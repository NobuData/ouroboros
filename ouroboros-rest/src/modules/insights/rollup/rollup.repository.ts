/**
 * The rollup jobs' statements — the registry, the bookkeeping, and the one transaction a day is
 * filled in (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433); tables V076/V078).
 *
 * **A day is filled in one transaction, and only here.** {@link RollupRepository.fillDay} takes a
 * per-(workspace, family) advisory lock, runs the extractor inside the transaction, **replaces**
 * the day's rows for the family's metrics — delete, then insert — and moves the bookkeeping, then
 * commits. So:
 *
 *   * **re-running a day changes nothing** — the same sources give the same rows, and a row that
 *     should no longer exist (a suite that stopped failing) is gone rather than left behind, which
 *     an upsert alone would not do;
 *   * **an interrupted backfill resumes without gaps or double-counting** — a day's rows and its
 *     cursor move commit together or not at all, so a restart begins at the first day not
 *     committed, and a day committed twice holds one copy;
 *   * **two replicas do not interleave** — the lock serialises them per family, and the second
 *     re-reads what the first committed.
 *
 * Dates cross the wire as `YYYY-MM-DD` text in both directions: `pg` would read a `date` as local
 * midnight, which is a different UTC day west of Greenwich.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { Database, MetricAggregation } from "../../db/schema";
import { addDays } from "./rollup.days";
import type { FamilyState } from "./rollup.plan";
import type { RegisteredMetric } from "./rollup.registry";
import type { Day, FamilyExtractor, RollupRow } from "./rollup.types";

/**
 * What a filled day does to the family's bookkeeping.
 *
 *   * `tail` — today's incremental fill: no cursor moves, because today is not over.
 *   * `backfill` — a cursor step: the cursor moves past the day, or, when the day was the
 *     backfill's last, cursor and end clear together and `last_filled_day` advances to it.
 */
export type CursorMove = "tail" | "backfill";

/** The registry, as `pg` hands it back. */
interface DefinitionRow {
  metric_id: string;
  family: string;
  version: number;
  is_rate: boolean;
  aggregation: MetricAggregation;
}

/** The bookkeeping, with dates as text. */
interface StateRow {
  last_filled_day: string | null;
  backfill_cursor: string | null;
  backfill_until: string | null;
}

