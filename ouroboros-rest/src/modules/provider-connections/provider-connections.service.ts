/**
 * The credential lifecycle — add, read, reveal, rotate, edit, delete — and the six rules
 * that make each of them safe by construction.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)), roadmap decision **P4**.
 *
 * ```
 * add    ─▶ schema ─▶ live validate ─▶ seal ─▶ store     ✗ anywhere = nothing persisted
 * read   ─▶ mask, server-side                            the value is never in the payload
 * reveal ─▶ rate limit ─▶ step-up ─▶ open ─▶ audit       the one endpoint that answers a key
 * rotate ─▶ live validate NEW ─▶ atomic swap ─▶ retire   ✗ = the old key is still live
 * edit   ─▶ schema ─▶ live validate ─▶ store             an address is checked like an add
 * delete ─▶ dependent aliases? ─▶ 409 naming them        Y.1's FK, as a designed refusal
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The order of operations is the whole ticket.** Every one of these is *check, then
 * write*, and the checks are ordered so that the expensive and the dangerous ones happen
 * last:
 *
 *   * **Nothing reaches the database before the provider has agreed.** `add` calls the
 *     adapter *before* it seals anything and before it inserts, which is what makes
 *     *adding a provider with an invalid key fails without persisting anything* a property
 *     of the control flow rather than a promise. There is no row to clean up on failure
 *     because there was never a row.
 *   * **`rotate` validates the new credential against the live provider and only then
 *     swaps.** The swap is one conditional `update` — see the repository — so the old
 *     credential is live until the instant the new one is, and a failed validation returns
 *     before any statement is issued at all.
 *   * **`reveal` counts the attempt before it checks the step-up.** That ordering is a
 *     security property, not a preference: a limiter behind the step-up would leave the
 *     password comparison unlimited.
 *
 * ---------------------------------------------------------------------------
 * **Where the plaintext lives, and for how long.** Exactly three paths open a credential —
 * `add` (which already has it, from the request), `reveal` (which is what the endpoint is
 * for) and `edit` and `rotate` (which need it to ask the provider whether a new address or
 * a new key works). Each holds it for the length of one call. The list path opens each
 * credential to compute a mask and drops it immediately; `masking.ts` explains why it reads
 * bytes rather than a string, and why the bytes it decodes are only the tail.
 *
 * Nothing here logs a credential, and `ouroboros/no-secret-logging` is applied to this
 * whole service rather than to the vault alone precisely so that this module is covered —
 * see `eslint.config.mjs`, which names this ticket.
 */

import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import type { AuthRequest } from "../auth/http";
import type { Principal } from "../auth/principal";
import { PROVIDER_UPDATED_EVENT, type AuditAction } from "../audit/audit.events";
import type { ProviderConnectionKind } from "../db/schema";
import { ModelProviderRegistry } from "../providers/provider.registry";
import type { ModelProviderAdapter, ProviderValidation } from "../providers/provider.adapter";
import { CAPABILITY_NOTE_FIELD, type ProviderConfigSchema } from "../providers/provider.config";
import {
  partitionSubmission,
  secretFieldName,
  storedConfigSchema,
} from "../providers/provider.forms";
import { isProviderConnectionInUse, providerConnectionInUse } from "../registry/registry.errors";
import { RegistryService } from "../registry/registry.service";
import { pageOf, windowOf, type Page } from "../tenancy/pagination";
import { zeroize } from "../vault/envelope";
import { VaultService } from "../vault/vault.service";
import { columnsFor, submissionOf, unstorableFields } from "./config.mapping";
import { configViolations } from "./config.validation";
import {
  ProviderAudit,
  PROVIDER_ADDED_EVENT,
  PROVIDER_DELETED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  type ProviderAuditAttempt,
  type ProviderAuditContext,
} from "./connection.audit";
import { maskCredential } from "./masking";
import {
  configInvalid,
  configNotStorable,
  connectionChanged,
  connectionNotFound,
  credentialAbsent,
  providerValidationFailed,
  revealRateLimited,
  stepUpRequired,
} from "./provider-connections.errors";
import {
  ProviderConnectionsRepository,
  type ConnectionPatch,
  type ConnectionRow,
  type NewConnection,
} from "./provider-connections.repository";
import type {
  CreateConnectionDto,
  ListConnectionsQuery,
  RevealConnectionDto,
  RotateConnectionDto,
  UpdateConnectionDto,
} from "./provider-connections.dto";
import {
  connectionResource,
  type ProviderConnectionResource,
  type RevealResource,
} from "./resources";
import { RevealLimiter } from "./reveal.limiter";
import { STEP_UP_METHODS, STEP_UP_MAX_AGE_SECONDS, StepUpService } from "./step-up";

