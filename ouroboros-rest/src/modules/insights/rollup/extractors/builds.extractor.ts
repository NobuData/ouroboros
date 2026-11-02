/**
 * The `builds` family — builds, failed builds and the build success rate (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433); source: #249's farm jobs).
 *
 * **The population is farm jobs that finished on the day** as `succeeded`, `failed` or `retried`.
 * A `retried` job is a failure somebody ran again: it counts as a failed build, and the retry is
 * a build of its own. `canceled` jobs never finished a build and are in neither side.
 */

import { sql } from "kysely";

import type { DataOrigin } from "../../../db/schema";
import { dayBounds } from "../rollup.days";
import { ratioRow, sumRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One repository's day. */
interface BuildGroup {
  repo_ref: string;
  origin: DataOrigin;
  builds: string;
  succeeded: string;
}

export const buildsExtractor: FamilyExtractor = {
  family: "builds",
  metrics: { builds: 2, build_failures: 2, build_success_rate: 2 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const { rows } = await sql<BuildGroup>`
      select ${REPO_REF} as repo_ref, b.origin,
             count(*) as builds,
             count(*) filter (where b.status = 'succeeded') as succeeded
        from ouroboros.build_jobs b
        ${joinRepo("b")}
       where b.organization_id = ${organizationId}
         and b.status in ('succeeded', 'failed', 'retried')
         and b.finished_at >= ${from} and b.finished_at < ${to}
       group by 1, 2`.execute(db);

    return rows.flatMap((group) => {
      const { repo_ref: repoRef, origin } = group;
      const builds = num(group.builds);
      const succeeded = num(group.succeeded);

      // Every figure is over the day's finished jobs, so each row's population is all of them.
      return [
        sumRow({ repoRef, origin, metricId: "builds" }, builds, builds),
        sumRow({ repoRef, origin, metricId: "build_failures" }, builds - succeeded, builds),
        ratioRow({ repoRef, origin, metricId: "build_success_rate" }, succeeded, builds, 100),
      ];
    });
  },
};
