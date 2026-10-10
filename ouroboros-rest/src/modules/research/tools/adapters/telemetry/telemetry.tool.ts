/**
 * `telemetry` — the build & test telemetry research tool (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)).
 *
 * ```
 * ∿ Build & test telemetry    8 HIL measurements · 23 insights metrics · 63 test cases    ●
 * ```
 *
 * Read-only windows over what the product already measures — **no new collection**. Four
 * operations through `query`, and `fetch` to re-run a citation:
 *
 * | `op` | answers | read from |
 * | --- | --- | --- |
 * | `metric_window` | a metric over a window: value, n, median, spread, unit | the insights plane (`MetricsService.span()`), or HIL measurements for a case metric |
 * | `compare` | the signed delta between two windows, with both sample counts | the same two readings — the shape CM.4's watch (#623) calls |
 * | `case_history` | a case's or a suite's results: pass rate, flake score, quarantine | case history and flake scores |
 * | `run_series` | runs or token usage per day | runs and token usage |
 *
 * Three promises, each kept in one place:
 *
 *   * **A cited number re-runs.** Every result is one `telemetry://` source whose locator carries
 *     the whole query with **absolute** windows (`telemetry.locator.ts`); `fetch(locator)` runs
 *     it again, and the source's content hash is the result's digest, so "same numbers" is
 *     checkable.
 *   * **Empty is not zero.** A window with nothing in it is a `no_data` result naming the window
 *     searched (`telemetry.readings.ts`). It is still cited — absence is a finding.
 *   * **A window may be left out** of every operation but `compare`: it is then the workspace's
 *     default window (thirty days unless the settings form chose another) — resolved, like any
 *     relative window, to the absolute range it names before it is cited.
 *   * **Nothing is written.** The tool's reads are `TelemetryRepository`'s selects and the
 *     insights service's read; it holds no write path to any plane.
 *
 * Farm telemetry (#266, a runner's health history) is not one of its planes: that history does
 * not exist yet, and this tool reads nothing it cannot cite.
 */

import { MetricWindowError } from "../../../../insights/metrics/metrics.service";
import type { MetricSpan, MetricSpanScope } from "../../../../insights/metrics/metrics.types";
import {
  RUN_SERIES_KINDS,
  TELEMETRY_OPERATIONS,
  caseKey,
  metricRef,
  narrowing,
  queryOf,
  type MetricRef,
  type RunSeriesKind,
  type TelemetryQuery,
} from "../../../telemetry/telemetry.locator";
import {
  baselineReading,
  compareReadings,
  metricReading,
  readingSentence,
  sampleReading,
  type Reading,
} from "../../../telemetry/telemetry.readings";
import type {
  TelemetryRepository,
  TelemetrySummary,
} from "../../../telemetry/telemetry.repository";
import { telemetrySource } from "../../../telemetry/telemetry.sources";
import { round } from "../../../telemetry/telemetry.stats";
import { daySpan, parseWindow, type RangeWindow } from "../../../telemetry/telemetry.window";
import type {
  FetchCapableTool,
  QueryCapableTool,
  SubLineValue,
  ToolCallContext,
  ToolCapabilities,
  ToolDisplayMeta,
  ToolResult,
} from "../../research-tool.adapter";
import type { ResearchToolConfig, ResearchToolConfigSchema } from "../../research-tool.config";
import { ResearchToolError } from "../../research-tool.errors";
import { NOT_CONFIGURED_HEALTH, type ToolHealth } from "../../research-tool.health";

/** The tool's slug — V106's catalog row. */
export const TELEMETRY_TOOL_SLUG = "telemetry";

/** The default-window choices the settings form offers, in days. */
export const WINDOW_CHOICES = ["7", "30", "90"] as const;

/** The window an operation reads when it names none and the workspace chose none. */
export const DEFAULT_WINDOW_DAYS = 30;

