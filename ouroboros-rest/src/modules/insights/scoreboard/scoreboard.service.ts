/**
 * `ScoreboardService` — mockup 15's MODEL SCOREBOARD (BJ.3,
 * [#439](https://github.com/NobuData/ouroboros/issues/439), decisions **I1**, **I6**, **I10**): how
 * often each task kind × model's work merged untouched, what a success costs, and which way it is
 * trending. It is the read side of the routing decision's feedback loop.
 *
 * ```
 * scoreboard({org, range: 30d})
 *   ├─ tallies   this window and the prior one, from the source planes  (scoreboard.repository)
 *   ├─ rows      untouched %, $/success, trend, role, low sample         (scoreboard.compose)
 *   ├─ registry  one methodology per column; untouched is the KPI row's own entry
 *   └─ AB.3      the suggestion, passed through only when its source is bound
 * ```
 *
 * Windows follow `metrics.window.ts`'s rules — N UTC days ending today, prior the N days before —
 * so the scoreboard and the KPI row always describe the same days. The untouched predicate is
 * `untouched.sql.ts`'s, shared with the throughput extractor the KPI row reads.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { dayBounds } from "../rollup/rollup.days";
import { MetricsRepository, type MetricDefinition } from "../metrics/metrics.repository";
import { METRICS_CLOCK, methodologyOf } from "../metrics/metrics.service";
import type { MetricMethodology } from "../metrics/metrics.types";
import { resolveWindow, type DaySpan } from "../metrics/metrics.window";
import { composeRows, SCOREBOARD_MIN_SAMPLE } from "./scoreboard.compose";
import { ScoreboardRepository, type InstantSpan } from "./scoreboard.repository";
import type {
  Scoreboard,
  ScoreboardMethodology,
  ScoreboardScope,
  ScoreboardSuggestionSource,
} from "./scoreboard.types";

/**
 * AB.3's injection token ([#209](https://github.com/NobuData/ouroboros/issues/209)). Nothing binds
 * it until AB.3 exists, and unbound the scoreboard has no suggestion (decision I10).
 */
export const SCOREBOARD_SUGGESTIONS = Symbol("SCOREBOARD_SUGGESTIONS");

/** The registry entry behind each column. */
export const SCOREBOARD_METRICS = Object.freeze({
  untouched: "merged_untouched_rate",
  costPerSuccess: "scoreboard_cost_per_success",
  trend: "scoreboard_trend",
  sample: "scoreboard_merged",
} as const satisfies Record<keyof ScoreboardMethodology, string>);

/** The registry is missing an entry a column needs: code and migrations disagree. */
export class ScoreboardRegistryError extends Error {
  /** @param metricId - The missing entry. */
  constructor(readonly metricId: string) {
    super(`${metricId}: not in the metric registry; the scoreboard cannot explain that column`);
    this.name = "ScoreboardRegistryError";
  }
}

@Injectable()
export class ScoreboardService {
  /**
   * @param repository - The tallies statement.
   * @param metrics - The registry read.
   * @param suggestions - AB.3's source, or undefined while AB.3 does not exist.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly repository: ScoreboardRepository,
    private readonly metrics: MetricsRepository,
    @Optional()
    @Inject(SCOREBOARD_SUGGESTIONS)
    private readonly suggestions: ScoreboardSuggestionSource | undefined,
    @Optional() @Inject(METRICS_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /**
   * The scoreboard over a range.
   *
   * @param scope - The workspace, optional repository, range and instant.
   * @returns Rows, windows, the low-sample threshold, every column's methodology and — only with
   *   AB.3 bound and answering — its suggestion.
   * @throws {ScoreboardRegistryError} When a column's registry entry is missing.
   */
  async scoreboard(scope: ScoreboardScope): Promise<Scoreboard> {
    const resolved = resolveWindow(scope.range, scope.now ?? new Date(this.clock()));

    const [definitions, current, prior] = await Promise.all([
      this.metrics.definitions(),
      this.repository.tallies(scope.organizationId, instantsOf(resolved.current), scope.repo),
      this.repository.tallies(scope.organizationId, instantsOf(resolved.prior), scope.repo),
    ]);

    const rows = composeRows(current, prior, SCOREBOARD_MIN_SAMPLE);
    const suggestion = (await this.suggestions?.suggestion(scope, rows)) ?? null;

    return {
      range: resolved.range,
      window: resolved.current,
      prior: resolved.prior,
      minSample: SCOREBOARD_MIN_SAMPLE,
      rows,
      methodology: methodologies(definitions),
      ...(suggestion === null ? {} : { suggestion }),
    };
  }
}

/**
 * A span of UTC days as the instants a statement compares against.
 *
 * @param span - Inclusive days.
 * @returns `[start of from, end of to)`.
 */
export function instantsOf(span: DaySpan): InstantSpan {
  return { from: dayBounds(span.from).from, to: dayBounds(span.to).to };
}

/**
 * Every column's methodology.
 *
 * @param definitions - The registry.
 * @returns One entry per column.
 * @throws {ScoreboardRegistryError} When one is missing.
 */
function methodologies(definitions: ReadonlyMap<string, MetricDefinition>): ScoreboardMethodology {
  const entry = (metricId: string): MetricMethodology => {
    const definition = definitions.get(metricId);

    if (definition === undefined) {
      throw new ScoreboardRegistryError(metricId);
    }

    return methodologyOf(definition);
  };

  return {
    untouched: entry(SCOREBOARD_METRICS.untouched),
    costPerSuccess: entry(SCOREBOARD_METRICS.costPerSuccess),
    trend: entry(SCOREBOARD_METRICS.trend),
    sample: entry(SCOREBOARD_METRICS.sample),
  };
}
