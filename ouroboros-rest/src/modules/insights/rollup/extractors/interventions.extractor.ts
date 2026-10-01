/**
 * The `interventions` family — human interventions per day, by cause (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433); causes: BI.3,
 * [#434](https://github.com/NobuData/ouroboros/issues/434)).
 *
 * **The events are V079's, counted.** Every moment a person stepped into a loop is an
 * `intervention_events` row — a needs-human handoff, a human failure classification, a waiver, the
 * first failure of a guardrail or policy-gate check on a loop, a blocking vote — and its cause is the
 * one the versioned mapping rules assigned or a person re-categorized it to. This family reads
 * `intervention_cause_daily`, the migration's per-(workspace, repository, UTC day, cause) shape, and
 * writes one `human_interventions` row per cause (`dimension_kind = 'cause'`, registry version 2).
 *
 * Which records are events, and which cause each gets, is decided in the database — once, by the
 * hooks and the rules — so the card's bars and this total cannot disagree.
 */

import { sql } from "kysely";

import { sumRow } from "../rollup.rows";
import { joinRepo, num, REPO_REF } from "../rollup.sql";
import type { FamilyExtractor, RollupRow } from "../rollup.types";

/** One repository's day for one cause. */
interface InterventionGroup {
  repo_ref: string;
  cause: string;
  events: string;
}

export const interventionsExtractor: FamilyExtractor = {
  family: "interventions",
  metrics: { human_interventions: 2 },

  async extract(db, organizationId, day): Promise<RollupRow[]> {
    // `r` because each row of the view is a group of runs, and `joinRepo` joins a run's repository.
    const { rows } = await sql<InterventionGroup>`
      select ${REPO_REF} as repo_ref, r.cause, sum(r.events) as events
        from ouroboros.intervention_cause_daily r
        ${joinRepo("r")}
       where r.organization_id = ${organizationId}
         and r.day = ${day}::date
       group by 1, 2
       order by 1, 2`.execute(db);

    return rows.map((group) =>
      sumRow(
        { repoRef: group.repo_ref, metricId: "human_interventions", dimension: group.cause },
        num(group.events),
      ),
    );
  },
};
