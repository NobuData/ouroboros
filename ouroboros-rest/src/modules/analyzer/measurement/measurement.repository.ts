/**
 * The measurement job's statements and the measurements read (BV.6,
 * [#515](https://github.com/NobuData/ouroboros/issues/515)) — over `suggestion_measurements`,
 * `analyzer_calibration` and its history (V085, V089), all the analyzer's own tables. The
 * suggestion and calibration tables are not in `db/schema.ts`, so this is `sql`.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { Database } from "../../db/schema";
import type { Confound, Verdict } from "./measurement.math";

/** An open measurement, with what the job needs to judge it. */
export interface OpenMeasurement {
  id: string;
  suggestion_id: string;
  organization_id: string;
  repo_ref: string;
  applied_on: string;
  window_ends_on: string;
  window_days: number;
  target_metric: string;
  baseline: { value: number; statistic?: string; dimension?: string };
  predicted: {
    delta: number;
    unit: string;
    calibration: { analyzer: string; impact_class: string; factor: number };
  };
  verdict_under_below: number;
  verdict_over_above: number;
  confounds: Confound[];
  /** The target metric's registry entry. */
  metric_unit: string;
  metric_aggregation: string;
  /** The last day the metric's rollup family is filled through for the workspace, or null. */
  filled_through: string | null;
}

/** How one measurement closes. */
export interface Closing {
  id: string;
  measured: { window: { from: string; to: string }; value: number; delta: number };
  verdict: Verdict;
  confounds: Confound[];
  closedAt: Date;
}

/** What closing did to the measurement's calibration cell. */
export interface ClosedCell {
  /** The factor before — 1 when the cell had none. */
  fromFactor: number;
  /** The factor after — the same when this measurement did not move it, or it is confounded. */
  toFactor: number;
}

/** One measurement as the read answers it. */
export interface MeasurementRow {
  id: string;
  suggestion_id: string;
  title: string;
  repo_ref: string;
  applied_at: Date;
  applied_on: string;
  window_days: number;
  window_ends_on: string;
  day: number;
  target_metric: string;
  baseline: unknown;
  predicted: unknown;
  measured: unknown;
  verdict: string;
  confounds: Confound[];
  note: string | null;
  closed_at: Date | null;
}

/** One calibration cell with its history, newest first. */
export interface CalibrationRow {
  analyzer: string;
  impact_class: string;
  factor: string;
  sample_count: number;
  updated_at: Date;
  history: {
    from_factor: string;
    to_factor: string;
    sample_count: number;
    measured_sum: string;
    predicted_sum: string;
    measurement_ids: string[];
    added_measurement_ids: string[];
    created_at: string;
  }[];
}

/** Numbers come back from `numeric` as strings; JSON numbers stay numbers. */
const num = (value: unknown): number => Number(value);

