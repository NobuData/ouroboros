/**
 * `EstimationOrchestrator` — what moves an issue `unsized → estimating → sized | needs_human`,
 * and what never leaves a row stuck.
 *
 * L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)), and decision **K7**:
 * estimation runs *through the engine* — this service orchestrates, the engine computes — even
 * while the estimator is a rule engine, because that pipeline shape **is** the product
 * architecture and swapping `heuristic-v0` for O.2's model
 * ([#123](https://github.com/NobuData/ouroboros/issues/123)) is an engine-internal change that
 * nothing in this file sees.
 *
 * ```
 * accept(issues)   ─┐
 * sweep()          ─┼─▶ EstimationQueue (bounded, de-duplicating)
 * estimate(issue)  ─┘         │
 *                             ▼
 *                   context ─▶ claim ─▶ engine ─▶ persist version + status
 *                                        │
 *                                        └─ fail ×2 ─▶ needs_human, named in the log
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## It **is** K.4's `EstimationIntake`, which is the whole reason that port exists
 *
 * `backlog-sync/estimation.intake.ts` was written with a placeholder that logs and a note
 * saying *"L.3 replaces the binding in `backlog-sync.module.ts` and changes nothing else."*
 * That is what happened: this class implements the port, `BacklogSyncModule` binds the token to
 * it, and `LoggingEstimationIntake` is gone. The sync still hands over new and reopened issues
 * after its transaction commits and still knows nothing about what happens next.
 *
 * ## The retry is one attempt, and only around the engine
 *
 * The issue asks for *"engine error or timeout → one retry → `needs_human` with a trace
 * recording the failure"*. That retry is **on top of** `EngineClient`'s own, which is narrower
 * and answers a different question: the client retries once for a failure that proves the
 * request was never delivered — a refused connection, a name that did not resolve — and
 * deliberately not a deadline or a `500`. This one retries the whole call, because at this
 * altitude the question is *"is the engine having a moment"* rather than *"was this request
 * delivered"*, and sizing an issue twice costs nothing that matters: an estimate is a pure
 * function of the request, and a duplicate would at worst produce a second version of the same
 * answer.
 *
 * ## A failure writes no estimate, and is not silent
 *
 * `issue_estimates` has no nullable effort and no *unknown*: a row invented for a failure would
 * put an effort chip on the backlog table for an issue nothing sized, and put a `trace.estimator`
 * on a record of nothing — which is decision **K10** read backwards. So a failed issue is moved
 * to `needs_human` and the failure is named in the service log, with the issue, the repository,
 * both attempts and the reason. *Honest, not silent* is what the ticket asks for, and a
 * fabricated estimate would be the opposite of both.
 *
 * ## Nothing here is stuck, and the sweep is why
 *
 * Every path out of {@link EstimationOrchestrator.run} writes a terminal status — including the
 * `catch` around the persistence itself, which is the one case where an issue could otherwise
 * be left `estimating` by this process. What that cannot cover is a process that stops
 * existing between the claim and the write, and `estimation.sweeper.ts` is what covers that:
 * `sweep()` re-queues every row that has been `estimating` longer than
 * `OURO_ESTIMATION_STALE_SECONDS`.
 */

import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { EstimableIssue, EstimationIntake } from "../backlog-sync/estimation.intake";
import { EngineClient } from "../engine/engine.client";
import type { Estimate, EstimateRequest, EstimationContext } from "../engine/engine.contract";
import { describeForLog } from "../errors/failure";
import { EstimationContextService } from "./estimation.context";
import { draftEstimateRow, estimateRow, statusFor, ticketEstimateRow } from "./estimation.outcome";
import { EstimationQueue } from "./estimation.queue";
import {
  EstimationRepository,
  type EstimableDraftRow,
  type EstimableIssueRow,
} from "./estimation.repository";
import { ticketIssueContext, type EstimableTicketRow } from "./estimation.ticket";

/**
 * How many times one issue's engine call is attempted before it is given up on.
 *
 * The original and one retry, which is the ticket's *"engine error or timeout → one retry"*.
 * See this file's header for why this sits on top of `EngineClient.MAX_ATTEMPTS` rather than
 * replacing it.
 */
export const MAX_ENGINE_ATTEMPTS = 2;

