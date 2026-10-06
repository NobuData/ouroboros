import { describe, expect, it } from "vitest";

import {
  CONVENTIONS_LINE,
  LEGACY_CONVENTIONS_LINE,
  PROTECTED_CONSEQUENCE,
  RESCAN_INTERVAL_SECONDS,
  SCAN_FAILED_FALLBACK,
  cardState,
  evidenceLines,
  globsChanged,
  isPartial,
  isScanning,
  pointsAtRoadmap,
  probeLine,
  progressFraction,
  progressLine,
  protectedSummary,
  rescanWait,
  rescanWaitReason,
  rowLabel,
  rowMark,
  rowValue,
  scanFailure,
  scannedIn,
  splitValue,
} from "@/app/get-started/detection-view";

import { SCANNED_AT, cardRow, scanProgress, seededCard } from "../helpers/onboarding";

/**
 * The detection card's pure rules (#391): marks and labels, the value's dim affix, the duration
 * tag from the real duration, the evidence the popover lists, the card's states, and the debounce.
 */

describe("a row", () => {
  it("is marked by its verdict — and undetermined when the scan could not settle it", () => {
    expect(rowMark(cardRow({ rowKey: "build" }))).toBe("ok");
    expect(rowMark(cardRow({ rowKey: "conventions", verdict: "warn" }))).toBe("warn");
    expect(rowMark(cardRow({ rowKey: "tests", verdict: "missing" }))).toBe("missing");
    expect(rowMark(cardRow({ rowKey: "tests", verdict: "warn", determined: false }))).toBe("undetermined");
  });

  it("is labelled as the mockup labels it, and a pack's own row by its name", () => {
    expect(rowLabel("protected_paths")).toBe("Protected paths");
    expect(rowLabel("devcontainer")).toBe("Devcontainer");
    expect(rowLabel("custom:license_header")).toBe("License header");
    expect(rowLabel("custom:")).toBe("custom:");
  });

  it("splits the parenthetical that shows its work off its claim", () => {
    expect(splitValue("west + twister (found west.yml)")).toEqual({ claim: "west + twister", affix: "(found west.yml)" });
    expect(splitValue("C 92% · Zephyr RTOS 4.1")).toEqual({ claim: "C 92% · Zephyr RTOS 4.1", affix: "" });
    expect(splitValue("(only a parenthetical)")).toEqual({ claim: "(only a parenthetical)", affix: "" });
    expect(splitValue("a (b) c")).toEqual({ claim: "a (b) c", affix: "" });
  });
});

