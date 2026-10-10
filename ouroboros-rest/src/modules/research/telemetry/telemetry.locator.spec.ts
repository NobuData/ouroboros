import { locatorValid } from "../tools/research-tool.citations";
import { ResearchToolError } from "../tools/research-tool.errors";
import {
  MAX_NARROWING_CHARS,
  caseKey,
  locatorOf,
  metricRef,
  narrowing,
  queryOf,
  type TelemetryQuery,
} from "./telemetry.locator";

/**
 * `telemetry://` locators (#619): the citation carries the query, so writing one and reading it
 * back are inverses — and every locator written is one the ledger's rule (V122) accepts.
 */

const CASE = "29f70bbc9eaa22505445bbf2378dc743e5b177119c5a09cdcde73870d0867560";
const MERGE = metricRef("merge_rate");
const HOVER = metricRef(`${CASE}:hover_drift_cm`);

/** Every shape of query, with the locator it is cited by and the input that re-runs it. */
const CASES: readonly [string, TelemetryQuery, string, Record<string, unknown>][] = [
  [
    "an insights metric's window",
    { op: "metric_window", metric: MERGE, window: "2026-09-11..2026-10-10" },
    "telemetry://metric/merge_rate/2026-09-11..2026-10-10",
    { op: "metric_window", metric: "merge_rate", window: "2026-09-11..2026-10-10" },
  ],
  [
    "a narrowed insights metric",
    {
      op: "metric_window",
      metric: metricRef("build_duration"),
      window: "2026-10-04..2026-10-10",
      repo: "acme-robotics/helios-firmware",
      dimension: "zephyr build",
    },
    "telemetry://metric/build_duration/2026-10-04..2026-10-10?dimension=zephyr%20build&repo=acme-robotics%2Fhelios-firmware",
    {
      op: "metric_window",
      metric: "build_duration",
      window: "2026-10-04..2026-10-10",
      repo: "acme-robotics/helios-firmware",
      dimension: "zephyr build",
    },
  ],
  [
    "a case metric's window",
    { op: "metric_window", metric: HOVER, window: "2026-10-03T02:47:47Z..2026-10-10T02:47:47Z" },
    `telemetry://case/${CASE}/hover_drift_cm/2026-10-03T02:47:47Z..2026-10-10T02:47:47Z`,
    {
      op: "metric_window",
      metric: `${CASE}:hover_drift_cm`,
      window: "2026-10-03T02:47:47Z..2026-10-10T02:47:47Z",
    },
  ],
  [
    "a baseline window",
    { op: "metric_window", metric: HOVER, window: "baseline:v2.0.4" },
    `telemetry://case/${CASE}/hover_drift_cm/baseline:v2.0.4`,
    { op: "metric_window", metric: `${CASE}:hover_drift_cm`, window: "baseline:v2.0.4" },
  ],
  [
    "the watch's comparison — a baseline against a window",
    {
      op: "compare",
      metric: HOVER,
      windowA: "baseline:v2.0.4",
      windowB: "2026-10-03T02:47:47Z..2026-10-10T02:47:47Z",
    },
    `telemetry://case/${CASE}/hover_drift_cm/baseline:v2.0.4-vs-2026-10-03T02:47:47Z..2026-10-10T02:47:47Z`,
    {
      op: "compare",
      metric: `${CASE}:hover_drift_cm`,
      windowA: "baseline:v2.0.4",
      windowB: "2026-10-03T02:47:47Z..2026-10-10T02:47:47Z",
    },
  ],
  [
    "two windows of an insights metric",
    {
      op: "compare",
      metric: MERGE,
      windowA: "2026-08-11..2026-09-09",
      windowB: "2026-09-11..2026-10-10",
    },
    "telemetry://metric/merge_rate/2026-08-11..2026-09-09-vs-2026-09-11..2026-10-10",
    {
      op: "compare",
      metric: "merge_rate",
      windowA: "2026-08-11..2026-09-09",
      windowB: "2026-09-11..2026-10-10",
    },
  ],
  [
    "two baselines, one a release candidate",
    { op: "compare", metric: MERGE, windowA: "baseline:v2.0.4", windowB: "baseline:v2.1.0-rc1" },
    "telemetry://metric/merge_rate/baseline:v2.0.4-vs-baseline:v2.1.0-rc1",
    {
      op: "compare",
      metric: "merge_rate",
      windowA: "baseline:v2.0.4",
      windowB: "baseline:v2.1.0-rc1",
    },
  ],
  [
    "a case's history",
    {
      op: "case_history",
      subject: { kind: "case", caseKey: CASE },
      window: "2026-09-10..2026-10-10",
    },
    `telemetry://history/case/${CASE}/2026-09-10..2026-10-10`,
    { op: "case_history", case: CASE, window: "2026-09-10..2026-10-10" },
  ],
  [
    "a suite's history, its name encoded",
    {
      op: "case_history",
      subject: { kind: "suite", suite: "PHYSICAL · HIL rig" },
      window: "2026-09-10..2026-10-10",
      repo: "acme-robotics/helios-firmware",
    },
    "telemetry://history/suite/2026-09-10..2026-10-10?repo=acme-robotics%2Fhelios-firmware&suite=PHYSICAL%20%C2%B7%20HIL%20rig",
    {
      op: "case_history",
      suite: "PHYSICAL · HIL rig",
      window: "2026-09-10..2026-10-10",
      repo: "acme-robotics/helios-firmware",
    },
  ],
  [
    "a run series",
    {
      op: "run_series",
      kind: "tokens",
      window: "2026-10-08..2026-10-10",
      repo: "acme-robotics/helios-firmware",
    },
    "telemetry://runs/tokens/2026-10-08..2026-10-10?repo=acme-robotics%2Fhelios-firmware",
    {
      op: "run_series",
      kind: "tokens",
      window: "2026-10-08..2026-10-10",
      repo: "acme-robotics/helios-firmware",
    },
  ],
];