/**
 * Most stale rows one sweep reads.
 *
 * The sweep repeats on a cadence and its queue drops what is already in flight, so a bounded
 * batch that comes back beats an unbounded one that reads a whole backlog into memory to
 * discover it is already working on it. Fifty is several times the largest concurrency an
 * operator may set, so a sweep always finds more than it can start — which is the property that
 * keeps the pipe full without the read being a scan.
 */
export const SWEEP_BATCH = 50;

/**
 * A ticket draft to size — AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)),
 * decision **N3**: drafts enter *this* orchestrator, so there is one sizer in the product.
 */
export interface DraftSizingRequest {
  /** `ticket_drafts.id`. */
  readonly draftId: string;
  /**
   * The repository the draft will be pushed to, `owner/name` — the estimation contract's `repo`,
   * which a draft has no other way to name. The caller resolves it through the ticket-source SPI
   * (`pushTargetName`), which this module deliberately does not reach.
   */
  readonly repo: string;
}

/** How one draft's sizing ended. */
export type DraftSizingOutcome =
  /** An estimate was stored — below the floor or not, a draft is sized once it has one. */
  | "sized"
  /** Every engine attempt failed, or the write did; nothing was stored. */
  | "failed"
  /** The draft is gone, or its workspace routes nothing; nothing was attempted. */
  | "skipped";

/**
 * Told once a queued draft's sizing has ended, however it ended — so the planning module can move
 * its batch `drafting → sized` without this module knowing what a batch is.
 */
export type DraftSizingListener = (draftId: string, outcome: DraftSizingOutcome) => Promise<void>;

/**
 * The queue's dedupe key for a draft.
 *
 * Prefixed, so a draft can never be mistaken for an issue: both are uuids, and the queue holds
 * both kinds of work in one bound.
 *
 * @param draftId - `ticket_drafts.id`.
 * @returns `draft:<id>`.
 */
export function draftQueueKey(draftId: string): string {
  return `draft:${draftId}`;
}

/**
 * The queue's dedupe key for a canonical ticket (AL.5, [#281](https://github.com/NobuData/ouroboros/issues/281)).
 *
 * Prefixed for {@link draftQueueKey}'s reason: a ticket, a draft and a mirrored issue are all
 * uuids, and the queue holds all three kinds of work in one bound.
 *
 * @param ticketId - `tickets.id`.
 * @returns `ticket:<id>`.
 */
export function ticketQueueKey(ticketId: string): string {
  return `ticket:${ticketId}`;
}

/**
 * The issue number a draft is sized as — its local key's position.
 *
 * The estimation contract requires a positive number and a draft has no tracker number yet; the
 * plan contract guarantees every local key ends in a 1-based position (`OTA-3`), which is the one
 * number a draft does have. Read for provenance only — no estimator branches on it.
 *
 * @param localKey - `OTA-3`.
 * @returns `3`, or `1` for a key without a trailing number (a hand-seeded row).
 */
export function draftNumber(localKey: string): number {
  const match = /-(\d+)$/.exec(localKey);
  const number = match === null ? 0 : Number(match[1]);

  return number >= 1 ? number : 1;
}

/** What one sweep found and did — what the scheduler logs, when there was anything to say. */
export interface SweepReport {
  /** Rows — mirrored issues and canonical tickets — that had been `estimating` longer than the threshold. */
  readonly stale: number;
  /** How many of them were queued. */
  readonly requeued: number;
  /**
   * How many were already waiting or running here.
   *
   * Reported rather than discarded: a sweep that keeps finding its own in-flight work is a
   * sweep whose threshold is set below how long an estimate legitimately takes, and this count
   * is the only way anybody would know.
   */
  readonly inFlight: number;
}

@Injectable()
export class EstimationOrchestrator implements EstimationIntake {
  /** Where a failure is named. See this file's header on why it is named here and nowhere else. */
  private readonly logger = new Logger(EstimationOrchestrator.name);

  /** The bound, and the dedupe. Constructed rather than injected — see `estimation.queue.ts`. */
  private readonly queue: EstimationQueue;

