/**
 * Decision **I6**'s predicate — *merged without human edits* — written once (BJ.3,
 * [#439](https://github.com/NobuData/ouroboros/issues/439)).
 *
 * The KPI row's `merged_untouched_rate` (the throughput extractor, #433) and the model scoreboard's
 * per-row rate (#439) both read this fragment, so the page's most quotable number cannot have two
 * computations. The oracle twin in `rollup.oracle.fixture.ts` states it again independently on
 * purpose: parity there compares two writings, not one with itself.
 *
 * **Untouched** is a merged PR whose revisions contain no push the loop did not author. A revision
 * is the loop's when its `head_sha` is a commit the run reported in `run_commits` — V052's
 * match-by-sha, never an assertion — so a human push, a host-side edit and anything pushed after
 * the loop's last revision each leave a revision no run commit names.
 */

import { sql, type RawBuilder } from "kysely";

/** The relations the predicate can be applied to: each has a PR `id` and its loop's `run_id`. */
export type UntouchedSubject = "pr" | "closed_prs";

/**
 * True for a PR none of whose revisions is outside its loop's commits.
 *
 * The caller decides the population (merged, in the window); this answers only *untouched*.
 *
 * @param subject - The alias of a relation with the PR's `id` and its loop's `run_id`. A fixed
 *   identifier chosen by the caller, never input.
 * @returns A boolean SQL expression.
 */
export function untouchedPr(subject: UntouchedSubject): RawBuilder<boolean> {
  return sql.raw<boolean>(
    `not exists (select 1 from ouroboros.pr_revisions v ` +
      `where v.pr_id = ${subject}.id ` +
      `and not exists (select 1 from ouroboros.run_commits c ` +
      `where c.run_id = ${subject}.run_id and c.sha = v.head_sha))`,
  );
}