/**
 * How long a client is told to keep a revealed credential on screen, in seconds — **sixty**.
 *
 * An instruction rather than an enforcement, and the resource says so: a value handed to a
 * browser is in the browser, and no header this service sends takes it back. It is published
 * because the alternative is every client inventing its own timeout and most of them
 * choosing *never* — mockup 07's Reveal is a glance at a key, not a panel somebody leaves
 * open.
 */
export const REVEAL_TTL_SECONDS = 60;

/**
 * A {@link ProviderAuditAttempt} while the operation it describes is still running.
 *
 * `ProviderAuditAttempt` is `readonly` because a *recorded* attempt is a fact and facts do
 * not change. This is the same shape before it becomes one: the provider kind is usually not
 * known until the operation has read its row, and the connection id is not known at all until
 * an `add` has minted one, so the wrapper hands the operation a draft to fill in and reads
 * whatever it holds if the operation throws.
 *
 * Written as a mapped type rather than as a second interface so the two cannot drift: a field
 * added to the attempt is a field the draft has.
 */
type AuditAttemptDraft = { -readonly [K in keyof ProviderAuditAttempt]: ProviderAuditAttempt[K] };

@Injectable()
export class ProviderConnectionsService {
  /**
   * @param connections - The statements against `provider_connections`.
   * @param registry - AC.1's adapter lookup. The **only** way this module reaches a
   *   provider: `.dependency-cruiser.cjs` makes an import of an adapter from here a build
   *   failure, which is what keeps decision **P1**'s promise that no core service learns a
   *   vendor's name.
   * @param vault - AD.1's envelope encryption. Every credential this module stores goes
   *   through it, and V015's own CHECK is what makes that true of every other writer too.
   * @param aliases - Y.1's registry service, for the one question `DELETE` has to ask:
   *   which aliases resolve on this connection.
   * @param stepUp - The re-authentication reveal requires.
   * @param limiter - How often a credential may be asked for.
   * @param audit - The trail. Interim sink until AD.4 (#225) — see `connection.audit.ts`.
   */
  constructor(
    private readonly connections: ProviderConnectionsRepository,
    private readonly registry: ModelProviderRegistry,
    private readonly vault: VaultService,
    private readonly aliases: RegistryService,
    private readonly stepUp: StepUpService,
    private readonly limiter: RevealLimiter,
    private readonly audit: ProviderAudit,
  ) {}

  /**
   * One page of this workspace's connections, each with its credential masked.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param query - The window. Defaults per the #31 pagination convention.
   * @returns The page, ordered by name. Empty for a workspace that has configured no
   *   providers — mockup 07's dashed-card empty state, not a failure.
   */
  async list(
    organizationId: string,
    query: ListConnectionsQuery,
  ): Promise<Page<ProviderConnectionResource>> {
    const window = windowOf(query);
    const { rows, total } = await this.connections.list(organizationId, window);
    const envelopes = await this.connections.envelopesFor(
      organizationId,
      rows.map((row) => row.id),
    );

    const items = await Promise.all(
      rows.map(async (row) =>
        connectionResource(row, await this.mask(organizationId, row.id, envelopes.get(row.id))),
      ),
    );

    return pageOf(items, total, window);
  }

  /**
   * One connection, with its credential masked.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection.
   * @returns The resource.
   * @throws {NotFoundError} `404 provider_connection_not_found` when this workspace has no
   *   such connection — including when another workspace does.
   */
  async read(organizationId: string, connectionId: string): Promise<ProviderConnectionResource> {
    const row = await this.require(organizationId, connectionId);
    const envelope = await this.connections.envelopeOf(organizationId, connectionId);

    return connectionResource(row, await this.mask(organizationId, connectionId, envelope));
  }

