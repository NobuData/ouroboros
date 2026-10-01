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
import type { EstimateEffort, EstimateOutcome } from "../db/schema";
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
   * A window's outcomes, summed per predicted effort (null for the unestimated).
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
      select predicted_effort                                                   as effort,
             count(*)                                                           as merged,
             count(*) filter (where within_band)                                as within_band,
             count(*) filter (where not within_band and deviation_ms > 0)       as over,
             count(*) filter (where not within_band and deviation_ms < 0)       as under,
             sum(deviation_ms)                                                  as deviation_ms,
             sum((predicted_cycle_min::bigint + predicted_cycle_max) * 30000)   as midpoint_ms
        from ouroboros.estimate_outcomes
       where organization_id = ${organizationId}
         and merged_at >= ${range.from}
         and merged_at < ${range.to}
       group by predicted_effort`.execute(this.database.db);

    return result.rows.map((row) => ({
      effort: row.effort,
      merged: Number(row.merged),
      withinBand: Number(row.within_band),
      over: Number(row.over),
      under: Number(row.under),
      deviationMs: Number(row.deviation_ms ?? 0),
      midpointMs: Number(row.midpoint_ms ?? 0),
    }));
  }
}
