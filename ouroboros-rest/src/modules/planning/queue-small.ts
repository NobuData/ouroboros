/**
 * **Queue XS/S tickets immediately** — the post-push hook, as composition (decision **N7**).
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)). After a push, the batch's pushed
 * drafts whose estimate is `xs` or `s` are queued through **INTAKE-M.3's own queue write**
 * (`BacklogQueueService.queueSelection`, #112) — not a second path. M.3's rules therefore apply
 * unchanged: only a **sized** mirrored issue is queueable, a queued issue is not queued twice, and
 * R.1's trigger pins each row's workflow.
 *
 * ```
 * pushed drafts ─▶ effort ∈ {xs, s} ─▶ tracker number ─▶ github_issues (org · owner/name · number)
 *                                                          │
 *                               not mirrored yet ◀─────────┤
 *                               mirrored, not sized ◀──────┤   M.3's sized-only rule
 *                                                          ▼
 *                                      BacklogQueueService.queueSelection
 * ```
 *
 * **What is ready is queued; the rest is reported, not retried.** M.3 queues rows of the backlog
 * sync's GitHub mirror, and a just-pushed issue reaches that mirror — and its size — on the sync's
 * next cycle. So right after a push most small tickets are honestly *not yet mirrored*, and the
 * answer says so per draft rather than pretending they were queued. Pushing again (a resume) asks
 * again.
 *
 * **One refusal is one reason, so the hook asks again with less.** M.3 refuses a whole
 * selection for one problem at a time — not sized, or already queued — naming every offender. The
 * hook moves those offenders to `skipped` and asks again with the rest, which is the same selection
 * minus what M.3 said no to, never a relaxed rule.
 */

import { Injectable, Logger } from "@nestjs/common";

import {
  QUEUE_ERRORS,
  QUEUE_ISSUE_PROBLEMS,
  type QueueIssueProblem,
} from "../backlog/queue.errors";
import { BacklogQueueService } from "../backlog/queue.service";
import { DomainError } from "../errors/error.envelope";
import { describeForLog } from "../errors/failure";
import type { Effort } from "../engine/engine.contract";
import { supportsWrites } from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { PlanningRepository, type BatchRow } from "./planning.repository";
import type { QueueSmallResource, QueueSmallSkipReason } from "./planning.resources";

/** The efforts the toggle queues — mockup 09's *XS/S*. */
export const SMALL_EFFORTS: readonly Effort[] = Object.freeze(["xs", "s"]);

/** One small pushed ticket that is mirrored and sized, and so a candidate for M.3. */
interface Candidate {
  readonly localKey: string;
  readonly issueId: string;
}

@Injectable()
export class QueueSmallHook {
  /** Where an unexpected refusal is named. */
  private readonly logger = new Logger(QueueSmallHook.name);

  /**
   * @param repository - The pushed drafts and the mirror lookup.
   * @param registry - The provider, for the push target's name.
   * @param queue - INTAKE-M.3's queue write.
   */
  constructor(
    private readonly repository: PlanningRepository,
    private readonly registry: TicketSourceRegistry,
    private readonly queue: BacklogQueueService,
  ) {}

