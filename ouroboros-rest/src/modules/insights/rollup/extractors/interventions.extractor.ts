/**
 * The `interventions` family — human interventions per day (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * **Totals today, causes with #434.** The registry's formula is "times a loop stopped for a
 * person: needs-human handoffs, guardrail stops and policy gates", and those stops exist on the
 * run plane now:
 *
 *   * a **needs-human handoff** is a loop that finished `needs_human`, on the day it finished;
 *   * a **guardrail stop** — and a **policy gate**, which is the `review_required` check — is the
 *     first `fail` verdict of one check on one loop, on the day it was evaluated. A check that
 *     re-evaluates and fails again is the same stop, not a new one.
 *
 * #434 (BI.3) adds the cause taxonomy; when it lands, this family gains the `cause` dimension and
 * the registry entry its version bump.
 */

import { sql } from "kysely";

import { dayBounds } from "../rollup.days";
import { sumRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One repository's day. */
interface InterventionGroup {
  repo_ref: string;
  stops: string;
}

export const interventionsExtractor: FamilyExtractor = {
  family: "interventions",
  metrics: { human_interventions: 1 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const { rows } = await sql<InterventionGroup>`
      with first_failures as (
        select g.run_id, min(g.evaluated_at) as at
          from ouroboros.guardrail_evaluations g
          join ouroboros.runs r on r.id = g.run_id
         where r.organization_id = ${organizationId} and g.verdict = 'fail'
         group by g.run_id, g."check"
      ),
      stops as (
        select r.github_repo_id
          from ouroboros.runs r
         where r.organization_id = ${organizationId} and r.status = 'needs_human'
           and r.finished_at >= ${from} and r.finished_at < ${to}
        union all
        select r.github_repo_id
          from first_failures f
          join ouroboros.runs r on r.id = f.run_id
         where f.at >= ${from} and f.at < ${to}
      )
      select ${REPO_REF} as repo_ref, count(*) as stops
        from stops r
        ${joinRepo("r")}
       group by 1`.execute(db);

    return rows.map((group) =>
      sumRow({ repoRef: group.repo_ref, metricId: "human_interventions" }, num(group.stops)),
    );
  },
};
