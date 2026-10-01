/**
 * The windowed metrics service's statements (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437)): the registry entry, the rollup scan,
 * the rollup stamp the cache is keyed on, and the live tail.
 *
 * **Every statement is scoped to one workspace.** The workspace comes from the tenant context, and
 * `metrics.repository.spec.ts` asserts the predicate is in every compiled statement. A window
 * request therefore cannot read another workspace's rollups.
 *
 * Days are read as `YYYY-MM-DD` text: `pg` would turn a `date` into local midnight, which is a
 * different UTC day west of Greenwich.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { MetricAggregation, MetricDefinitionsTable } from "../../db/schema";
import type { Day, FamilyExtractor, RollupRow } from "../rollup/rollup.types";
import type { DailyRow } from "./metrics.types";
import type { DaySpan } from "./metrics.window";

/** A registry entry, as the service needs it. */
export interface MetricDefinition {
  readonly metricId: string;
  readonly family: string;
  readonly title: string;
  readonly formulaText: string;
  readonly sourcePlanes: readonly string[];
  readonly caveats: string;
  readonly unit: MetricDefinitionsTable["unit"];
  readonly isRate: boolean;
  readonly version: number;
  readonly proxy: boolean;
  readonly aggregation: MetricAggregation;
  readonly dimensionKind: MetricDefinitionsTable["dimension_kind"];
}

/** Which rows a scan or a tail keeps. */
export interface RowFilter {
  /** The stored metrics to read. */
  readonly metricIds: readonly string[];
  /** One repository, or every one. */
  readonly repo?: string;
  /** One dimension, or every one. */
  readonly dimension?: string;
}

/** A stored row, as `pg` hands it back. */
interface StoredRow {
  day: string;
  metric_id: string;
  repo_ref: string | null;
  dimension: string;
  value: string;
  numerator: string | null;
  denominator: string | null;
  meta: Record<string, unknown>;
}

@Injectable()
export class MetricsRepository {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every registry entry, by metric id.
   *
   * The registry is workspace-independent and ships in migrations; the service only reads it.
   *
   * @returns The entries.
   */
  async definitions(): Promise<Map<string, MetricDefinition>> {
    const rows = await this.database.db
      .selectFrom("metric_definitions")
      .select([
        "metric_id",
        "family",
        "title",
        "formula_text",
        "source_planes",
        "caveats",
        "unit",
        "is_rate",
        "version",
        "proxy",
        "aggregation",
        "dimension_kind",
      ])
      .execute();

    return new Map(
      rows.map((row) => [
        row.metric_id,
        {
          metricId: row.metric_id,
          family: row.family,
          title: row.title,
          formulaText: row.formula_text,
          sourcePlanes: row.source_planes,
          caveats: row.caveats,
          unit: row.unit,
          isRate: row.is_rate,
          version: row.version,
          proxy: row.proxy,
          aggregation: row.aggregation,
          dimensionKind: row.dimension_kind,
        },
      ]),
    );
  }

  /**
   * What the workspace's rollups currently are, cheaply enough to ask on every request.
   *
   * Every fill marks its family's `metric_rollup_state.last_run_at` when it ends (BI.2), so this
   * changes whenever any family refreshes on any replica. The cache keys on it, which is how a
   * window cached before a rollup refresh is never served after one.
   *
   * @param organizationId - The workspace.
   * @returns An opaque fingerprint.
   */
  async stamp(organizationId: string): Promise<string> {
    const row = await this.database.db
      .selectFrom("metric_rollup_state")
      .select(
        sql<string>`count(*)::text || ' ' || coalesce(max(last_run_at)::text, '') || ' ' || coalesce(max(updated_at)::text, '')`.as(
          "stamp",
        ),
      )
      .where("organization_id", "=", organizationId)
      .executeTakeFirstOrThrow();

    return row.stamp;
  }

  /**
   * The stored daily rows over a span of days.
   *
   * @param organizationId - The workspace.
   * @param filter - Which metrics, repository and dimension.
   * @param span - The days, inclusive.
   * @returns The rows, oldest first.
   */
  async scan(organizationId: string, filter: RowFilter, span: DaySpan): Promise<DailyRow[]> {
    if (filter.metricIds.length === 0 || span.from > span.to) {
      return [];
    }

    let query = this.database.db
      .selectFrom("metric_daily")
      .select([
        sql<string>`to_char(day, 'YYYY-MM-DD')`.as("day"),
        "metric_id",
        "repo_ref",
        "dimension",
        "value",
        "numerator",
        "denominator",
        "meta",
      ])
      .where("organization_id", "=", organizationId)
      .where("metric_id", "in", [...filter.metricIds])
      .where(sql<boolean>`day between ${span.from}::date and ${span.to}::date`);

    if (filter.repo !== undefined) {
      query = query.where("repo_ref", "=", filter.repo);
    }

    if (filter.dimension !== undefined) {
      query = query.where("dimension", "=", filter.dimension);
    }

    const rows = (await query.orderBy("day").execute()) as StoredRow[];

    return rows.map(storedRow);
  }

  /**
   * Today's rows, computed live by a family's extractor and never written.
   *
   * **Bounded to one day.** The extractor reads exactly `[day 00:00Z, next 00:00Z)` of its
   * sources, the same statement the hourly fill runs, so the tail costs one fill's reads and not
   * a scan of history.
   *
   * @param organizationId - The workspace.
   * @param extractor - The family.
   * @param day - Today's UTC day.
   * @param filter - Which metrics, repository and dimension to keep.
   * @returns The kept rows.
   */
  async tail(
    organizationId: string,
    extractor: FamilyExtractor,
    day: Day,
    filter: RowFilter,
  ): Promise<DailyRow[]> {
    const rows = await extractor.extract(this.database.db, organizationId, day);

    return rows
      .filter(
        (row) =>
          filter.metricIds.includes(row.metricId) &&
          (filter.repo === undefined || row.repoRef === filter.repo) &&
          (filter.dimension === undefined || row.dimension === filter.dimension),
      )
      .map((row) => liveRow(day, row));
  }
}

/**
 * A stored row as the composition reads it.
 *
 * @param row - The row from `pg`.
 * @returns The daily row: numerics as numbers, samples split from the tooltip figures.
 */
export function storedRow(row: StoredRow): DailyRow {
  const meta: Record<string, number> = {};
  let samples: number[] = [];

  for (const [key, value] of Object.entries(row.meta)) {
    if (key === "samples" && Array.isArray(value)) {
      samples = value.map(Number);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      meta[key] = value;
    }
  }

  return {
    day: row.day,
    metricId: row.metric_id,
    repoRef: row.repo_ref,
    dimension: row.dimension,
    value: Number(row.value),
    numerator: row.numerator === null ? null : Number(row.numerator),
    denominator: row.denominator === null ? null : Number(row.denominator),
    samples,
    meta,
  };
}

/**
 * A live extractor row as the composition reads it.
 *
 * @param day - The tail's day.
 * @param row - The extractor's row.
 * @returns The daily row. Live rows carry no tooltip figures.
 */
function liveRow(day: Day, row: RollupRow): DailyRow {
  return {
    day,
    metricId: row.metricId,
    repoRef: row.repoRef,
    dimension: row.dimension,
    value: row.value,
    numerator: row.numerator ?? null,
    denominator: row.denominator ?? null,
    samples: row.samples ?? [],
    meta: {},
  };
}
