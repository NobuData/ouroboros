/**
 * The source credential a build runner checks a private repository out with (AG.7,
 * [#991](https://github.com/NobuData/ouroboros/issues/991), decision **L9**).
 *
 * ```
 * dispatch ── forOffer(job)  ──▶ ticket minted, hash in the ledger ──▶ job.offer.repository.credential
 * runner   ── POST /api/v1/farm/jobs/{id}/source-credential  Authorization: Bearer <ticket>
 *            ├─ no ledger · wrong ticket · expired · redeemed · job not running → 401, one code
 *            └─ redeemed_at set in one statement ──▶ the workspace's GitHub token, opened in
 *               request scope, answered once ──▶ audit runner.source_credential_redeemed
 * ```
 *
 * **What is handed over is the workspace's own GitHub token** — the K1 credential the
 * workspace stores for its backlog — scoped by the hand-over rather than by GitHub: one job,
 * one repository (the offer's), one redemption, a ticket that lives minutes, and an audit row.
 * GitHub issues no narrower token for a classic PAT; when O.1 (#122) mints installation tokens
 * the same call answers one of those. `docs/SECURITY_MODEL.md` § 4.8 is the decision.
 *
 * **A workspace with no GitHub token mints no ticket**: its repositories are cloned
 * anonymously, and a private one fails on the runner with a sentence that says so.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { RUNNER_SOURCE_CREDENTIAL_REDEEMED_EVENT } from "../../audit/audit.events";
import { AuditService } from "../../audit/audit.service";
import type { BuildJob } from "../../db/schema";
import { GithubCredentialsService } from "../../github/github.credentials.service";
import { type JobPhase } from "../dispatch/job.states";
import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import type { JobSourceCredential } from "../protocol/protocol.messages";
import { sourceCredentialRefused } from "./source-credential.errors";
import { SourceCredentialRepository } from "./source-credential.repository";
import { bearerTicket, mintSourceTicket, sourceTicketMatches } from "./source-credential.token";

/** What the dispatcher needs of this module: a ticket for an offer, or none. */
export interface OfferSourceCredentials {
  /**
   * @param job - The job being offered.
   * @param at - When it is offered.
   * @param validForMs - How long the offer may go unanswered — the ticket outlives it by a grace.
   * @returns The offer's `repository.credential`, or `undefined` for an anonymous clone.
   */
  forOffer(job: BuildJob, at: Date, validForMs: number): Promise<JobSourceCredential | undefined>;
}

/** The token `FarmDispatchModule` injects the dispatcher's ticket minter under. */
export const FARM_OFFER_SOURCE_CREDENTIALS = Symbol("FARM_OFFER_SOURCE_CREDENTIALS");

/**
 * How long past the offer's answer window a ticket is honoured — the checkout starts within
 * moments of the accept, so fifteen minutes covers a slow machine and nothing else.
 */
export const SOURCE_TICKET_GRACE_MS = 15 * 60 * 1000;

/** The user name GitHub expects beside a token over HTTPS — the clone cache's own constant. */
export const SOURCE_CREDENTIAL_USERNAME = "x-access-token";

/**
 * The phases a runner may be checking out under. A runner sends `job.accept`, checks the source
 * out, and only then sends `job.start` — so the checkout normally happens while the job is
 * `accepted` (#1818).
 */
const REDEEMABLE_PHASES = new Set<JobPhase>(["offered", "accepted", "running"]);

/** What a redemption answers: a git credential for one fetch. */
export interface SourceCredentialResource {
  /** Always {@link SOURCE_CREDENTIAL_USERNAME}. */
  readonly username: string;
  /** The workspace's GitHub token. Shown once; never stored by the runner. */
  readonly password: string;
  /** When the ticket that bought it would have expired — a hint to drop it, not a lease. */
  readonly expires_at: string;
}

/** The path a `job.offer` names, resolved by the agent against the origin it already dials. */
export const SOURCE_CREDENTIAL_ROUTE = "farm/jobs/:id/source-credential";

