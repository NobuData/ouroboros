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
 * **Since BQ.2** ([#481](https://github.com/NobuData/ouroboros/issues/481)) "is dry-run active" is
 * asked **per PR**: the org-wide switch is the stricter override, and otherwise the policy
 * document's `dry_run_new_repos` keeps each repository's first N loops in dry-run
 * (`policy-resolution.ts`, `effectiveDryRun`). A requested auto-merge is also subject to the
 * document's `auto_merge` rule; {@link autoMergeUnderPolicy} takes its eligibility.
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
  /** What happens: `requested`, unless dry-run overrides it or the `auto_merge` rule refuses it. */
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
  /**
   * What made it active (#481): `org_override` — the workspace-wide switch — or
   * `dry_run_new_repos`, the policy document's per-repository rule. Null while inactive; absent
   * where the caller has no per-PR answer.
   */
  readonly source?: "org_override" | "dry_run_new_repos" | null;
  /** The policy version, when `dry_run_new_repos` is the source; otherwise null. */
  readonly policyVersion?: number | null;
}

/** What the org policy document said about one PR (#481), for {@link dryRunStateOf}. */
export interface PolicyStanding {
  /** Which said dry-run is active, or null when it is not. */
  readonly source: "org_override" | "dry_run_new_repos" | null;
  /** The policy version, when the document's rule is the source. */
  readonly version: number | null;
  /** Whether the `auto_merge` rule lets this PR merge unattended. */
  readonly autoMergeEligible: boolean;
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
 * @param eligible - Whether the org policy's `auto_merge` rule lets this PR merge unattended (#481).
 * @returns What it asks, what happens, and whether dry-run is the difference.
 */
export function autoMergeUnderPolicy(
  requested: boolean,
  dryRun: boolean,
  eligible = true,
): AutoMergeUnderPolicy {
  return {
    requested,
    effective: requested && !dryRun && eligible,
    overridden: requested && dryRun,
  };
}

/**
 * The dry-run state a surface renders.
 *
 * @param dryRun - Whether dry-run is active.
 * @param workflowAutoMerges - Whether the pinned workflow's terminal requests auto-merge.
 * @param standing - What the org policy document said about this PR (#481), when the caller knows.
 * @returns The state.
 */
export function dryRunStateOf(
  dryRun: boolean,
  workflowAutoMerges: boolean,
  standing?: PolicyStanding,
): DryRunState {
  const state: DryRunState = {
    active: dryRun,
    reason: dryRun ? DRY_RUN_REASON : null,
    autoMerge: autoMergeUnderPolicy(
      workflowAutoMerges,
      dryRun,
      standing?.autoMergeEligible ?? true,
    ),
  };

  return standing === undefined
    ? state
    : {
        ...state,
        source: dryRun ? standing.source : null,
        policyVersion: dryRun ? standing.version : null,
      };
}