describe("writing a locator", () => {
  it.each(CASES)("cites %s", (_what, query, locator) => {
    expect(locatorOf(query)).toBe(locator);
  });

  it.each(CASES)("writes a locator the ledger accepts for %s", (_what, query) => {
    expect(locatorValid("telemetry", locatorOf(query))).toBe(true);
  });

  it("encodes everything the locator's character set leaves out", () => {
    const locator = locatorOf({
      op: "case_history",
      subject: { kind: "suite", suite: "it's (all) fine! *really* & 100% a=b?" },
      window: "2026-09-10..2026-10-10",
    });

    expect(locatorValid("telemetry", locator)).toBe(true);
    expect(queryOf(locator)).toMatchObject({ suite: "it's (all) fine! *really* & 100% a=b?" });
  });

  it("encodes a release tag the locator's character set cannot hold", () => {
    const locator = locatorOf({
      op: "metric_window",
      metric: MERGE,
      window: "baseline:release/2.0 (final)",
    });

    expect(locator).toBe("telemetry://metric/merge_rate/baseline:release%2F2.0%20%28final%29");
    expect(locatorValid("telemetry", locator)).toBe(true);
    expect(queryOf(locator)).toMatchObject({ window: "baseline:release/2.0 (final)" });
  });

  it("refuses to cite a tag containing the separator, rather than write a locator that splits wrongly", () => {
    expect(() =>
      locatorOf({
        op: "compare",
        metric: MERGE,
        windowA: "baseline:a-vs-b",
        windowB: "2026-09-11..2026-10-10",
      }),
    ).toThrow(/cannot be cited/);
  });

  it("sorts the narrowing keys, so one query has one locator", () => {
    const a = locatorOf({
      op: "metric_window",
      metric: MERGE,
      window: "2026-09-11..2026-10-10",
      repo: "o/r",
      dimension: "d",
    });
    const b = locatorOf({
      op: "metric_window",
      metric: MERGE,
      window: "2026-09-11..2026-10-10",
      dimension: "d",
      repo: "o/r",
    });

    expect(a).toBe(b);
  });
});

