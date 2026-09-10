/**
 * `EstimationTriggerService` — the two things a person can press, and the four guards between
 * a press and an engine call.
 *
 * L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108)). L.3 built a pipeline fed by a
 * poll and a recovery sweep; mockup 03 offers re-estimation in two places — the panel's
 * *Re-estimate* and the head's *Re-estimate all* — and neither had anything to call.
 *
 * ---------------------------------------------------------------------------
 * ## The order of the guards is the design
 *
 * ```
 * rate limit ─▶ scoped read ─▶ already estimating? ─▶ claim ─▶ queue ─▶ 202
 *     429            404              409
 * ```
 *
 * **The limit is first**, ahead of the read, because the caller the criterion names is
 * *mostly* collecting refusals: their second click lands on an issue their first one moved
 * into `estimating`, so a limiter that only counted accepted requests would leave a hammering
 * caller unlimited. `estimation.limiter.ts` carries the argument.
 *
 * **The read is scoped, not filtered.** `EstimationRepository.issueIn()` puts the workspace in
 * the `where`, so an id belonging to another workspace comes back as nothing and is answered
 * `404` — never `403`, which would confirm the id names a real issue somewhere.
 *
 * ## The row is claimed here, and that is what makes the `202` true
 *
 * `EstimationOrchestrator.run()` claims the row when the work *starts*, which may be after
 * several other estimates. If this endpoint only queued, its answer would say `estimating`
 * while a client re-reading the issue still saw `sized` — and a second press would have to be
 * refused from an in-process queue rather than from the database, which two replicas cannot
 * agree about. Claiming at the boundary fixes both: the answer is true when it is sent, and
 * the `409` is a fact any replica can read. The orchestrator's own claim is unconditional and
 * idempotent, so doing it twice costs one `UPDATE`, and a process that dies between the claim
 * and the run leaves a row the recovery sweep is built to find.
 *
 * ## *Re-estimate all* claims in one statement
 *
 * `claimBacklog()` is a single `update … where sizing_status != 'estimating' returning id`, so
 * the ticket's *"touches only non-`estimating` rows"* is a property of the statement rather
 * than of a loop that reads and then writes. Two administrators pressing the button together
 * cannot claim the same row twice, and the count it returns is a fact rather than an estimate
 * of one.
 */

import { Injectable, Logger } from "@nestjs/common";

import { EstimationLimiter } from "./estimation.limiter";
import { EstimationOrchestrator } from "./estimation.orchestrator";
import { EstimationRepository } from "./estimation.repository";
import {
  alreadyEstimating,
  backlogAlreadyEstimating,
  estimationRateLimited,
  issueNotFound,
} from "./estimation.errors";
import { fanout, type EstimationAccepted, type EstimationFanout } from "./estimation.resources";

@Injectable()
export class EstimationTriggerService {
  /** Where an accepted trigger is recorded — the workspace and the scope, never a person. */
  private readonly logger = new Logger(EstimationTriggerService.name);

  /**
   * @param issues - The scoped read, the counts and the one-statement claim.
   * @param orchestrator - L.3's pipeline. `enqueue()` is the whole of what a press does with
   *   it; everything after that — the engine call, the version, the status — is its own.
   * @param limiter - The per-workspace counter.
   */
  constructor(
    private readonly issues: EstimationRepository,
    private readonly orchestrator: EstimationOrchestrator,
    private readonly limiter: EstimationLimiter,
  ) {}

  /**
   * Re-estimate one issue.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param issueId - `github_issues.id`, from the path.
   * @param now - The clock, injectable so a spec can drive the rate limit's window without
   *   waiting through one.
   * @returns The issue as it now stands: `estimating`, and queued.
   * @throws {TooManyRequestsError} `estimation_rate_limited` when the window is full.
   * @throws {NotFoundError} `issue_not_found` when this workspace has no such issue.
   * @throws {ConflictError} `issue_already_estimating` when one is already in flight.
   */
  async estimate(
    organizationId: string,
    issueId: string,
    now: Date = new Date(),
  ): Promise<EstimationAccepted> {
    this.limit(organizationId, now);

    const issue = await this.issues.issueIn(organizationId, issueId);

    if (issue === undefined) {
      throw issueNotFound(issueId);
    }

    // Both halves of *already estimating*, and they answer different failures. The column is
    // what any replica can see, and survives a restart. The queue is what this process knows
    // about an issue it has claimed and not yet started — a row it queued a moment ago still
    // says `sized` until the work reaches it.
    if (issue.sizingStatus === "estimating" || this.orchestrator.estimating(issueId)) {
      throw alreadyEstimating("estimating");
    }

    await this.issues.claim(issueId);
    this.orchestrator.enqueue(issueId);

    this.logger.log(
      `Re-estimating ${issue.repo}#${String(issue.number)} for workspace ${organizationId}.`,
    );

    return {
      issueId: issue.issueId,
      number: issue.number,
      repository: issue.repo,
      status: "estimating",
    };
  }

  /**
   * Re-estimate everything in the workspace that is not already being estimated.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param now - The clock, as above.
   * @returns What it took: how many it queued, how many it left alone, and how many there are.
   * @throws {TooManyRequestsError} `estimation_rate_limited` when the window is full.
   * @throws {ConflictError} `backlog_already_estimating` when there was something to do and
   *   all of it was already in flight — a second press while the first is running. A workspace
   *   that mirrors nothing is **not** that: it gets a `202` with zeros, because *empty* and
   *   *busy* are different answers and a dialog should be able to say which.
   */
  async estimateAll(organizationId: string, now: Date = new Date()): Promise<EstimationFanout> {
    this.limit(organizationId, now);

    // Read before the claim, so `total` describes the backlog the caller asked about rather
    // than the one this request has just changed.
    const counts = await this.issues.backlogCounts(organizationId);
    const claimed = await this.issues.claimBacklog(organizationId);

    if (claimed.length === 0 && counts.estimating > 0) {
      throw backlogAlreadyEstimating(counts.estimating);
    }

    // A claimed row the queue refuses is one this process had already queued and not yet
    // started — it is in flight either way, so it counts as skipped rather than as work
    // this request began.
    const enqueued = claimed.filter((id) => this.orchestrator.enqueue(id)).length;

    if (enqueued > 0) {
      this.logger.log(
        `Re-estimating ${String(enqueued)} issue(s) for workspace ${organizationId}.`,
      );
    }

    return fanout(counts.total, enqueued);
  }

  /**
   * Spend one of this workspace's attempts, or refuse the request.
   *
   * @param organizationId - The workspace.
   * @param now - The clock.
   * @throws {TooManyRequestsError} `estimation_rate_limited`, carrying how long to wait.
   */
  private limit(organizationId: string, now: Date): void {
    const exceeded = this.limiter.attempt(organizationId, now);

    if (exceeded !== null) {
      throw estimationRateLimited(exceeded.retryAfterSeconds);
    }
  }
}
