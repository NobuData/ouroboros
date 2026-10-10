/**
 * `MetricsService` — the windowed metrics service (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437), decisions **I1–I3**). It is the one
 * place any surface asks what a number is, what it was, and how it was computed.
 *
 * ```
 * window(merge_rate, {org, range: 30d})
 *   ├─ rollup scan     metric_daily, [prior.from, yesterday]          (BI.2's daily grain)
 *   ├─ live tail       the family's extractor, today only (bounded)   (never written)
 *   ├─ recompose       Σnumerator / Σdenominator — never an average of rates
 *   ├─ prior window    the N days before, by the same rule
 *   └─ methodology     the registry entry, version included
 *   ⇒ {value, components, prior, delta, series, methodology}
 * ```
 *
 * The boundary and timezone rules are in `metrics.window.ts`. The arithmetic is in
 * `metrics.compose.ts`. The dashboard's pulse card (DASH-G.3, #72) and stat row read their shared
 * metrics through this service, so the dashboard and the Insights page cannot disagree.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { ROLLUP_FAMILIES } from "../rollup/rollup.service";
import { addDays, utcDay } from "../rollup/rollup.days";
import type { FamilyExtractor } from "../rollup/rollup.types";
import { MetricsCache, type MetricsCacheKey } from "./metrics.cache";
import {
  compose,
  deltaOf,
  DERIVED_RATIOS,
  planMetrics,
  seriesOf,
  unitScale,
  type MetricPlan,
} from "./metrics.compose";
import { MetricsRepository, type MetricDefinition, type RowFilter } from "./metrics.repository";
import type {
  DailyRow,
  MetricBreakdown,
  MetricMethodology,
  MetricScope,
  MetricSpan,
  MetricSpanScope,
  MetricWindow,
} from "./metrics.types";
import { daysOf, resolveWindow, type ResolvedWindow } from "./metrics.window";

/** The clock's injection token — bound only by the suites; production reads `Date.now`. */
export const METRICS_CLOCK = Symbol("METRICS_CLOCK");

/** A window request the service cannot answer, and why. */
export class MetricWindowError extends Error {
  /**
   * @param metricId - The metric asked for.
   * @param reason - Why it cannot be windowed.
   */
  constructor(
    readonly metricId: string,
    reason: string,
  ) {
    super(`${metricId}: ${reason}`);
    this.name = "MetricWindowError";
  }
}

/** A metric as a request reads it: its registry entry, and how its figure is composed. */
interface Planned {
  readonly definition: MetricDefinition;
  readonly plan: MetricPlan;
}

@Injectable()
export class MetricsService {
  /**
   * @param repository - The statements.
   * @param cache - The short-TTL window cache.
   * @param extractors - The rollup families; the live tail runs their extractors for today.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly repository: MetricsRepository,
    private readonly cache: MetricsCache,
    @Inject(ROLLUP_FAMILIES) private readonly extractors: readonly FamilyExtractor[],
    @Optional() @Inject(METRICS_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /**
   * A metric over a range, with its prior window, daily series and methodology.
   *
   * @param metricId - The registry id, e.g. `merge_rate`.
   * @param scope - The workspace, optional repository and dimension, range and instant.
   * @returns The window.
   * @throws {MetricWindowError} When the metric is not in the registry, is not on the daily grain
   *   (calibration, #435, reads its own table), or is a dimensioned median asked for without a
   *   dimension.
   */
  async window(metricId: string, scope: MetricScope): Promise<MetricWindow> {
    const windows = await this.windows([metricId], scope);

    return windows.get(metricId) as MetricWindow;
  }