/**
 * The path for one job.
 *
 * @param jobId - The build job's uuid.
 * @returns `/api/v1/farm/jobs/<id>/source-credential`.
 */
export function sourceCredentialPath(jobId: string): string {
  return `/api/v1/${SOURCE_CREDENTIAL_ROUTE.replace(":id", jobId)}`;
}

@Injectable()
export class SourceCredentialService implements OfferSourceCredentials {
  /** Where a refusal's reason goes — the caller is only ever told the one refusal. */
  private readonly logger = new Logger(SourceCredentialService.name);

  /**
   * @param ledger - The ticket ledger.
   * @param github - The workspace's GitHub token — whether there is one, and the one call that
   *   opens it.
   * @param audit - The trail (#225).
   * @param now - The gateway's clock.
   */
  constructor(
    private readonly ledger: SourceCredentialRepository,
    private readonly github: GithubCredentialsService,
    private readonly audit: AuditService,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /** @inheritdoc */
  async forOffer(
    job: BuildJob,
    at: Date,
    validForMs: number,
  ): Promise<JobSourceCredential | undefined> {
    if (!(await this.github.isConfigured(job.organization_id))) return undefined;

    const { token, hash } = mintSourceTicket();
    const expiresAt = new Date(at.getTime() + validForMs + SOURCE_TICKET_GRACE_MS);

    if (!(await this.ledger.mint(job.organization_id, job.id, hash, at, expiresAt))) {
      return undefined;
    }

    return { path: sourceCredentialPath(job.id), token, expires_at: expiresAt.toISOString() };
  }

  /**
   * Redeem a ticket for the job's checkout credential — once.
   *
   * @param jobId - The build job the path named.
   * @param authorization - The request's `Authorization` header, whatever arrived.
   * @returns The credential, once.
   * @throws {UnauthenticatedError} `401 farm_source_credential_refused` for every failure.
   */
  async redeem(jobId: string, authorization: unknown): Promise<SourceCredentialResource> {
    const ticket = bearerTicket(authorization);
    // No bearer at all is refused before the ledger is read: there is nothing to compare.
    if (ticket === undefined) throw sourceCredentialRefused();

    const ledger = await this.ledger.ledger(jobId);
    const at = this.now();
    const why =
      ledger === undefined
        ? "no ticket was minted for this job"
        : !sourceTicketMatches(ledger.tokenHash, ticket)
          ? "the ticket is not the one last minted for this job"
          : ledger.redeemedAt !== null
            ? "the ticket was already redeemed"
            : ledger.expiresAt.getTime() <= at.getTime()
              ? "the ticket has expired"
              : !REDEEMABLE_PHASES.has(ledger.phase)
                ? `the job is ${ledger.phase}, not offered, accepted or running`
                : null;

    if (why !== null || ledger === undefined) {
      // The caller is told one thing for every failure; the operator's log says which (DI.6).
      this.logger.warn(`Source credential for build job ${jobId} refused: ${why ?? "no ledger"}.`);
      throw sourceCredentialRefused();
    }

    // The statement is the single-use rule: two presentations at once get one credential.
    if (!(await this.ledger.redeem(jobId, ledger.tokenHash, at))) {
      this.logger.warn(
        `Source credential for build job ${jobId} refused: redeemed or re-minted concurrently.`,
      );
      throw sourceCredentialRefused();
    }

    const password = await this.github.tokenFor(ledger.organizationId);

    await this.audit.record({
      organizationId: ledger.organizationId,
      actorId: null,
      action: RUNNER_SOURCE_CREDENTIAL_REDEEMED_EVENT,
      subjectType: "build_job",
      subjectId: ledger.jobId,
      at,
      // The repository and nothing derived from the credential — not a mask, not a length.
      detail: { repository: ledger.repository },
    });

    return {
      username: SOURCE_CREDENTIAL_USERNAME,
      password,
      expires_at: ledger.expiresAt.toISOString(),
    };
  }
}