  /**
   * Connect a provider — schema-checked, live-validated, sealed, then stored.
   *
   * **Nothing is written until the provider has agreed.** See this file's header on why the
   * order is the ticket.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param actorId - `"user".id` of whoever is adding it. Stored as `added_by` and recorded
   *   in the audit event; taken from the session, never from the body.
   * @param body - The validated request.
   * @returns The connection as stored, masked.
   * @throws {NotImplementedError} `501 provider_kind_unsupported` from the registry when
   *   this build has no adapter for the kind, or `501 provider_config_not_storable` when a
   *   submitted setting has no column — see `provider-connections.errors.ts`.
   * @throws {InvalidRequestError} `422 provider_config_invalid` when the submission does not
   *   satisfy the adapter's schema, or `422 provider_validation_failed` when the provider
   *   itself refused it.
   */
  async add(
    organizationId: string,
    actorId: string,
    body: CreateConnectionDto,
  ): Promise<ProviderConnectionResource> {
    const at = new Date();
    // The kind is known from the body, so a refused add records *which provider was being
    // connected* — which is most of what makes the row worth having. The connection id
    // stays null unless the insert gets that far, because until it does there is genuinely
    // no row to name; see `connection.audit.ts` on why that is a second shape rather than a
    // widened one.
    const attempt: AuditAttemptDraft = {
      organizationId,
      connectionId: null,
      kind: body.kind,
      actorId,
      at,
    };

    return this.recording(PROVIDER_ADDED_EVENT, attempt, async () => {
      const adapter = this.registry.get(body.kind);
      const schema = adapter.configSchema();

      this.refuseBadConfig(schema, body.kind, body.config);

      const submission = partitionSubmission(schema, body.config);
      const validation = await this.checked(adapter, submission.config, submission.secret);

      // The id is minted here rather than by the column's default, because the vault binds a
      // ciphertext to `(organization, record)` — so the row's identity has to exist before its
      // credential can be sealed. See the repository's `insert`.
      const connectionId = randomUUID();
      const columns = columnsFor(submission.config);

      attempt.connectionId = connectionId;

      const row = await this.connections.insert(
        {
          id: connectionId,
          organization_id: organizationId,
          kind: body.kind,
          display_name: body.displayName,
          base_url: columns.base_url,
          capability_note: columns.capability_note,
          status: "active",
          last_checked_at: at,
          health: healthOf(validation),
          monthly_cap_cents: body.monthlyCapCents ?? null,
          added_by: actorId,
        } satisfies NewConnection,
        submission.secret === null
          ? null
          : await this.vault.encryptText(organizationId, connectionId, submission.secret),
      );

      // The resource is built *before* the event is recorded, and that ordering is the
      // "exactly one event" rule rather than a preference: `recording()` writes a refusal for
      // anything this callback throws, so a statement that could throw *after* a successful
      // audit write would leave two rows describing one operation. The audit call is
      // therefore the last thing here that can fail, in all five operations.
      const resource = connectionResource(row, maskOf(submission.secret));

      await this.audit.added(contextFor(organizationId, row, actorId, at));

      return resource;
    });
  }