/** What the tool reads from the test, run and baseline planes. */
export type TelemetryStore = Pick<
  TelemetryRepository,
  "measurements" | "baseline" | "caseHistory" | "flakeContext" | "runDays" | "tokenDays" | "summary"
>;

/** What the tool reads from the insights plane. */
export interface MetricSpanReader {
  /** `MetricsService.span()`. */
  span(metricId: string, scope: MetricSpanScope): Promise<MetricSpan>;
}

/** PostgreSQL and socket codes that mean the database could not be reached. */
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "57P01",
  "57P03",
  "08006",
  "08001",
]);

export class TelemetryResearchTool implements QueryCapableTool, FetchCapableTool {
  readonly slug = TELEMETRY_TOOL_SLUG;

  /**
   * @param store - The test, run and baseline reads.
   * @param metrics - The insights plane's span read.
   * @param now - The clock a relative window resolves against.
   */
  constructor(
    private readonly store: TelemetryStore,
    private readonly metrics: MetricSpanReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** @returns The card's name, glyph and sub-line template. */
  displayMeta(): ToolDisplayMeta {
    return {
      name: "Build & test telemetry",
      glyph: "∿",
      subLine: "{measurements} · {metrics} · {cases}",
    };
  }

  /**
   * The sub-line's counts.
   *
   * @param organizationId - The workspace.
   * @returns Phrases for the three slots; nulls when the planes could not be read.
   */
  async counts(organizationId: string): Promise<Readonly<Record<string, SubLineValue>>> {
    try {
      return subLineOf(await this.store.summary(organizationId));
    } catch {
      return { measurements: null, metrics: null, cases: null };
    }
  }

  /**
   * @returns The enable form: one optional choice and nothing required — the tool reads this
   *   workspace's own measurements, so there is no connection or credential to configure.
   */
  configSchema(): ResearchToolConfigSchema {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title: "Build & test telemetry",
      properties: {
        windowDays: {
          type: "string",
          title: "Default window",
          description:
            "How many days back an investigation reads when it names no window. The tool reads this workspace's own insights metrics, test results, HIL measurements, runs and token usage; it needs no connection or credential.",
          enum: [...WINDOW_CHOICES],
          default: String(DEFAULT_WINDOW_DAYS),
        },
      },
      required: [],
      additionalProperties: false,
    };
  }

  /** @returns `query` for the four operations and `fetch` to re-run a citation. */
  capabilities(): ToolCapabilities & { readonly query: true; readonly fetch: true } {
    return { search: false, fetch: true, query: true, watch: false };
  }

  /**
   * Whether the workspace has anything to read.
   *
   * @param config - The workspace's settings, or `null` when the tool is not enabled.
   * @param _secret - Unused: the tool has no credential.
   * @param organizationId - The workspace.
   * @returns `healthy` with the sub-line, `not_configured` when nothing has been measured yet,
   *   `degraded` without a workspace, `down` when the planes cannot be read. Never rejects.
   */
  async healthCheck(
    config: ResearchToolConfig | null,
    _secret: string | null,
    organizationId?: string,
  ): Promise<ToolHealth> {
    if (config === null) return NOT_CONFIGURED_HEALTH;
    if (organizationId === undefined) {
      return { state: "degraded", detail: "no workspace named — nothing to count" };
    }

    try {
      const summary = await this.store.summary(organizationId);

      if (summary.measurements + summary.metrics + summary.cases === 0) {
        return {
          state: "not_configured",
          detail: "nothing measured yet — telemetry appears once builds and tests have run",
        };
      }

      const line = subLineOf(summary);

      return { state: "healthy", detail: `${line.measurements} · ${line.metrics} · ${line.cases}` };
    } catch {
      return { state: "down", detail: "the telemetry planes could not be read" };
    }
  }

