/**
 * An in-memory telemetry store for the tool's suites (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)) — the planes as plain arrays, read by
 * the same rules the repository's SQL states: every read keeps to its workspace, a window is
 * `[from, to)`, and a day with nothing in it is absent rather than zero.
 */

import { MetricWindowError } from "../../insights/metrics/metrics.service";
import type { MetricSpan, MetricSpanScope } from "../../insights/metrics/metrics.types";
import type { MetricSpanReader, TelemetryStore } from "../tools/adapters/telemetry/telemetry.tool";
import type {
  CaseHistoryRow,
  FlakeContext,
  HistorySubject,
  MeasurementSample,
  RunDay,
  StoredBaseline,
  Stretch,
  TelemetrySummary,
  TokenDay,
} from "./telemetry.repository";

/** The workspace the fixture's data belongs to. */
export const TELEMETRY_ORG = "org-acme";

/** Another workspace, which owns nothing here. */
export const OTHER_ORG = "org-other";

/** The seeded stack's overshoot case (mockup 11's HIL failure). */
export const OVERSHOOT_CASE = "a7ee68b68b6e533f32d3be7b75e4ea550bb860bfaf04e02fde18b55dd4f946d0";

/** The regression seed's hover-drift case. */
export const HOVER_CASE = "29f70bbc9eaa22505445bbf2378dc743e5b177119c5a09cdcde73870d0867560";

/** One stored measurement. */
export interface MeasurementFixture extends MeasurementSample {
  readonly org: string;
  readonly caseKey: string;
  readonly metric: string;
  readonly repo: string;
}

/** One stored test result. */
export interface ResultFixture {
  readonly org: string;
  readonly caseKey: string;
  readonly suite: string;
  readonly repo: string;
  readonly status: "passed" | "failed" | "flaky" | "skipped" | "error";
  readonly retries: number;
  readonly at: Date;
}

/** One flake score. */
export interface FlakeFixture {
  readonly org: string;
  readonly caseKey: string;
  readonly score: number;
  readonly state: "healthy" | "watching" | "quarantined";
  readonly scoredAt: Date;
}

/** One run. */
export interface RunFixture {
  readonly org: string;
  readonly repo: string;
  readonly status: string;
  readonly at: Date;
}

/** One model call. */
export interface UsageFixture {
  readonly org: string;
  readonly repo: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costCents: number | null;
  readonly at: Date;
}

/**
 * Whether an instant is inside a stretch.
 *
 * @param at - The instant.
 * @param window - `[from, to)`.
 * @returns `true` when it is.
 */
function within(at: Date, window: Stretch): boolean {
  return at.getTime() >= window.from.getTime() && at.getTime() < window.to.getTime();
}

/**
 * Whether a row's repository is the one asked for.
 *
 * @param repo - The row's `owner/name`, or `null`.
 * @param asked - The filter, or `null` for any.
 * @returns `true` when it matches, compared without regard to case.
 */
function inRepo(repo: string | null, asked: string | null): boolean {
  return asked === null || (repo !== null && repo.toLowerCase() === asked.toLowerCase());
}

/** The planes, in memory. */
export class MemoryTelemetry implements TelemetryStore {
  readonly measurementRows: MeasurementFixture[] = [];
  readonly baselineRows: (StoredBaseline & { org: string; metricKey: string })[] = [];
  readonly resultRows: ResultFixture[] = [];
  readonly flakeRows: FlakeFixture[] = [];
  readonly runRows: RunFixture[] = [];
  readonly usageRows: UsageFixture[] = [];
  /** How many insights metrics the summary reports. */
  metrics = 0;

  /** See `TelemetryRepository.measurements`. */
  measurements(
    organizationId: string,
    caseKey: string,
    measurement: string,
    window: Stretch,
    repo: string | null,
  ): Promise<MeasurementSample[]> {
    return Promise.resolve(
      this.measurementRows
        .filter(
          (row) =>
            row.org === organizationId &&
            row.caseKey === caseKey &&
            row.metric === measurement &&
            within(row.at, window) &&
            inRepo(row.repo, repo),
        )
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .map(({ value, unit, verdict, at }) => ({ value, unit, verdict, at })),
    );
  }