  /**
   * Hand back a stored credential, once the caller has proved who they are.
   *
   * The one endpoint in this API that answers with a live credential, and the only one with
   * four gates in front of it. In order: **rate limit**, **step-up**, **existence**,
   * **presence of a credential** — see this file's header on why the limiter is first.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param principal - The resolved session — whose attempts are counted, and whose step-up
   *   is checked.
   * @param request - The request, for the cookie the step-up's password check authenticates
   *   with. Only its `Cookie` header is read.
   * @param connectionId - The connection.
   * @param body - The validated request; carries a password when the caller is stepping up
   *   with one.
   * @param now - The instant. Injected so a suite can drive a rate-limit window without
   *   waiting through one; every caller in the application passes nothing.
   * @returns The credential, and when a client should stop showing it.
   * @throws {TooManyRequestsError} `429 provider_reveal_rate_limited`.
   * @throws {UnauthenticatedError} `401 step_up_required` when there is no recent
   *   re-authentication — and equally when the password offered was wrong. See `step-up.ts`
   *   on why those two answer alike.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   * @throws {ConflictError} `409 provider_credential_absent` for a provider that stores none.
   */
  async reveal(
    organizationId: string,
    principal: Principal,
    request: AuthRequest,
    connectionId: string,
    body: RevealConnectionDto,
    now: Date = new Date(),
  ): Promise<RevealResource> {
    // The kind starts unknown and is filled in once the row has been read. A reveal is rate-
    // limited *before* anything is fetched — see this file's header on why the limiter is
    // first — so a refusal on that path genuinely does not know which provider was being
    // asked for, and recording a guess would be worse than recording nothing.
    const attempt: AuditAttemptDraft = {
      organizationId,
      connectionId,
      kind: null,
      actorId: principal.user.id,
      at: now,
    };

    return this.recording(PROVIDER_REVEALED_EVENT, attempt, async () => {
      const exceeded = this.limiter.attempt(principal.user.id, connectionId, now);

      if (exceeded !== null) {
        throw revealRateLimited(exceeded.scope, exceeded.retryAfterSeconds);
      }

      const method = await this.stepUp.satisfied(principal, request, body.password, now);

      if (method === null) {
        throw stepUpRequired([...STEP_UP_METHODS], STEP_UP_MAX_AGE_SECONDS);
      }

      const row = await this.require(organizationId, connectionId);

      attempt.kind = row.kind;

      const envelope = await this.connections.envelopeOf(organizationId, connectionId);

      if (envelope === null || envelope === undefined) {
        throw credentialAbsent(connectionId);
      }

      const value = await this.vault.decryptText(organizationId, connectionId, envelope);

      // Awaited before the credential is returned, and that ordering is the point rather
      // than the style: an unaudited reveal is the one outcome decision P5 exists to
      // prevent, and here — unlike after a rotation or a delete — nothing has happened yet
      // that a refusal would have to un-happen. See `audit.service.ts`.
      await this.audit.revealed(contextFor(organizationId, row, principal.user.id, now), method);

      return {
        connectionId,
        value,
        expiresAt: new Date(now.getTime() + REVEAL_TTL_SECONDS * 1000).toISOString(),
      };
    });
  }

  /**
   * Replace a credential — verify the new one against the live provider, then swap.
   *
   * **A failed validation leaves the old credential live and working**, because the failure
   * happens before any statement is issued. That is the ticket's criterion, and it is a
   * property of these six lines rather than of a rollback.
   *
   * A connection whose provider takes no credential at all — an Ollama host — is refused:
   * there is nothing to rotate, and writing one would seal a credential the adapter would
   * never send. A connection whose provider takes an *optional* one and currently has none
   * is **not** refused: an OpenAI-compatible endpoint that has just been put behind auth is
   * a real thing to rotate onto, and the new key is live-validated exactly as any other.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param actorId - `"user".id` of whoever is rotating it.
   * @param connectionId - The connection.
   * @param body - The new credential.
   * @returns The connection after the swap, masked with the new credential's suffix.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   * @throws {ConflictError} `409 provider_credential_absent` when the provider takes none,
   *   or `409 provider_connection_changed` when the row moved under the validation.
   * @throws {InvalidRequestError} `422 provider_validation_failed` when the provider refused
   *   the new credential.
   */
  async rotate(
    organizationId: string,
    actorId: string,
    connectionId: string,
    body: RotateConnectionDto,
  ): Promise<ProviderConnectionResource> {
    const at = new Date();
    const attempt: AuditAttemptDraft = {
      organizationId,
      connectionId,
      kind: null,
      actorId,
      at,
    };

    return this.recording(PROVIDER_ROTATED_EVENT, attempt, () =>
      this.rotating(organizationId, actorId, connectionId, body, at, attempt),
    );
  }

