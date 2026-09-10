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
 * `unsized → estimating → sized | needs_human`. This ticket deliberately did not build it, and
 * left this port with a placeholder that logged instead: the roadmap's L.3 owns that queue, its
 * retry, its stale sweep and its versioned persistence, and a second queue built here would be
 * the thing that ticket then had to delete.
 *
 * **L.3 has landed, and the port did its job.** `backlog-sync.module.ts` binds
 * {@link ESTIMATION_INTAKE} to `src/modules/estimation/`'s orchestrator; the placeholder is
 * gone, and nothing else in this module changed. What remains here is the interface itself, and
 * it stays here rather than moving next to its implementation for a reason worth stating: it is
 * what the **sync** depends on, and a port that lives with its consumer is a port a second
 * implementation can be written against — which is what Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140))'s ticket-source providers will
 * need when GitHub stops being the only thing that fills this table.
 *
 * The issue's fourth acceptance criterion — *"a new issue automatically enters the estimation
 * pipeline"* — was marked *(verified together with #107)* for this reason. What is verifiable
 * here is that the sync hands over exactly the new and reopened issues, exactly once, after
 * the transaction that stored them has committed; `backlog-sync.service.spec.ts` and the
 * integration suite both assert that, against a recording intake. That it then reaches `sized`
 * is `estimation/estimation.integration-spec.ts`'s.
 */

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