  /**
   * @param issues - The statements: the read, the claim, the versioned write, the stale sweep.
   * @param engine - The typed gateway. The only way this service reaches `ouroboros-engine`,
   *   and already the owner of the deadline, the shared secret and the parse.
   * @param context - The vocabularies an estimate may use, resolved through routing (Z.4).
   * @param config - The concurrency, the confidence floor and the staleness threshold.
   */
  constructor(
    private readonly issues: EstimationRepository,
    private readonly engine: EngineClient,
    private readonly context: EstimationContextService,
    private readonly config: AppConfigService,
  ) {
    this.queue = new EstimationQueue(config.estimationConcurrency);
  }

  /**
   * Take issues the backlog sync has just mirrored or seen reopen.
   *
   * K.4's port. Called **after** the transaction that stored them has committed, so every row
   * named here exists — which is what lets this method queue work rather than verify it.
   *
   * @param issues - The new and reopened issues, in the order GitHub listed them. May be
   *   empty, which is the common case: most polls change nothing.
   * @returns Immediately, once the work is queued. Deliberately **not** when the estimates are
   *   done: the caller is a poll cycle, and a cycle that waited for a backlog to be sized
   *   would hold a GitHub token's rate budget open for the length of an import.
   */
  accept(issues: readonly EstimableIssue[]): Promise<void> {
    if (issues.length === 0) {
      return Promise.resolve();
    }

    const queued = issues.filter((issue) => this.enqueue(issue.issueId)).length;

    this.logger.log(
      `Queued ${String(queued)} of ${String(issues.length)} issue(s) for estimation` +
        `${queued === issues.length ? "" : "; the rest are already in flight"}.`,
    );

    return Promise.resolve();
  }

  /**
   * Queue one issue by id, unless this process is already dealing with it.
   *
   * The entry point L.4's re-estimation endpoints ([#108](https://github.com/NobuData/ouroboros/issues/108))
   * are written against — hence public, and hence the boolean: *already estimating* is the
   * state that ticket answers `409` for, and it is this queue's answer rather than a second
   * read of the column.
   *
   * @param issueId - `github_issues.id`.
   * @returns `true` when it was queued, `false` when the issue is already waiting or running.
   */
  enqueue(issueId: string): boolean {
    return this.queue.admit({ issueId, run: async () => this.run(issueId) });
  }

  /**
   * Queue one ticket draft for sizing, unless this process is already sizing it.
   *
   * AL.4's entry point ([#280](https://github.com/NobuData/ouroboros/issues/280)): a generated or
   * regenerated batch with auto-size on hands each draft here, so drafts are sized by the same
   * queue, bound, engine call, retry and floor as every issue (decision **N3**).
   *
   * **No sweep covers a draft**, because a draft has no `estimating` status to be stranded in: it is
   * sized exactly when an estimate exists. A draft whose sizing failed stays unsized, and asking
   * again — a regeneration — is how it is retried.
   *
   * @param request - The draft, and the repository it will be pushed to.
   * @param listener - Told how it ended, once. Its own failure is logged and dropped.
   * @returns `true` when it was queued, `false` when it is already waiting or running.
   */
  enqueueDraft(request: DraftSizingRequest, listener?: DraftSizingListener): boolean {
    return this.queue.admit({
      issueId: draftQueueKey(request.draftId),
      run: async () => {
        const outcome = await this.runDraft(request);

        if (listener === undefined) {
          return;
        }

        try {
          await listener(request.draftId, outcome);
        } catch (error) {
          this.logger.error(
            `The listener for draft ${request.draftId} failed after sizing ended ${outcome}`,
            describeForLog(error),
          );
        }
      },
    });
  }

  /**
   * Queue one canonical ticket for sizing, unless this process is already sizing it.
   *
   * AL.5's entry point ([#281](https://github.com/NobuData/ouroboros/issues/281)), decision **N9**:
   * the nightly re-estimation job hands each open, unsized ticket here, so the canonical backlog is
   * sized by the same queue, bound, engine call, retry and floor as every issue and draft — there is
   * no second sizer for it to disagree with. The ticket moves `unsized → estimating → sized |
   * needs_human` exactly as an issue does, and its estimate is stored under V038's `ticket_id`.
   *
   * @param ticketId - `tickets.id`.
   * @returns `true` when it was queued, `false` when it is already waiting or running.
   */
  enqueueTicket(ticketId: string): boolean {
    return this.queue.admit({
      issueId: ticketQueueKey(ticketId),
      run: async () => this.runTicket(ticketId),
    });
  }