  /**
   * The rotation itself, once the trail is watching it.
   *
   * Split out rather than nested inside {@link ProviderConnectionsService.rotate}, which is
   * what the other four operations do: this one is long enough that another level of
   * indentation would push the interesting part — *validate the new credential, then swap* —
   * off the left margin, and the whole of AD.2's argument is that the order of these
   * statements is the ticket.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is rotating it.
   * @param connectionId - The connection.
   * @param body - The validated request.
   * @param at - The instant, minted by the caller so the attempt and the event agree.
   * @param attempt - The draft the caller will record a refusal from; this fills in the
   *   provider kind as soon as the row makes it known.
   * @returns The connection after the swap, masked.
   */
  private async rotating(
    organizationId: string,
    actorId: string,
    connectionId: string,
    body: RotateConnectionDto,
    at: Date,
    attempt: AuditAttemptDraft,
  ): Promise<ProviderConnectionResource> {
    const row = await this.require(organizationId, connectionId);

    attempt.kind = row.kind;

    const adapter = this.registry.get(row.kind);
    const schema = adapter.configSchema();

    if (secretFieldName(schema) === null) {
      throw credentialAbsent(connectionId);
    }

    const previous = await this.connections.envelopeOf(organizationId, connectionId);

    if (previous === undefined) {
      throw connectionNotFound(connectionId);
    }

    const config = Object.freeze(submissionOf(storedConfigSchema(schema), row));
    const validation = await this.checked(adapter, config, body.secret);

    const swapped = await this.connections.swapCredential(
      organizationId,
      connectionId,
      previous,
      await this.vault.encryptText(organizationId, connectionId, body.secret),
      at,
      healthOf(validation),
    );

    if (swapped === undefined) {
      throw connectionChanged(connectionId);
    }

    // Built before the event is recorded — see `add` for why that ordering is the rule.
    const resource = connectionResource(swapped, maskOf(body.secret));

    await this.audit.rotated(contextFor(organizationId, swapped, actorId, at));

    return resource;
  }

  /**
   * Change a connection's settings — the switch, the cap, the note, the address.
   *
   * **A body carrying `config` is validated exactly as an add is**, live provider included:
   * an address is the one setting that can make a working connection stop working, and
   * checking it here is what stops that being discovered by the next run instead. The stored
   * credential is opened for the length of that one check, because a provider cannot answer
   * *does this address work* without one.
   *
   * A body that changes nothing is answered with the connection unchanged and writes no
   * audit event. That is what `PATCH {}` means, and refusing it would need a code for a
   * request that has done no harm.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param actorId - `"user".id` of whoever is editing it.
   * @param connectionId - The connection.
   * @param body - The validated request.
   * @returns The connection after the change.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   * @throws {InvalidRequestError} `422 provider_config_invalid` or
   *   `422 provider_validation_failed`, on the same terms as an add.
   */
  async update(
    organizationId: string,
    actorId: string,
    connectionId: string,
    body: UpdateConnectionDto,
  ): Promise<ProviderConnectionResource> {
    const at = new Date();
    const attempt: AuditAttemptDraft = {
      organizationId,
      connectionId,
      kind: null,
      actorId,
      at,
    };

    // `provider.updated` is the name a *refused* edit records under, whichever of the four a
    // successful one would have chosen. The specialisation in `providerUpdateEvent` reads
    // what the request actually wrote, and a request that was refused wrote nothing — so
    // `provider.enabled` on an edit that never flipped a switch would be the trail
    // describing an intention rather than an act.
    return this.recording(PROVIDER_UPDATED_EVENT, attempt, () =>
      this.updating(organizationId, actorId, connectionId, body, at, attempt),
    );
  }

