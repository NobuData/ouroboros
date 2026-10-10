import {
  HOVER_CASE,
  MemoryMetrics,
  MemoryTelemetry,
  OTHER_ORG,
  OVERSHOOT_CASE,
  TELEMETRY_ORG,
  seededTelemetry,
} from "../../../telemetry/telemetry.store.fixture";
import type { ToolCallContext, ToolResult } from "../../research-tool.adapter";
import { locatorValid, sourceRecordViolations } from "../../research-tool.citations";
import { ResearchToolError } from "../../research-tool.errors";
import { TelemetryResearchTool, subLineOf } from "./telemetry.tool";

/**
 * The telemetry tool (#619) over the in-memory planes: the four operations, the citation each
 * result carries, re-running a citation, the no-data record, and the workspace boundary.
 */

const NOW = new Date("2026-10-10T02:47:47.512Z");
const OVERSHOOT = `${OVERSHOOT_CASE}:overshoot_pct`;
const HOVER = `${HOVER_CASE}:hover_drift_cm`;
const REPO = "acme-robotics/helios-firmware";

/**
 * A call's context.
 *
 * @param organizationId - The workspace.
 * @returns The context.
 */
function context(organizationId = TELEMETRY_ORG): ToolCallContext {
  return { organizationId, investigationId: "inv", config: {}, secret: null, tokenCeiling: null };
}

/**
 * The tool over the seeded fixture.
 *
 * @param now - The clock.
 * @returns The tool and what is under it.
 */
function harness(now: Date = NOW) {
  const { store, metrics } = seededTelemetry();

  return { store, metrics, tool: new TelemetryResearchTool(store, metrics, () => now) };
}

/**
 * A result's payload, as a record.
 *
 * @param result - The tool result.
 * @returns Its payload.
 */
function payloadOf(result: ToolResult): Record<string, unknown> {
  return result.payload as Record<string, unknown>;
}

/**
 * Every number anywhere inside a value.
 *
 * @param value - Anything.
 * @returns The numbers found, depth-first.
 */
function numbersIn(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(numbersIn);

  return [];
}

/** One query per operation, each with data behind it in the fixture. */
const EVERY_OPERATION: readonly [string, Record<string, unknown>][] = [
  ["metric_window, insights", { op: "metric_window", metric: "merge_rate", window: "30d" }],
  ["metric_window, case metric", { op: "metric_window", metric: OVERSHOOT, window: "7d" }],
  ["metric_window, baseline", { op: "metric_window", metric: HOVER, window: "baseline:v2.0.4" }],
  ["compare", { op: "compare", metric: HOVER, windowA: "baseline:v2.0.4", windowB: "8d" }],
  ["case_history, case", { op: "case_history", case: OVERSHOOT_CASE, window: "30d" }],
  [
    "case_history, suite",
    { op: "case_history", suite: "PHYSICAL · HIL rig", window: "30d", repo: REPO },
  ],
  ["run_series, runs", { op: "run_series", kind: "runs", window: "7d", repo: REPO }],
  ["run_series, tokens", { op: "run_series", kind: "tokens", window: "7d" }],
];

