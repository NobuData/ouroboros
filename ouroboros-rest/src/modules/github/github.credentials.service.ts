/**
 * The GitHub token's whole life: set it, rotate it, clear it, read what may be said about it,
 * and hand it to a client that is about to call GitHub.
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)), decision **K1**.
 *
 * ```
 * PUT    /settings/github-token  ─▶ seal ─▶ upsert ─▶ forget budget ─▶ audit ─▶ ghp_••••abcd
 * DELETE /settings/github-token  ─▶ delete ────────▶ forget budget ─▶ audit ─▶ configured:false
 * GET    /settings/github-token  ─▶ find ─▶ open ─▶ mask ─▶ erase ─▶ ghp_••••abcd
 * (internal) tokenFor(workspace) ─▶ find ─▶ open ─▶ the caller's, for one call
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Set and rotate are one operation, and the trail is where they differ.**
 *
 * There is one token per workspace, so *"replace it"* and *"add one"* are the same upsert
 * against the same primary key. Making them two endpoints would mean a client had to know
 * which state it was in before it could ask, and would answer `409` to an administrator who
 * guessed wrong about a token somebody else had already set. So there is one `PUT`, and what
 * distinguishes the two is the audit event it writes — decided by asking whether a row was
 * there, which is a question with no secret in it.
 *
 * **The old token is never used again**, and that is not a matter of the code intending it:
 * the column holds one value, the upsert replaces it, and nothing anywhere caches a decrypted
 * token — {@link tokenFor} opens the stored envelope on every call and hands the plaintext to
 * one client for one operation. The one thing that *would* have outlived a rotation is the
 * rate-limit view, which describes the **old** token's hourly window; {@link forget} on the
 * limiter is what stops a freshly pasted token inheriting a spent budget.
 *
 * ---------------------------------------------------------------------------
 * **Where the plaintext exists, and for how long.**
 *
 * On the write path it is the string the DTO validated, sealed by the vault and used once
 * more to compute the mask. On the read paths it is a `Buffer` the vault hands over and this
 * file erases in a `finally`. {@link tokenFor} is the one method that returns a plaintext,
 * and it returns a `string` because that is what an HTTP client needs — the vault's
 * `decryptText` documents that weaker guarantee and this inherits it rather than pretending
 * otherwise.
 *
 * **Nothing here logs.** Not the token, not the mask, not the envelope, not a length. The
 * failures this file raises name a workspace. `github.secrecy.spec.ts` is the proof, run over
 * these code paths rather than over a payload written to be clean.
 */

import { Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import {
  GITHUB_TOKEN_CLEARED_EVENT,
  GITHUB_TOKEN_ROTATED_EVENT,
  GITHUB_TOKEN_SET_EVENT,
  type AuditAction,
} from "../audit/audit.events";
import { zeroize } from "../vault/envelope";
import { VaultService } from "../vault/vault.service";
import { GithubCredentialsRepository } from "./github.credentials.repository";
import { GITHUB_FAILURES, GithubApiError } from "./github.errors";
import { GithubRateLimiter } from "./github.rate-limit";
import { githubTokenResource, noGithubToken, type GithubTokenResource } from "./github.resources";
import { maskToken } from "./github.token";

/** What kind of thing these events are about — V022's non-referential `subject_type`. */
export const GITHUB_CREDENTIAL_SUBJECT = "github_credential";

/** Who did it, and when — the parts of an operation the trail needs and the domain does not. */
export interface CredentialActor {
  /** The workspace, from the tenant context. Never from the request. */
  readonly organizationId: string;
  /** Who — `"user".id`, from the session. */
  readonly actorId: string;
  /** When. Supplied so one operation's row and its event agree. */
  readonly at: Date;
}

@Injectable()
export class GithubCredentialsService {
  /**
   * @param credentials - The four statements against `github_credentials`.
   * @param vault - AD.1's envelope encryption ([#222](https://github.com/NobuData/ouroboros/issues/222)).
   *   The only thing in this service that can open a stored token.
   * @param limiter - The rate guard, so a replaced token starts with a clean view of its
   *   budget.
   * @param audit - AD.4's trail ([#225](https://github.com/NobuData/ouroboros/issues/225)).
   *   Credential operations are audited from the day they exist, per decision **AD.4**.
   */
  constructor(
    private readonly credentials: GithubCredentialsRepository,
    private readonly vault: VaultService,
    private readonly limiter: GithubRateLimiter,
    private readonly audit: AuditService,
  ) {}

  /**
   * What may be said about this workspace's token.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The masked resource, or the not-configured one. Never a 404: the surface always
   *   has a state to render.
   */
  async read(organizationId: string): Promise<GithubTokenResource> {
    const row = await this.credentials.find(organizationId);

    if (row === undefined) {
      return noGithubToken();
    }

    const plaintext = await this.vault.decrypt(
      organizationId,
      // The record id is the workspace id — V027's primary key, and what the envelope's
      // additional authenticated data was bound to on the way in. Passing anything else here
      // is an authentication failure rather than a wrong answer, which is the property the
      // vault's AAD exists to give.
      organizationId,
      row.token_encrypted,
    );

    try {
      return githubTokenResource(maskToken(plaintext), row);
    } finally {
      zeroize(plaintext);
    }
  }

  /**
   * Store a token, replacing whatever was there.
   *
   * @param actor - Who, where and when.
   * @param token - The token, already validated for shape by the DTO. This service does not
   *   ask GitHub whether it works: a live check belongs to the test-connection affordance
   *   (Q.4, [#141](https://github.com/NobuData/ouroboros/issues/141)), and refusing to
   *   *store* a token because GitHub was unreachable would make a network outage look like a
   *   bad credential.
   * @returns The masked resource, as it now stands.
   */
  async set(actor: CredentialActor, token: string): Promise<GithubTokenResource> {
    const replaced = await this.credentials.exists(actor.organizationId);
    const envelope = await this.vault.encryptText(
      actor.organizationId,
      actor.organizationId,
      token,
    );
    const row = await this.credentials.upsert(actor.organizationId, envelope);

    // The budget belonged to the token that has just been replaced. See this file's header.
    this.limiter.forget(actor.organizationId);

    await this.write(replaced ? GITHUB_TOKEN_ROTATED_EVENT : GITHUB_TOKEN_SET_EVENT, actor, {
      rotated: replaced,
    });

    const bytes = Buffer.from(token, "utf8");

    try {
      return githubTokenResource(maskToken(bytes), row);
    } finally {
      zeroize(bytes);
    }
  }

  /**
   * Remove this workspace's token.
   *
   * Idempotent: clearing a workspace that has none succeeds and says so. A `404` would be
   * telling an administrator that the thing they wanted gone is not there, which is the
   * outcome they asked for.
   *
   * @param actor - Who, where and when.
   * @returns The not-configured resource.
   */
  async clear(actor: CredentialActor): Promise<GithubTokenResource> {
    const removed = await this.credentials.remove(actor.organizationId);

    this.limiter.forget(actor.organizationId);

    // Written even when there was nothing to remove — see GITHUB_TOKEN_CLEARED_EVENT on why
    // a trail of actions beats a trail of outcomes.
    await this.write(GITHUB_TOKEN_CLEARED_EVENT, actor, { removed });

    return noGithubToken();
  }

  /**
   * Which workspaces have a token at all.
   *
   * The backlog sync's entry point (K.4,
   * [#102](https://github.com/NobuData/ouroboros/issues/102)): a poll runs on a timer with
   * nobody signed in, so it has no workspace to ask about and has to start from the set of
   * workspaces that are configured. It is also what makes the sync's two *off* states
   * distinguishable — a workspace with no token reads `not_configured`, and a workspace with
   * a token and no enabled repositories reads `no_repositories`.
   *
   * **No credential is loaded.** The statement selects the key column only, so this method
   * cannot leak what it does not fetch — which is why it is here rather than a caller mapping
   * over {@link tokenFor}.
   *
   * @returns The workspace ids that have a stored token, in no particular order.
   */
  async configuredOrganizations(): Promise<string[]> {
    return this.credentials.configured();
  }

  /**
   * The workspace's token, opened, for one call to GitHub.
   *
   * The one method that answers with a live credential, and it is not reachable over HTTP:
   * `github.module.ts` exports this service to the client factory and to K.4's sync
   * ([#102](https://github.com/NobuData/ouroboros/issues/102)), and the controller only ever
   * calls the three above.
   *
   * @param organizationId - The workspace.
   * @returns The token.
   * @throws {GithubApiError} `not_configured` when the workspace has none — the designed
   *   status the *"clear → sync pauses"* criterion is about. A thrown reason rather than an
   *   `undefined` the caller might forget to check, and the reason the sync renders instead
   *   of a stack trace.
   */
  async tokenFor(organizationId: string): Promise<string> {
    const row = await this.credentials.find(organizationId);

    if (row === undefined) {
      throw new GithubApiError(
        GITHUB_FAILURES.notConfigured,
        `workspace ${organizationId} has no GitHub token`,
      );
    }

    return this.vault.decryptText(organizationId, organizationId, row.token_encrypted);
  }

  /**
   * Append one event to the trail.
   *
   * Awaited and **not** swallowed, which is `connection.audit.ts`'s posture for the success
   * path: a credential change nobody can prove happened is worse than a request that failed
   * loudly, and the caller can retry a `PUT` that is idempotent by construction.
   *
   * @param action - Which event.
   * @param actor - Who, where and when.
   * @param detail - What else to record. Never anything derived from the token — not the
   *   mask, not a length, not a prefix.
   */
  private async write(
    action: AuditAction,
    actor: CredentialActor,
    detail: Record<string, boolean>,
  ): Promise<void> {
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      action,
      subjectType: GITHUB_CREDENTIAL_SUBJECT,
      // There is one token per workspace, so the credential has no identity of its own — the
      // workspace *is* the subject. Named rather than left null, so the trail's own filter
      // finds these events beside a connection's.
      subjectId: actor.organizationId,
      at: actor.at,
      detail: { ...detail, outcome: "success" },
    });
  }
}
