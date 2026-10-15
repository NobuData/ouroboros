/**
 * Whether a repository is in dry-run **now** — the one answer the PR opener (#481) and live-run
 * admission (DI.4, [#1312](https://github.com/NobuData/ouroboros/issues/1312)) both ask.
 *
 * ```
 * org_policies.dry_run (the stricter override) ── true → in dry-run, whatever the counter says
 *                                              └─ false → dry_run_new_repos for the repo's next loop
 * ```
 *
 * Read uncached: the opener decides a PR's draft once and the PR keeps it, and admission must
 * see a policy flipped a moment ago on the very next claim. A run already admitted is not
 * re-judged here — its PR is opened by the opener, which asks again, and the merge executor
 * re-checks at execution, so flipping the policy mid-run never turns a draft into a merge.
 */

import type { DryRunPolicyReader } from "./org-policy.service";
import { effectiveDryRun } from "./policy-resolution";
import type { PolicyResolutionService, PolicySnapshotSource } from "./policy-resolution.service";

/** What the check needs of the policy resolver (#481). */
export type PolicyLoopSource = PolicySnapshotSource & Pick<PolicyResolutionService, "nextLoop">;

/**
 * Whether the next loop on a repository runs in dry-run.
 *
 * @param policy - The org-wide switch, or undefined where no policy module is wired (reads as
 *   dry-run: the safe answer).
 * @param resolver - The per-repository rule's resolver, or undefined (the switch alone decides).
 * @param organizationId - The workspace.
 * @param githubRepoId - `github_repos.id`, or null when not known (read as still in dry-run).
 * @returns True while the org-wide switch is on, or the repository is inside its first N loops.
 */
export async function repositoryDryRun(
  policy: DryRunPolicyReader | undefined,
  resolver: PolicyLoopSource | undefined,
  organizationId: string,
  githubRepoId: string | null,
): Promise<boolean> {
  if (policy === undefined) {
    return true;
  }

  const override = await policy.dryRunNow(organizationId);

  if (override || resolver === undefined) {
    return override;
  }

  const [snapshot, loop] = await Promise.all([
    resolver.snapshot(organizationId, true),
    resolver.nextLoop(organizationId, githubRepoId),
  ]);

  return effectiveDryRun(override, snapshot.resolve("dry_run_new_repos", { loop })).active;
}