  /**
   * Run one of the four operations.
   *
   * @param context - The call: the workspace is its `organizationId`, never the input's.
   * @param structured - `{op, …}` — see the table above.
   * @returns The result and its one `telemetry://` source.
   * @throws {ResearchToolError} `unsupported` for an unknown operation or a malformed input;
   *   `network` or `upstream` when a plane cannot be read.
   */
  async query(
    context: ToolCallContext,
    structured: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    switch (structured.op) {
      case "metric_window":
        return this.metricWindow(context, structured);
      case "compare":
        return this.compare(context, structured);
      case "case_history":
        return this.caseHistory(context, structured);
      case "run_series":
        return this.runSeries(context, structured);
      default:
        throw new ResearchToolError(
          "unsupported",
          `telemetry answers {op: ${TELEMETRY_OPERATIONS.map((name) => `"${name}"`).join(" | ")}}`,
        );
    }
  }

  /**
   * Re-run a citation.
   *
   * @param context - The call.
   * @param locator - A `telemetry://` locator this tool wrote.
   * @returns What the query answers now — the same numbers while the data behind them stands,
   *   under the same locator.
   * @throws {ResearchToolError} `unsupported` for a locator this tool did not write.
   */
  async fetch(context: ToolCallContext, locator: string): Promise<ToolResult> {
    return this.query(context, queryOf(locator));
  }

  /**
   * `metric_window(metric, window)`.
   *
   * @param context - The call.
   * @param input - `{metric, window, repo?, dimension?}`.
   * @returns The reading, cited.
   */
  private async metricWindow(
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const metric = metricRef(input.metric);
    const scope = scopeOf(input, metric);
    const reading = await this.reading(
      context.organizationId,
      metric,
      input.window ?? defaultWindow(context.config),
      scope,
    );
    const query: TelemetryQuery = { op: "metric_window", metric, window: reading.window, ...scope };
    const payload = {
      op: "metric_window",
      metric: metric.key,
      source: metric.source,
      ...scope,
      ...reading,
    };

    return this.cited(
      query,
      payload,
      `${metric.key} — ${reading.window}`,
      readingSentence(metric.key, reading),
    );
  }

  /**
   * `compare(metric, window_a, window_b)`.
   *
   * @param context - The call.
   * @param input - `{metric, windowA, windowB, repo?, dimension?}`.
   * @returns Both readings and the signed delta `b − a`, cited as one source.
   */
  private async compare(
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const metric = metricRef(input.metric);
    const scope = scopeOf(input, metric);
    const [a, b] = await Promise.all([
      this.reading(context.organizationId, metric, input.windowA, scope),
      this.reading(context.organizationId, metric, input.windowB, scope),
    ]);
    const comparison = compareReadings(a, b);
    const query: TelemetryQuery = {
      op: "compare",
      metric,
      windowA: a.window,
      windowB: b.window,
      ...scope,
    };
    const payload = {
      op: "compare",
      metric: metric.key,
      source: metric.source,
      ...scope,
      ...comparison,
      a,
      b,
    };
    const sentence =
      comparison.status === "ok"
        ? `${metric.key}: ${comparison.display} — ${readingSentence("a", a)} vs ${readingSentence("b", b)}`
        : `No data — ${comparison.reason}. Not zero: nothing was compared.`;

    return this.cited(query, payload, `${metric.key} — ${a.window} vs ${b.window}`, sentence);
  }

