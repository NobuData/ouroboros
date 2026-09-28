import { describe, expect, it } from "vitest";

import {
  CHOOSE_MEASUREMENT,
  CHOOSE_PATH,
  CHOOSE_TEST,
  type EvidenceOptions,
  MAX_QUALIFIER_LENGTH,
  NO_FILES_TO_CITE,
  NO_MEASUREMENTS_TO_CITE,
  NO_RUN_TO_CITE,
  NO_TESTS_TO_CITE,
  PICKER_KINDS,
  type PickerDraft,
  QUALIFIER_TOO_LONG,
  RANGE_INVALID,
  attemptOptions,
  emptyReason,
  hunkPaths,
  noOptions,
  pickerAttempt,
  readDraft,
  typedLine,
} from "@/app/prs/evidence-options";

import {
  ATTEMPT_3_ID,
  ATTEMPT_4_ID,
  REV_2_ID,
  TELEMETRY_PATH,
  files,
  matrixPage,
  prPage,
} from "../helpers/pull-requests";
import {
  attempt,
  measurement,
  page as attemptPage,
  physicalCase,
  suite,
  testCase,
} from "../helpers/test-results";

/**
 * What the evidence picker offers (#366): only rows that exist for this run and revision, and a
 * form that cannot be read as a reference until it names one of them.
 */

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const ATTEMPT = { id: ATTEMPT_4_ID, seq: 4 };

/** Build 4's rows: two cases that ran, one that was skipped, and one measurement. */
const RESULTS = attemptPage({
  suites: [
    suite({
      name: "telemetry integration",
      platform: "qemu_cortex_m3",
      cases: [
        testCase({ id: "case-1", caseKey: KEY_A, name: "test_frame_order_under_load" }),
        testCase({ id: "case-2", caseKey: KEY_B, name: "test_skipped", status: "skipped" }),
        testCase({ id: "case-3", caseKey: "not-a-key", name: "test_unkeyed" }),
      ],
    }),
  ],
  physical: [
    physicalCase({
      name: "Motor overshoot on e-stop release",
      measurements: [measurement({ id: "m-1", value: 1.7, verdict: "pass" })],
    }),
  ],
});

const OPTIONS = attemptOptions(ATTEMPT, RESULTS);

/**
 * A form.
 *
 * @param over What to change.
 * @returns A form with nothing chosen, changed.
 */
function draft(over: Partial<PickerDraft> = {}): PickerDraft {
  return {
    kind: "test_case",
    testId: "",
    measurementId: "",
    path: "",
    lineStart: "",
    lineEnd: "",
    qualifier: "",
    ...over,
  };
}

const OFFER = { options: OPTIONS, paths: hunkPaths(files()), revisionId: REV_2_ID };

describe("the kinds", () => {
  it("are the three the ticket names, in its order", () => {
    expect(PICKER_KINDS.map((each) => each.kind)).toEqual([
      "test_case",
      "hil_measurement",
      "hunk",
    ]);
  });
});

describe("the attempt the picker reads", () => {
  const attempts = [attempt(3, { id: ATTEMPT_3_ID }), attempt(4, { id: ATTEMPT_4_ID })];

  it("is the one the latest revision was judged on", () => {
    expect(pickerAttempt(matrixPage(), attempts)).toEqual({ id: ATTEMPT_4_ID, seq: 4 });
    expect(pickerAttempt(matrixPage(), attempts.toReversed())).toEqual({
      id: ATTEMPT_4_ID,
      seq: 4,
    });
  });

  it("is the run's latest when the revision names none, or one the run does not have", () => {
    expect(pickerAttempt(prPage(), attempts)).toEqual({ id: ATTEMPT_4_ID, seq: 4 });
    expect(pickerAttempt(matrixPage(), [attempt(3, { id: ATTEMPT_3_ID })])).toEqual({
      id: ATTEMPT_3_ID,
      seq: 3,
    });
  });

  it("is none for a run never tested", () => {
    expect(pickerAttempt(matrixPage(), [])).toBeNull();
  });
});

describe("what an attempt offers", () => {
  it("offers every case that ran, named by where it sits", () => {
    expect(OPTIONS.tests).toEqual([
      {
        id: "case-1",
        caseKey: KEY_A,
        label: "telemetry integration · qemu_cortex_m3 · test_frame_order_under_load",
      },
    ]);
  });

  it("offers no skipped case — it did not run — and none without a durable key", () => {
    expect(OPTIONS.tests.map((each) => each.id)).not.toContain("case-2");
    expect(OPTIONS.tests.map((each) => each.id)).not.toContain("case-3");
  });

  it("offers every rig measurement by its id, with its figure and limit", () => {
    expect(OPTIONS.measurements).toEqual([
      {
        id: "m-1",
        label: "Motor overshoot on e-stop release · overshoot_pct 1.7 % (limit 2 %)",
      },
    ]);
  });

  it("names a minimum as one", () => {
    const low = attemptOptions(
      ATTEMPT,
      attemptPage({
        physical: [physicalCase({ measurements: [measurement({ limitKind: "min" })] })],
      }),
    );

    expect(low.measurements[0]!.label).toContain("(minimum 2 %)");
  });

  it("offers the snapshot's paths for a hunk, and none without a snapshot", () => {
    expect(hunkPaths(files())).toEqual([
      TELEMETRY_PATH,
      "drivers/can/telemetry_buf.h",
      "tests/integration/test_telemetry.c",
    ]);
    expect(hunkPaths(null)).toEqual([]);
  });
});

