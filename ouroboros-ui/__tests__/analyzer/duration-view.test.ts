import { describe, expect, it } from "vitest";

import type { ChangePoint } from "@/app/api/analyzer";
import {
  ATTRIBUTED_HEADING,
  EVIDENCE_UNAVAILABLE,
  MAX_CHIP_NAME,
  NO_DURATION_RUN,
  NO_DURATION_SERIES,
  NO_WINDOW,
  UNATTRIBUTED_NAME,
  candidateRows,
  changeSentence,
  changeTone,
  chipDescription,
  chipLabel,
  chipName,
  confidenceLines,
  deltaText,
  durationAxis,
  durationChartLabel,
  durationEmpty,
  tooFewDays,
  durationMarkers,
  durationPoints,
  durationSpan,
  durationTicks,
  durationTitle,
  evidenceLink,
  evidenceLinks,
  isUnattributed,
  markerIndex,
  offsetPhrase,
  scoreText,
  segmentLine,
  sheetEyebrow,
  shiftDay,
  topCandidate,
  windowLine,
} from "@/app/analyzer/duration-view";

import { emptyDuration, evidenceOf, seededChangePoints, seededDay, seededDuration } from "../helpers/analyzer";

/**
 * Every decision the annotated duration chart makes (#517), as values: a chip is a finding and its
 * tint is the sign of the finding's delta; the top candidate is a ranking's first row, never a
 * cause; and every evidence reference opens on the surface it resolves to, or says it cannot.
 */

const [ZEPHYR, CCACHE, TWISTER] = seededChangePoints() as [ChangePoint, ChangePoint, ChangePoint];

/** The seeded change-point with one field replaced. */
function ccache(over: Partial<ChangePoint> = {}): ChangePoint {
  return { ...CCACHE, ...over };
}

describe("durations", () => {
  it("are written as spans, never as seconds", () => {
    expect(durationSpan(252)).toBe("4m 12s");
    expect(durationSpan(180)).toBe("3m");
    expect(durationSpan(40)).toBe("40s");
    expect(durationSpan(3725)).toBe("1h 02m 05s");
  });

  it("round to the nearest second rather than truncating a half", () => {
    expect(durationSpan(341.5)).toBe("5m 42s");
    expect(durationSpan(341.4)).toBe("5m 41s");
  });

  it("sign a delta the way the mockup's chips do, with a true minus", () => {
    expect(deltaText(90)).toBe("+1m 30s");
    expect(deltaText(-130)).toBe("−2m 10s");
    expect(deltaText(40)).toBe("+40s");
  });
});

describe("a chip's tint", () => {
  it("is the delta's sign: slower is a warning, faster is good news", () => {
    expect(changeTone(90)).toBe("warn");
    expect(changeTone(-130)).toBe("ok");
  });

  it("is never a warning for an improvement, whatever its candidate is called", () => {
    const alarming = ccache({
      candidates: [{ ...CCACHE.candidates[0]!, label: "WARNING: regression — build slower, failure" }],
    });
    const [marker] = durationMarkers(seededDuration({ changePoints: [alarming] }));

    expect(marker!.tone).toBe("ok");
  });

  it("is never good news for a regression, whatever its candidate is called", () => {
    const soothing = { ...ZEPHYR, candidates: [{ ...ZEPHYR.candidates[0]!, label: "speed-up: faster builds, improvement" }] };
    const [marker] = durationMarkers(seededDuration({ changePoints: [soothing] }));

    expect(marker!.tone).toBe("warn");
  });
});