  /**
   * Several metrics over one range and scope, read together (BJ.2,
   * [#438](https://github.com/NobuData/ouroboros/issues/438)) — the Insights page's KPI row,
   * series, performance strip and DORA cells in **one** scan of the grain and one live tail per
   * family, instead of a scan and a tail per number.
   *
   * Each window is exactly what {@link window} answers for that metric, and is cached under the
   * same key, so asking singly afterwards is a cache hit and the two can never disagree.
   *
   * @param metricIds - The registry ids; a repeated id is read once.
   * @param scope - The workspace, optional repository and dimension, range and instant.
   * @returns Each metric's window, by id, in the order asked.
   * @throws {MetricWindowError} For the first metric {@link window} would refuse.
   */
  async windows(
    metricIds: readonly string[],
    scope: MetricScope,
  ): Promise<Map<string, MetricWindow>> {
    const resolved = resolveWindow(scope.range, scope.now ?? new Date(this.clock()));
    const stamp = await this.repository.stamp(scope.organizationId);
    const keyFor = (metricId: string): MetricsCacheKey => ({
      organizationId: scope.organizationId,
      stamp,
      metricId,
      repo: scope.repo,
      dimension: scope.dimension,
      range: scope.range,
      today: resolved.today,
    });
    const ids = [...new Set(metricIds)];
    const found = new Map<string, MetricWindow>();

    for (const metricId of ids) {
      const cached = this.cache.get(keyFor(metricId));

      if (cached !== undefined) {
        found.set(metricId, cached);
      }
    }

    const missing = ids.filter((metricId) => !found.has(metricId));

    if (missing.length > 0) {
      const definitions = await this.repository.definitions();
      const planned = missing.map((metricId) => this.planned(metricId, definitions, scope));
      const rows = await this.rows(planned, scope, resolved);

      for (const { definition, plan } of planned) {
        const computed = windowFrom(definition, plan, rows, resolved);

        this.cache.set(keyFor(definition.metricId), computed);
        found.set(definition.metricId, computed);
      }
    }

    return new Map(ids.map((metricId) => [metricId, found.get(metricId) as MetricWindow]));
  }

  /**
   * A dimensioned metric over a range, one window per label (BJ.2, #438): the causes behind
   * *where loops still need humans*, the stages, suites, efforts and task kinds of the bar cards.
   *
   * The labels are whatever the grain holds for the window or its prior — nothing is listed that
   * has no row, and nothing with a row is left out — read in one scan and one live tail. Each
   * entry's window is what {@link window} answers for that label.
   *
   * @param metricId - A registry id with a dimension, e.g. `human_interventions`.
   * @param scope - The workspace, optional repository, range and instant. No dimension: a
   *   breakdown is all of them.
   * @returns The entries, labels ascending, and the methodology.
   * @throws {MetricWindowError} When the metric is not in the registry, has no dimension, or no
   *   rollup family fills it.
   */
  async breakdown(
    metricId: string,
    scope: Omit<MetricScope, "dimension">,
  ): Promise<MetricBreakdown> {
    const resolved = resolveWindow(scope.range, scope.now ?? new Date(this.clock()));
    const stamp = await this.repository.stamp(scope.organizationId);
    const key: MetricsCacheKey = {
      organizationId: scope.organizationId,
      stamp,
      metricId,
      repo: scope.repo,
      range: scope.range,
      today: resolved.today,
    };
    const cached = this.cache.getBreakdown(key);

    if (cached !== undefined) {
      return cached;
    }

    const definition = (await this.repository.definitions()).get(metricId);

    if (definition === undefined) {
      throw new MetricWindowError(metricId, "not in the metric registry");
    }

    if (definition.dimensionKind === null) {
      throw new MetricWindowError(metricId, "has no dimension to break out by");
    }

    const plan = this.planFor(definition);
    const rows = await this.rows([{ definition, plan }], scope, resolved);
    const labels = [...new Set(rows.map((row) => row.dimension))].sort();
    const breakdown: MetricBreakdown = {
      metricId,
      dimensionKind: definition.dimensionKind,
      range: resolved.range,
      from: resolved.current.from,
      to: resolved.current.to,
      entries: labels.map((dimension) => ({
        dimension,
        window: windowFrom(
          definition,
          plan,
          rows.filter((row) => row.dimension === dimension),
          resolved,
        ),
      })),
      methodology: methodologyOf(definition),
    };

    this.cache.setBreakdown(key, breakdown);

    return breakdown;
  }