describe("why a kind has nothing to offer", () => {
  const empty: EvidenceOptions = { attempt: ATTEMPT, tests: [], measurements: [], reason: null };

  it("says nothing while the rows are being read, or when there are some", () => {
    expect(emptyReason("test_case", null, [])).toBeNull();
    expect(emptyReason("test_case", OPTIONS, [])).toBeNull();
    expect(emptyReason("hil_measurement", OPTIONS, [])).toBeNull();
    expect(emptyReason("hunk", null, ["a.c"])).toBeNull();
  });

  it("says which kind has none", () => {
    expect(emptyReason("test_case", empty, [])).toBe(NO_TESTS_TO_CITE);
    expect(emptyReason("hil_measurement", empty, [])).toBe(NO_MEASUREMENTS_TO_CITE);
    expect(emptyReason("hunk", OPTIONS, [])).toBe(NO_FILES_TO_CITE);
  });

  it("gives the read's own reason for a PR no loop opened — and still offers hunks", () => {
    const none = noOptions(NO_RUN_TO_CITE);

    expect(emptyReason("test_case", none, ["a.c"])).toBe(NO_RUN_TO_CITE);
    expect(emptyReason("hil_measurement", none, ["a.c"])).toBe(NO_RUN_TO_CITE);
    expect(emptyReason("hunk", none, ["a.c"])).toBeNull();
  });
});

describe("reading the form", () => {
  it("cites the chosen test by its durable key, pinned to the attempt it was offered from", () => {
    expect(readDraft(draft({ testId: "case-1" }), OFFER)).toEqual({
      ok: true,
      request: { kind: "test_case", caseKey: KEY_A, testRunId: ATTEMPT_4_ID },
    });
  });

  it("sends the qualifier trimmed, and leaves a blank one out", () => {
    expect(
      readDraft(draft({ testId: "case-1", qualifier: "  10⁶ frames, 0 reordered " }), OFFER),
    ).toEqual({
      ok: true,
      request: {
        kind: "test_case",
        caseKey: KEY_A,
        testRunId: ATTEMPT_4_ID,
        note: "10⁶ frames, 0 reordered",
      },
    });
    expect(readDraft(draft({ testId: "case-1", qualifier: "   " }), OFFER)).toEqual({
      ok: true,
      request: { kind: "test_case", caseKey: KEY_A, testRunId: ATTEMPT_4_ID },
    });
  });

  it("cites the chosen measurement by its id", () => {
    expect(readDraft(draft({ kind: "hil_measurement", measurementId: "m-1" }), OFFER)).toEqual({
      ok: true,
      request: { kind: "hil_measurement", hilMeasurementId: "m-1" },
    });
  });

  it("cites a hunk of an offered path, pinned to the revision the paths were read from", () => {
    expect(
      readDraft(
        draft({ kind: "hunk", path: TELEMETRY_PATH, lineStart: "41", lineEnd: " 66 " }),
        OFFER,
      ),
    ).toEqual({
      ok: true,
      request: {
        kind: "hunk",
        path: TELEMETRY_PATH,
        lineStart: 41,
        lineEnd: 66,
        revisionId: REV_2_ID,
      },
    });
  });

  it("cannot construct a reference to a row that was not offered", () => {
    expect(readDraft(draft({ testId: "case-2" }), OFFER)).toEqual({
      ok: false,
      reason: CHOOSE_TEST,
    });
    expect(readDraft(draft({ kind: "hil_measurement", measurementId: "m-9" }), OFFER)).toEqual({
      ok: false,
      reason: CHOOSE_MEASUREMENT,
    });
    expect(
      readDraft(draft({ kind: "hunk", path: "src/other.c", lineStart: "1", lineEnd: "2" }), OFFER),
    ).toEqual({ ok: false, reason: CHOOSE_PATH });
  });

  it("waits while nothing is chosen, or the rows have not been read", () => {
    expect(readDraft(draft(), OFFER)).toEqual({ ok: false, reason: CHOOSE_TEST });
    expect(readDraft(draft({ testId: "case-1" }), { ...OFFER, options: null })).toEqual({
      ok: false,
      reason: CHOOSE_TEST,
    });
  });

  it.each([
    ["no lines", "", ""],
    ["a backwards range", "66", "41"],
    ["a zero line", "0", "4"],
    ["a fractional line", "4.5", "9"],
    ["words", "first", "last"],
  ])("refuses a hunk with %s", (_name, lineStart, lineEnd) => {
    expect(
      readDraft(draft({ kind: "hunk", path: TELEMETRY_PATH, lineStart, lineEnd }), OFFER),
    ).toEqual({ ok: false, reason: RANGE_INVALID });
  });

  it("refuses a qualifier the service would", () => {
    expect(
      readDraft(
        draft({ testId: "case-1", qualifier: "x".repeat(MAX_QUALIFIER_LENGTH + 1) }),
        OFFER,
      ),
    ).toEqual({ ok: false, reason: QUALIFIER_TOO_LONG });
  });

  it("reads a typed line as a whole number from 1, and nothing else", () => {
    expect(typedLine(" 41 ")).toBe(41);
    expect(typedLine("041")).toBeNull();
    expect(typedLine("-3")).toBeNull();
    expect(typedLine("")).toBeNull();
  });
});
