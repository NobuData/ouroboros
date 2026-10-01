/**
 * One rollup pass over every workspace and metric family (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * `rollup.plan.ts` says what a tick does; this class does it, and `rollup.scheduler.ts` says when.
 * Each (workspace, family) is its own unit of failure: an extractor whose registry entry moved, or
 * a statement the database refused, marks that family `failed` with the reason in
 * `metric_rollup_state.last_error` and the pass moves on to the next.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { describeForLog } from "../../errors/failure";
import { addDays, isDay, utcDay } from "./rollup.days";
import { backfillDue } from "./rollup.plan";
import { registryMismatches, type RegisteredMetric } from "./rollup.registry";
import { RollupRepository } from "./rollup.repository";
import type { Day, FamilyExtractor } from "./rollup.types";

/** The token the family list is bound to — `ROLLUP_EXTRACTORS` in production, a stub in a spec. */
export const ROLLUP_FAMILIES = Symbol("ROLLUP_FAMILIES");

/** What one (workspace, family) did in a pass. */
export interface FamilyOutcome {
  readonly organizationId: string;
  readonly family: string;
  readonly status: "succeeded" | "failed";
  /** Backfill days filled this pass — today's tail is not counted. */
  readonly backfilledDays: number;
  /** Why it failed. */
  readonly error?: string;
}

/** What one pass did. */
export interface RollupReport {
  /** The UTC day the pass treated as today. */
  readonly today: Day;
  readonly outcomes: readonly FamilyOutcome[];
}

@Injectable()
export class RollupService {
  /**
   * @param repository - The statements.
   * @param config - The consolidation window, backfill horizon and per-tick bound.
   * @param extractors - The families — `ROLLUP_EXTRACTORS`, bound by `InsightsModule`.
   */
  constructor(
    private readonly repository: RollupRepository,
    private readonly config: AppConfigService,
    @Inject(ROLLUP_FAMILIES) private readonly extractors: readonly FamilyExtractor[],
  ) {}

  /**
   * One pass: for every workspace and family, start a due backfill, step it, and fill today.
   *
   * @param now - The instant the pass runs at; its UTC day is today.
   * @returns What each (workspace, family) did.
   */
  async tick(now: Date = new Date()): Promise<RollupReport> {
    const today = utcDay(now);
    const registry = await this.repository.registry();
    const outcomes: FamilyOutcome[] = [];

    for (const organizationId of await this.repository.organizations()) {
      for (const extractor of this.extractors) {
        outcomes.push(await this.fillFamily(organizationId, extractor, registry, today));
      }
    }

    return { today, outcomes };
  }

  /**
   * Fill a range of days for one family now, cursor-tracked, as a backfill does — the operator's
   * re-fill after a formula change, and what the oracle parity suite drives.
   *
   * @param organizationId - The workspace.
   * @param family - The family.
   * @param from - The first day, inclusive.
   * @param until - The last day, inclusive; not after yesterday, not before `from`, and at most
   *   `OURO_INSIGHTS_ROLLUP_BACKFILL_DAYS` days after `from`.
   * @param now - The current instant, for "yesterday".
   * @returns The family's outcome. The backfill is recorded first, so a pass interrupted here is
   *   resumed by the next tick at its cursor.
   * @throws {RangeError} On an unknown family or a range outside the bounds above.
   */
  async backfill(
    organizationId: string,
    family: string,
    from: Day,
    until: Day,
    now: Date = new Date(),
  ): Promise<FamilyOutcome> {
    const extractor = this.extractors.find((candidate) => candidate.family === family);
    const yesterday = addDays(utcDay(now), -1);

    if (extractor === undefined) {
      throw new RangeError(`no rollup family named ${family}`);
    }

    if (!isDay(from) || !isDay(until) || from > until || until > yesterday) {
      throw new RangeError(
        `a backfill is a range of whole days ending by ${yesterday}: ${from}..${until}`,
      );
    }

    if (addDays(from, this.config.insightsRollupBackfillDays) < until) {
      throw new RangeError(
        `a backfill spans at most ${String(this.config.insightsRollupBackfillDays)} days: ${from}..${until}`,
      );
    }

    await this.repository.startBackfill(organizationId, family, from, until);

    return this.fillFamily(
      organizationId,
      extractor,
      await this.repository.registry(),
      utcDay(now),
      {
        unbounded: true,
      },
    );
  }

  /**
   * One (workspace, family): check the registry, start a due backfill, step it, fill today.
   *
   * @param organizationId - The workspace.
   * @param extractor - The family.
   * @param registry - The registry.
   * @param today - Today's UTC day.
   * @param options - `unbounded` steps the backfill to its end rather than by the per-tick bound.
   * @returns The outcome. Never rejects: a failure is recorded and reported.
   */
  private async fillFamily(
    organizationId: string,
    extractor: FamilyExtractor,
    registry: ReadonlyMap<string, RegisteredMetric>,
    today: Day,
    options: { unbounded?: boolean } = {},
  ): Promise<FamilyOutcome> {
    const { family } = extractor;
    let backfilledDays = 0;

    try {
      const mismatches = registryMismatches(extractor, registry);

      if (mismatches.length > 0) {
        throw new Error(`extractor and registry disagree: ${mismatches.join("; ")}`);
      }

      await this.repository.markRun(organizationId, family, "running");

      const due = backfillDue(await this.repository.state(organizationId, family), today, {
        backfillDays: this.config.insightsRollupBackfillDays,
        consolidateDays: this.config.insightsRollupConsolidateDays,
      });

      if (due !== undefined) {
        await this.repository.startBackfill(organizationId, family, due.from, due.until);
      }

      const bound = options.unbounded === true ? Infinity : this.config.insightsRollupDaysPerTick;

      while (backfilledDays < bound) {
        const cursor = (await this.repository.state(organizationId, family))?.backfillCursor;

        if (cursor == null) {
          break;
        }

        await this.repository.fillDay(organizationId, extractor, registry, cursor, "backfill");
        backfilledDays += 1;
      }

      await this.repository.fillDay(organizationId, extractor, registry, today, "tail");
      await this.repository.markRun(organizationId, family, "succeeded");

      return { organizationId, family, status: "succeeded", backfilledDays };
    } catch (error) {
      const message = error instanceof Error ? error.message : describeForLog(error);

      // Recording the failure can fail too — the database it would be recorded in is the likely
      // cause. The outcome still reports it.
      await this.repository
        .markRun(organizationId, family, "failed", message)
        .catch(() => undefined);

      return { organizationId, family, status: "failed", backfilledDays, error: message };
    }
  }
}
