import { describe, expect, it } from "vitest";

import type { TestParseWarning } from "@/app/api/test-results";
import { INGEST_LAG_AFTER_SECONDS } from "@/app/runs/states";
import {
  PARSE_WARNING_MISSING,
  emptyKind,
  noTestStageNote,
  parseWarningsView,
  partialNote,
  testsLagHeadline,
  testsLagSince,
  unknownAttemptNote,
} from "@/app/test-results/states";

import { attempt, strip } from "../helpers/test-results";

/**
 * The test-results page's states besides *results already parsed* (#342), as rules: what a running
 * build's figures are called, which empty state a run with no attempt draws, what a parse warning
 * leaves missing, and when a running build's uploads count as quiet.
 */

/** When the helper's attempt last received a report. */
const LAST_RECEIVED = Date.parse("2026-09-19T14:44:31.000Z");

/** The truncated JUnit file of the issue's story. */
const TRUNCATED: TestParseWarning = {
  code: "xml_truncated",
  file: "junit-telemetry.xml",
  message: "The document ended inside <testsuite>; 40 cases closed before it.",
  at: "line 212",
};

describe("partialNote", () => {
  it("labels a running build's figures as what has parsed so far, never as the result", () => {
    const note = partialNote(attempt(3, { status: "running", strip: strip({ total: 40, passed: 40 }) }));

    expect(note).toContain("Build 3 is still running");
    expect(note).toContain("40 cases have been reported so far");
    expect(note).toContain("not the final result");
  });

  it("counts one case in the singular, and says so when none has been reported", () => {
    expect(partialNote(attempt(3, { status: "running", strip: strip({ total: 1 }) }))).toContain(
      "1 case has been reported so far",
    );
    expect(partialNote(attempt(3, { status: "running", strip: strip({ total: 0 }) }))).toContain(
      "no case has been reported yet",
    );
  });

  it("says nothing of a build that has finished, whatever its verdict", () => {
    expect(partialNote(attempt(3, { status: "complete" }))).toBeNull();
    expect(partialNote(attempt(3, { status: "error" }))).toBeNull();
  });
});

describe("emptyKind", () => {
  it("reports no test stage only when the stages were read and none is the test stage", () => {
    expect(emptyKind(false)).toBe("no-test-stage");
    expect(emptyKind(true)).toBe("no-results");
  });

  it("never reports unknown as absent", () => {
    expect(emptyKind(null)).toBe("no-results");
  });

  it("names the workflow in the guidance", () => {
    expect(noTestStageNote("docs-only v3")).toContain("docs-only v3 runs no test stage");
  });
});

describe("unknownAttemptNote", () => {
  it("says which build is shown when the address names one that does not exist", () => {
    expect(unknownAttemptNote(9, attempt(3))).toBe(
      "Build 9 does not exist for this run — showing Build 3, the latest.",
    );
  });

  it("says nothing when the address names nothing, names the build on screen, or none reported", () => {
    expect(unknownAttemptNote(null, attempt(3))).toBeNull();
    expect(unknownAttemptNote(3, attempt(3))).toBeNull();
    expect(unknownAttemptNote(9, null)).toBeNull();
  });
});

describe("parseWarningsView", () => {
  it("draws nothing when the parser read everything", () => {
    expect(parseWarningsView([], attempt(3))).toBeNull();
  });

  it("names the file, what failed to parse, where, and what is missing", () => {
    const view = parseWarningsView([TRUNCATED], attempt(3, { strip: strip({ total: 40 }) }));

    expect(view?.headline).toBe(
      "1 report file could not be fully read — Build 3's results are incomplete: 40 cases parsed and are shown, and what is listed here is missing.",
    );
    expect(view?.warnings).toEqual([
      {
        key: "0:junit-telemetry.xml:xml_truncated",
        file: "junit-telemetry.xml",
        at: "line 212",
        failed: TRUNCATED.message,
        missing: PARSE_WARNING_MISSING.xml_truncated,
      },
    ]);
  });

  it("counts files, not warnings, and keeps every warning", () => {
    const view = parseWarningsView(
      [
        TRUNCATED,
        { code: "junit_platform_missing", file: "junit-telemetry.xml", message: "No platform." },
        { code: "coverage_unreadable", file: "lcov.info", message: "No line counts." },
      ],
      attempt(3, { strip: strip({ total: 1 }) }),
    );

    expect(view?.headline).toContain("2 report files could not be fully read");
    expect(view?.headline).toContain("1 case parsed and is shown");
    expect(view?.warnings).toHaveLength(3);
    expect(view?.warnings[1]?.at).toBeNull();
    expect(new Set(view?.warnings.map((each) => each.key)).size).toBe(3);
  });

  it("says what is missing for every code the parser can attach", () => {
    for (const sentence of Object.values(PARSE_WARNING_MISSING)) {
      expect(sentence).toMatch(/missing|shown/);
    }
    expect(Object.keys(PARSE_WARNING_MISSING)).toHaveLength(9);
  });
});

describe("testsLagSince", () => {
  const running = attempt(3, { status: "running" });

  it("is quiet until the threshold, and names the last report from it on", () => {
    const threshold = LAST_RECEIVED + INGEST_LAG_AFTER_SECONDS * 1000;

    expect(testsLagSince(running, threshold - 1)).toBeNull();
    expect(testsLagSince(running, threshold)).toBe(LAST_RECEIVED);
    expect(testsLagSince(running, threshold + 3_600_000)).toBe(LAST_RECEIVED);
  });

  it("takes the threshold it is given", () => {
    expect(testsLagSince(running, LAST_RECEIVED + 10_000, 10)).toBe(LAST_RECEIVED);
    expect(testsLagSince(running, LAST_RECEIVED + 9_999, 10)).toBeNull();
  });

  it("never lags a build that has finished — it is supposed to be quiet", () => {
    const later = LAST_RECEIVED + 86_400_000;

    expect(testsLagSince(attempt(3, { status: "complete" }), later)).toBeNull();
    expect(testsLagSince(attempt(3, { status: "error" }), later)).toBeNull();
  });

  it("draws nothing from an instant it cannot read, or a clock behind the report", () => {
    expect(testsLagSince({ ...running, lastReceivedAt: "soon" }, LAST_RECEIVED + 86_400_000)).toBeNull();
    expect(testsLagSince(running, 0)).toBeNull();
  });

  it("states the last-received time and the build", () => {
    expect(testsLagHeadline(LAST_RECEIVED, 3, () => "14:44")).toBe(
      "No results received since 14:44 — Build 3's uploads have gone quiet.",
    );
  });
});