describe("a chip's text", () => {
  it("is the date, the top candidate and the delta — the mockup's three, on the seed's days", () => {
    expect(seededChangePoints().map(chipLabel)).toEqual([
      "Jul 12 · Zephyr 4.1 migration +1m 30s",
      "Aug 16 · ccache enabled −2m 10s",
      "Sep 23 · twister suite growth +40s",
    ]);
  });

  it("names the first of the ranked candidates, not the best-sounding one", () => {
    expect(topCandidate(ZEPHYR)?.label).toBe("Zephyr 4.1 migration");
    expect(topCandidate({ candidates: [] })).toBeNull();
  });

  it("cuts a long candidate name, and never the date or the delta", () => {
    const long = "Motor PID: clamp the integral term on saturation";
    const label = chipLabel(ccache({ candidates: [{ ...CCACHE.candidates[0]!, label: long }] }));

    expect(chipName(long)).toBe("Motor PID: clamp the integr…");
    expect([...chipName(long)]).toHaveLength(MAX_CHIP_NAME);
    expect(label).toBe("Aug 16 · Motor PID: clamp the integr… −2m 10s");
    expect(chipName("ccache enabled")).toBe("ccache enabled");
    expect(chipName("x".repeat(MAX_CHIP_NAME))).toBe("x".repeat(MAX_CHIP_NAME));
  });

  it("says a shift nothing recorded explains is unattributed, rather than borrowing a cause", () => {
    const orphan = ccache({
      candidates: [
        {
          label: "no recorded change within ±3 days",
          score: 0,
          eventKind: null,
          date: CCACHE.date,
          daysFromBreakpoint: 0,
          proximity: 0,
          prior: 0,
          ref: { kind: "build", id: "b" },
        },
      ],
    });

    expect(isUnattributed(orphan.candidates[0]!)).toBe(true);
    expect(isUnattributed(CCACHE.candidates[0]!)).toBe(false);
    expect(chipLabel(orphan)).toBe(`Aug 16 · ${UNATTRIBUTED_NAME} −2m 10s`);
    expect(chipDescription(orphan)).toBe(
      "Build duration fell by 2m 10s on Aug 16. No recorded change in the attribution window. Opens the details.",
    );
  });
});

describe("what a screen reader is told about a change-point", () => {
  it("is its date, direction, magnitude and top candidate, in words", () => {
    expect(changeSentence(ZEPHYR)).toBe("Build duration rose by 1m 30s on Jul 12");
    expect(changeSentence(CCACHE)).toBe("Build duration fell by 2m 10s on Aug 16");
    expect(chipDescription(ZEPHYR)).toBe(
      "Build duration rose by 1m 30s on Jul 12. Top candidate: Zephyr 4.1 migration. Opens the details.",
    );
  });

  it("names the top candidate in full even where the chip cut it", () => {
    const long = "Tune the brown-out threshold for writes during flashing";
    const point = ccache({ candidates: [{ ...CCACHE.candidates[0]!, label: long }] });

    expect(chipLabel(point)).not.toContain(long);
    expect(chipDescription(point)).toContain(`Top candidate: ${long}.`);
  });
});

describe("the markers", () => {
  it("are the findings, one each, at the day each was detected on", () => {
    const chart = seededDuration();
    const markers = durationMarkers(chart);

    expect(markers.map((marker) => [marker.id, chart.series[marker.index]!.day, marker.tone])).toEqual([
      [ZEPHYR.id, "2026-07-12", "warn"],
      [CCACHE.id, "2026-08-16", "ok"],
      [TWISTER.id, "2026-09-23", "warn"],
    ]);
  });

  it("are none when there are no findings — a curve alone draws no chip", () => {
    expect(durationMarkers(seededDuration({ changePoints: [] }))).toEqual([]);
  });

  it("change when a finding changes", () => {
    const moved = { ...CCACHE, date: seededDay(50), deltaSeconds: -45 };
    const [marker] = durationMarkers(seededDuration({ changePoints: [moved] }));

    expect(marker).toMatchObject({ index: 50, label: "Aug 24 · ccache enabled −45s", tone: "ok" });
  });

  it("sit on the first day with builds after a day the series skipped", () => {
    const chart = seededDuration();
    const gapped = { ...chart, series: chart.series.filter((day) => day.day !== "2026-08-16") };

    expect(markerIndex(gapped.series, "2026-08-16")).toBe(42);
    expect(gapped.series[42]!.day).toBe("2026-08-17");
  });

  it("leave out a finding the series does not reach, rather than pinning it to the last day", () => {
    const late = { ...CCACHE, date: "2026-12-25" };

    expect(markerIndex(seededDuration().series, "2026-12-25")).toBe(-1);
    expect(durationMarkers(seededDuration({ changePoints: [late] }))).toEqual([]);
  });
});