describe("metric_window", () => {
  it("reproduces the insights plane's figure exactly, with what it rests on", async () => {
    const { tool, metrics } = harness();

    const result = await tool.query(context(), {
      op: "metric_window",
      metric: "merge_rate",
      window: "30d",
    });

    expect(result.payload).toEqual({
      op: "metric_window",
      metric: "merge_rate",
      source: "bi_metric",
      status: "ok",
      window: "2026-09-11..2026-10-10",
      from: "2026-09-11",
      to: "2026-10-10",
      value: 91.83673469387755,
      unit: "%",
      n: 98,
      basis: "denominator",
      median: null,
      spread: null,
      spreadKind: null,
    });
    // Asked of the insights service over the absolute days, for this workspace, at this instant.
    expect(metrics.asked).toEqual([
      {
        metricId: "merge_rate",
        scope: {
          organizationId: TELEMETRY_ORG,
          repo: undefined,
          dimension: undefined,
          span: { from: "2026-09-11", to: "2026-10-10" },
          now: NOW,
        },
      },
    ]);
  });

  it("reproduces the test plane's measurements: overshoot 2.4 %, n = 4", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "metric_window",
      metric: OVERSHOOT,
      window: "7d",
    });

    expect(result.payload).toMatchObject({
      status: "ok",
      source: "case_metric",
      value: 2.4,
      median: 2.4,
      spread: 0.175,
      spreadKind: "iqr",
      unit: "%",
      n: 4,
      basis: "samples",
      window: "2026-10-03T02:47:47Z..2026-10-10T02:47:47Z",
    });
  });

  it("narrows by repository and dimension, and cites both", async () => {
    const { tool, metrics } = harness();

    const result = await tool.query(context(), {
      op: "metric_window",
      metric: "build_duration",
      window: "7d",
      dimension: "zephyr build",
    });

    expect(result.payload).toMatchObject({
      status: "ok",
      value: 251_000,
      unit: "ms",
      n: 5,
      dimension: "zephyr build",
    });
    expect(metrics.asked[0].scope.dimension).toBe("zephyr build");
    expect(result.sources[0].locator).toBe(
      "telemetry://metric/build_duration/2026-10-04..2026-10-10?dimension=zephyr%20build",
    );
  });

  it("reads a release's baseline as a window", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "metric_window",
      metric: HOVER,
      window: "baseline:v2.0.4",
    });

    expect(result.payload).toMatchObject({
      status: "ok",
      value: 31,
      unit: "cm",
      n: 48,
      basis: "baseline",
      spread: 4.2,
      from: "2026-07-25T02:35:47Z",
      to: "2026-08-01T02:35:47Z",
    });
    expect(result.sources[0].locator).toBe(
      `telemetry://case/${HOVER_CASE}/hover_drift_cm/baseline:v2.0.4`,
    );
  });

  it("passes the insights service's own refusal on, as the caller's input to fix", async () => {
    const { tool } = harness();

    await expect(
      tool.query(context(), { op: "metric_window", metric: "no_such_metric", window: "7d" }),
    ).rejects.toMatchObject({
      errorClass: "unsupported",
      detail: "no_such_metric: not in the metric registry",
    });
  });

  it("refuses a dimension on a case metric, and a malformed metric or window", async () => {
    const { tool } = harness();

    await expect(
      tool.query(context(), {
        op: "metric_window",
        metric: OVERSHOOT,
        window: "7d",
        dimension: "x",
      }),
    ).rejects.toThrow(/no dimension/);
    await expect(
      tool.query(context(), { op: "metric_window", metric: "Fleet.X", window: "7d" }),
    ).rejects.toThrow(ResearchToolError);
    await expect(
      tool.query(context(), { op: "metric_window", metric: "merge_rate", window: "last month" }),
    ).rejects.toMatchObject({ errorClass: "unsupported" });
    await expect(
      tool.query(context(), { op: "metric_window", metric: "merge_rate", window: "36h" }),
    ).rejects.toThrow(/kept per UTC day/);
  });
});

describe("compare", () => {
  it("returns the signed delta with its unit and both windows' sample counts — the watch's +14%", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "compare",
      metric: HOVER,
      windowA: "baseline:v2.0.4",
      windowB: "8d",
    });
    const payload = payloadOf(result);

    expect(payload).toMatchObject({
      op: "compare",
      status: "ok",
      unit: "cm",
      delta: 4.34,
      deltaPct: 14,
      display: "+14% (+4.34 cm)",
      a: { status: "ok", window: "baseline:v2.0.4", value: 31, n: 48, basis: "baseline" },
      b: { status: "ok", value: 35.34, n: 12, basis: "samples", unit: "cm" },
    });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].locator).toBe(
      `telemetry://case/${HOVER_CASE}/hover_drift_cm/baseline:v2.0.4-vs-2026-10-02T02:47:47Z..2026-10-10T02:47:47Z`,
    );
    expect(result.sources[0].excerpt).toMatch(/\+14% \(\+4\.34 cm\)/);
  });

  it("compares two windows of an insights metric, in points", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "compare",
      metric: "merge_rate",
      windowA: "2026-08-11..2026-09-09",
      windowB: "30d",
    });

    expect(result.payload).toMatchObject({
      status: "ok",
      unit: "%",
      delta: 2.9478,
      display: "+2.9478 pts",
      a: { n: 108, value: 88.88888888888889 },
      b: { n: 98, value: 91.83673469387755 },
    });
    expect(result.sources[0].locator).toBe(
      "telemetry://metric/merge_rate/2026-08-11..2026-09-09-vs-2026-09-11..2026-10-10",
    );
  });

  it("is negative when the second window is lower", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "compare",
      metric: "merge_rate",
      windowA: "30d",
      windowB: "2026-08-11..2026-09-09",
    });

    expect(result.payload).toMatchObject({ delta: -2.9478, display: "−2.9478 pts" });
  });

  it("is no data — with no delta anywhere — when a window is empty, and says which", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "compare",
      metric: HOVER,
      windowA: "baseline:v2.0.4",
      windowB: "2026-01-01..2026-01-08",
    });
    const payload = payloadOf(result);

    expect(payload.status).toBe("no_data");
    expect(payload).not.toHaveProperty("delta");
    expect(payload).not.toHaveProperty("deltaPct");
    expect(payload.reason).toMatch(
      /nothing to compare: no measurement of .*hover_drift_cm was taken in 2026-01-01\.\.2026-01-08/,
    );
    expect(payload.b).toMatchObject({ status: "no_data", window: "2026-01-01..2026-01-08" });
    // The side that has data keeps it; the empty side holds no number at all.
    expect(payload.a).toMatchObject({ status: "ok", value: 31 });
    expect(numbersIn(payload.b)).toEqual([]);
    expect(result.sources[0].excerpt).toMatch(/^No data — .*Not zero/);
  });

  it("is no data against a release that captured no baseline", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "compare",
      metric: HOVER,
      windowA: "baseline:v9.9.9",
      windowB: "8d",
    });

    expect(payloadOf(result)).toMatchObject({
      status: "no_data",
      a: { status: "no_data", from: null, to: null },
    });
    expect(payloadOf(result).reason).toMatch(/no baseline of .* was captured for release v9\.9\.9/);
  });
});

