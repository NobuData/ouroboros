import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DURATION_ANCHOR, chipLabel } from "@/app/analyzer/duration-view";
import {
  CONFOUNDS_HEADING,
  CORRELATE_LINE,
  DEFAULT_WINDOW_DAYS,
  INGEST_BEFORE_A_RUN,
  LOCALITY_NOTE,
  LOCALITY_URL,
  MEASUREMENTS_ANCHOR,
  NONE_IN_WINDOW,
  PENDING_CONFOUNDS_HEADING,
  RETRAINS_WORD,
  STEPS,
  SYNTHESIZE_LINE,
  appliedLabel,
  captionParts,
  confoundItems,
  ingestLine,
  measuredText,
  measurementAnchor,
  measurementRows,
  pendingNote,
  predictedText,
  recalibrationCells,
  rowNote,
  targetText,
  verdictTone,
  verdictWord,
  windowDays,
} from "@/app/analyzer/measurements-view";
import { MEASUREMENTS_ANCHOR as SUGGESTIONS_ANCHOR } from "@/app/analyzer/suggestions-view";
import type { AnalysisManifest, Measurement } from "@/app/api/analyzer";
import { SECURITY_MODEL_URL } from "@/app/providers/view";

import { seededDuration, seededRun } from "../helpers/analyzer";
import {
  CONFOUNDED_NOTE,
  DELIVERED_ID,
  UNDER_ID,
  confoundedMeasurement,
  measurementsWith,
  noMeasurements,
  pendingMeasurement,
  seededMeasurement,
  seededMeasurements,
} from "../helpers/analyzer-measurements";

/**
 * The accountability cards' decisions (#520), each on a small value: the rows' order and their two
 * lines, how each verdict is treated — a miss as plainly as a win, a confound as neither — what
 * interfered and where it links, the recalibration cells as the service holds them, and the
 * ingest line as the newest run's manifest states it.
 */

/** The seeded run's manifest. */
function manifest(over: Partial<AnalysisManifest> = {}): AnalysisManifest {
  return { ...seededRun().manifest!, ...over };
}

/** The seeded chart's first change-point. */
const POINT = seededDuration().changePoints[0]!;

describe("the rows", () => {
  it("lists the oldest apply first, as the mockup orders its pair, without touching the answer", () => {
    const answer = seededMeasurements();
    const before = structuredClone(answer);

    expect(measurementRows(answer).map((row) => row.title)).toEqual(["Test-suite split", "ccache warm-up"]);
    expect(answer).toEqual(before);
  });

  it("puts a suggestion applied later last, whatever order the service answers in", () => {
    const rows = [seededMeasurement(UNDER_ID), pendingMeasurement(), seededMeasurement(DELIVERED_ID)];

    expect(measurementRows({ measurements: rows }).map((row) => row.title)).toEqual([
      "Test-suite split",
      "ccache warm-up",
      "Shift pool-a's weekday autoscale floor",
    ]);
  });

  it("has nothing to list where nothing was applied", () => {
    expect(measurementRows(noMeasurements())).toEqual([]);
  });

  it("gives each row an id of its own, and the card the anchor an applied suggestion links to", () => {
    expect(measurementAnchor(UNDER_ID)).toBe(`measurement-${UNDER_ID}`);
    expect(MEASUREMENTS_ANCHOR).toBe("predicted-vs-measured");
    expect(MEASUREMENTS_ANCHOR).toBe(SUGGESTIONS_ANCHOR);
  });

  it("says when each was applied, as the mockup's parenthesis does", () => {
    expect(appliedLabel(seededMeasurement(DELIVERED_ID))).toBe("(applied Aug 26)");
    expect(appliedLabel(seededMeasurement(UNDER_ID))).toBe("(applied Sep 2)");
  });
});