  /**
   * Queue a batch's small pushed tickets that are ready, and say why the rest are not.
   *
   * @param batch - The batch, just pushed. Its `queueSmall` toggle is the caller's to check.
   * @returns The queued local keys, and every skipped small draft with its reason.
   */
  async run(batch: BatchRow): Promise<QueueSmallResource> {
    const pushed = await this.repository.pushedDrafts(batch.organizationId, batch.id);
    const small = pushed.filter(
      (draft) => draft.effort !== null && SMALL_EFFORTS.includes(draft.effort),
    );

    if (small.length === 0) {
      return { queued: [], skipped: [] };
    }

    const repo = this.pushTargetName(batch);
    const numbers = small.map((draft) => Number(draft.externalId)).filter(Number.isInteger);
    const mirrored =
      repo === undefined
        ? []
        : await this.repository.mirroredIssues(batch.organizationId, repo, numbers);
    const byNumber = new Map(mirrored.map((issue) => [issue.number, issue]));
    const skipped: { localKey: string; reason: QueueSmallSkipReason }[] = [];
    let candidates: Candidate[] = [];

    for (const draft of small) {
      const issue = byNumber.get(Number(draft.externalId));

      if (issue === undefined) {
        skipped.push({ localKey: draft.localKey, reason: "not_yet_mirrored" });
      } else if (issue.sizingStatus !== "sized") {
        skipped.push({ localKey: draft.localKey, reason: "not_sized" });
      } else {
        candidates.push({ localKey: draft.localKey, issueId: issue.id });
      }
    }

    // Every refusal removes at least one candidate or throws, so this ends.
    while (candidates.length > 0) {
      const refused = await this.ask(batch.organizationId, candidates);

      if (refused === undefined) {
        return { queued: candidates.map((candidate) => candidate.localKey), skipped };
      }

      const reasons = new Map(refused.map((problem) => [problem.issueId, reasonFor(problem)]));

      skipped.push(
        ...candidates.flatMap((candidate) => {
          const reason = reasons.get(candidate.issueId);

          return reason === undefined ? [] : [{ localKey: candidate.localKey, reason }];
        }),
      );
      const remaining = candidates.filter((candidate) => !reasons.has(candidate.issueId));

      if (remaining.length === candidates.length) {
        throw new Error(`batch ${batch.id}: the queue refused issues it did not name`);
      }

      candidates = remaining;
    }

    return { queued: [], skipped };
  }

  /**
   * Ask M.3 once.
   *
   * @param organizationId - The workspace.
   * @param candidates - The issues to queue.
   * @returns Undefined when they were queued, or the offenders M.3 named.
   * @throws Whatever M.3 threw that is not a per-issue refusal.
   */
  private async ask(
    organizationId: string,
    candidates: readonly Candidate[],
  ): Promise<QueueIssueProblem[] | undefined> {
    try {
      await this.queue.queueSelection(organizationId, {
        issueIds: candidates.map((candidate) => candidate.issueId),
      });

      return undefined;
    } catch (error) {
      const problems = issueProblemsOf(error);

      if (problems === undefined || problems.length === 0) {
        throw error;
      }

      return problems;
    }
  }

  /**
   * The batch's push target, named — or undefined when its source cannot say.
   *
   * @param batch - The batch.
   * @returns `owner/name`, or undefined.
   */
  private pushTargetName(batch: BatchRow): string | undefined {
    const provider = this.registry.find(batch.source.kind);

    if (provider === undefined || !supportsWrites(provider)) {
      return undefined;
    }

    try {
      return provider.pushTargetName(batch.source.config);
    } catch (error) {
      this.logger.warn(
        `batch ${batch.id}: the target source's configuration cannot name a repository.`,
        describeForLog(error),
      );

      return undefined;
    }
  }
}

/**
 * The per-issue offenders of an M.3 refusal, when it is one the hook can act on.
 *
 * @param error - What `queueSelection` threw.
 * @returns The problems, or undefined for any other failure.
 */
export function issueProblemsOf(error: unknown): QueueIssueProblem[] | undefined {
  if (!(error instanceof DomainError)) {
    return undefined;
  }

  if (error.code !== QUEUE_ERRORS.notQueueable && error.code !== QUEUE_ERRORS.conflict) {
    return undefined;
  }

  const { issues } = error.envelope().details as { issues?: QueueIssueProblem[] };

  return issues;
}

/**
 * The skip reason one M.3 problem means.
 *
 * @param problem - The offender.
 * @returns `already_queued` for the queue's own conflicts, `not_sized` for everything else M.3 says
 *   makes an issue unqueueable.
 */
export function reasonFor(problem: QueueIssueProblem): QueueSmallSkipReason {
  return problem.code === QUEUE_ISSUE_PROBLEMS.alreadyQueued ||
    problem.code === QUEUE_ISSUE_PROBLEMS.numberTaken
    ? "already_queued"
    : "not_sized";
}