  /**
   * The edit itself, once the trail is watching it.
   *
   * Split out for {@link ProviderConnectionsService.rotating}'s reason: this method is a
   * sequence of five near-identical blocks, and the thing worth seeing about it is that they
   * are in a deliberate order (see the `capabilityNote` comment below).
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is editing it.
   * @param connectionId - The connection.
   * @param body - The validated request.
   * @param at - The instant, minted by the caller so the attempt and the event agree.
   * @param attempt - The draft the caller will record a refusal from.
   * @returns The connection after the change.
   */
  private async updating(
    organizationId: string,
    actorId: string,
    connectionId: string,
    body: UpdateConnectionDto,
    at: Date,
    attempt: AuditAttemptDraft,
  ): Promise<ProviderConnectionResource> {
    const row = await this.require(organizationId, connectionId);

    attempt.kind = row.kind;

    const fields: string[] = [];
    let patch: ConnectionPatch = {};

    if (body.config !== undefined) {
      const { columns, revalidated } = await this.editedConfig(
        organizationId,
        row,
        body.config,
        at,
      );

      patch = { ...patch, ...columns, ...revalidated };
      fields.push("config");
    }

    if (body.displayName !== undefined) {
      patch = { ...patch, display_name: body.displayName };
      fields.push("displayName");
    }

    if (body.enabled !== undefined) {
      patch = { ...patch, enabled: body.enabled };
      fields.push("enabled");
    }

    if (body.monthlyCapCents !== undefined) {
      patch = { ...patch, monthly_cap_cents: body.monthlyCapCents };
      fields.push("monthlyCapCents");
    }

    // Applied after the config columns on purpose: a request that edits an address *and*
    // clears the note must end with the note cleared, whatever the adapter's schema says
    // about a `capabilityNote` field. See the DTO on why the note is a connection field.
    if (body.capabilityNote !== undefined) {
      patch = { ...patch, capability_note: body.capabilityNote };
      fields.push("capabilityNote");
    }

    if (fields.length === 0) {
      const envelope = await this.connections.envelopeOf(organizationId, connectionId);

      return connectionResource(row, await this.mask(organizationId, connectionId, envelope));
    }

    const updated = await this.connections.update(organizationId, connectionId, patch);

    if (updated === undefined) {
      throw connectionNotFound(connectionId);
    }

    // Re-read rather than remembered: nothing on this path changes the credential — that is
    // `rotate`'s — so the mask is whatever the row still holds, and reading it here keeps
    // this method free of a second way for a plaintext to be in scope. Read *before* the
    // event is recorded — see `add` for why that ordering is the "exactly one event" rule.
    const envelope = await this.connections.envelopeOf(organizationId, connectionId);
    const resource = connectionResource(
      updated,
      await this.mask(organizationId, connectionId, envelope),
    );

    await this.audit.updated(
      contextFor(organizationId, updated, actorId, at),
      fields.sort(),
      // The two figures are only recorded when the cap is what moved. A `from`/`to` pair on
      // an edit that did not touch the cap would be two more columns of *unchanged* in every
      // settings event, which is how a payload stops being read.
      body.monthlyCapCents === undefined
        ? undefined
        : { from: row.monthly_cap_cents, to: body.monthlyCapCents },
      body.enabled,
    );

    return resource;
  }

  /**
   * Remove a connection, unless the workspace's routing still points at it.
   *
   * The refusal is Y.1's ([#189](https://github.com/NobuData/ouroboros/issues/189)), written
   * there *for* this ticket: V015's `model_aliases_provider_fk` is what makes the delete
   * impossible, and `providerConnectionInUse` is what turns *violates foreign key
   * constraint* into a sentence naming the aliases somebody has to repoint first.
   *
   * Both directions are covered, which is why the `catch` is here and not merely a
   * pre-flight: an alias created between the check and the delete makes PostgreSQL refuse
   * anyway, and a caller that could not recognise that would report a designed `409` as an
   * unexplained `500`.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param actorId - `"user".id` of whoever is removing it.
   * @param connectionId - The connection.
   * @returns When it is gone.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   * @throws {ConflictError} `409 provider_connection_in_use`, naming the aliases.
   */
  async remove(organizationId: string, actorId: string, connectionId: string): Promise<void> {
    const at = new Date();
    const attempt: AuditAttemptDraft = {
      organizationId,
      connectionId,
      kind: null,
      actorId,
      at,
    };

    await this.recording(PROVIDER_DELETED_EVENT, attempt, async () => {
      const row = await this.require(organizationId, connectionId);

      attempt.kind = row.kind;

      const dependents = await this.aliases.dependentAliases(organizationId, connectionId);

      if (dependents.length > 0) {
        throw providerConnectionInUse(connectionId, dependents);
      }

      try {
        if (!(await this.connections.remove(organizationId, connectionId))) {
          throw connectionNotFound(connectionId);
        }
      } catch (error) {
        throw await this.explainDeleteFailure(organizationId, connectionId, error);
      }

      await this.audit.deleted(contextFor(organizationId, row, actorId, at));
    });
  }