  /**
   * `case_history(case | suite, window)`.
   *
   * @param context - The call.
   * @param input - `{case, window, repo?}` or `{suite, window, repo?}`.
   * @returns The results over the window, with the flake scorer's current verdict as context.
   */
  private async caseHistory(
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    if ((input.case === undefined) === (input.suite === undefined)) {
      throw new ResearchToolError(
        "unsupported",
        "case_history takes one of {case: <64-hex case key>} or {suite: <suite name>}",
      );
    }

    const subject =
      input.case === undefined
        ? ({ kind: "suite", suite: narrowing(input.suite, "a suite") as string } as const)
        : ({ kind: "case", caseKey: caseKey(input.case) } as const);
    const repo = narrowing(input.repo, "a repository");
    const window = this.range(input.window ?? defaultWindow(context.config), "instant");
    const stretch = { from: window.from, to: window.to };
    const [history, flake] = await reading(() =>
      Promise.all([
        this.store.caseHistory(context.organizationId, subject, stretch, repo ?? null),
        this.store.flakeContext(context.organizationId, subject, stretch, repo ?? null),
      ]),
    );
    const named =
      subject.kind === "case" ? `case ${subject.caseKey.slice(0, 12)}…` : `suite ${subject.suite}`;
    const at = {
      window: window.text,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    };
    const query: TelemetryQuery = {
      op: "case_history",
      subject,
      window: window.text,
      ...(repo === undefined ? {} : { repo }),
    };
    const base = {
      op: "case_history",
      ...(subject.kind === "case" ? { case: subject.caseKey } : { suite: subject.suite }),
      ...(repo === undefined ? {} : { repo }),
      ...at,
    };

    if (history.runs === 0) {
      const reason = `no result of ${named} was recorded in ${window.text}`;

      return this.cited(
        query,
        { ...base, status: "no_data", reason },
        `${named} — ${window.text}`,
        `No data — ${reason}. Not zero: nothing ran.`,
      );
    }

    // Of the results that ran: a skipped case neither passed nor failed.
    const ran = history.passed + history.failed + history.flaky + history.errored;
    const passRate = ran === 0 ? null : round(((history.passed + history.flaky) / ran) * 100);
    const payload = {
      ...base,
      status: "ok",
      runs: history.runs,
      cases: history.cases,
      passed: history.passed,
      failed: history.failed,
      flaky: history.flaky,
      skipped: history.skipped,
      errored: history.errored,
      retries: history.retries,
      passRatePct: passRate,
      firstObservedAt: history.firstObservedAt?.toISOString() ?? null,
      lastObservedAt: history.lastObservedAt?.toISOString() ?? null,
      // The scorer keeps one row per case: this is its verdict now, not as of the window.
      flake: {
        asOf: "now",
        scored: flake.scored,
        maxScore: flake.maxScore,
        healthy: flake.healthy,
        watching: flake.watching,
        quarantined: flake.quarantined,
        lastScoredAt: flake.lastScoredAt?.toISOString() ?? null,
      },
    };
    const flakeWords =
      flake.scored === 0
        ? "no flake score"
        : `flake score up to ${String(flake.maxScore)} (${String(flake.quarantined)} quarantined, ${String(flake.watching)} watching)`;

    return this.cited(
      query,
      payload,
      `${named} — ${window.text}`,
      `${named}: ${passRate === null ? "nothing ran" : `${String(passRate)}% passed`} over ${String(history.runs)} results of ${String(history.cases)} ${history.cases === 1 ? "case" : "cases"} in ${window.text} — ${String(history.failed)} failed, ${String(history.flaky)} flaky, ${String(history.retries)} retries; ${flakeWords} as scored now.`,
    );
  }