describe("case_history", () => {
  it("answers a suite's pass rate, counts and the flake scorer's verdict", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "case_history",
      suite: "PHYSICAL · HIL rig",
      window: "30d",
    });

    expect(result.payload).toMatchObject({
      op: "case_history",
      suite: "PHYSICAL · HIL rig",
      status: "ok",
      runs: 4,
      cases: 1,
      passed: 1,
      failed: 3,
      flaky: 0,
      passRatePct: 25,
      retries: 0,
      flake: { asOf: "now", scored: 1, maxScore: 0.42, watching: 1, quarantined: 0 },
    });
    expect(result.sources[0].excerpt).toMatch(/25% passed over 4 results of 1 case in/);
  });

  it("answers one case by its key", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "case_history",
      case: OVERSHOOT_CASE,
      window: "30d",
    });

    expect(result.payload).toMatchObject({ case: OVERSHOOT_CASE, runs: 4, passRatePct: 25 });
    expect(result.sources[0].locator).toBe(
      `telemetry://history/case/${OVERSHOOT_CASE}/2026-09-10T02:47:47Z..2026-10-10T02:47:47Z`,
    );
  });

  it("counts a flaky result as passed, and leaves a skipped one out of the rate", async () => {
    const { store, metrics } = seededTelemetry();
    const at = new Date("2026-10-08T00:00:00Z");
    const base = {
      org: TELEMETRY_ORG,
      caseKey: "c".repeat(64),
      suite: "unit",
      repo: REPO,
      retries: 0,
      at,
    };

    store.resultRows.push(
      { ...base, status: "passed" },
      { ...base, status: "flaky", retries: 2 },
      { ...base, status: "failed" },
      { ...base, status: "error" },
      { ...base, status: "skipped" },
    );
    const tool = new TelemetryResearchTool(store, metrics, () => NOW);

    const result = await tool.query(context(), { op: "case_history", suite: "unit", window: "7d" });

    expect(result.payload).toMatchObject({
      runs: 5,
      passed: 1,
      flaky: 1,
      failed: 1,
      errored: 1,
      skipped: 1,
      passRatePct: 50,
      retries: 2,
    });
  });

  it("has no pass rate — not 0 % — when everything observed was skipped", async () => {
    const { store, metrics } = seededTelemetry();

    store.resultRows.push({
      org: TELEMETRY_ORG,
      caseKey: "d".repeat(64),
      suite: "skipped-suite",
      repo: REPO,
      status: "skipped",
      retries: 0,
      at: new Date("2026-10-08T00:00:00Z"),
    });
    const result = await new TelemetryResearchTool(store, metrics, () => NOW).query(context(), {
      op: "case_history",
      suite: "skipped-suite",
      window: "7d",
    });

    expect(result.payload).toMatchObject({ status: "ok", runs: 1, passRatePct: null });
    expect(result.sources[0].excerpt).toMatch(/nothing ran/);
  });

  it("is no data for a suite nobody ran in the window", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "case_history",
      suite: "dock_suite",
      window: "30d",
    });

    expect(result.payload).toEqual({
      op: "case_history",
      suite: "dock_suite",
      window: "2026-09-10T02:47:47Z..2026-10-10T02:47:47Z",
      from: "2026-09-10T02:47:47.000Z",
      to: "2026-10-10T02:47:47.000Z",
      status: "no_data",
      reason:
        "no result of suite dock_suite was recorded in 2026-09-10T02:47:47Z..2026-10-10T02:47:47Z",
    });
  });

  it("takes exactly one of a case and a suite, and no baseline", async () => {
    const { tool } = harness();

    await expect(tool.query(context(), { op: "case_history", window: "7d" })).rejects.toThrow(
      /one of/,
    );
    await expect(
      tool.query(context(), { op: "case_history", case: OVERSHOOT_CASE, suite: "x", window: "7d" }),
    ).rejects.toThrow(/one of/);
    await expect(
      tool.query(context(), { op: "case_history", case: "dock_suite", window: "7d" }),
    ).rejects.toThrow(/64-hex case key/);
    await expect(
      tool.query(context(), { op: "case_history", suite: "x", window: "baseline:v2.0.4" }),
    ).rejects.toThrow(/belongs to a metric/);
  });
});