describe("the predicted and measured lines", () => {
  it("writes the seeded pair's figures as the mockup does", () => {
    const delivered = seededMeasurement(DELIVERED_ID);
    const under = seededMeasurement(UNDER_ID);

    expect(predictedText(delivered)).toBe("−3m 40s");
    expect(measuredText(delivered)).toBe("−3m 55s");
    expect(predictedText(under)).toBe("−1m 50s");
    expect(measuredText(under)).toBe("−1m 12s");
  });

  it("writes both lines in the prediction's own unit", () => {
    const interventions = seededMeasurement(DELIVERED_ID, {
      predicted: { ...seededMeasurement(DELIVERED_ID).predicted, unit: "interventions", delta: -2 },
      measured: { ...seededMeasurement(DELIVERED_ID).measured!, delta: -1 },
    });

    expect(predictedText(interventions)).toBe("−2 interventions");
    expect(measuredText(interventions)).toBe("−1 intervention");
  });

  it("shows a change for the worse with its sign — a measured rise is never flattened", () => {
    const worse = seededMeasurement(UNDER_ID, { measured: { ...seededMeasurement(UNDER_ID).measured!, delta: 18 } });

    expect(measuredText(worse)).toBe("+18s");
  });

  it("shows how far a pending measurement is through its own window, not a figure", () => {
    expect(measuredText(pendingMeasurement())).toBe("day 3 of 14");
    expect(measuredText(pendingMeasurement({ day: 9, windowDays: 21 }))).toBe("day 9 of 21");
  });

  it("says a closed row has no result rather than drawing one, should the service answer none", () => {
    expect(measuredText(seededMeasurement(UNDER_ID, { measured: null }))).toBe("not recorded");
  });
});

describe("how a verdict is treated", () => {
  it("gives a delivered measurement the success treatment and a miss the warning — either way", () => {
    expect(verdictTone("delivered")).toBe("ok");
    expect(verdictTone("under")).toBe("warn");
    expect(verdictTone("over")).toBe("warn");
  });

  it("treats a confounded measurement as none of the clean three, and a pending one as no verdict", () => {
    expect(verdictTone("confounded")).toBe("confounded");
    expect(verdictTone("pending")).toBe("pending");
  });

  it("has a word for every verdict, so the hue is never the only signal", () => {
    expect(
      (["pending", "delivered", "under", "over", "confounded"] as const).map((verdict) => verdictWord(verdict)),
    ).toEqual(["pending", "delivered", "under-delivered", "over-delivered", "confounded"]);
  });
});

describe("the line under a row", () => {
  it("is the service's composed note for a miss — the mockup's sentence, from the row", () => {
    expect(rowNote(seededMeasurement(UNDER_ID))).toBe("under-delivered — analyzer revised its cache model");
  });

  it("is nothing for a delivered measurement", () => {
    expect(rowNote(seededMeasurement(DELIVERED_ID))).toBeNull();
  });

  it("never leaves a miss bare: one closed without a note says which way it missed", () => {
    expect(rowNote(seededMeasurement(UNDER_ID, { note: null }))).toBe("under-delivered");
    expect(rowNote(seededMeasurement(UNDER_ID, { verdict: "over", note: "  " }))).toBe("over-delivered");
  });

  it("is the service's note for a confounded one, and nothing where it carries none", () => {
    expect(rowNote(confoundedMeasurement(POINT))).toBe(CONFOUNDED_NOTE);
    expect(rowNote(confoundedMeasurement(POINT, { note: null }))).toBeNull();
  });

  it("names the metric a pending measurement is taken on, and until when", () => {
    expect(rowNote(pendingMeasurement())).toBe("measuring queue wait (p95, pool-a) until Oct 14");
    expect(pendingNote(seededMeasurement(DELIVERED_ID))).toBe("measuring cycle time until Sep 9");
  });
});

describe("the target metric, named", () => {
  it("names each rolled-up metric in words", () => {
    const named = (targetMetric: string) => targetText({ targetMetric, baseline: seededMeasurement(UNDER_ID).baseline });

    expect(named("build_duration")).toBe("build duration");
    expect(named("queue_wait")).toBe("queue wait");
    expect(named("human_interventions")).toBe("human interventions");
    expect(named("cycle_time")).toBe("cycle time");
    expect(named("stage_duration")).toBe("stage duration");
  });

  it("writes a metric it has no name for as the service names it, in words", () => {
    expect(targetText({ targetMetric: "flash_retry_rate", baseline: seededMeasurement(UNDER_ID).baseline })).toBe(
      "flash retry rate",
    );
  });

  it("adds how the window becomes one number and the slice measured, where the baseline says", () => {
    const baseline = pendingMeasurement().baseline;

    expect(targetText({ targetMetric: "queue_wait", baseline })).toBe("queue wait (p95, pool-a)");
    expect(targetText({ targetMetric: "queue_wait", baseline: { ...baseline, dimension: "" } })).toBe("queue wait (p95)");
    expect(
      targetText({
        targetMetric: "human_interventions",
        baseline: { value: 9, window: baseline.window, statistic: "weekly_sum" },
      }),
    ).toBe("human interventions (per week)");
    expect(
      targetText({ targetMetric: "build_duration", baseline: { value: 9, window: baseline.window, statistic: "p99" } }),
    ).toBe("build duration (p99)");
  });
});