describe("the conventions row", () => {
  it("is phrased as a future capability, never a current one", () => {
    expect(CONVENTIONS_LINE).toMatch(/will learn/);
    expect(CONVENTIONS_LINE).not.toMatch(/we'll learn|learns your/);
  });

  it("re-phrases a line a scan stored before #391 in the future tense", () => {
    expect(rowValue(cardRow({ rowKey: "conventions", verdict: "warn", value: LEGACY_CONVENTIONS_LINE }))).toBe(CONVENTIONS_LINE);
    // Only that row's legacy line: another row's text is the service's, verbatim.
    expect(rowValue(cardRow({ rowKey: "build", value: LEGACY_CONVENTIONS_LINE }))).toBe(LEGACY_CONVENTIONS_LINE);
    expect(rowValue(cardRow({ rowKey: "conventions", value: "CONTRIBUTING.md, CODEOWNERS" }))).toBe(
      "CONTRIBUTING.md, CODEOWNERS",
    );
  });

  it("points at the knowledge roadmap only from its determined warn", () => {
    expect(pointsAtRoadmap(cardRow({ rowKey: "conventions", verdict: "warn" }))).toBe(true);
    expect(pointsAtRoadmap(cardRow({ rowKey: "conventions", verdict: "ok" }))).toBe(false);
    expect(pointsAtRoadmap(cardRow({ rowKey: "conventions", verdict: "warn", determined: false }))).toBe(false);
    expect(pointsAtRoadmap(cardRow({ rowKey: "build", verdict: "warn" }))).toBe(false);
  });
});

describe("the duration tag", () => {
  it.each([
    [38_000, "scanned in 38s"],
    [37_600, "scanned in 38s"],
    [120, "scanned in 1s"],
    [0, "scanned in 1s"],
    [60_000, "scanned in 1m"],
    [72_400, "scanned in 1m 12s"],
  ])("renders %i ms as %s — from the scan's real duration", (durationMs, text) => {
    expect(scannedIn(durationMs)).toBe(text);
  });
});

describe("the card's state", () => {
  it("is never scanned, first scan running, or a stored scan — re-scans run beside it", () => {
    expect(cardState(seededCard({ scan: null, rows: [] }))).toBe("never");
    expect(cardState(seededCard({ scan: null, rows: [], progress: scanProgress() }))).toBe("first");
    expect(cardState(seededCard())).toBe("ready");
    expect(cardState(seededCard({ progress: scanProgress() }))).toBe("ready");
  });

  it("knows a scan is running only from running progress", () => {
    expect(isScanning(null)).toBe(false);
    expect(isScanning(scanProgress())).toBe(true);
    expect(isScanning(scanProgress({ state: "done" }))).toBe(false);
  });

  it("is partial when any row is undetermined", () => {
    expect(isPartial(seededCard().rows)).toBe(false);
    expect(isPartial([...seededCard().rows, cardRow({ rowKey: "tests", verdict: "warn", determined: false })])).toBe(true);
  });

  it("says why the last scan failed — unless a newer scan was stored since", () => {
    const failed = scanProgress({ state: "failed", error: "GitHub rate-limited the scan." });

    expect(scanFailure(seededCard({ scan: null, rows: [], progress: failed }))).toBe(
      "The scan failed: GitHub rate-limited the scan.",
    );
    expect(scanFailure(seededCard({ progress: failed }))).toBe("The scan failed: GitHub rate-limited the scan.");
    expect(scanFailure(seededCard({ progress: { ...failed, error: null } }))).toBe(SCAN_FAILED_FALLBACK);
    expect(
      scanFailure(seededCard({ progress: { ...failed, startedAt: "2026-10-01T00:00:00.000Z" } })),
    ).toBeNull();
    expect(scanFailure(seededCard({ progress: scanProgress() }))).toBeNull();
    expect(scanFailure(seededCard())).toBeNull();
    expect(Date.parse(SCANNED_AT)).toBeGreaterThan(Date.parse("2026-10-01T00:00:00.000Z"));
  });
});

describe("a running scan's progress", () => {
  it("counts settled probes, and says when none is planned yet", () => {
    expect(progressLine(scanProgress())).toBe("Scanning — 4 of 9 probes settled…");
    expect(progressLine(scanProgress({ probesPlanned: 0, probesSettled: 0 }))).toBe("Scanning — planning probes…");
    expect(progressFraction(scanProgress())).toBeCloseTo(4 / 9);
    expect(progressFraction(scanProgress({ probesPlanned: 0 }))).toBe(0);
    expect(progressFraction(scanProgress({ probesSettled: 12 }))).toBe(1);
  });
});

describe("the re-scan debounce", () => {
  const started = Date.parse(scanProgress().startedAt);

  it("waits out the service's window from when the last scan started", () => {
    expect(rescanWait(null, started)).toBe(0);
    expect(rescanWait(scanProgress({ state: "done" }), started + 1_000)).toBe(RESCAN_INTERVAL_SECONDS - 1);
    expect(rescanWait(scanProgress({ state: "done" }), started + 29_100)).toBe(1);
    expect(rescanWait(scanProgress({ state: "done" }), started + RESCAN_INTERVAL_SECONDS * 1000)).toBe(0);
    expect(rescanWait(scanProgress({ startedAt: "not a date" }), started)).toBe(0);
    expect(rescanWaitReason(12)).toBe("Scanned a moment ago — re-scan in 12s.");
  });
});

describe("a row's evidence", () => {
  it("lists the probe hits, what was found, the pack and the confidence", () => {
    const [language, build] = seededCard().rows;

    expect(evidenceLines(language!)).toEqual({
      probes: ["Read the repository's language breakdown", "Listed the repository's file tree", "Read west.yml"],
      found: null,
      unfinished: [],
      pack: "language 1.0.0",
      confidence: "high",
    });
    expect(evidenceLines(build!)).toMatchObject({ found: "west.yml", pack: "build 1.0.0" });
  });

  it("lists what did not finish for an undetermined row", () => {
    const row = cardRow({
      rowKey: "tests",
      determined: false,
      confidence: "low",
      evidence: {
        undetermined: true,
        reason: "budget",
        unfinished: [
          { probe: "file:tests/a.c", status: "skipped", reason: "budget" },
          { probe: "file:tests/b.c" },
          "junk",
          { status: "skipped" },
        ],
        pack: "tests",
        packVersion: "1.0.0",
        probes: ["tree", 7],
      },
    });

    expect(evidenceLines(row)).toEqual({
      probes: ["Listed the repository's file tree"],
      found: null,
      unfinished: ["Read tests/a.c — skipped, budget", "Read tests/b.c — did not finish"],
      pack: "tests 1.0.0",
      confidence: "low",
    });
  });

  it("leaves out what a pack did not record rather than guessing it", () => {
    expect(evidenceLines(cardRow({ rowKey: "custom:x", confidence: null, evidence: {} }))).toEqual({
      probes: [],
      found: null,
      unfinished: [],
      pack: null,
      confidence: null,
    });
    expect(evidenceLines(cardRow({ rowKey: "x", evidence: { pack: "x", version: "2.0.0" } })).pack).toBe("x 2.0.0");
    expect(evidenceLines(cardRow({ rowKey: "x", evidence: { pack: "x" } })).pack).toBe("x");
  });

  it("words each probe", () => {
    expect(probeLine("languages")).toBe("Read the repository's language breakdown");
    expect(probeLine("tree")).toBe("Listed the repository's file tree");
    expect(probeLine("file:boot/mcuboot.conf")).toBe("Read boot/mcuboot.conf");
    expect(probeLine("something-new")).toBe("something-new");
  });
});

describe("the protected paths", () => {
  it("summarise as the mockup's chips, with where they came from", () => {
    expect(protectedSummary(seededCard().protectedPaths)).toEqual({ globs: "boot/, keys/", provenance: "suggested" });
    expect(protectedSummary([{ glob: "src/*.ld", source: "edited" }])).toEqual({ globs: "src/*.ld", provenance: "edited" });
    expect(
      protectedSummary([
        { glob: "boot/**", source: "suggested" },
        { glob: "keys/**", source: "edited" },
      ]),
    ).toEqual({ globs: "boot/, keys/", provenance: "suggested and edited" });
    expect(protectedSummary([])).toEqual({ globs: "none", provenance: "" });
  });

  it("state the consequence the issue names", () => {
    expect(PROTECTED_CONSEQUENCE).toBe("These paths are refused by run guardrails");
  });

  it("count as changed only when the set of globs differs", () => {
    expect(globsChanged(["boot/**", "keys/**"], ["keys/**", "boot/**"])).toBe(false);
    expect(globsChanged(["boot/**"], ["boot/**", "keys/**"])).toBe(true);
    expect(globsChanged(["boot/**", "a/**"], ["boot/**", "keys/**"])).toBe(true);
  });
});