  /**
   * Is this process already estimating that issue?
   *
   * @param issueId - `github_issues.id`.
   * @returns `true` when {@link enqueue} would refuse it.
   */
  estimating(issueId: string): boolean {
    return this.queue.holds(issueId);
  }

  /**
   * When everything queued has finished.
   *
   * For the suites, and for a shutdown that would rather let in-flight work end than strand it
   * for the sweep to find.
   *
   * @returns A promise that settles once nothing is waiting or running.
   */
  async settled(): Promise<void> {
    return this.queue.settled();
  }

  /**
   * Re-queue every issue that has been `estimating` for too long.
   *
   * The recovery sweep, driven by `estimation.sweeper.ts`. Its own read is unscoped — the
   * caller is a timer, and a row stranded in one workspace is not more or less stranded than
   * one in another.
   *
   * @returns What it found. `stale` counts rows the read returned; `inFlight` counts the ones
   *   this process is already working on, which on a healthy service is most of them.
   */
  async sweep(): Promise<SweepReport> {
    const olderThan = new Date(Date.now() - this.config.estimationStaleSeconds * 1000);
    const stale = await this.issues.staleIssues(olderThan, SWEEP_BATCH);
    // Canonical tickets strand the same way since AL.5 (#281) sizes them, and the nightly job
    // selects only `unsized` ones — so without this read a ticket whose process died mid-estimate
    // would never be looked at again. Its own batch, so neither kind can starve the other.
    const staleTickets = await this.issues.staleTickets(olderThan, SWEEP_BATCH);

    let requeued = 0;

    for (const issueId of stale) {
      if (this.enqueue(issueId)) {
        requeued += 1;
      }
    }

    for (const ticketId of staleTickets) {
      if (this.enqueueTicket(ticketId)) {
        requeued += 1;
      }
    }

    const found = stale.length + staleTickets.length;

    return { stale: found, requeued, inFlight: found - requeued };
  }

  /**
   * Size one issue, end to end, and leave it in a terminal status whatever happens.
   *
   * The queue calls this and does not read its result — which is why it must not reject; see
   * `estimation.queue.ts`. Every failure is handled here, where the status it implies is known.
   *
   * @param issueId - `github_issues.id`.
   * @returns When the issue has reached `sized` or `needs_human`, or when there was nothing to
   *   do because the row is gone or its workspace cannot be routed.
   */
  private async run(issueId: string): Promise<void> {
    const issue = await this.issues.issue(issueId);

    if (issue === undefined) {
      // Ordinary rather than exceptional: the sync hands work over after its transaction
      // commits, and a repository that left scope in between takes its issues with it.
      this.logger.log(`Issue ${issueId} is gone; nothing to estimate.`);
      return;
    }

    const context = await this.context.forWorkspace(issue.organizationId);

    if (context === undefined) {
      // The workspace routes nothing, so there is no model an estimate could name. The row
      // stays as it is — `unsized` for a newly synced issue — because this is a fact about the
      // installation rather than about the issue. `estimation.context.ts` has logged the
      // sentence a person needs; repeating it per issue would bury it.
      return;
    }

    if (!(await this.issues.claim(issueId))) {
      this.logger.log(`Issue ${issueId} disappeared before it could be claimed.`);
      return;
    }

    const estimate = await this.size(issue, context);

    if (estimate === undefined) {
      await this.giveUp(issue, "the engine could not be reached or could not answer");
      return;
    }

    await this.store(issue, estimate);
  }