describe("run_series", () => {
  it("lists the days that had runs — and only those", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "run_series",
      kind: "runs",
      window: "7d",
      repo: REPO,
    });

    expect(result.payload).toMatchObject({
      op: "run_series",
      kind: "runs",
      repo: REPO,
      status: "ok",
      daysWithData: 2,
      totals: { started: 5, merged: 3, failed: 1, needsHuman: 1 },
      days: [
        { day: "2026-10-07", started: 3, merged: 2, failed: 1, needsHuman: 0 },
        { day: "2026-10-09", started: 2, merged: 1, failed: 0, needsHuman: 1 },
      ],
    });
    // 2026-10-08 had no run: it is absent, not a row of zeros.
    expect((payloadOf(result).days as { day: string }[]).map((day) => day.day)).not.toContain(
      "2026-10-08",
    );
  });

  it("sums token usage per day, and prices only what was priced", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), { op: "run_series", kind: "tokens", window: "7d" });

    expect(result.payload).toMatchObject({
      status: "ok",
      daysWithData: 2,
      totals: { events: 3, tokensIn: 4400, tokensOut: 800, costCents: 15.5, unpricedEvents: 1 },
      days: [
        {
          day: "2026-10-07",
          events: 2,
          tokensIn: 4000,
          tokensOut: 700,
          costCents: 12.5,
          unpricedEvents: 1,
        },
        {
          day: "2026-10-09",
          events: 1,
          tokensIn: 400,
          tokensOut: 100,
          costCents: 3,
          unpricedEvents: 0,
        },
      ],
    });
  });

  it("shows no cost at all — not 0 — when no call in the window was priced", async () => {
    const store = new MemoryTelemetry();

    store.usageRows.push({
      org: TELEMETRY_ORG,
      repo: null,
      tokensIn: 10,
      tokensOut: 5,
      costCents: null,
      at: new Date("2026-10-09T00:00:00Z"),
    });
    const result = await new TelemetryResearchTool(store, new MemoryMetrics(), () => NOW).query(
      context(),
      {
        op: "run_series",
        kind: "tokens",
        window: "7d",
      },
    );

    expect(payloadOf(result).totals).toMatchObject({ costCents: null, unpricedEvents: 1 });
    expect(result.sources[0].excerpt).not.toMatch(/¢/);
  });

  it("keeps a repository's usage to that repository's runs", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "run_series",
      kind: "tokens",
      window: "7d",
      repo: REPO,
    });

    // The call that belonged to no run is not this repository's.
    expect(payloadOf(result).totals).toMatchObject({ events: 2 });
  });

  it.each(["runs", "tokens"])("is no data for a window with no %s", async (kind) => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "run_series",
      kind,
      window: "2026-01-01..2026-01-07",
    });

    expect(payloadOf(result)).toMatchObject({
      status: "no_data",
      window: "2026-01-01..2026-01-07",
    });
    expect(payloadOf(result)).not.toHaveProperty("totals");
    expect(payloadOf(result)).not.toHaveProperty("days");
  });

  it("refuses an unknown series", async () => {
    const { tool } = harness();

    await expect(
      tool.query(context(), { op: "run_series", kind: "builds", window: "7d" }),
    ).rejects.toThrow(/"runs" \| "tokens"/);
  });
});

