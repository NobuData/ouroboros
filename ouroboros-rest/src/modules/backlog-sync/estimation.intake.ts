/**
 * Where a newly mirrored issue goes next — the *"before you ever ask it to work"* handoff.
 *
 * K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102)). Mockup 03's subline claims
 * that Ouroboros *"continuously estimates effort, risk, and routing for every open issue —
 * before you ever ask it to work"*, and this seam is where that claim is either kept or
 * quietly dropped. The sync's part of it is small and exact: an issue that has just arrived,
 * or has just reopened, is `unsized`, and something is told about it.
 *
 * **The something is L.3's** ([#107](https://github.com/NobuData/ouroboros/issues/107)) —
 * `EstimationOrchestrator`, the bounded in-process queue that moves an issue
 * `unsized → estimating → sized | needs_human`. It does not exist yet, and this ticket
 * deliberately does not build it: the roadmap's L.3 owns that queue, its retry, its stale
 * sweep and its versioned persistence, and a second queue built here would be the thing that
 * ticket then had to delete.
 *
 * So the handoff is an **interface with a default**, and the default is the honest one rather
 * than the convenient one:
 *
 *   * {@link EstimationIntake} is what the sync depends on. It is a port and nothing else —
 *     no queue, no retry, no state.
 *   * {@link LoggingEstimationIntake} is what is bound until L.3 lands. It records the
 *     handoff and does nothing with it, which is exactly what is true: the rows are `unsized`,
 *     they are the pipeline's to claim, and nothing is claiming them yet. It does not pretend
 *     to enqueue, and it does not swallow the fact that it is a placeholder — a boot without
 *     an estimator says so once, in the log.
 *   * L.3 replaces the binding in `backlog-sync.module.ts` and changes nothing else. That is
 *     the whole reason the token exists.
 *
 * The issue's fourth acceptance criterion — *"a new issue automatically enters the estimation
 * pipeline"* — is marked *(verified together with #107)* for this reason. What is verifiable
 * here is that the sync hands over exactly the new and reopened issues, exactly once, after
 * the transaction that stored them has committed; `backlog-sync.service.spec.ts` and the
 * integration suite both assert that, against a recording intake.
 */

import { Injectable, Logger } from "@nestjs/common";

/** One issue being handed to the estimation pipeline. */
export interface EstimableIssue {
  /** The workspace, so the pipeline can resolve a model and a budget without a second read. */
  readonly organizationId: string;
  /** `github_issues.id` — the row to estimate, and what an estimate is versioned against. */
  readonly issueId: string;
  /** The repository the issue lives in. */
  readonly githubRepoId: string;
  /** The issue number, for a log line a person can follow to GitHub. */
  readonly number: number;
  /**
   * Why it is being estimated: it is new to this mirror, or it has reopened.
   *
   * Carried because the two are different events to a queue that may want to prioritise or
   * de-duplicate — and because *"reopened"* is a fact the sync knows and nothing downstream
   * could recover from the row alone.
   */
  readonly reason: "imported" | "reopened";
}

/**
 * The port the sync hands new work to.
 *
 * One method, and it takes a batch rather than an issue: a poll produces a page's worth at
 * once, and a queue that wants to bound its own admission needs to see them together.
 */
export interface EstimationIntake {
  /**
   * Take these issues into the estimation pipeline.
   *
   * Called **after** the transaction that stored them has committed, so an implementation may
   * assume every row it is told about exists.
   *
   * @param issues - The new and reopened issues, in the order GitHub listed them. May be
   *   empty, which is the common case: most polls change nothing.
   * @returns When the pipeline has accepted them. An implementation that rejects must not
   *   throw for a reason the sync could not act on — the poll has already committed, and a
   *   failure here costs the handoff rather than the mirror.
   */
  accept(issues: readonly EstimableIssue[]): Promise<void>;
}

/** The Nest token {@link EstimationIntake} is bound under. */
export const ESTIMATION_INTAKE = "ESTIMATION_INTAKE";

@Injectable()
export class LoggingEstimationIntake implements EstimationIntake {
  /** Where the handoff is recorded until something acts on it. */
  private readonly logger = new Logger(LoggingEstimationIntake.name);

  /**
   * Whether the *"nothing is estimating yet"* notice has been given.
   *
   * Once per process rather than once per poll: the fact is about this build's wiring and
   * does not change between cycles, and a background loop that repeated it every interval
   * would be a log nobody reads by the second day.
   */
  private announced = false;

  /**
   * Record the handoff.
   *
   * @param issues - The new and reopened issues.
   * @returns Immediately. Nothing is queued, and the rows stay `unsized` — which is what
   *   `sizing_status` already says about them, so this implementation makes no claim that is
   *   not true.
   */
  accept(issues: readonly EstimableIssue[]): Promise<void> {
    if (issues.length === 0) {
      return Promise.resolve();
    }

    if (!this.announced) {
      this.announced = true;
      this.logger.warn(
        "No estimation pipeline is installed (L.3, #107). Issues are mirrored as `unsized` " +
          "and are waiting to be claimed; nothing is estimating them yet.",
      );
    }

    this.logger.log(
      `Ready to estimate: ${String(issues.length)} issue(s) — ` +
        `${describe(issues, "imported")} imported, ${describe(issues, "reopened")} reopened.`,
    );

    return Promise.resolve();
  }
}

/**
 * How many of a batch arrived for one reason.
 *
 * @param issues - The batch.
 * @param reason - Which reason to count.
 * @returns The count, as a string, for the one log line above.
 */
function describe(issues: readonly EstimableIssue[], reason: EstimableIssue["reason"]): string {
  return String(issues.filter((issue) => issue.reason === reason).length);
}