describe("the chart's body", () => {
  it("gives every day its median and its builds in the tooltip", () => {
    const [first] = durationPoints(seededDuration().series);

    expect(first).toEqual({ label: "Jul 5", value: 252, meta: "4m 12s median · 9 builds" });
  });

  it("labels the y-axis in whole minutes around the data, as the mockup's 3m to 6m", () => {
    const axis = durationAxis(seededDuration().series.map((day) => day.medianSeconds))!;

    expect([axis.min, axis.max]).toEqual([180, 360]);
    expect(axis.ticks.map((tick) => axis.format!(tick))).toEqual(["3m", "4m", "5m", "6m"]);
  });

  it("counts in a step that fits the range — seconds for a quick build, hours for a long one", () => {
    expect(durationAxis([12, 14, 19])!.ticks.map(durationSpan)).toEqual(["12s", "14s", "16s", "18s", "20s"]);
    expect(durationAxis([3_000, 9_000])!.ticks.map(durationSpan)).toEqual([
      "30m",
      "1h",
      "1h 30m",
      "2h",
      "2h 30m",
    ]);
  });

  it("gives a flat series a plot with height without magnifying it, and an empty one no axis", () => {
    expect(durationAxis([240, 240])).toMatchObject({ min: 240, max: 255, ticks: [240, 255] });
    // A series that wobbles by a second is still drawn against steps of its own size.
    expect(durationAxis([251, 252, 253])).toMatchObject({ min: 240, max: 255 });
    expect(durationAxis([])).toBeUndefined();
    expect(durationAxis([Number.NaN])).toBeUndefined();
  });

  it("labels four evenly spaced days, the first and the last always", () => {
    expect(durationTicks(89)).toEqual([0, 29, 59, 88]);
    expect(durationTicks(2)).toEqual([0, 1]);
    expect(durationTicks(1)).toEqual([0]);
    expect(durationTicks(0)).toEqual([]);
  });

  it("summarises the series for the image's name: what, when, its range, its end and the shifts", () => {
    expect(durationChartLabel(seededDuration())).toBe(
      "Median zephyr build duration per day, Jul 5 – Oct 1: between 3m 21s and 5m 53s, ending at 4m 05s. 3 detected change-points.",
    );
    expect(durationChartLabel(seededDuration({ changePoints: [], durationLabel: null }))).toBe(
      "Median build duration per day, Jul 5 – Oct 1: between 3m 21s and 5m 53s, ending at 4m 05s. No change-points detected.",
    );
    expect(durationChartLabel(seededDuration({ changePoints: [CCACHE] }))).toContain("1 detected change-point.");
  });
});

describe("the card's frame", () => {
  it("is titled with the run's own window, ninety days before any run says", () => {
    expect(durationTitle(seededDuration())).toBe("Build duration · 90 days, with detected change-points");
    expect(durationTitle(null)).toBe("Build duration · 90 days, with detected change-points");
    expect(durationTitle(seededDuration({ window: { from: "2026-09-02", to: "2026-10-01", days: 30 } }))).toBe(
      "Build duration · 30 days, with detected change-points",
    );
  });

  it("says why there is no chart: no analysis yet, or nothing was timed", () => {
    expect(durationEmpty(emptyDuration())).toBe(NO_DURATION_RUN);
    expect(durationEmpty(seededDuration({ series: [], changePoints: [] }))).toBe(NO_DURATION_SERIES);
    expect(durationEmpty(seededDuration())).toBeNull();
  });

  it("draws no curve from fewer timed days than the floor — and says how many there were (#521)", () => {
    const days = (count: number) => seededDuration({ series: seededDuration().series.slice(0, count), changePoints: [] });

    expect(durationEmpty(days(6), 10)).toEqual(tooFewDays(6, 10));
    expect(durationEmpty(days(9), 10)).toEqual(tooFewDays(9, 10));
    expect(durationEmpty(days(10), 10)).toBeNull();
    expect(tooFewDays(1, 10)).toEqual({
      title: "Too few days to chart",
      note: "The last analysis timed builds on 1 day. A curve, and a shift detected in it, need at least 10.",
    });
  });

  it("holds no floor of its own: without one, whatever was timed is drawn", () => {
    const three = seededDuration({ series: seededDuration().series.slice(0, 3), changePoints: [] });

    expect(durationEmpty(three)).toBeNull();
    // The older reasons still come first: no run, and a run that timed nothing.
    expect(durationEmpty(emptyDuration(), 10)).toBe(NO_DURATION_RUN);
    expect(durationEmpty(seededDuration({ series: [], changePoints: [] }), 10)).toBe(NO_DURATION_SERIES);
  });
});