  /**
   * One metric over an explicit span of days.
   *
   * The composition is {@link window}'s — the same stored rows, today read live through the same
   * tail, the same recomputation from components — so a span that happens to be a range's days
   * answers that range's figure exactly. What differs is that the days are named, which is what
   * lets a figure be asked for again later and answer the same
   * ([#619](https://github.com/NobuData/ouroboros/issues/619)). It is not cached: its callers
   * ask once per citation.
   *
   * @param metricId - The registry id, e.g. `merge_rate`.
   * @param scope - The workspace, optional repository and dimension, the days and the instant.
   * @returns The figure with its components or samples, and how many days had anything recorded.
   * @throws {MetricWindowError} As {@link window}, and when the span ends before it starts.
   */
  async span(metricId: string, scope: MetricSpanScope): Promise<MetricSpan> {
    const { from, to } = scope.span;

    if (from > to) {
      throw new MetricWindowError(metricId, "the span ends before it starts");
    }

    const today = utcDay(scope.now ?? new Date(this.clock()));
    const { definition, plan } = this.planned(metricId, await this.repository.definitions(), scope);
    const metricIds = planMetrics(plan);
    const filter: RowFilter = { metricIds, repo: scope.repo, dimension: scope.dimension };
    const yesterday = addDays(today, -1);
    // Today is never stored: it is read live, and only when the span reaches it.
    const tails =
      from <= today && today <= to ? this.tailFamilies(definition.metricId, metricIds) : [];
    const [stored, ...live] = await Promise.all([
      this.repository.scan(scope.organizationId, filter, {
        from,
        to: to < yesterday ? to : yesterday,
      }),
      ...tails.map((extractor) =>
        this.repository.tail(scope.organizationId, extractor, today, filter),
      ),
    ]);
    const rows = [...stored, ...live.flat()].filter((row) => metricIds.includes(row.metricId));
    const composed = compose(plan, rows);

    return {
      metricId: definition.metricId,
      from,
      to,
      value: composed.value,
      ...(composed.components ? { components: composed.components } : {}),
      samples:
        plan.kind === "stored" && plan.aggregation === "median"
          ? rows.flatMap((row) => row.samples).sort((a, b) => a - b)
          : [],
      days: new Set(rows.map((row) => row.day)).size,
      methodology: methodologyOf(definition),
    };
  }

  /**
   * A metric's registry entry and plan, or the refusal {@link window} documents.
   *
   * @param metricId - The metric.
   * @param definitions - The registry.
   * @param scope - The request, for the dimension rule.
   * @returns The entry and how it is computed.
   * @throws {MetricWindowError} See {@link window}.
   */
  private planned(
    metricId: string,
    definitions: ReadonlyMap<string, MetricDefinition>,
    scope: Pick<MetricScope, "dimension">,
  ): Planned {
    const definition = definitions.get(metricId);

    if (definition === undefined) {
      throw new MetricWindowError(metricId, "not in the metric registry");
    }

    if (
      definition.aggregation === "median" &&
      definition.dimensionKind !== null &&
      scope.dimension === undefined
    ) {
      throw new MetricWindowError(
        metricId,
        `a median by ${definition.dimensionKind} needs a dimension; pooling every ${definition.dimensionKind} means nothing`,
      );
    }

    return { definition, plan: this.planFor(definition) };
  }

  /**
   * Every daily row the plans read: the rollup scan over both windows, and today from each
   * family's extractor — once per family, however many of its metrics were asked for.
   *
   * @param planned - The metrics and their plans.
   * @param scope - The request.
   * @param resolved - Its boundaries.
   * @returns The rows, stored first.
   */
  private async rows(
    planned: readonly Planned[],
    scope: MetricScope,
    resolved: ResolvedWindow,
  ): Promise<DailyRow[]> {
    const filter: RowFilter = {
      metricIds: [...new Set(planned.flatMap(({ plan }) => planMetrics(plan)))],
      repo: scope.repo,
      dimension: scope.dimension,
    };
    const families = new Set(
      planned.flatMap(({ definition, plan }) =>
        this.tailFamilies(definition.metricId, planMetrics(plan)),
      ),
    );

    const [stored, ...tails] = await Promise.all([
      this.repository.scan(scope.organizationId, filter, resolved.scan),
      ...[...families].map((extractor) =>
        this.repository.tail(scope.organizationId, extractor, resolved.today, filter),
      ),
    ]);

    return [...stored, ...tails.flat()];
  }

