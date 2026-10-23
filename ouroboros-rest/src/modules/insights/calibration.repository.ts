/**
 * `estimate_outcomes` statements — the fill and the report's per-effort sums (V077,
 * [#435](https://github.com/NobuData/ouroboros/issues/435)).
 *
 * The join itself — which estimate governed, the queue instant, the lead-time actual — is
 * `ouroboros.record_estimate_outcome()` in the migration, where `tests/constraints.sql` proves it
 * against the multiple-version fixture. This file calls it and reads what it wrote.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { DataOrigin, EstimateEffort, EstimateOutcome } from "../db/schema";
import type { CalibrationRange, CalibrationSliceSums } from "./calibration.rules";

/** The calibration statements, as the service reaches them. */
export interface CalibrationStore {
  /**
   * Upsert the outcome row for one merged loop PR.
   *
   * @param organizationId - The workspace.
   * @param prId - `pull_requests.id`.
   * @returns The row, or undefined when the PR is not a merged loop PR of the workspace.
   */
  record(organizationId: string, prId: string): Promise<EstimateOutcome | undefined>;
  /**
   * A window's outcomes, summed per predicted effort (null for the unestimated) and per data
   * origin of the merged pull request (DJ.2) — every origin; the report keeps the one asked for.
   *
   * @param organizationId - The workspace.
   * @param range - `[from, to)` over `merged_at`.
   * @returns One group per effort present in the window.
   */
  sums(organizationId: string, range: CalibrationRange): Promise<CalibrationSliceSums[]>;
}

/** A group as `pg` hands it back — `count` and `sum` over `bigint` arrive as strings. */
interface SumsRow {
  effort: EstimateEffort | null;
  origin: DataOrigin;
  merged: string;
  within_band: string;
  over: string;
  under: string;
  deviation_ms: string | null;
  midpoint_ms: string | null;
}

@Injectable()
export class CalibrationRepository implements CalibrationStore {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async record(organizationId: string, prId: string): Promise<EstimateOutcome | undefined> {
    const result = await sql<EstimateOutcome>`
      select * from ouroboros.record_estimate_outcome(${organizationId}, ${prId}::uuid)`.execute(
      this.database.db,
    );

    return result.rows[0];
  }

  /** @inheritdoc */
  async sums(organizationId: string, range: CalibrationRange): Promise<CalibrationSliceSums[]> {
    const result = await sql<SumsRow>`
      select o.predicted_effort                                                 as effort,
             pr.origin                                                          as origin,
             count(*)                                                           as merged,
             count(*) filter (where within_band)                                as within_band,
             count(*) filter (where not within_band and deviation_ms > 0)       as over,
             count(*) filter (where not within_band and deviation_ms < 0)       as under,
             sum(deviation_ms)                                                  as deviation_ms,
             sum((predicted_cycle_min::bigint + predicted_cycle_max) * 30000)   as midpoint_ms
        from ouroboros.estimate_outcomes o
        join ouroboros.pull_requests pr on pr.id = o.pr_id
       where o.organization_id = ${organizationId}
         and o.merged_at >= ${range.from}
         and o.merged_at < ${range.to}
       group by o.predicted_effort, pr.origin`.execute(this.database.db);

    return result.rows.map((row) => ({
      effort: row.effort,
      origin: row.origin,
      merged: Number(row.merged),
      withinBand: Number(row.within_band),
      over: Number(row.over),
      under: Number(row.under),
      deviationMs: Number(row.deviation_ms ?? 0),
      midpointMs: Number(row.midpoint_ms ?? 0),
    }));
  }
}