describe("the Details sheet", () => {
  it("heads the top candidate honestly", () => {
    expect(ATTRIBUTED_HEADING).toBe("Attributed to (top candidate)");
    expect(sheetEyebrow(CCACHE)).toBe("Change-point · Aug 16");
  });

  it("lists every candidate in rank order, each with its score and the score's factors", () => {
    expect(candidateRows(ZEPHYR).map((row) => [row.rank, row.label, row.score, row.kind, row.when, row.factors])).toEqual([
      [1, "Zephyr 4.1 migration", "0.70", "merge", "Jul 12 · same day", "proximity 1.00 × prior 0.70"],
      [2, "pool-a image zephyr-sdk:0.16", "0.30", "infrastructure change", "Jul 10 · 2 days before", "proximity 0.50 × prior 0.60"],
      [3, "standard-fix v5", "0.20", "workflow version", "Jul 10 · 2 days before", "proximity 0.50 × prior 0.40"],
      [4, "docs: README typo", "0.175", "merge", "Jul 15 · 3 days after", "proximity 0.25 × prior 0.70"],
    ]);
  });

  it("keeps a score to the precision the analyzer kept", () => {
    expect(scoreText(0.7)).toBe("0.70");
    expect(scoreText(0.175)).toBe("0.175");
    expect(scoreText(0.525)).toBe("0.525");
    expect(scoreText(1)).toBe("1.00");
    expect(scoreText(0)).toBe("0.00");
  });

  it("says how far from the breakpoint each candidate happened", () => {
    expect(offsetPhrase(0)).toBe("same day");
    expect(offsetPhrase(-1)).toBe("1 day before");
    expect(offsetPhrase(3)).toBe("3 days after");
  });

  it("draws what a finding did not record as absent, never as a zero", () => {
    const bare = ccache({
      candidates: [
        {
          label: "a merge",
          score: 0.5,
          eventKind: null,
          date: null,
          daysFromBreakpoint: null,
          proximity: null,
          prior: null,
          ref: { kind: "merge", id: "feedbee" },
        },
      ],
    });

    expect(candidateRows(bare)[0]).toMatchObject({ kind: null, when: null, factors: null, link: null, unattributed: false });
  });

  it("names a kind of change it has no word for by its own name", () => {
    const novel = ccache({ candidates: [{ ...CCACHE.candidates[0]!, eventKind: "toolchain_bump" }] });

    expect(candidateRows(novel)[0]!.kind).toBe("toolchain bump");
  });

  it("states the attribution window as days either side, with its dates", () => {
    expect(windowLine(CCACHE)).toBe("±3 days · Aug 13 – Aug 19");
    expect(windowLine(ccache({ attributionWindowDays: 1 }))).toBe("±1 day · Aug 15 – Aug 17");
    expect(windowLine(ccache({ attributionWindowDays: null }))).toBe(NO_WINDOW);
  });

  it("moves a day across a month's end by the calendar, in UTC", () => {
    expect(shiftDay("2026-07-01", -3)).toBe("2026-06-28");
    expect(shiftDay("2026-12-30", 3)).toBe("2027-01-02");
    expect(shiftDay("not a day", 3)).toBe("not a day");
  });

  it("gives the two segment medians, or nothing when the finding kept neither", () => {
    expect(segmentLine(CCACHE)).toBe("5m 42s before → 3m 32s after");
    expect(segmentLine(ccache({ beforeMedianSeconds: null }))).toBeNull();
  });

  it("spells out the confidence's basis from what the finding recorded", () => {
    expect(confidenceLines(ZEPHYR)).toEqual([
      "370 builds in the two segments either side of the shift.",
      "The shift is 12.1× the day-to-day noise within those segments.",
      "100.0% of their days sit on their own segment's side of the midpoint between the two levels.",
    ]);
    expect(
      confidenceLines({ confidenceBasis: { method: null, sampleSize: null, effectSize: null, stability: null } }),
    ).toEqual([]);
  });
});