describe("the no-data record", () => {
  it("names the window searched and carries no number — never 0", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "metric_window",
      metric: OVERSHOOT,
      window: "2026-01-01..2026-01-08",
    });

    expect(result.payload).toEqual({
      op: "metric_window",
      metric: OVERSHOOT,
      source: "case_metric",
      status: "no_data",
      window: "2026-01-01..2026-01-08",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-09T00:00:00.000Z",
      reason: `no measurement of ${OVERSHOOT} was taken in 2026-01-01..2026-01-08`,
    });
    expect(numbersIn(result.payload)).toEqual([]);
  });

  it("is a sum that recorded nothing, not the 0 the insights composition gives it", async () => {
    const { tool } = harness();

    // merged_prs is canned for the last 30 days only; any other span answers value null, days 0.
    const result = await tool.query(context(), {
      op: "metric_window",
      metric: "merged_prs",
      window: "2020-01-01..2020-01-07",
    });

    expect(payloadOf(result).status).toBe("no_data");
    expect(numbersIn(result.payload)).toEqual([]);
  });

  it("is still cited: absence is a finding, with the window in its locator", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "metric_window",
      metric: OVERSHOOT,
      window: "2026-01-01..2026-01-08",
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      kind: "telemetry",
      locator: `telemetry://case/${OVERSHOOT_CASE}/overshoot_pct/2026-01-01..2026-01-08`,
      meta: { status: "no_data" },
    });
    expect(result.sources[0].excerpt).toBe(
      `No data — no measurement of ${OVERSHOOT} was taken in 2026-01-01..2026-01-08. Not zero: nothing was measured.`,
    );
  });
});

describe("citations", () => {
  it.each(EVERY_OPERATION)(
    "cites %s as exactly one well-formed telemetry source",
    async (_name, input) => {
      const { tool } = harness();

      const result = await tool.query(context(), input);

      expect(result.sources).toHaveLength(1);
      expect(sourceRecordViolations(result.sources[0])).toEqual([]);
      expect(result.sources[0].kind).toBe("telemetry");
      expect(locatorValid("telemetry", result.sources[0].locator)).toBe(true);
      expect(result.usage).toEqual({ tokens: 0 });
    },
  );

  it.each(EVERY_OPERATION)(
    "writes an absolute window into the locator of %s — never a relative one",
    async (_name, input) => {
      const { tool } = harness();

      const { locator } = (await tool.query(context(), input)).sources[0];

      expect(locator).not.toMatch(/\/[0-9]+[hdw](-vs-|\?|$)/);
      expect(locator).not.toMatch(/-vs-[0-9]+[hdw](\?|$)/);
    },
  );

  it.each(EVERY_OPERATION)("embeds the query of %s in the source's meta", async (_name, input) => {
    const { tool } = harness();

    const source = (await tool.query(context(), input)).sources[0];

    expect(source.meta).toMatchObject({ query: { op: input.op }, status: "ok" });
  });

  it.each(EVERY_OPERATION)(
    "re-runs the locator of %s to the same numbers, a week later",
    async (_name, input) => {
      const { store, metrics } = seededTelemetry();
      const first = await new TelemetryResearchTool(store, metrics, () => NOW).query(
        context(),
        input,
      );
      // The clock has moved on; the data has not.
      const later = new TelemetryResearchTool(
        store,
        metrics,
        () => new Date("2026-10-17T11:00:00Z"),
      );

      const again = await later.fetch(context(), first.sources[0].locator);

      expect(again.payload).toEqual(first.payload);
      expect(again.sources[0].locator).toBe(first.sources[0].locator);
      expect(again.sources[0].contentHash).toBe(first.sources[0].contentHash);
      expect(again.sources[0].retrievedAt).toBe("2026-10-17T11:00:00.000Z");
    },
  );

  it("gives a relative window a different locator on a different day — which is why it is never cited", async () => {
    const input = { op: "metric_window", metric: OVERSHOOT, window: "7d" };
    const today = (await harness().tool.query(context(), input)).sources[0].locator;
    const nextWeek = (await harness(new Date("2026-10-17T02:47:47Z")).tool.query(context(), input))
      .sources[0].locator;

    expect(today).not.toBe(nextWeek);
  });

  it("changes the content hash when the number behind a locator changes", async () => {
    const { store, metrics } = seededTelemetry();
    const tool = new TelemetryResearchTool(store, metrics, () => NOW);
    const before = await tool.query(context(), {
      op: "metric_window",
      metric: OVERSHOOT,
      window: "7d",
    });

    store.measurementRows.push({
      org: TELEMETRY_ORG,
      caseKey: OVERSHOOT_CASE,
      metric: "overshoot_pct",
      repo: REPO,
      value: 9.9,
      unit: "%",
      verdict: "fail",
      at: new Date("2026-10-09T09:00:00Z"),
    });
    const after = await tool.fetch(context(), before.sources[0].locator);

    expect(after.sources[0].locator).toBe(before.sources[0].locator);
    expect(after.sources[0].contentHash).not.toBe(before.sources[0].contentHash);
  });

  it("refuses to re-run a telemetry locator it did not write", async () => {
    const { tool } = harness();

    await expect(
      tool.fetch(context(), "telemetry://fleet.docking_success/30d"),
    ).rejects.toMatchObject({
      errorClass: "unsupported",
    });
    await expect(tool.fetch(context(), "https://example.com/metrics")).rejects.toMatchObject({
      errorClass: "unsupported",
    });
  });
});