describe("reading a locator back", () => {
  it.each(CASES)("recovers the query of %s", (_what, _query, locator, input) => {
    expect(queryOf(locator)).toEqual(input);
  });

  it.each([
    ["a seeded, hand-written telemetry citation", "telemetry://fleet.docking_success/30d"],
    ["another scheme", "git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214"],
    ["an unknown path", "telemetry://warehouse/fleet/2026-09-11..2026-10-10"],
    ["a third window", "telemetry://metric/merge_rate/7d-vs-7d-vs-7d"],
    ["an empty window", "telemetry://metric/merge_rate/"],
    ["an unknown narrowing key", "telemetry://metric/merge_rate/2026-09-11..2026-10-10?org=other"],
    ["a key with no value sign", "telemetry://metric/merge_rate/2026-09-11..2026-10-10?repo"],
    ["a malformed encoding", "telemetry://metric/merge_rate/2026-09-11..2026-10-10?repo=%E0%A4%A"],
    ["two query strings", "telemetry://metric/merge_rate/2026-09-11..2026-10-10?repo=a?repo=b"],
    ["a suite on a metric", "telemetry://metric/merge_rate/2026-09-11..2026-10-10?suite=x"],
    [
      "a dimension on a history",
      "telemetry://history/suite/2026-09-11..2026-10-10?suite=x&dimension=y",
    ],
    ["a compared history", "telemetry://runs/runs/7d-vs-7d"],
    ["a suite history with no suite", "telemetry://history/suite/2026-09-11..2026-10-10"],
    [
      "an over-long locator",
      `telemetry://metric/merge_rate/2026-09-11..2026-10-10?repo=${"a".repeat(2048)}`,
    ],
  ])("refuses %s as unsupported", (_what, locator) => {
    expect(() => queryOf(locator)).toThrow(ResearchToolError);
    try {
      queryOf(locator);
    } catch (error) {
      expect((error as ResearchToolError).errorClass).toBe("unsupported");
    }
  });

  it("never reads a workspace out of a locator — there is nowhere in one to put it", () => {
    for (const [, , locator] of CASES) {
      expect(Object.keys(queryOf(locator))).not.toContain("organizationId");
    }
  });
});

describe("a metric key", () => {
  it("reads an insights metric id and a case metric", () => {
    expect(metricRef("merge_rate")).toEqual({
      source: "bi_metric",
      key: "merge_rate",
      metricId: "merge_rate",
    });
    expect(metricRef(`${CASE}:hover_drift_cm`)).toEqual({
      source: "case_metric",
      key: `${CASE}:hover_drift_cm`,
      caseKey: CASE,
      measurement: "hover_drift_cm",
    });
  });

  it.each([
    undefined,
    null,
    7,
    "",
    "Merge_Rate",
    "merge rate",
    "merge-rate",
    `${CASE}:`,
    `${CASE.slice(1)}:x`,
    `${CASE}:Hover`,
    "fleet.docking_success",
  ])("refuses %p", (key) => {
    expect(() => metricRef(key)).toThrow(/a metric is an insights metric id/);
  });
});

describe("the small inputs", () => {
  it("reads a case key, and refuses anything else", () => {
    expect(caseKey(CASE)).toBe(CASE);
    expect(() => caseKey(CASE.toUpperCase())).toThrow(/64-hex case key/);
    expect(() => caseKey("dock_suite")).toThrow(ResearchToolError);
    expect(() => caseKey(undefined)).toThrow(ResearchToolError);
  });

  it("reads an optional narrowing value", () => {
    expect(narrowing(undefined, "a repository")).toBeUndefined();
    expect(narrowing(null, "a repository")).toBeUndefined();
    expect(narrowing("acme/helios", "a repository")).toBe("acme/helios");
    expect(() => narrowing("  ", "a repository")).toThrow(/a repository is a non-blank string/);
    expect(() => narrowing(7, "a suite")).toThrow(/a suite is a non-blank string/);
    expect(() => narrowing("x".repeat(MAX_NARROWING_CHARS + 1), "a dimension")).toThrow(
      ResearchToolError,
    );
  });
});