  /**
   * Run one lifecycle operation with the trail watching it.
   *
   * **This is what makes *every operation writes exactly one event* a property of the
   * control flow** rather than of five call sites that each remembered. The success event is
   * written by the operation itself, at the one point it is known to have happened; this
   * covers the other half — the refusal — under the same action name, with `outcome` and
   * `reason` saying which it was. See `connection.audit.ts` on why a refusal is an event at
   * all, and why AD.2 recorded no such thing.
   *
   * `ProviderAudit.failed` swallows what it cannot store, which is what keeps this wrapper
   * transparent: the error the caller sees is always the operation's own, never the trail's.
   *
   * @param action - The action the operation would have recorded had it succeeded.
   * @param attempt - What is known about the attempt. Mutable on purpose — the provider kind
   *   is often not known until the operation has read the row, and a refusal after that point
   *   should say which provider it was about.
   * @param work - The operation.
   * @returns Whatever the operation returned.
   * @throws Whatever the operation threw, unchanged.
   */
  private async recording<T>(
    action: AuditAction,
    attempt: AuditAttemptDraft,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      await this.audit.failed(attempt, action, error);

      throw error;
    }
  }

  /**
   * One connection, or the refusal that says there is none.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection.
   * @returns The row.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   */
  private async require(organizationId: string, connectionId: string): Promise<ConnectionRow> {
    const row = await this.connections.find(organizationId, connectionId);

    if (row === undefined) {
      throw connectionNotFound(connectionId);
    }

    return row;
  }

  /**
   * Refuse a submission the adapter's schema will not accept, or that this build cannot keep.
   *
   * Two refusals in one place because they are asked in one order and always together: a
   * field with nowhere to go is only worth complaining about once the submission is known to
   * be otherwise valid, or a typo would answer `501` when it deserves a `422`.
   *
   * @param schema - The schema to check against.
   * @param kind - The provider kind, for the `501`'s message.
   * @param values - The submission.
   * @throws {InvalidRequestError} `422 provider_config_invalid`.
   * @throws {NotImplementedError} `501 provider_config_not_storable`.
   */
  private refuseBadConfig(
    schema: ProviderConfigSchema,
    kind: ProviderConnectionKind,
    values: Readonly<Record<string, string>>,
  ): void {
    const violations = configViolations(schema, values);

    if (Object.keys(violations).length > 0) {
      throw configInvalid(violations);
    }

    const unstorable = unstorableFields(schema, values);

    if (unstorable.length > 0) {
      throw configNotStorable(kind, unstorable);
    }
  }

  /**
   * Ask the provider, and turn a refusal into the designed error.
   *
   * @param adapter - The adapter for the connection's kind.
   * @param config - The settings to check.
   * @param secret - The credential to check, or null.
   * @returns What the check found, narrowed to the success — the failure branch throws.
   * @throws {InvalidRequestError} `422 provider_validation_failed`.
   */
  private async checked(
    adapter: ModelProviderAdapter,
    config: Readonly<Record<string, string>>,
    secret: string | null,
  ): Promise<ProviderValidation> {
    const validation = await adapter.validate(config, secret);

    if (validation.status === "failed") {
      throw providerValidationFailed(validation);
    }

    return validation;
  }

  /**
   * An edit's configuration: merged over what is stored, validated, and checked live.
   *
   * The merge is why a partial edit can be judged at all — a schema's rules can span fields,
   * and half a request cannot be checked against them. The stored credential is opened for
   * the one call that needs it and is not retained.
   *
   * @param organizationId - The workspace.
   * @param row - The connection as stored.
   * @param edited - What the body sent.
   * @param at - The instant the check is stamped with.
   * @returns The columns to write, and the health the check measured.
   * @throws {InvalidRequestError} `422 provider_config_invalid` — including for a
   *   `capabilityNote` sent inside `config`, which has a field of its own on this body and
   *   would otherwise be settable two ways with no rule about which wins.
   * @throws {NotImplementedError} `501 provider_config_not_storable`.
   */
  private async editedConfig(
    organizationId: string,
    row: ConnectionRow,
    edited: Readonly<Record<string, string>>,
    at: Date,
  ): Promise<{ columns: ConnectionPatch; revalidated: ConnectionPatch }> {
    if (CAPABILITY_NOTE_FIELD in edited) {
      throw configInvalid({
        [CAPABILITY_NOTE_FIELD]: [
          `${CAPABILITY_NOTE_FIELD} is a connection setting rather than a provider one — ` +
            "send it beside `enabled` and `monthlyCapCents` instead of inside `config`",
        ],
      });
    }

    const adapter = this.registry.get(row.kind);
    // The *stored* projection: the credential is not resubmitted on an edit, and demanding
    // it would make every provider whose key is required un-editable. `provider.forms.ts`
    // argues the distinction where it defines the projection.
    const schema = storedConfigSchema(adapter.configSchema());
    const merged = { ...submissionOf(schema, row), ...edited };

    this.refuseBadConfig(schema, row.kind, merged);

    const envelope = await this.connections.envelopeOf(organizationId, row.id);
    const secret =
      envelope === null || envelope === undefined
        ? null
        : await this.vault.decryptText(organizationId, row.id, envelope);

    const validation = await this.checked(adapter, Object.freeze(merged), secret);

    return {
      columns: columnsFor(merged),
      revalidated: { status: "active", last_checked_at: at, health: healthOf(validation) },
    };
  }

  /**
   * What a failed delete really was.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection.
   * @param error - Whatever the statement threw.
   * @returns The error to throw — the designed `409` when PostgreSQL refused because aliases
   *   depend on the connection and those aliases can still be named, and otherwise the
   *   original, unchanged. Re-reading rather than reusing the pre-flight's answer is the
   *   point: the pre-flight said *nothing depends on this*, so whatever appeared did so
   *   afterwards and only a fresh read knows its name.
   */
  private async explainDeleteFailure(
    organizationId: string,
    connectionId: string,
    error: unknown,
  ): Promise<unknown> {
    if (!isProviderConnectionInUse(error)) {
      return error;
    }

    const dependents = await this.aliases.dependentAliases(organizationId, connectionId);

    // Empty means the alias that caused the violation has itself since gone, which leaves
    // nothing to name — and an error naming no alias would be worse than the driver's.
    return dependents.length === 0 ? error : providerConnectionInUse(connectionId, dependents);
  }

  /**
   * The mask for one stored credential.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection, which is the record the envelope is bound to.
   * @param envelope - The sealed credential, `null` for a provider that stores none, or
   *   `undefined` when the row was not in the batch — which a caller that read the row and
   *   the envelope in two statements can legitimately see if the row was deleted in between.
   * @returns `••••Xq4A`, or null when there is nothing to mask.
   */
  private async mask(
    organizationId: string,
    connectionId: string,
    envelope: string | null | undefined,
  ): Promise<string | null> {
    if (envelope === null || envelope === undefined) {
      return null;
    }

    const plaintext = await this.vault.decrypt(organizationId, connectionId, envelope);

    try {
      return maskCredential(plaintext);
    } finally {
      // The vault hands the buffer over and says the caller owns it. This is the caller.
      zeroize(plaintext);
    }
  }
}

