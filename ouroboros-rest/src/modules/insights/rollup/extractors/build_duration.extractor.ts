/**
 * The `build_duration` family — the median build duration per job label (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510), amending BI.2's registry; source: #249's
 * farm jobs). The Build Analyzer's duration series and its duration chart read it.
 *
 * **The population is farm jobs that finished `succeeded` on the day.** A failed build measures how
 * far it got rather than how long a build takes, and a retried one is a failure; neither is timed.
 * A build's duration is `finished_at − started_at`, rounded to the millisecond, so queue wait is
 * not in it. Grouped by job label (`job_label` dimension): a firmware build and a simulator run are
 * different jobs with different lengths, and one series of both would be a series of neither.
 *
 * Each row keeps the day's samples and the window pools them (V078's median rule), so nothing here
 * is ever averaged.
 */

import { sql } from "kysely";

import { dayBounds } from "../rollup.days";
import { medianRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One succeeded build's duration. */
interface DurationSample {
  repo_ref: string;
  label: string;
  ms: string;
}

export const buildDurationExtractor: FamilyExtractor = {
  family: "build_duration",
  metrics: { build_duration: 1 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    const { from, to } = dayBounds(day);

    const { rows } = await sql<DurationSample>`
      select ${REPO_REF} as repo_ref, b.label,
             round(extract(epoch from (b.finished_at - b.started_at)) * 1000)::bigint as ms
        from ouroboros.build_jobs b
        ${joinRepo("b")}
       where b.organization_id = ${organizationId}
         and b.status = 'succeeded'
         and b.started_at is not null
         and b.finished_at >= ${from} and b.finished_at < ${to}`.execute(db);

    const groups = new Map<string, { repoRef: string; label: string; samples: number[] }>();

    for (const row of rows) {
      const key = JSON.stringify([row.repo_ref, row.label]);
      const group = groups.get(key) ?? { repoRef: row.repo_ref, label: row.label, samples: [] };

      group.samples.push(num(row.ms));
      groups.set(key, group);
    }

    return [...groups.values()].map((group) =>
      medianRow(
        { repoRef: group.repoRef, metricId: "build_duration", dimension: group.label },
        group.samples,
      ),
    );
  },
};
