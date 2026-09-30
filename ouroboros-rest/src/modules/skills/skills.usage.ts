/**
 * The Used-by column, counted (BF.1, [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * Mockup 14's `61% of runs`, `every run`, `every PR`, `physical tests` and `—` are counted from
 * #406's injection records, never stored — BE.5 (#409) seeded the records so these figures fall
 * out, and `ouroboros-db/tests/seed.sql` applies the same rule this file does:
 *
 * Over the runs context was assembled for in the window, in the skill's scope —
 *
 *   1. no run carried the skill                        → `—`
 *   2. every in-scope run did                          → `every run`
 *   3. exactly the in-scope runs that opened a PR did  → `every PR`
 *   4. exactly the in-scope runs with HIL measurements → `physical tests`
 *   5. otherwise the rounded share                     → `61% of runs`
 *
 * A draft skill is `—` whatever the records say: a draft is never injected, and no response may
 * report it as active.
 */

import type { SkillScope } from "../db/schema";
import { USED_BY_NONE, type SkillUsedBy } from "./skills.resources";

/** A run context was assembled for in the window. */
export interface InjectedRun {
  readonly runId: string;
  /** Its repository, `owner/name`. */
  readonly repoRef: string;
  /** Its workflow's slug. */
  readonly workflowSlug: string;
  /** Whether it opened a pull request. */
  readonly openedPr: boolean;
  /** Whether it took HIL measurements. */
  readonly physical: boolean;
}

/** What {@link usedBy} needs of a skill. */
export interface UsageSkill {
  readonly scope: SkillScope;
  readonly repoRef: string | null;
  readonly workflowSlug: string | null;
  readonly draft: boolean;
}

/**
 * Whether a run is in a skill's scope.
 *
 * @param skill - The skill.
 * @param run - The run.
 * @returns `true` for every run of an org skill, the repository's runs for a repo skill, and the
 *   workflow's runs for a workflow skill.
 */
export function inScope(skill: UsageSkill, run: InjectedRun): boolean {
  switch (skill.scope) {
    case "org":
      return true;
    case "repo":
      return run.repoRef === skill.repoRef;
    case "workflow":
      return run.workflowSlug === skill.workflowSlug;
  }
}

/**
 * The Used-by cell for one skill.
 *
 * @param skill - The skill.
 * @param runs - Every run context was assembled for in the window.
 * @param carried - The ids of the runs whose manifests carried a version of the skill.
 * @returns The label and the two counts behind it.
 */
export function usedBy(
  skill: UsageSkill,
  runs: readonly InjectedRun[],
  carried: ReadonlySet<string>,
): SkillUsedBy {
  const scoped = runs.filter((run) => inScope(skill, run));
  const carriedCount = runs.filter((run) => carried.has(run.runId)).length;

  if (skill.draft || carriedCount === 0) {
    return { label: USED_BY_NONE, carried: skill.draft ? 0 : carriedCount, inScope: scoped.length };
  }

  const matches = (subset: readonly InjectedRun[]): boolean =>
    subset.length === carriedCount && subset.every((run) => carried.has(run.runId));

  const label = matches(scoped)
    ? "every run"
    : matches(scoped.filter((run) => run.openedPr))
      ? "every PR"
      : matches(scoped.filter((run) => run.physical))
        ? "physical tests"
        : `${Math.round((100 * carriedCount) / Math.max(scoped.length, 1))}% of runs`;

  return { label, carried: carriedCount, inScope: scoped.length };
}