  /** See `TelemetryRepository.baseline`. */
  baseline(
    organizationId: string,
    metricKey: string,
    releaseTag: string,
  ): Promise<StoredBaseline | undefined> {
    const found = this.baselineRows.find(
      (row) =>
        row.org === organizationId && row.metricKey === metricKey && row.releaseTag === releaseTag,
    );

    if (found === undefined) return Promise.resolve(undefined);

    const { org: _org, metricKey: _key, ...baseline } = found;
    void _org;
    void _key;

    return Promise.resolve(baseline);
  }

  /** See `TelemetryRepository.caseHistory`. */
  caseHistory(
    organizationId: string,
    subject: HistorySubject,
    window: Stretch,
    repo: string | null,
  ): Promise<CaseHistoryRow> {
    const rows = this.results(organizationId, subject, window, repo);
    const count = (status: ResultFixture["status"]): number =>
      rows.filter((row) => row.status === status).length;
    const times = rows.map((row) => row.at.getTime());

    return Promise.resolve({
      runs: rows.length,
      cases: new Set(rows.map((row) => row.caseKey)).size,
      passed: count("passed"),
      failed: count("failed"),
      flaky: count("flaky"),
      skipped: count("skipped"),
      errored: count("error"),
      retries: rows.reduce((total, row) => total + row.retries, 0),
      firstObservedAt: rows.length === 0 ? null : new Date(Math.min(...times)),
      lastObservedAt: rows.length === 0 ? null : new Date(Math.max(...times)),
    });
  }

  /** See `TelemetryRepository.flakeContext`. */
  flakeContext(
    organizationId: string,
    subject: HistorySubject,
    window: Stretch,
    repo: string | null,
  ): Promise<FlakeContext> {
    const cases = new Set(
      this.results(organizationId, subject, window, repo).map((row) => row.caseKey),
    );
    const scored = this.flakeRows.filter(
      (row) => row.org === organizationId && cases.has(row.caseKey),
    );
    const count = (state: FlakeFixture["state"]): number =>
      scored.filter((row) => row.state === state).length;

    return Promise.resolve({
      scored: scored.length,
      maxScore: scored.length === 0 ? null : Math.max(...scored.map((row) => row.score)),
      healthy: count("healthy"),
      watching: count("watching"),
      quarantined: count("quarantined"),
      lastScoredAt:
        scored.length === 0
          ? null
          : new Date(Math.max(...scored.map((row) => row.scoredAt.getTime()))),
    });
  }

  /** See `TelemetryRepository.runDays`. */
  runDays(organizationId: string, window: Stretch, repo: string | null): Promise<RunDay[]> {
    const days = new Map<string, RunDay>();

    for (const row of this.runRows) {
      if (row.org !== organizationId || !within(row.at, window) || !inRepo(row.repo, repo)) {
        continue;
      }

      const day = row.at.toISOString().slice(0, 10);
      const seen = days.get(day) ?? { day, started: 0, merged: 0, failed: 0, needsHuman: 0 };

      days.set(day, {
        day,
        started: seen.started + 1,
        merged: seen.merged + (row.status === "merged" ? 1 : 0),
        failed: seen.failed + (row.status === "failed" ? 1 : 0),
        needsHuman: seen.needsHuman + (row.status === "needs_human" ? 1 : 0),
      });
    }

    return Promise.resolve([...days.values()].sort((a, b) => a.day.localeCompare(b.day)));
  }

  /** See `TelemetryRepository.tokenDays`. */
  tokenDays(organizationId: string, window: Stretch, repo: string | null): Promise<TokenDay[]> {
    const days = new Map<string, TokenDay>();

    for (const row of this.usageRows) {
      if (row.org !== organizationId || !within(row.at, window) || !inRepo(row.repo, repo)) {
        continue;
      }

      const day = row.at.toISOString().slice(0, 10);
      const seen = days.get(day) ?? {
        day,
        events: 0,
        tokensIn: 0,
        tokensOut: 0,
        costCents: null,
        unpricedEvents: 0,
      };

      days.set(day, {
        day,
        events: seen.events + 1,
        tokensIn: seen.tokensIn + row.tokensIn,
        tokensOut: seen.tokensOut + row.tokensOut,
        costCents: row.costCents === null ? seen.costCents : (seen.costCents ?? 0) + row.costCents,
        unpricedEvents: seen.unpricedEvents + (row.costCents === null ? 1 : 0),
      });
    }

    return Promise.resolve([...days.values()].sort((a, b) => a.day.localeCompare(b.day)));
  }