  /**
   * Size one canonical ticket, end to end, and leave it in a terminal status whatever happens —
   * {@link run} for the third kind of subject. Never rejects.
   *
   * @param ticketId - `tickets.id`.
   * @returns When the ticket has reached `sized` or `needs_human`, or when there was nothing to do
   *   because the row is gone or its workspace cannot be routed.
   */
  private async runTicket(ticketId: string): Promise<void> {
    let ticket: EstimableTicketRow | undefined;
    let claimed = false;

    try {
      ticket = await this.issues.ticket(ticketId);

      if (ticket === undefined) {
        this.logger.log(`Ticket ${ticketId} is gone; nothing to estimate.`);
        return;
      }

      const context = await this.context.forWorkspace(ticket.organizationId);

      // No routing, no model an estimate could name — the row stays `unsized`, and the next night
      // asks again. See {@link run}.
      if (context === undefined || !(await this.issues.claimTicket(ticketId))) {
        return;
      }

      claimed = true;

      const subject = `ticket ${ticket.externalKey} (${ticketId})`;
      const estimate = await this.attempt(subject, { issue: ticketIssueContext(ticket), context });

      if (estimate === undefined) {
        await this.giveUpTicket(ticket, "the engine could not be reached or could not answer");
        return;
      }

      const status = statusFor(estimate, this.config.estimationConfidenceFloor);
      const sizedAt = new Date();
      const version = await this.issues.persistTicket(ticketId, status, (next) =>
        ticketEstimateRow(ticketId, next, estimate, sizedAt),
      );

      this.logger.log(
        `${subject} is ${status} — ${estimate.effort.toUpperCase()}, ` +
          `${String(estimate.confidence)}% confidence ` +
          `(v${String(version)}, by ${estimate.trace.estimator}).`,
      );
    } catch (error) {
      // The read, the claim or the write failed. Before the claim nothing moved and the next night
      // selects the ticket again, so it is left alone; after it, the ticket is given up on — and if
      // even that write fails, the row says `estimating` and the recovery sweep's `staleTickets`
      // re-queues it. A failure here strands nothing.
      this.logger.error(`Estimating ticket ${ticketId} failed`, describeForLog(error));

      if (claimed && ticket !== undefined) {
        await this.giveUpTicket(ticket, "the estimate could not be stored");
      }
    }
  }

  /**
   * Leave a ticket to a person, and say why — {@link giveUp} for a canonical ticket.
   *
   * @param ticket - The ticket.
   * @param reason - What went wrong.
   * @returns When the status is written. A failure to write even this is logged and dropped: the
   *   row is left `estimating`, which the recovery sweep re-queues.
   */
  private async giveUpTicket(ticket: EstimableTicketRow, reason: string): Promise<void> {
    this.logger.warn(
      `Ticket ${ticket.externalKey} (${ticket.ticketId}) needs a human: ${reason}. ` +
        "No estimate was stored.",
    );

    try {
      await this.issues.settleTicket(ticket.ticketId, "needs_human");
    } catch (error) {
      this.logger.error(
        `Could not move ticket ${ticket.externalKey} to needs_human; the recovery sweep will ` +
          "re-queue it.",
        describeForLog(error),
      );
    }
  }

  /**
   * Size one draft, end to end. Never rejects — see {@link run}.
   *
   * @param request - The draft and its push target.
   * @returns How it ended.
   */
  private async runDraft(request: DraftSizingRequest): Promise<DraftSizingOutcome> {
    let draft: EstimableDraftRow | undefined;

    try {
      draft = await this.issues.draft(request.draftId);
    } catch (error) {
      this.logger.error(`Reading draft ${request.draftId} failed`, describeForLog(error));

      return "failed";
    }

    if (draft === undefined) {
      this.logger.log(`Draft ${request.draftId} is gone; nothing to estimate.`);

      return "skipped";
    }

    const context = await this.context.forWorkspace(draft.organizationId);

    if (context === undefined) {
      return "skipped";
    }

    const estimate = await this.attempt(`draft ${draft.localKey} (batch ${draft.batchId})`, {
      issue: {
        number: draftNumber(draft.localKey),
        title: draft.title,
        body: draft.body,
        labels: [],
        repo: request.repo,
      },
      context,
    });

    if (estimate === undefined) {
      this.logger.warn(
        `Draft ${draft.localKey} (batch ${draft.batchId}) was not sized: the engine could not ` +
          "be reached or could not answer. No estimate was stored.",
      );

      return "failed";
    }

    try {
      const sizedAt = new Date();
      const version = await this.issues.persistDraft(draft.draftId, (next) =>
        draftEstimateRow(draft.draftId, next, estimate, sizedAt),
      );

      this.logger.log(
        `Draft ${draft.localKey} (batch ${draft.batchId}) is sized — ` +
          `${estimate.effort.toUpperCase()}, ${String(estimate.confidence)}% confidence ` +
          `(v${String(version)}, by ${estimate.trace.estimator}).`,
      );

      return "sized";
    } catch (error) {
      this.logger.error(
        `Storing the estimate for draft ${draft.localKey} (batch ${draft.batchId}) failed`,
        describeForLog(error),
      );

      return "failed";
    }
  }

