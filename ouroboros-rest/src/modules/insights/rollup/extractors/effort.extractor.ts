/**
 * The `effort` family — time to completion by predicted effort (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433); sources: #100's estimates, joined to
 * merged loops by #435's `estimate_outcomes`).
 *
 * **The population is merged loop PRs graded on the day of their merge** — `estimate_outcomes`
 * is exactly "merged loops ⋈ the estimate in force when they were queued", with the lead-time
 * actual from `ouroboros.lead_time_ms()`. Each predicted effort (`xs` … `xl`) is a dimension row
 * holding its merges' lead times as median samples. Unestimated merges are in no slice.
 */

import { sql } from "kysely";

import { dayBounds } from "../rollup.days";
import { medianRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One graded merge. */
interface EffortSample {
  repo_ref: string;
  effort: string;
  ms: string;
}

export const effortExtractor: FamilyExtractor = {
  family: "effort",
  metrics: { completion_time_by_effort: 1 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const { rows } = await sql<EffortSample>`
      select ${REPO_REF} as repo_ref, eo.predicted_effort as effort, eo.actual_duration_ms as ms
        from ouroboros.estimate_outcomes eo
        join ouroboros.pull_requests pr on pr.id = eo.pr_id
        join ouroboros.runs r on r.id = pr.run_id
        ${joinRepo("r")}
       where eo.organization_id = ${organizationId} and eo.predicted_effort is not null
         and eo.merged_at >= ${from} and eo.merged_at < ${to}`.execute(db);

    const groups = new Map<string, { repoRef: string; effort: string; samples: number[] }>();

    for (const row of rows) {
      const key = JSON.stringify([row.repo_ref, row.effort]);
      const group = groups.get(key) ?? { repoRef: row.repo_ref, effort: row.effort, samples: [] };

      // A lead time is never negative in practice; clamped so a clock skew between the loop and
      // the host cannot make the whole day's fill refuse.
      group.samples.push(Math.max(0, num(row.ms)));
      groups.set(key, group);
    }

    return [...groups.values()].map((group) =>
      medianRow(
        { repoRef: group.repoRef, metricId: "completion_time_by_effort", dimension: group.effort },
        group.samples,
      ),
    );
  },
};