@Injectable()
export class RollupRepository {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every workspace — each is filled independently.
   *
   * @returns Organization ids.
   */
  async organizations(): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      select "id" from ouroboros.organization order by "id"`.execute(this.database.db);

    return rows.map((row) => row.id);
  }

  /**
   * The methodology registry, as the fill needs it.
   *
   * @returns Every registry entry, by metric id.
   */
  async registry(): Promise<Map<string, RegisteredMetric>> {
    const { rows } = await sql<DefinitionRow>`
      select metric_id, family, version, is_rate, aggregation
        from ouroboros.metric_definitions`.execute(this.database.db);

    return new Map(
      rows.map((row) => [
        row.metric_id,
        {
          metricId: row.metric_id,
          family: row.family,
          version: row.version,
          isRate: row.is_rate,
          aggregation: row.aggregation,
        },
      ]),
    );
  }

  /**
   * A family's bookkeeping.
   *
   * @param organizationId - The workspace.
   * @param family - The family.
   * @returns The state, or undefined before the family's first run.
   */
  async state(organizationId: string, family: string): Promise<FamilyState | undefined> {
    const { rows } = await sql<StateRow>`
      select to_char(last_filled_day, 'YYYY-MM-DD') as last_filled_day,
             to_char(backfill_cursor, 'YYYY-MM-DD') as backfill_cursor,
             to_char(backfill_until, 'YYYY-MM-DD')  as backfill_until
        from ouroboros.metric_rollup_state
       where organization_id = ${organizationId} and family = ${family}`.execute(this.database.db);

    const [row] = rows;

    return row === undefined
      ? undefined
      : {
          lastFilledDay: row.last_filled_day,
          backfillCursor: row.backfill_cursor,
          backfillUntil: row.backfill_until,
        };
  }

  /**
   * Stamp a run's outcome on the family's bookkeeping, creating the row on first use.
   *
   * @param organizationId - The workspace.
   * @param family - The family.
   * @param status - `running` as a fill starts; `succeeded` or `failed` as it ends.
   * @param error - Why it failed; only with `failed`.
   */
  async markRun(
    organizationId: string,
    family: string,
    status: "running" | "succeeded" | "failed",
    error?: string,
  ): Promise<void> {
    const lastError = status === "failed" ? (error ?? "unknown error").slice(0, 2000) : null;

    await sql`
      insert into ouroboros.metric_rollup_state
        (organization_id, family, last_run_status, last_run_at, last_error)
      values (${organizationId}, ${family}, ${status}, now(), ${lastError})
      on conflict (organization_id, family) do update
        set last_run_status = excluded.last_run_status,
            last_run_at     = excluded.last_run_at,
            last_error      = excluded.last_error`.execute(this.database.db);
  }

  /**
   * Begin a backfill over `[from, until]`, or widen the one in progress to cover it.
   *
   * @param organizationId - The workspace.
   * @param family - The family.
   * @param from - The first day to fill.
   * @param until - The last day to fill, inclusive; not before `from`.
   */
  async startBackfill(
    organizationId: string,
    family: string,
    from: Day,
    until: Day,
  ): Promise<void> {
    await sql`
      insert into ouroboros.metric_rollup_state (organization_id, family, backfill_cursor, backfill_until)
      values (${organizationId}, ${family}, ${from}::date, ${until}::date)
      on conflict (organization_id, family) do update
        set backfill_cursor = least(coalesce(metric_rollup_state.backfill_cursor, excluded.backfill_cursor),
                                    excluded.backfill_cursor),
            backfill_until  = greatest(coalesce(metric_rollup_state.backfill_until, excluded.backfill_until),
                                       excluded.backfill_until)`.execute(this.database.db);
  }

  /**
   * Fill one day of one family, in one transaction: lock, extract, replace, move the cursor.
   *
   * @param organizationId - The workspace.
   * @param extractor - The family.
   * @param registry - The registry, for each metric's `is_rate`.
   * @param day - The UTC day.
   * @param move - What the fill does to the bookkeeping — see {@link CursorMove}.
   * @returns The rows written.
   */
  async fillDay(
    organizationId: string,
    extractor: FamilyExtractor,
    registry: ReadonlyMap<string, RegisteredMetric>,
    day: Day,
    move: CursorMove,
  ): Promise<RollupRow[]> {
    return this.database.db.transaction().execute(async (trx) => {
      await sql`
        select pg_advisory_xact_lock(hashtext('metric_rollup'),
                                     hashtext(${organizationId} || ':' || ${extractor.family}))`.execute(
        trx,
      );

      const rows = await extractor.extract(trx, organizationId, day);

      await this.replace(trx, organizationId, extractor, registry, day, rows);

      if (move === "backfill") {
        await this.advance(trx, organizationId, extractor.family, day);
      }

      return rows;
    });
  }

  /**
   * Replace a day's rows for a family's metrics.
   *
   * @param trx - The day's transaction.
   * @param organizationId - The workspace.
   * @param extractor - The family, whose `metrics` scope the delete.
   * @param registry - For each row's `is_rate`.
   * @param day - The day.
   * @param rows - The new rows.
   * @throws {Error} When a row names a metric the family does not declare — the delete would not
   *   have cleared it, so a re-run would collide.
   */
  private async replace(
    trx: Kysely<Database>,
    organizationId: string,
    extractor: FamilyExtractor,
    registry: ReadonlyMap<string, RegisteredMetric>,
    day: Day,
    rows: readonly RollupRow[],
  ): Promise<void> {
    const metricIds = Object.keys(extractor.metrics);

    await sql`
      delete from ouroboros.metric_daily
       where organization_id = ${organizationId}
         and metric_id = any(${metricIds}::text[])
         and day = ${day}::date`.execute(trx);

    if (rows.length === 0) {
      return;
    }

    await trx
      .insertInto("metric_daily")
      .values(
        rows.map((row) => {
          const registered = registry.get(row.metricId);

          if (registered === undefined || !metricIds.includes(row.metricId)) {
            throw new Error(`${extractor.family} wrote ${row.metricId}, which it does not declare`);
          }

          return {
            organization_id: organizationId,
            repo_ref: row.repoRef,
            metric_id: row.metricId,
            is_rate: registered.isRate,
            dimension: row.dimension,
            day,
            value: row.value,
            numerator: row.numerator ?? null,
            denominator: row.denominator ?? null,
            meta: JSON.stringify(row.samples === undefined ? {} : { samples: row.samples }),
          };
        }),
      )
      .execute();
  }

  /**
   * Move a backfill past a filled day, finishing it when the day was its last.
   *
   * @param trx - The day's transaction.
   * @param organizationId - The workspace.
   * @param family - The family.
   * @param day - The day just filled.
   */
  private async advance(
    trx: Kysely<Database>,
    organizationId: string,
    family: string,
    day: Day,
  ): Promise<void> {
    const next = addDays(day, 1);

    await sql`
      update ouroboros.metric_rollup_state
         set last_filled_day = case when ${day}::date >= backfill_until
                                    then greatest(last_filled_day, backfill_until)
                                    else last_filled_day end,
             backfill_cursor = case when ${day}::date < backfill_until then ${next}::date end,
             backfill_until  = case when ${day}::date < backfill_until then backfill_until end
       where organization_id = ${organizationId} and family = ${family}
         and backfill_cursor = ${day}::date`.execute(trx);
  }
}