  /**
   * `run_series(repo, kind, window)`.
   *
   * @param context - The call.
   * @param input - `{kind: "runs" | "tokens", window, repo?}`.
   * @returns The days that had anything, and their totals. A quiet day is absent, never zero.
   */
  private async runSeries(
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const kind = input.kind;

    if (typeof kind !== "string" || !(RUN_SERIES_KINDS as readonly string[]).includes(kind)) {
      throw new ResearchToolError(
        "unsupported",
        `run_series takes {kind: ${RUN_SERIES_KINDS.map((name) => `"${name}"`).join(" | ")}}`,
      );
    }

    const repo = narrowing(input.repo, "a repository");
    const window = this.range(input.window ?? defaultWindow(context.config), "instant");
    const stretch = { from: window.from, to: window.to };
    const query: TelemetryQuery = {
      op: "run_series",
      kind: kind as RunSeriesKind,
      window: window.text,
      ...(repo === undefined ? {} : { repo }),
    };
    const base = {
      op: "run_series",
      kind,
      ...(repo === undefined ? {} : { repo }),
      window: window.text,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    };
    const title = `${kind} per day${repo === undefined ? "" : ` — ${repo}`} — ${window.text}`;
    const empty = (what: string): Promise<ToolResult> => {
      const reason = `no ${what} was recorded in ${window.text}`;

      return this.cited(
        query,
        { ...base, status: "no_data", reason },
        title,
        `No data — ${reason}. Not zero: nothing was recorded.`,
      );
    };

    if (kind === "runs") {
      const days = await reading(() =>
        this.store.runDays(context.organizationId, stretch, repo ?? null),
      );

      if (days.length === 0) return empty("run");

      const totals = {
        started: sum(days.map((day) => day.started)),
        merged: sum(days.map((day) => day.merged)),
        failed: sum(days.map((day) => day.failed)),
        needsHuman: sum(days.map((day) => day.needsHuman)),
      };

      return this.cited(
        query,
        { ...base, status: "ok", daysWithData: days.length, totals, days },
        title,
        `${String(totals.started)} runs started on ${String(days.length)} days in ${window.text} — ${String(totals.merged)} merged, ${String(totals.failed)} failed, ${String(totals.needsHuman)} needing a person. Days with no run are not listed.`,
      );
    }

    const days = await reading(() =>
      this.store.tokenDays(context.organizationId, stretch, repo ?? null),
    );

    if (days.length === 0) return empty("token usage");

    const priced = days.filter((day) => day.costCents !== null);
    const totals = {
      events: sum(days.map((day) => day.events)),
      tokensIn: sum(days.map((day) => day.tokensIn)),
      tokensOut: sum(days.map((day) => day.tokensOut)),
      // No dollars without a price: null when no call in the window was priced.
      costCents: priced.length === 0 ? null : round(sum(priced.map((day) => day.costCents ?? 0))),
      unpricedEvents: sum(days.map((day) => day.unpricedEvents)),
    };

    return this.cited(
      query,
      { ...base, status: "ok", daysWithData: days.length, totals, days },
      title,
      `${String(totals.tokensIn + totals.tokensOut)} tokens over ${String(totals.events)} model calls on ${String(days.length)} days in ${window.text}${totals.costCents === null ? "" : `, ${String(totals.costCents)}¢ priced`}${totals.unpricedEvents === 0 ? "" : ` (${String(totals.unpricedEvents)} calls unpriced)`}. Days with no usage are not listed.`,
    );
  }

  /**
   * One metric over one window.
   *
   * @param organizationId - The workspace.
   * @param metric - The metric.
   * @param input - The window as written.
   * @param scope - The repository and dimension that narrow it.
   * @returns The reading — `ok`, or `no_data` naming the window searched.
   */
  private async reading(
    organizationId: string,
    metric: MetricRef,
    input: unknown,
    scope: { readonly repo?: string; readonly dimension?: string },
  ): Promise<Reading> {
    const window = parseWindow(
      input,
      this.now(),
      metric.source === "bi_metric" ? "day" : "instant",
    );

    if (window.kind === "baseline") {
      return baselineReading(
        await reading(() => this.store.baseline(organizationId, metric.key, window.tag)),
        metric.key,
        window.text,
        window.tag,
      );
    }

    if (metric.source === "case_metric") {
      return sampleReading(
        await reading(() =>
          this.store.measurements(
            organizationId,
            metric.caseKey,
            metric.measurement,
            { from: window.from, to: window.to },
            scope.repo ?? null,
          ),
        ),
        metric.key,
        { window: window.text, from: window.from.toISOString(), to: window.to.toISOString() },
      );
    }

    try {
      return metricReading(
        await this.metrics.span(metric.metricId, {
          organizationId,
          repo: scope.repo,
          dimension: scope.dimension,
          span: daySpan(window),
          now: this.now(),
        }),
        window.text,
      );
    } catch (error) {
      // The insights service names what it cannot compute — an unknown id, a median asked for
      // without its dimension. That is the caller's input, and it is told so in those words.
      if (error instanceof MetricWindowError) {
        throw new ResearchToolError("unsupported", error.message);
      }

      throw classified(error);
    }
  }