  /** See `TelemetryRepository.summary`. */
  summary(organizationId: string): Promise<TelemetrySummary> {
    return Promise.resolve({
      measurements: this.measurementRows.filter((row) => row.org === organizationId).length,
      cases: new Set(
        this.resultRows.filter((row) => row.org === organizationId).map((row) => row.caseKey),
      ).size,
      metrics: organizationId === TELEMETRY_ORG ? this.metrics : 0,
      baselines: this.baselineRows.filter((row) => row.org === organizationId).length,
    });
  }

  /**
   * The results a history covers.
   *
   * @param organizationId - The workspace.
   * @param subject - The case, or the suite.
   * @param window - The window.
   * @param repo - The repository filter.
   * @returns The matching results.
   */
  private results(
    organizationId: string,
    subject: HistorySubject,
    window: Stretch,
    repo: string | null,
  ): ResultFixture[] {
    return this.resultRows.filter(
      (row) =>
        row.org === organizationId &&
        within(row.at, window) &&
        inRepo(row.repo, repo) &&
        (subject.kind === "case" ? row.caseKey === subject.caseKey : row.suite === subject.suite),
    );
  }
}

/** What a canned span answers with — everything but its days and methodology. */
export type SpanFixture = Pick<MetricSpan, "value" | "days"> &
  Partial<Pick<MetricSpan, "components" | "samples">> & {
    readonly unit?: MetricSpan["methodology"]["unit"];
    readonly aggregation?: MetricSpan["methodology"]["aggregation"];
  };

/** The insights plane, canned: a figure per `metric|from..to[|repo][|dimension]`. */
export class MemoryMetrics implements MetricSpanReader {
  /** Every scope asked for, in order. */
  readonly asked: { metricId: string; scope: MetricSpanScope }[] = [];
  private readonly spans = new Map<string, SpanFixture>();

  /**
   * Can an answer.
   *
   * @param key - `metric|from..to`, with `|repo` and `|dimension` when the query is narrowed.
   * @param span - The answer.
   * @returns This, for chaining.
   */
  answering(key: string, span: SpanFixture): this {
    this.spans.set(key, span);

    return this;
  }

  /** See `MetricsService.span`. */
  span(metricId: string, scope: MetricSpanScope): Promise<MetricSpan> {
    this.asked.push({ metricId, scope });

    if (metricId === "no_such_metric") {
      return Promise.reject(new MetricWindowError(metricId, "not in the metric registry"));
    }

    const key = [
      metricId,
      `${scope.span.from}..${scope.span.to}`,
      ...(scope.repo === undefined ? [] : [scope.repo]),
      ...(scope.dimension === undefined ? [] : [scope.dimension]),
    ].join("|");
    // Another workspace's metrics are another workspace's: it has none here.
    const found = scope.organizationId === TELEMETRY_ORG ? this.spans.get(key) : undefined;
    const aggregation = found?.aggregation ?? "ratio";

    return Promise.resolve({
      metricId,
      from: scope.span.from,
      to: scope.span.to,
      value: found?.value ?? null,
      ...(found?.components ? { components: found.components } : {}),
      samples: found?.samples ?? [],
      days: found?.days ?? 0,
      methodology: {
        metricId,
        title: metricId,
        formula: `${metricId} formula`,
        sources: ["runs"],
        caveats: "none",
        unit: found?.unit ?? "pct",
        version: 1,
        proxy: false,
        aggregation,
      },
    });
  }
}

/**
 * The seeded stack's telemetry, as far as the tool's suites need it: the four overshoot
 * measurements, the hover-drift baseline, a suite's results, a week of runs and usage.
 *
 * @returns The store and the insights reader.
 */