describe("what interfered with a measurement", () => {
  const confounded = confoundedMeasurement(POINT);
  const all: Measurement[] = [confounded, ...seededMeasurements().measurements];

  it("names an interfering application by its own row, dated, and links to that row", () => {
    const [application] = confoundItems(confounded, all, seededDuration());

    expect(application).toEqual({
      key: `application:${seededMeasurement(UNDER_ID).suggestionId}`,
      text: "applied Sep 2: ccache warm-up",
      href: `#measurement-${UNDER_ID}`,
    });
  });

  it("names an interfering change-point by the chart's chip for it, and links to the chart", () => {
    const [, point] = confoundItems(confounded, all, seededDuration());

    expect(point).toEqual({
      key: `change_point:${POINT.id}`,
      text: `change-point ${chipLabel(POINT)}`,
      href: `#${DURATION_ANCHOR}`,
    });
    expect(point!.text).toContain("Jul 12");
  });

  it("finds a change-point a later analysis re-detected under a new finding, by its day", () => {
    const redetected = confoundedMeasurement({ id: "5eed0066-0000-4000-8000-0000000009ff", date: POINT.date });

    expect(confoundItems(redetected, all, seededDuration())[1]).toMatchObject({
      text: `change-point ${chipLabel(POINT)}`,
      href: `#${DURATION_ANCHOR}`,
    });
  });

  it("keeps the date and links nowhere for what the page no longer holds", () => {
    const items = confoundItems(confounded, [confounded], { changePoints: [] });

    expect(items).toEqual([
      { key: expect.stringMatching(/^application:/), text: "another suggestion was applied Sep 2", href: null },
      { key: expect.stringMatching(/^change_point:/), text: "a change-point was detected Jul 12", href: null },
    ]);
    expect(confoundItems(confounded, all, null)[1]).toMatchObject({ href: null });
  });

  it("keeps the service's order, and is empty for a clean measurement", () => {
    expect(confoundItems(confounded, all, seededDuration()).map((item) => item.key.split(":")[0])).toEqual([
      "application",
      "change_point",
    ]);
    expect(confoundItems(seededMeasurement(DELIVERED_ID), all, seededDuration())).toEqual([]);
  });

  it("heads the list differently while the measurement is still open", () => {
    expect(CONFOUNDS_HEADING).not.toBe(PENDING_CONFOUNDS_HEADING);
  });
});

describe("the caption", () => {
  it("is the mockup's sentence around the word that opens the popover", () => {
    const { before, after } = captionParts(14);

    expect(`${before}${RETRAINS_WORD}${after}`).toBe(
      "Every applied suggestion is re-measured for 14 days. The analyzer's model retrains on its own misses.",
    );
  });

  it("states the window the rows were measured over — the newest measurement's own", () => {
    expect(windowDays(seededMeasurements())).toBe(14);
    expect(windowDays(measurementsWith([pendingMeasurement({ windowDays: 21 }), seededMeasurement(UNDER_ID)]))).toBe(21);
    expect(captionParts(21).before).toContain("for 21 days");
    expect(captionParts(1).before).toContain("for 1 day.");
  });

  it("falls back to the schema's default where there is no measurement to read it from", () => {
    expect(windowDays(noMeasurements())).toBe(DEFAULT_WINDOW_DAYS);
    expect(DEFAULT_WINDOW_DAYS).toBe(14);
  });
});