/**
 * The mask for a credential this process already has in hand.
 *
 * The add and rotate paths were *given* the plaintext by the request, so re-reading and
 * decrypting the row to mask it would be a query and a key unwrap to learn something already
 * known. The buffer is erased immediately; the string it was made from is the request body's
 * and is the collector's to reclaim, which is the same weaker guarantee `VaultService.encryptText`
 * documents for its own parameter.
 *
 * @param secret - The credential, or null when the provider stores none.
 * @returns `••••Xq4A`, or null.
 */
function maskOf(secret: string | null): string | null {
  if (secret === null) {
    return null;
  }

  const bytes = Buffer.from(secret, "utf8");

  try {
    return maskCredential(bytes);
  } finally {
    zeroize(bytes);
  }
}

/**
 * What a successful live check writes into `provider_connections.health`.
 *
 * V015 constrains the column: an object, whose `latency_ms` — if present — is a non-negative
 * number, and whose non-empty content requires a `last_checked_at`. Every caller here stamps
 * one, so the shape and the stamp travel together.
 *
 * @param validation - What the adapter's check found. Only a success reaches here; a failure
 *   has already been thrown as `422`, and `provider.adapter.ts` explains why a failure
 *   carries no latency to record.
 * @returns The health blob.
 */
function healthOf(validation: ProviderValidation): Record<string, unknown> {
  return validation.status === "ok" ? { latency_ms: validation.latencyMs } : {};
}

/**
 * The five fields every audit event carries.
 *
 * @param organizationId - The workspace.
 * @param row - The connection the operation was about.
 * @param actorId - `"user".id` of whoever did it.
 * @param at - When.
 * @returns The context.
 */
function contextFor(
  organizationId: string,
  row: ConnectionRow,
  actorId: string,
  at: Date,
): ProviderAuditContext {
  return { organizationId, connectionId: row.id, kind: row.kind, actorId, at };
}