  /**
   * Parse a window that must be a stretch of time.
   *
   * @param input - The window as written.
   * @param grain - The plane's grain.
   * @returns The range.
   * @throws {ResearchToolError} `unsupported` for a baseline: only a metric has one.
   */
  private range(input: unknown, grain: "day" | "instant"): RangeWindow {
    const window = parseWindow(input, this.now(), grain);

    if (window.kind === "baseline") {
      throw new ResearchToolError(
        "unsupported",
        "a baseline window belongs to a metric — use it with metric_window or compare",
      );
    }

    return window;
  }

  /**
   * A result with its one source.
   *
   * @param query - The canonical query.
   * @param payload - The result.
   * @param title - The source's title.
   * @param sentence - The result in words.
   * @returns The tool result.
   */
  private cited(
    query: TelemetryQuery,
    payload: Readonly<Record<string, unknown>>,
    title: string,
    sentence: string,
  ): Promise<ToolResult> {
    return Promise.resolve({
      payload,
      sources: [telemetrySource(query, payload, title, sentence, this.now())],
      usage: { tokens: 0 },
    });
  }
}

/**
 * The repository and dimension that narrow a metric query.
 *
 * @param input - The operation's input.
 * @param metric - The metric: a dimension belongs to an insights metric only.
 * @returns The narrowing, absent keys left out.
 * @throws {ResearchToolError} `unsupported` for a dimension on a case metric.
 */
function scopeOf(
  input: Readonly<Record<string, unknown>>,
  metric: MetricRef,
): { readonly repo?: string; readonly dimension?: string } {
  const repo = narrowing(input.repo, "a repository");
  const dimension = narrowing(input.dimension, "a dimension");

  if (dimension !== undefined && metric.source === "case_metric") {
    throw new ResearchToolError("unsupported", "a case metric has no dimension to narrow by");
  }

  return {
    ...(repo === undefined ? {} : { repo }),
    ...(dimension === undefined ? {} : { dimension }),
  };
}

/**
 * The window an operation reads when it names none.
 *
 * @param config - The workspace's settings.
 * @returns The chosen default as a relative window, or thirty days.
 */
function defaultWindow(config: ResearchToolConfig): string {
  const chosen = config.windowDays;

  return typeof chosen === "string" && (WINDOW_CHOICES as readonly string[]).includes(chosen)
    ? `${chosen}d`
    : `${String(DEFAULT_WINDOW_DAYS)}d`;
}

/**
 * Add up.
 *
 * @param values - The numbers.
 * @returns Their sum.
 */
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * A failed read as the taxonomy's error.
 *
 * @param error - What the read threw.
 * @returns `network` when the database could not be reached, otherwise `upstream`.
 */
function classified(error: unknown): ResearchToolError {
  if (error instanceof ResearchToolError) return error;

  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

  return typeof code === "string" && UNREACHABLE.has(code)
    ? new ResearchToolError("network", "the telemetry planes could not be reached")
    : new ResearchToolError("upstream", "the telemetry planes could not be read");
}

/**
 * Run a read, turning any failure into the taxonomy's error.
 *
 * @param read - The read.
 * @returns What it answered.
 * @throws {ResearchToolError} `network` or `upstream`.
 */
async function reading<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw classified(error);
  }
}

/**
 * The card's sub-line phrases.
 *
 * @param summary - What the workspace holds.
 * @returns `8 HIL measurements`, `23 insights metrics`, `63 test cases`.
 */
export function subLineOf(summary: TelemetrySummary): {
  readonly measurements: string;
  readonly metrics: string;
  readonly cases: string;
} {
  const phrase = (count: number, one: string, many: string): string =>
    `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

  return {
    measurements: phrase(summary.measurements, "HIL measurement", "HIL measurements"),
    metrics: phrase(summary.metrics, "insights metric", "insights metrics"),
    cases: phrase(summary.cases, "test case", "test cases"),
  };
}
