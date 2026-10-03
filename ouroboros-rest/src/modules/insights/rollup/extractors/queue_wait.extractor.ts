/**
 * The `queue_wait` family — the median time a farm job waited for a runner, per pool (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514), amending BI.2's registry; source: #249's
 * farm jobs). The runner-move suggestion predicts a queue wait, and the measurement row its apply
 * writes reads its baseline and outcome here.
 *
 * **The population is farm jobs that started on the day.** A job's wait is `started_at −
 * queued_at`, rounded to the millisecond. A job canceled while queued never started and is not
 * timed; a retry is its own job and waits again. Grouped by pool (`pool` dimension, the pool's
 * name): a starved pool and an idle one are different queues.
 *
 * Each row keeps the day's samples and the window pools them (V078's median rule), so any other
 * percentile of a window — the suggestion's p95 — is read from the same samples.
 */

import { sql } from "kysely";

import { dayBounds } from "../rollup.days";
import { medianRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One started job's wait. */
interface WaitSample {
  repo_ref: string;
  pool: string;
  ms: string;
}

export const queueWaitExtractor: FamilyExtractor = {
  family: "queue_wait",
  metrics: { queue_wait: 1 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const { rows } = await sql<WaitSample>`
      select ${REPO_REF} as repo_ref, p.name as pool,
             greatest(round(extract(epoch from (b.started_at - b.queued_at)) * 1000), 0)::bigint as ms
        from ouroboros.build_jobs b
        ${joinRepo("b")}
        join ouroboros.runner_pools p on p.id = b.pool_id
       where b.organization_id = ${organizationId}
         and b.started_at >= ${from} and b.started_at < ${to}`.execute(db);

    const groups = new Map<string, { repoRef: string; pool: string; samples: number[] }>();

    for (const row of rows) {
      const key = JSON.stringify([row.repo_ref, row.pool]);
      const group = groups.get(key) ?? { repoRef: row.repo_ref, pool: row.pool, samples: [] };

      group.samples.push(num(row.ms));
      groups.set(key, group);
    }

    return [...groups.values()].map((group) =>
      medianRow(
        { repoRef: group.repoRef, metricId: "queue_wait", dimension: group.pool },
        group.samples,
      ),
    );
  },
};
