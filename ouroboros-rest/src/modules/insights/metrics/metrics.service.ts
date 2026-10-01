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
import type { FamilyExtractor } from "../rollup/rollup.types";
import { MetricsCache } from "./metrics.cache";
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
import type { DailyRow, MetricMethodology, MetricScope, MetricWindow } from "./metrics.types";
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
    const resolved = resolveWindow(scope.range, scope.now ?? new Date(this.clock()));
    const stamp = await this.repository.stamp(scope.organizationId);
    const key = {
      organizationId: scope.organizationId,
      stamp,
      metricId,
      repo: scope.repo,
      dimension: scope.dimension,
      range: scope.range,
      today: resolved.today,
    };
    const cached = this.cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const computed = await this.compute(metricId, scope, resolved);

    this.cache.set(key, computed);

    return computed;
  }

  /**
   * Compute a window: scan and tail, recompose, compare with the prior window.
   *
   * @param metricId - The metric.
   * @param scope - The request.
   * @param resolved - Its boundaries.
   * @returns The window.
   */
  private async compute(
    metricId: string,
    scope: MetricScope,
    resolved: ResolvedWindow,
  ): Promise<MetricWindow> {
    const definitions = await this.repository.definitions();
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

    const plan = this.planFor(definition);
    const filter: RowFilter = {
      metricIds: planMetrics(plan),
      repo: scope.repo,
      dimension: scope.dimension,
    };
    const families = this.tailFamilies(metricId, filter.metricIds);

    const [stored, ...tails] = await Promise.all([
      this.repository.scan(scope.organizationId, filter, resolved.scan),
      ...families.map((extractor) =>
        this.repository.tail(scope.organizationId, extractor, resolved.today, filter),
      ),
    ]);
    const rows: DailyRow[] = [...stored, ...tails.flat()];

    const inCurrent = rows.filter((row) => row.day >= resolved.current.from);
    const inPrior = rows.filter((row) => row.day <= resolved.prior.to);
    const current = compose(plan, inCurrent);
    const prior = compose(plan, inPrior);

    return {
      metricId,
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
 * The methodology payload for a registry entry.
 *
 * @param definition - The entry.
 * @returns What travels with the number.
 */
function methodologyOf(definition: MetricDefinition): MetricMethodology {
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