  /**
   * How a metric is computed from the grain.
   *
   * @param definition - Its registry entry.
   * @returns The plan.
   * @throws {MetricWindowError} When no rollup family fills it.
   */
  private planFor(definition: MetricDefinition): MetricPlan {
    const scale = unitScale(definition.unit);
    const derived = DERIVED_RATIOS[definition.metricId] as
      (typeof DERIVED_RATIOS)[string] | undefined;

    if (derived !== undefined) {
      return { kind: "derived", ...derived, scale };
    }

    if (this.extractorOf(definition.metricId) === undefined) {
      throw new MetricWindowError(definition.metricId, "no rollup family fills it");
    }

    return {
      kind: "stored",
      metricId: definition.metricId,
      aggregation: definition.aggregation,
      scale,
    };
  }

  /**
   * The families whose extractors the live tail runs: one per family the plan reads, once each.
   *
   * @param metricId - The metric asked for, for the error.
   * @param metricIds - The stored metrics the plan reads.
   * @returns The extractors.
   * @throws {MetricWindowError} When a stored metric has no extractor.
   */
  private tailFamilies(metricId: string, metricIds: readonly string[]): FamilyExtractor[] {
    const out = new Set<FamilyExtractor>();

    for (const id of metricIds) {
      const extractor = this.extractorOf(id);

      if (extractor === undefined) {
        throw new MetricWindowError(metricId, `no rollup family fills ${id}`);
      }

      out.add(extractor);
    }

    return [...out];
  }

  /**
   * The extractor that fills a metric.
   *
   * @param metricId - The metric.
   * @returns The extractor, or undefined.
   */
  private extractorOf(metricId: string): FamilyExtractor | undefined {
    return this.extractors.find((extractor) => metricId in extractor.metrics);
  }
}

/**
 * One metric's window from the rows a request read: the figure, the prior window's, their
 * difference, the daily series and the methodology.
 *
 * @param definition - The registry entry.
 * @param plan - How the figure is composed.
 * @param rows - The request's rows — any metric, both windows; the plan takes its own.
 * @param resolved - The window's boundaries.
 * @returns The window.
 */
function windowFrom(
  definition: MetricDefinition,
  plan: MetricPlan,
  rows: readonly DailyRow[],
  resolved: ResolvedWindow,
): MetricWindow {
  // Its own rows only: a batch read holds other metrics' rows too, and a day's tooltip figures
  // (`meta`) are summed over whatever rows the series is handed.
  const metricIds = planMetrics(plan);
  const own = rows.filter((row) => metricIds.includes(row.metricId));
  const inCurrent = own.filter((row) => row.day >= resolved.current.from);
  const inPrior = own.filter((row) => row.day <= resolved.prior.to);
  const current = compose(plan, inCurrent);
  const prior = compose(plan, inPrior);

  return {
    metricId: definition.metricId,
    range: resolved.range,
    from: resolved.current.from,
    to: resolved.current.to,
    value: current.value,
    ...(current.components ? { components: current.components } : {}),
    prior: prior.value,
    ...(prior.components ? { priorComponents: prior.components } : {}),
    delta: deltaOf(current.value, prior.value),
    series: seriesOf(plan, daysOf(resolved.current), inCurrent),
    methodology: methodologyOf(definition),
  };
}

/**
 * The methodology payload for a registry entry — also the model scoreboard's (#439) per column.
 *
 * @param definition - The entry.
 * @returns What travels with the number.
 */
export function methodologyOf(definition: MetricDefinition): MetricMethodology {
  return {
    metricId: definition.metricId,
    title: definition.title,
    formula: definition.formulaText,
    sources: definition.sourcePlanes,
    caveats: definition.caveats,
    unit: definition.unit,
    version: definition.version,
    proxy: definition.proxy,
    aggregation: definition.aggregation,
  };
}
