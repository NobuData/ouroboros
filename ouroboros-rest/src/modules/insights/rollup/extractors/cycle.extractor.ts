/**
 * The `cycle` family — median cycle time and median time per stage (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433); sources: the run plane and #298's
 * stage history).
 *
 * **The population is loops that finished `merged` on the day.** A loop's cycle is
 * `finished_at − started_at`; its time in a stage is the sum of every attempt of that stage that
 * has both a start and a finish, so a stage that retried shows its retries as time. Both are
 * medians: each row keeps the day's samples and the window pools them (V078's median rule), so
 * nothing here is ever averaged.
 */

import { sql } from "kysely";

import { dayBounds } from "../rollup.days";
import { medianRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One observation: a loop's cycle (`stage_key` null) or its time in one stage. */
interface CycleSample {
  repo_ref: string;
  stage_key: string | null;
  ms: string;
}

export const cycleExtractor: FamilyExtractor = {
  family: "cycle",
  metrics: { cycle_time: 1, stage_duration: 1 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const { rows } = await sql<CycleSample>`
      with merged_runs as (
        select r.id, r.started_at, r.finished_at, ${REPO_REF} as repo_ref
          from ouroboros.runs r
          ${joinRepo("r")}
         where r.organization_id = ${organizationId} and r.status = 'merged'
           and r.finished_at >= ${from} and r.finished_at < ${to}
      )
      select repo_ref, null::text as stage_key,
             floor(extract(epoch from (finished_at - started_at)) * 1000)::bigint as ms
        from merged_runs
      union all
      select m.repo_ref, s.stage_key,
             sum(floor(extract(epoch from (s.finished_at - s.started_at)) * 1000))::bigint
        from merged_runs m
        join ouroboros.run_stages s on s.run_id = m.id
       where s.started_at is not null and s.finished_at is not null
       group by m.repo_ref, m.id, s.stage_key`.execute(db);

    const groups = new Map<string, { repoRef: string; stage: string | null; samples: number[] }>();

    for (const row of rows) {
      const key = JSON.stringify([row.repo_ref, row.stage_key]);
      const group = groups.get(key) ?? { repoRef: row.repo_ref, stage: row.stage_key, samples: [] };

      group.samples.push(num(row.ms));
      groups.set(key, group);
    }

    return [...groups.values()].map((group) =>
      group.stage === null
        ? medianRow({ repoRef: group.repoRef, metricId: "cycle_time" }, group.samples)
        : medianRow(
            { repoRef: group.repoRef, metricId: "stage_duration", dimension: group.stage },
            group.samples,
          ),
    );
  },
};