describe("evidence references", () => {
  it("open a merge with a mirrored PR on the PR page, keeping Build Farm lit", () => {
    const link = evidenceLink(
      evidenceOf("merge", "d8cdc9341c99f8e778d787d92d105107526073fa", "ccache enabled", {
        surface: "pull_request",
        pullRequestId: "5eed003a-0000-4000-8000-000000000514",
      }),
    );

    expect(link).toMatchObject({
      kind: "Merge",
      name: "ccache enabled",
      detail: "d8cdc93",
      href: "/prs/5eed003a-0000-4000-8000-000000000514?from=build-farm",
      destination: "Pull request",
    });
  });

  it("open a workflow version in the workflow studio — the config surface", () => {
    expect(evidenceLink(CCACHE.evidence[2]!)).toMatchObject({
      kind: "Workflow version",
      name: "standard-fix v9",
      href: "/workflows/standard-fix",
      destination: "Workflows",
    });
  });

  it("open a build and an unmirrored merge on the farm, a pool on its pools card, a runner on its runners card", () => {
    expect(evidenceLink(CCACHE.evidence[3]!)).toMatchObject({
      kind: "Build",
      name: "#10623 · zephyr build",
      detail: null,
      href: "/build-farm",
      destination: "Build Farm",
    });
    expect(evidenceLink(CCACHE.evidence[0]!)).toMatchObject({ kind: "Merge", href: "/build-farm", detail: "d8cdc93" });
    expect(evidenceLink(ZEPHYR.evidence[1]!)).toMatchObject({
      kind: "Runner pool",
      name: "pool-a",
      href: "/build-farm#pools-card-title",
    });
    expect(evidenceLink(evidenceOf("runner", "5eed0025-0000-4000-8000-000000000002", "forge-02")).href).toBe(
      "/build-farm#runners-card-title",
    );
  });

  it("open a test run, a test case and an unmirrored waiver on their loop's test results (#518)", () => {
    const run = "5eed0009-0000-4000-8000-000000000479";

    expect(
      evidenceLink(evidenceOf("test_run", "5eed0031-0000-4000-8000-000000000003", "Build 3", {
        surface: "test_results",
        runId: run,
        attempt: 3,
      })),
    ).toMatchObject({
      kind: "Test run",
      name: "Build 3",
      href: `/runs/${run}/tests?from=build-farm&attempt=3`,
      destination: "Test results",
    });
    expect(
      evidenceLink(evidenceOf("test_case", "5eed0033-0000-4000-8000-000000000001", "ring buffer drains under burst", {
        surface: "test_results",
        runId: run,
        attempt: 3,
        suiteName: "telemetry integration",
        caseName: "ring buffer drains under burst",
      })).href,
    ).toBe(`/runs/${run}/tests?from=build-farm&attempt=3&suite=telemetry+integration&case=ring+buffer+drains+under+burst`);
    expect(
      evidenceLink(evidenceOf("waiver", "5eed006d-0000-4000-8000-000000003401", "No thermal chamber", {
        surface: "test_results",
        runId: run,
      })),
    ).toMatchObject({ kind: "Waiver", href: `/runs/${run}/tests?from=build-farm`, destination: "Test results" });
  });

  it("open a waiver on the pull request it waived a criterion of, when the mirror has it (#518)", () => {
    expect(
      evidenceLink(evidenceOf("waiver", "5eed006d-0000-4000-8000-000000003401", "No thermal chamber", {
        surface: "pull_request",
        pullRequestId: "5eed003a-0000-4000-8000-000000000514",
      })),
    ).toMatchObject({
      kind: "Waiver",
      name: "No thermal chamber",
      detail: null,
      href: "/prs/5eed003a-0000-4000-8000-000000000514?from=build-farm",
      destination: "Pull request",
    });
  });

  it("never link test results the service did not address with a loop", () => {
    const halfResolved = evidenceOf("test_case", "5eed0033-0000-4000-8000-000000000001", "a case", {
      surface: "test_results",
      runId: null,
    });

    expect(evidenceLink(halfResolved)).toMatchObject({ href: null, destination: EVIDENCE_UNAVAILABLE });
  });

  it("open nothing for a reference whose row is gone, and say so by its id", () => {
    expect(evidenceLink(evidenceOf("build", "5eed0062-0000-4000-8000-000000010623", null))).toEqual({
      key: "build:5eed0062-0000-4000-8000-000000010623",
      kind: "Build",
      name: "5eed0062",
      detail: null,
      href: null,
      destination: EVIDENCE_UNAVAILABLE,
    });
    expect(evidenceLink(evidenceOf("merge", "d8cdc9341c99f8e778d787d92d105107526073fa", null))).toMatchObject({
      name: "d8cdc93",
      detail: null,
      href: null,
    });
  });

  it("never link a surface the service did not address", () => {
    const halfResolved = evidenceOf("merge", "d8cdc93", "ccache enabled", { surface: "pull_request", pullRequestId: null });

    expect(evidenceLink(halfResolved).href).toBeNull();
    expect(evidenceLink(evidenceOf("workflow_version", "v", "x v1", { surface: "workflow" })).href).toBeNull();
  });

  it("are listed in the finding's own order, and each candidate links to the one it cites", () => {
    expect(evidenceLinks(ZEPHYR).map((link) => link.kind)).toEqual([
      "Merge",
      "Runner pool",
      "Workflow version",
      "Merge",
      "Build",
      "Build",
    ]);
    expect(candidateRows(ZEPHYR).map((row) => row.link?.href)).toEqual([
      "/build-farm",
      "/build-farm#pools-card-title",
      "/workflows/standard-fix",
      "/build-farm",
    ]);
  });
});