describe("the recalibration cells", () => {
  it("lays out each cell as the service holds it: analyzer and impact class, factor, history", () => {
    expect(recalibrationCells(seededMeasurements())).toEqual([
      {
        key: "cache_window/duration_delta",
        heading: "cache_window · duration_delta",
        factor: "× 0.6545 now, from 1 closed measurement",
        history: ["Sep 17 · × 1 → × 0.6545 = −72 ÷ −110 over 1 measurement — moved by ccache warm-up"],
      },
      {
        key: "workflow_outcome/duration_delta",
        heading: "workflow_outcome · duration_delta",
        factor: "× 1.0682 now, from 1 closed measurement",
        history: ["Sep 10 · × 1 → × 1.0682 = −235 ÷ −220 over 1 measurement — moved by Test-suite split"],
      },
    ]);
  });

  it("names every measurement an update added, and counts the ones the page no longer holds", () => {
    const answer = seededMeasurements();
    const [cell] = answer.calibration;
    cell!.sampleCount = 3;
    cell!.history = [
      {
        ...cell!.history[0]!,
        sampleCount: 3,
        addedMeasurementIds: [UNDER_ID, DELIVERED_ID, "5eed0069-0000-4000-8000-0000000000aa"],
      },
      { ...cell!.history[0]!, addedMeasurementIds: [] },
    ];

    const [first] = recalibrationCells(answer);

    expect(first!.factor).toBe("× 0.6545 now, from 3 closed measurements");
    expect(first!.history[0]).toMatch(/over 3 measurements — moved by ccache warm-up, Test-suite split and 1 earlier measurement$/);
    expect(first!.history[1]).toMatch(/over 1 measurement$/);
  });

  it("states the factor the cell holds — never one worked out from its history", () => {
    const answer = seededMeasurements();
    answer.calibration[0]!.factor = 0.9;
    answer.calibration[0]!.history = [];

    expect(recalibrationCells(answer)[0]).toMatchObject({ factor: "× 0.9 now, from 1 closed measurement", history: [] });
  });

  it("has no cell where no measurement has closed", () => {
    expect(recalibrationCells(noMeasurements())).toEqual([]);
  });
});

describe("the ingest line", () => {
  it("is the mockup's line where the run read all four classes", () => {
    expect(ingestLine(manifest())).toEqual({
      read: "build logs, test results, loop transcripts, rig telemetry",
      absent: [],
    });
  });

  it("leaves an absent source out of the line and reports it apart, with the manifest's reason", () => {
    const reason = "Rig/HIL telemetry export (AJ.4, #266) is not available in this deployment.";
    const line = ingestLine(
      manifest({
        counts: { ...manifest().counts, hilSessions: 0 },
        absent: [{ source: "rig_telemetry", reason }],
      }),
    );

    expect(line.read).toBe("build logs, test results, loop transcripts");
    expect(line.absent).toEqual([{ source: "rig_telemetry", name: "rig telemetry", reason }]);
  });

  it("says which class the window held none of — present, and empty", () => {
    const line = ingestLine(manifest({ counts: { builds: 12, loops: 0, logLines: 0, hilSessions: 0 } }));

    expect(line.read).toBe(
      `build logs (${NONE_IN_WINDOW}), test results, loop transcripts (${NONE_IN_WINDOW}), rig telemetry (${NONE_IN_WINDOW})`,
    );
    expect(line.absent).toEqual([]);
  });

  it("reports a source it has no name for in the manifest's own words", () => {
    const line = ingestLine(manifest({ absent: [{ source: "energy_meter", reason: "No meter is attached." }] }));

    expect(line.read).toBe("build logs, test results, loop transcripts, rig telemetry");
    expect(line.absent).toEqual([{ source: "energy_meter", name: "energy meter", reason: "No meter is attached." }]);
  });

  it("claims nothing was read before any run has assembled a corpus", () => {
    expect(ingestLine(null)).toEqual({ read: INGEST_BEFORE_A_RUN, absent: [] });
    expect(INGEST_BEFORE_A_RUN).toContain("No analysis has assembled a corpus here yet.");
  });
});

describe("the explainer's copy", () => {
  it("is the mockup's three steps and two sentences, verbatim", () => {
    expect(STEPS.map((step) => `${step.number} ${step.name}`)).toEqual(["01 Ingest", "02 Correlate", "03 Synthesize"]);
    expect(CORRELATE_LINE).toBe("change-points ↔ merges, configs, infra events");
    expect(SYNTHESIZE_LINE).toBe("process changes, workflow drafts, tickets — with evidence attached");
    expect(LOCALITY_NOTE).toBe("Runs on your build farm's data. Nothing leaves the tenant.");
  });

  it("links the tenant-locality claim to the section of the security model that argues it", () => {
    const model = readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "SECURITY_MODEL.md"), "utf8");
    const heading = /^### (6\.6 The Build Analyzer's corpus stays on the tenant)$/m.exec(model)?.[1];

    expect(heading).toBeDefined();

    // GitHub's anchor for a heading: lower-cased, punctuation dropped, spaces to hyphens.
    const anchor = heading!
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/ /g, "-");

    expect(LOCALITY_URL).toBe(`${SECURITY_MODEL_URL}#${anchor}`);
  });
});
