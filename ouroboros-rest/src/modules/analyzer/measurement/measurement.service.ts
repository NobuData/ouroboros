/**
 * The measurement job (BV.6, [#515](https://github.com/NobuData/ouroboros/issues/515), decision A6,
 * mockup 18's *"Every applied suggestion is re-measured for 14 days. The analyzer's model retrains
 * on its own misses."*).
 *
 * One pass, for every pending measurement:
 *
 * ```
 * interference? ─ other applies on the same metric, change-points in it, inside the window
 *     └─ recorded as it is found, so the card flags a muddied window before it closes
 * window over and its rollup filled through the last day?
 *     ├─ no  ─▶ pending: the card shows day N of 14
 *     └─ yes ─▶ measured value of day 1…N (the baseline's statistic, unit and pool)
 *               verdict = confounded if anything interfered, else ratio against the stored bands
 *               close + recalibrate the cell (clean verdicts only) + the composed note, one write
 * ```
 *
 * **Never a clean verdict for a muddied window.** A measurement with any interfering event closes
 * `confounded`, listing them, and is never a calibration input (V085 refuses either otherwise).
 *
 * **Never a close on a half-filled day.** The rollup consolidates a day after it ends; a window
 * whose last day the metric's family has not been filled through stays pending one more tick.
 *
 * A measurement whose window has no data at all (no build ran) also stays pending, and says so in
 * the log: closing it on nothing would be a verdict about nothing.
 */

import { Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import { windowValue } from "../actions/measurement";
import { CorpusRepository } from "../corpus/corpus.repository";
import {
  changePointMetric,
  measuredWindow,
  noteOf,
  targetOf,
  unitScale,
  verdictOf,
  type Confound,
} from "./measurement.math";
import { MeasurementRepository, type OpenMeasurement } from "./measurement.repository";

/** What one pass did. */
export interface MeasurementPass {
  /** Measurements closed, by id, with their verdict. */
  closed: { id: string; verdict: string; note: string | null }[];
  /** Measurements still pending. */
  pending: number;
  /** Measurements a failure skipped this pass. */
  failed: string[];
}

/**
 * A UTC day as `YYYY-MM-DD`.
 *
 * @param at - An instant.
 * @returns Its UTC date.
 */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

@Injectable()
export class MeasurementService {
  private readonly logger = new Logger(MeasurementService.name);

  /**
   * @param measurements - The job's statements.
   * @param corpus - The rollup grain the target metric is read from (BI.2, #433).
   */
  constructor(
    private readonly measurements: MeasurementRepository,
    private readonly corpus: CorpusRepository,
  ) {}

  /**
   * One pass over every pending measurement. Each is handled on its own: one failing is logged
   * and skipped, never the pass.
   *
   * @param now - The pass's instant.
   * @returns What it did.
   */
  async pass(now: Date): Promise<MeasurementPass> {
    const result: MeasurementPass = { closed: [], pending: 0, failed: [] };

    for (const measurement of await this.measurements.open()) {
      try {
        const closed = await this.measure(measurement, now);
        if (closed === undefined) {
          result.pending += 1;
        } else {
          result.closed.push({ id: measurement.id, ...closed });
        }
      } catch (error) {
        result.failed.push(measurement.id);
        this.logger.error(
          `Measurement ${measurement.id} could not be judged.`,
          describeForLog(error),
        );
      }
    }

    return result;
  }

  /**
   * Judge one measurement.
   *
   * @param measurement - A pending measurement.
   * @param now - The pass's instant.
   * @returns The verdict and note when it closed; `undefined` while it stays pending.
   */
  async measure(
    measurement: OpenMeasurement,
    now: Date,
  ): Promise<{ verdict: string; note: string | null } | undefined> {
    const confounds = await this.interference(measurement);
    const today = utcDay(now);
    const closable =
      today > measurement.window_ends_on &&
      measurement.filled_through !== null &&
      measurement.filled_through >= measurement.window_ends_on;

    if (!closable) {
      if (confounds.length > measurement.confounds.length) {
        await this.measurements.recordConfounds(measurement.id, confounds);
      }
      return undefined;
    }

    const measured = await this.measuredValue(measurement);
    if (measured === undefined) {
      this.logger.warn(
        `Measurement ${measurement.id}: no ${measurement.target_metric} data in its window; it stays pending.`,
      );
      return undefined;
    }

    const delta = Math.round((measured.value - measurement.baseline.value) * 100) / 100;
    const verdict = verdictOf(
      measurement.predicted.delta,
      delta,
      measurement.verdict_under_below,
      measurement.verdict_over_above,
      confounds.length > 0,
    );
    const { calibration } = measurement.predicted;
    let note: string | null = null;

    await this.measurements.close(
      {
        id: measurement.id,
        measured: { window: measured.window, value: measured.value, delta },
        verdict,
        confounds,
        closedAt: now,
      },
      {
        organizationId: measurement.organization_id,
        repoRef: measurement.repo_ref,
        analyzer: calibration.analyzer,
        impactClass: calibration.impact_class,
      },
      (cell) => {
        note = noteOf(verdict, calibration.analyzer, cell.fromFactor, cell.toFactor, confounds);
        return note;
      },
    );

    return { verdict, note };
  }

  /**
   * Everything that interfered with the window — see the file header. Entries already recorded are
   * kept, so the list only grows.
   *
   * @param measurement - The measurement.
   * @returns The confounds, by date then id.
   */
  private async interference(measurement: OpenMeasurement): Promise<Confound[]> {
    const applications = await this.measurements.applications(measurement);
    const changePoints = (await this.measurements.changePoints(measurement))
      .filter((point) => changePointMetric(point.series) === measurement.target_metric)
      .map((point): Confound => ({ kind: "change_point", id: point.id, date: point.date }));

    const all = new Map<string, Confound>();
    for (const confound of [...measurement.confounds, ...applications, ...changePoints]) {
      all.set(`${confound.kind}:${confound.id}:${confound.date}`, confound);
    }
    return [...all.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
  }

  /**
   * The target metric over day 1…N, as the baseline was read.
   *
   * @param measurement - The measurement.
   * @returns The window and value in the prediction's unit, or `undefined` with nothing to read.
   */
  private async measuredValue(
    measurement: OpenMeasurement,
  ): Promise<{ window: { from: string; to: string }; value: number } | undefined> {
    const target = targetOf(
      measurement.target_metric,
      measurement.baseline.statistic,
      measurement.metric_aggregation,
      unitScale(measurement.metric_unit, measurement.predicted.unit),
    );
    if (target === undefined) return undefined;

    const window = measuredWindow(measurement.applied_on, measurement.window_ends_on);
    const dimension = measurement.baseline.dimension;
    const points = (
      await this.corpus.series(
        { organizationId: measurement.organization_id, repoRef: measurement.repo_ref },
        window,
        measurement.target_metric,
      )
    ).filter((point) => dimension === undefined || point.dimension === dimension);
    const value = windowValue(target, points, measurement.window_days);

    return value === undefined ? undefined : { window, value };
  }
}