@Injectable()
export class MeasurementRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every pending measurement, oldest window first, with its metric and how far its rollup is filled.
   *
   * @returns The open measurements.
   */
  async open(): Promise<OpenMeasurement[]> {
    const { rows } = await sql<OpenMeasurement>`
      select m.id::text as id, m.suggestion_id::text as suggestion_id, m.organization_id, m.repo_ref,
             to_char(m.applied_on, 'YYYY-MM-DD') as applied_on,
             to_char(m.window_ends_on, 'YYYY-MM-DD') as window_ends_on, m.window_days,
             m.target_metric, m.baseline, m.predicted,
             m.verdict_under_below::float8 as verdict_under_below,
             m.verdict_over_above::float8 as verdict_over_above, m.confounds,
             d.unit as metric_unit, d.aggregation as metric_aggregation,
             to_char(s.last_filled_day, 'YYYY-MM-DD') as filled_through
        from ouroboros.suggestion_measurements m
        join ouroboros.metric_definitions d on d.metric_id = m.target_metric
        left join ouroboros.metric_rollup_state s
          on s.organization_id = m.organization_id and s.family = d.family
       where m.verdict = 'pending'
       order by m.window_ends_on, m.id`.execute(this.database.db);

    return rows.map((row) => ({
      ...row,
      predicted: { ...row.predicted, delta: num(row.predicted.delta) },
      baseline: { ...row.baseline, value: num(row.baseline.value) },
    }));
  }

  /**
   * Other applications that interfere: measurements of other suggestions in the same repository
   * with the same target metric, applied inside the window (day 0 to day N).
   *
   * @param measurement - The measurement.
   * @returns One `application` confound per interfering suggestion.
   */
  async applications(measurement: OpenMeasurement): Promise<Confound[]> {
    const { rows } = await sql<{ id: string; date: string }>`
      select m.suggestion_id::text as id, to_char(m.applied_on, 'YYYY-MM-DD') as date
        from ouroboros.suggestion_measurements m
       where m.organization_id = ${measurement.organization_id}
         and m.repo_ref = ${measurement.repo_ref}
         and m.target_metric = ${measurement.target_metric}
         and m.suggestion_id <> ${measurement.suggestion_id}::uuid
         and m.applied_on between ${measurement.applied_on}::date
                              and ${measurement.window_ends_on}::date
       order by m.applied_on, m.suggestion_id`.execute(this.database.db);

    return rows.map((row) => ({ kind: "application", id: row.id, date: row.date }));
  }

  /**
   * Change-points the analyzer detected inside the window, with the series each is about — the
   * caller keeps the ones on its metric. One per day: a change-point re-detected by a later run is
   * one event, named by its newest finding.
   *
   * @param measurement - The measurement.
   * @returns `{id, date, series}` per change-point day.
   */
  async changePoints(
    measurement: OpenMeasurement,
  ): Promise<{ id: string; date: string; series: string }[]> {
    const { rows } = await sql<{ id: string; date: string; series: string }>`
      select distinct on (f.data ->> 'date', f.data ->> 'metric')
             f.id::text as id, f.data ->> 'date' as date, f.data ->> 'metric' as series
        from ouroboros.analysis_findings f
       where f.organization_id = ${measurement.organization_id}
         and f.repo_ref = ${measurement.repo_ref}
         and f.finding_type = 'change_point'
         and f.data ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         and (f.data ->> 'date')::date between ${measurement.applied_on}::date
                                           and ${measurement.window_ends_on}::date
       order by f.data ->> 'date', f.data ->> 'metric', f.created_at desc, f.id`.execute(
      this.database.db,
    );

    return rows;
  }

  /**
   * Record interference found while the window is still open, so the card can flag it early.
   *
   * @param id - The measurement.
   * @param confounds - Every confound found so far — a superset of what is stored.
   */
  async recordConfounds(id: string, confounds: readonly Confound[]): Promise<void> {
    await sql`
      update ouroboros.suggestion_measurements
         set confounds = ${JSON.stringify(confounds)}::jsonb
       where id = ${id}::uuid and verdict = 'pending'`.execute(this.database.db);
  }

  /**
   * Close a measurement and, for a clean verdict, recalibrate its cell — in one transaction, with
   * the note composed from what recalibration actually did.
   *
   * The note says whether the factor moved, and a closed row is frozen, so the factor has to be
   * known before the row is written. It is learned exactly rather than predicted: inside a
   * savepoint the row is closed and `recalibrate_analyzer()` run, the factor is read, the savepoint
   * is rolled back, and the row is closed again — now with its note — and recalibrated for real.
   * Both passes are the same deterministic arithmetic.
   *
   * @param closing - What the job measured and decided.
   * @param calibration - The prediction's cell.
   * @param compose - The note, from the cell's factor before and after.
   * @returns The cell's factor before and after.
   */
  async close(
    closing: Closing,
    calibration: { organizationId: string; repoRef: string; analyzer: string; impactClass: string },
    compose: (cell: ClosedCell) => string | null,
  ): Promise<ClosedCell> {
    return this.database.transaction(async (trx) => {
      const fromFactor = await this.factor(trx, calibration);

      await sql`savepoint measurement_close`.execute(trx);
      await this.write(trx, closing, null);
      const trial = await this.recalibrate(trx, closing.verdict, calibration, fromFactor);
      await sql`rollback to savepoint measurement_close`.execute(trx);

      const cell = { fromFactor, toFactor: trial };
      await this.write(trx, closing, compose(cell));
      await this.recalibrate(trx, closing.verdict, calibration, fromFactor);

      return cell;
    });
  }

  /**
   * A repository's measurements, newest apply first, with day N of each window.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @param at - The instant day N is counted to.
   * @returns The rows.
   */
  async measurements(organizationId: string, repoRef: string, at: Date): Promise<MeasurementRow[]> {
    const { rows } = await sql<MeasurementRow>`
      select m.id::text as id, m.suggestion_id::text as suggestion_id, s.title, m.repo_ref,
             m.applied_at, to_char(m.applied_on, 'YYYY-MM-DD') as applied_on, m.window_days,
             to_char(m.window_ends_on, 'YYYY-MM-DD') as window_ends_on,
             ouroboros.suggestion_measurement_day(m.applied_at, m.window_days, ${at}) as day,
             m.target_metric, m.baseline, m.predicted, m.measured, m.verdict, m.confounds, m.note,
             m.closed_at
        from ouroboros.suggestion_measurements m
        join ouroboros.analysis_suggestions s on s.id = m.suggestion_id
       where m.organization_id = ${organizationId} and m.repo_ref = ${repoRef}
       order by m.applied_at desc, m.id`.execute(this.database.db);

    return rows;
  }

  /**
   * A repository's calibration cells, each with its history newest first.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The cells.
   */
  async calibration(organizationId: string, repoRef: string): Promise<CalibrationRow[]> {
    const { rows } = await sql<CalibrationRow>`
      select c.analyzer, c.impact_class, c.factor::text as factor, c.sample_count, c.updated_at,
             coalesce((select jsonb_agg(jsonb_build_object(
                        'from_factor', h.from_factor::text, 'to_factor', h.to_factor::text,
                        'sample_count', h.sample_count, 'measured_sum', h.measured_sum::text,
                        'predicted_sum', h.predicted_sum::text,
                        'measurement_ids', h.measurement_ids,
                        'added_measurement_ids', h.added_measurement_ids,
                        'created_at', h.created_at) order by h.id desc)
                         from ouroboros.analyzer_calibration_history h
                        where (h.organization_id, h.repo_ref, h.analyzer, h.impact_class)
                              = (c.organization_id, c.repo_ref, c.analyzer, c.impact_class)),
                      '[]'::jsonb) as history
        from ouroboros.analyzer_calibration c
       where c.organization_id = ${organizationId} and c.repo_ref = ${repoRef}
       order by c.analyzer, c.impact_class`.execute(this.database.db);

    return rows;
  }

  /**
   * A cell's current factor.
   *
   * @param trx - The transaction.
   * @param cell - The cell.
   * @returns Its factor, 1 when it has none.
   */
  private async factor(
    trx: Transaction<Database>,
    cell: { organizationId: string; repoRef: string; analyzer: string; impactClass: string },
  ): Promise<number> {
    const { rows } = await sql<{ factor: string }>`
      select factor::text as factor from ouroboros.analyzer_calibration
       where organization_id = ${cell.organizationId} and repo_ref = ${cell.repoRef}
         and analyzer = ${cell.analyzer} and impact_class = ${cell.impactClass}`.execute(trx);

    return rows.length === 0 ? 1 : Number(rows[0].factor);
  }

  /**
   * Close the row.
   *
   * @param trx - The transaction.
   * @param closing - What to write.
   * @param note - The composed note.
   */
  private async write(
    trx: Transaction<Database>,
    closing: Closing,
    note: string | null,
  ): Promise<void> {
    const { numAffectedRows } = await sql`
      update ouroboros.suggestion_measurements
         set measured = ${JSON.stringify(closing.measured)}::jsonb, verdict = ${closing.verdict},
             confounds = ${JSON.stringify(closing.confounds)}::jsonb, note = ${note},
             closed_at = ${closing.closedAt}
       where id = ${closing.id}::uuid and verdict = 'pending'`.execute(trx);

    if ((numAffectedRows ?? 0n) === 0n) {
      throw new Error(`measurement ${closing.id} is no longer pending`);
    }
  }

  /**
   * Recalibrate the cell after a clean close — a confounded one is never an input.
   *
   * @param trx - The transaction.
   * @param verdict - The verdict just written.
   * @param cell - The cell.
   * @param current - Its factor before.
   * @returns Its factor after.
   */
  private async recalibrate(
    trx: Transaction<Database>,
    verdict: Verdict,
    cell: { organizationId: string; repoRef: string; analyzer: string; impactClass: string },
    current: number,
  ): Promise<number> {
    if (verdict === "confounded") return current;
    const { rows } = await sql<{ factor: string | null }>`
      select ouroboros.recalibrate_analyzer(${cell.organizationId}, ${cell.repoRef},
                                            ${cell.analyzer}, ${cell.impactClass})::text
             as factor`.execute(trx);

    return rows[0].factor === null ? current : Number(rows[0].factor);
  }
}