describe("the workspace boundary", () => {
  it.each(EVERY_OPERATION)("answers another workspace's %s with no data", async (_name, input) => {
    const { tool } = harness();

    const result = await tool.query(context(OTHER_ORG), input);

    expect(payloadOf(result).status).toBe("no_data");
    // Nothing of the owning workspace's figures crosses: 31 cm, 2.4 %, 98 PRs, 5 runs.
    expect(numbersIn(result.payload)).toEqual([]);
  });

  it("takes the workspace from the call, never from the input", async () => {
    const { tool, metrics } = harness();

    await tool.query(context(OTHER_ORG), {
      op: "metric_window",
      metric: "merge_rate",
      window: "30d",
      organizationId: TELEMETRY_ORG,
    });

    expect(metrics.asked[0].scope.organizationId).toBe(OTHER_ORG);
  });

  it("finds nothing behind a re-run locator in another workspace", async () => {
    const { tool } = harness();
    const mine = await tool.query(context(), {
      op: "metric_window",
      metric: OVERSHOOT,
      window: "7d",
    });

    const theirs = await tool.fetch(context(OTHER_ORG), mine.sources[0].locator);

    expect(payloadOf(theirs).status).toBe("no_data");
  });

  it("finds nothing for a repository the workspace does not have", async () => {
    const { tool } = harness();

    const result = await tool.query(context(), {
      op: "run_series",
      kind: "runs",
      window: "7d",
      repo: "someone/else",
    });

    expect(payloadOf(result).status).toBe("no_data");
  });
});