  /**
   * Ask the engine to size one issue, with one retry.
   *
   * @param issue - The issue, as the read returned it.
   * @param context - The vocabularies an answer may use.
   * @returns The estimate, or `undefined` when every attempt failed. The engine's own
   *   diagnosis never reaches here — `EngineClient` maps every failure to one
   *   `engine_unavailable` and logs the real one — so what this method adds is the attempt
   *   count and which issue it was for.
   */
  private async size(
    issue: EstimableIssueRow,
    context: EstimationContext,
  ): Promise<Estimate | undefined> {
    return this.attempt(`${issue.repo}#${String(issue.number)}`, {
      issue: {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        repo: issue.repo,
      },
      context,
    });
  }

  /**
   * One engine call, with one retry — the policy issues and drafts share.
   *
   * @param subject - How the log names what was being sized.
   * @param request - The sizing request.
   * @returns The estimate, or `undefined` when every attempt failed.
   */
  private async attempt(subject: string, request: EstimateRequest): Promise<Estimate | undefined> {
    for (let attempt = 1; attempt <= MAX_ENGINE_ATTEMPTS; attempt += 1) {
      try {
        return await this.engine.estimate(request);
      } catch (error) {
        this.logger.error(
          `Estimating ${subject} failed ` +
            `(attempt ${String(attempt)} of ${String(MAX_ENGINE_ATTEMPTS)})`,
          describeForLog(error),
        );
      }
    }

    return undefined;
  }

  /**
   * Store one estimate and move the issue with it.
   *
   * @param issue - The issue that was sized.
   * @param estimate - What the engine answered.
   * @returns When the row is written, or when the write failed and the issue has been given up
   *   on instead. A write that V026 refuses is an estimator producing something the schema
   *   forbids: it would fail identically on every retry, so retrying it is how a row gets stuck
   *   in a loop between this method and the sweep.
   */
  private async store(issue: EstimableIssueRow, estimate: Estimate): Promise<void> {
    const status = statusFor(estimate, this.config.estimationConfidenceFloor);
    // The estimator's clock and the row's are the same instant for this synchronous call, and
    // read once so the two cannot differ by the length of a transaction.
    const sizedAt = new Date();

    try {
      const version = await this.issues.persist(issue.issueId, status, (next) =>
        estimateRow(issue.issueId, next, estimate, sizedAt),
      );

      this.logger.log(
        `${issue.repo}#${String(issue.number)} is ${status} — ` +
          `${estimate.effort.toUpperCase()}, ${String(estimate.confidence)}% confidence, ` +
          `${estimate.suggestedWorkflow} on ${estimate.routedModel} ` +
          `(v${String(version)}, by ${estimate.trace.estimator}).`,
      );
    } catch (error) {
      this.logger.error(
        `Storing the estimate for ${issue.repo}#${String(issue.number)} failed`,
        describeForLog(error),
      );

      await this.giveUp(issue, "the estimate could not be stored");
    }
  }

  /**
   * Leave an issue to a person, and say why.
   *
   * @param issue - The issue.
   * @param reason - What went wrong, in the words a person reading the log needs. No engine
   *   body and no driver message: `EngineClient` and `describeForLog` have already written the
   *   diagnosis, and this is the sentence that says what was *done* about it.
   * @returns When the status is written. A failure to write even this is logged and dropped —
   *   the row is left `estimating`, which is precisely the state the sweep exists to find, so
   *   the recovery path is already the answer.
   */
  private async giveUp(issue: EstimableIssueRow, reason: string): Promise<void> {
    this.logger.warn(
      `${issue.repo}#${String(issue.number)} needs a human: ${reason}. ` +
        "No estimate was stored — there is nothing to store, and a fabricated one would put " +
        "an effort chip on an issue nothing sized.",
    );

    try {
      await this.issues.settle(issue.issueId, "needs_human");
    } catch (error) {
      this.logger.error(
        `Could not move ${issue.repo}#${String(issue.number)} to needs_human; the recovery ` +
          "sweep will re-queue it.",
        describeForLog(error),
      );
    }
  }
}
