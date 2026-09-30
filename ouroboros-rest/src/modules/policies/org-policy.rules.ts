/**
 * The dry-run policy's rules, as pure functions — what every enforcement point asks.
 *
 * BA.3 ([#382](https://github.com/NobuData/ouroboros/issues/382)), decision **O3**. The policy
 * sits **below** every surface that could merge, so the questions those surfaces ask are answered
 * here once:
 *
 * ```
 * createPR            draftFor(requested, dryRun)            → forced true while active
 * arm / merge         (refused by the executor with DRY_RUN_REASON)
 * workflow terminal   autoMergeUnderPolicy(pinned, dryRun)   → overridden at evaluation, never mutated
 * surfaces            dryRunStateOf(dryRun, pinned)           → one shape for the plan, the PR page, the wizard
 * ```
 *
 * **Overriding, not mutating.** A workflow whose terminal is `open_pr_automerge` keeps that
 * terminal in its stored document; {@link autoMergeUnderPolicy} decides what it *means* while
 * dry-run is active. Flipping the policy off changes the answer and nothing else, so the original
 * behaviour comes back exactly.
 *
 * Pure.
 */

/** The designed reason every surface renders — the stated half of a dry-run refusal. */
export const DRY_RUN_REASON = "dry-run policy active";

/** The machine-readable code of a dry-run refusal — what a surface branches on. */
export const DRY_RUN_CODE = "dry_run_policy_active";

/** The merge affordance's label while dry-run is active — AY.7's (#369) relabelling contract. */
export const DRY_RUN_MERGE_LABEL = "Dry-run — review the draft PR";

/** A workflow terminal's auto-merge, as the policy lets it stand. */
export interface AutoMergeUnderPolicy {
  /** What the pinned workflow's terminal asks for — its stored config, untouched. */
  readonly requested: boolean;
  /** What happens: `requested`, unless dry-run overrides it. */
  readonly effective: boolean;
  /** Whether dry-run is what turned a requested auto-merge off. */
  readonly overridden: boolean;
}

/** The dry-run state, as every consuming surface renders it. */
export interface DryRunState {
  /** Whether dry-run is active. */
  readonly active: boolean;
  /** {@link DRY_RUN_REASON} while active, otherwise null. */
  readonly reason: string | null;
  /** The pinned workflow's auto-merge under the policy. */
  readonly autoMerge: AutoMergeUnderPolicy;
}

/**
 * Whether a PR opens as a draft.
 *
 * @param requested - Whether the caller asked for a draft (`undefined` = not asked).
 * @param dryRun - Whether dry-run is active.
 * @returns `true` whenever dry-run is active, regardless of the caller; otherwise what was asked.
 */
export function draftFor(requested: boolean | undefined, dryRun: boolean): boolean {
  return dryRun || requested === true;
}

/**
 * A workflow terminal's auto-merge under the policy — evaluated, never written back.
 *
 * @param requested - Whether the pinned workflow's terminal is `open_pr_automerge`.
 * @param dryRun - Whether dry-run is active.
 * @returns What it asks, what happens, and whether dry-run is the difference.
 */
export function autoMergeUnderPolicy(requested: boolean, dryRun: boolean): AutoMergeUnderPolicy {
  return { requested, effective: requested && !dryRun, overridden: requested && dryRun };
}

/**
 * The dry-run state a surface renders.
 *
 * @param dryRun - Whether dry-run is active.
 * @param workflowAutoMerges - Whether the pinned workflow's terminal requests auto-merge.
 * @returns The state.
 */
export function dryRunStateOf(dryRun: boolean, workflowAutoMerges: boolean): DryRunState {
  return {
    active: dryRun,
    reason: dryRun ? DRY_RUN_REASON : null,
    autoMerge: autoMergeUnderPolicy(workflowAutoMerges, dryRun),
  };
}