describe("the tool's card and health", () => {
  it("is the mockup's fifth row, with computed counts", async () => {
    const { tool } = harness();

    expect(tool.slug).toBe("telemetry");
    expect(tool.displayMeta()).toEqual({
      name: "Build & test telemetry",
      glyph: "∿",
      subLine: "{measurements} · {metrics} · {cases}",
    });
    expect(await tool.counts(TELEMETRY_ORG)).toEqual({
      measurements: "16 HIL measurements",
      metrics: "24 insights metrics",
      cases: "1 test case",
    });
  });

  it("phrases one and many", () => {
    expect(subLineOf({ measurements: 1, metrics: 1, cases: 1280, baselines: 0 })).toEqual({
      measurements: "1 HIL measurement",
      metrics: "1 insights metric",
      cases: "1,280 test cases",
    });
  });

  it("requires no configuration — one optional default window — and declares query and fetch", () => {
    const { tool } = harness();
    const schema = tool.configSchema();

    expect(schema.required).toEqual([]);
    expect(Object.keys(schema.properties)).toEqual(["windowDays"]);
    expect(schema.properties.windowDays).toMatchObject({ enum: ["7", "30", "90"], default: "30" });
    expect(tool.capabilities()).toEqual({ search: false, fetch: true, query: true, watch: false });
  });

  it("reads thirty days when an operation names no window, or the workspace's chosen default", async () => {
    const { tool } = harness();

    const unset = await tool.query(context(), { op: "metric_window", metric: "merge_rate" });
    const chosen = await tool.query(
      { ...context(), config: { windowDays: "7" } },
      { op: "run_series", kind: "runs" },
    );
    const unknown = await tool.query(
      { ...context(), config: { windowDays: "400" } },
      { op: "case_history", case: OVERSHOOT_CASE },
    );

    expect(payloadOf(unset).window).toBe("2026-09-11..2026-10-10");
    expect(payloadOf(chosen).window).toBe("2026-10-03T02:47:47Z..2026-10-10T02:47:47Z");
    expect(payloadOf(unknown).window).toBe("2026-09-10T02:47:47Z..2026-10-10T02:47:47Z");
    // Cited absolute, like any other window.
    expect(unset.sources[0].locator).toBe("telemetry://metric/merge_rate/2026-09-11..2026-10-10");
  });

  it("gives compare no default: both of its windows are the question", async () => {
    const { tool } = harness();

    await expect(
      tool.query(context(), { op: "compare", metric: "merge_rate", windowA: "30d" }),
    ).rejects.toMatchObject({ errorClass: "unsupported" });
  });

  it("is healthy with something to read, and says what", async () => {
    const { tool } = harness();

    expect(await tool.healthCheck({}, null, TELEMETRY_ORG)).toEqual({
      state: "healthy",
      detail: "16 HIL measurements · 24 insights metrics · 1 test case",
    });
  });

  it("is not configured when disabled, or when nothing has been measured yet", async () => {
    const { tool } = harness();

    expect((await tool.healthCheck(null, null, TELEMETRY_ORG)).state).toBe("not_configured");
    expect(await tool.healthCheck({}, null, OTHER_ORG)).toEqual({
      state: "not_configured",
      detail: "nothing measured yet — telemetry appears once builds and tests have run",
    });
  });

  it("is degraded without a workspace, and down — never throwing — when the planes cannot be read", async () => {
    const { tool, metrics } = harness();
    const broken = new TelemetryResearchTool(
      { summary: () => Promise.reject(new Error("gone")) } as never,
      metrics,
    );

    expect((await tool.healthCheck({}, null)).state).toBe("degraded");
    expect(await broken.healthCheck({}, null, TELEMETRY_ORG)).toEqual({
      state: "down",
      detail: "the telemetry planes could not be read",
    });
    expect(await broken.counts(TELEMETRY_ORG)).toEqual({
      measurements: null,
      metrics: null,
      cases: null,
    });
  });
});

describe("failures", () => {
  it("refuses an operation it does not have, naming the four it does", async () => {
    const { tool } = harness();

    await expect(tool.query(context(), { op: "forecast" })).rejects.toMatchObject({
      errorClass: "unsupported",
      detail: 'telemetry answers {op: "metric_window" | "case_history" | "run_series" | "compare"}',
    });
    await expect(tool.query(context(), {})).rejects.toThrow(ResearchToolError);
  });

  it.each([
    ["network", Object.assign(new Error("connect"), { code: "ECONNREFUSED" })],
    ["upstream", new Error("relation does not exist")],
  ])("classifies a failed read of the test planes as %s", async (errorClass, failure) => {
    const { metrics } = harness();
    const tool = new TelemetryResearchTool(
      {
        measurements: () => Promise.reject(failure),
        runDays: () => Promise.reject(failure),
      } as never,
      metrics,
      () => NOW,
    );

    await expect(
      tool.query(context(), { op: "metric_window", metric: OVERSHOOT, window: "7d" }),
    ).rejects.toMatchObject({
      errorClass,
    });
    await expect(
      tool.query(context(), { op: "run_series", kind: "runs", window: "7d" }),
    ).rejects.toMatchObject({
      errorClass,
    });
  });

  it("classifies a failed read of the insights plane too, without leaking its message", async () => {
    const { store } = harness();
    const tool = new TelemetryResearchTool(
      store,
      {
        span: () =>
          Promise.reject(new Error("password authentication failed for user ouroboros_app")),
      },
      () => NOW,
    );

    const failure = tool.query(context(), {
      op: "metric_window",
      metric: "merge_rate",
      window: "7d",
    });

    await expect(failure).rejects.toMatchObject({
      errorClass: "upstream",
      detail: "the telemetry planes could not be read",
    });
  });
});