export function seededTelemetry(): { store: MemoryTelemetry; metrics: MemoryMetrics } {
  const store = new MemoryTelemetry();
  const repo = "acme-robotics/helios-firmware";
  const at = (text: string): Date => new Date(text);

  store.metrics = 24;
  // Mockup 11: three failing builds at 2.4 %, then the fix at 1.7 %.
  for (const [n, value] of [2.4, 2.4, 2.4, 1.7].entries()) {
    store.measurementRows.push({
      org: TELEMETRY_ORG,
      caseKey: OVERSHOOT_CASE,
      metric: "overshoot_pct",
      repo,
      value,
      unit: "%",
      verdict: value > 2 ? "fail" : "pass",
      at: at(`2026-10-09T0${String(n + 1)}:00:00Z`),
    });
    store.resultRows.push({
      org: TELEMETRY_ORG,
      caseKey: OVERSHOOT_CASE,
      suite: "PHYSICAL · HIL rig",
      repo,
      status: value > 2 ? "failed" : "passed",
      retries: 0,
      at: at(`2026-10-09T0${String(n + 1)}:00:00Z`),
    });
  }
  // Twelve nightly hover-drift measurements around 35.3 cm, against a 31 cm baseline: +14 %.
  for (let n = 0; n < 12; n += 1) {
    store.measurementRows.push({
      org: TELEMETRY_ORG,
      caseKey: HOVER_CASE,
      metric: "hover_drift_cm",
      repo,
      value: 35.34 + (n % 2 === 0 ? -0.5 : 0.5),
      unit: "cm",
      verdict: "pass",
      at: at(`2026-10-0${String((n % 7) + 3)}T02:00:00Z`),
    });
  }
  store.baselineRows.push({
    org: TELEMETRY_ORG,
    metricKey: `${HOVER_CASE}:hover_drift_cm`,
    releaseTag: "v2.0.4",
    n: 48,
    median: 31,
    spread: 4.2,
    spreadKind: "iqr",
    unit: "cm",
    from: "2026-07-25T02:35:47Z",
    to: "2026-08-01T02:35:47Z",
  });
  store.flakeRows.push({
    org: TELEMETRY_ORG,
    caseKey: OVERSHOOT_CASE,
    score: 0.42,
    state: "watching",
    scoredAt: at("2026-10-09T03:00:00Z"),
  });
  for (const [day, statuses] of [
    ["2026-10-07", ["merged", "merged", "failed"]],
    ["2026-10-09", ["merged", "needs_human"]],
  ] as const) {
    for (const [n, status] of statuses.entries()) {
      store.runRows.push({
        org: TELEMETRY_ORG,
        repo,
        status,
        at: at(`${day}T1${String(n)}:00:00Z`),
      });
    }
  }
  store.usageRows.push(
    {
      org: TELEMETRY_ORG,
      repo,
      tokensIn: 1000,
      tokensOut: 200,
      costCents: 12.5,
      at: at("2026-10-07T10:00:00Z"),
    },
    {
      org: TELEMETRY_ORG,
      repo,
      tokensIn: 3000,
      tokensOut: 500,
      costCents: null,
      at: at("2026-10-07T11:00:00Z"),
    },
    {
      org: TELEMETRY_ORG,
      repo: null,
      tokensIn: 400,
      tokensOut: 100,
      costCents: 3,
      at: at("2026-10-09T09:00:00Z"),
    },
  );

  const metrics = new MemoryMetrics()
    .answering("merge_rate|2026-09-11..2026-10-10", {
      value: 91.83673469387755,
      days: 30,
      components: { numerator: 90, denominator: 98 },
    })
    .answering("merge_rate|2026-08-11..2026-09-09", {
      value: 88.88888888888889,
      days: 30,
      components: { numerator: 96, denominator: 108 },
    })
    .answering("merged_prs|2026-09-11..2026-10-10", {
      value: 90,
      days: 27,
      unit: "count",
      aggregation: "sum",
    })
    .answering("build_duration|2026-10-04..2026-10-10|zephyr build", {
      value: 251_000,
      days: 7,
      samples: [200_000, 240_000, 251_000, 262_000, 300_000],
      unit: "duration_ms",
      aggregation: "median",
    });

  return { store, metrics };
}
