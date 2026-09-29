import { describe, expect, it } from "vitest";

import type { PrMergeRefusalCode } from "@/app/api/pull-requests";
import {
  EVERY_GATE,
  MERGE_NOW_TERMS,
  RECHECK_TERMS,
  armTerms,
  refusalView,
  unreportedLine,
  waitingOn,
} from "@/app/prs/merge-terms";

import { REV_2_ID, blockedPage, gateRow, gateRows, prPage, readyPage } from "../helpers/pull-requests";

/**
 * What a merge waits on, and why a re-check refused one (#369): the confirmation names the
 * specific gate, counts the ones that cannot be named, states the re-check, and gives every
 * designed refusal its own reason.
 */

/**
 * A page whose latest revision has these rows and this many required gates satisfied.
 *
 * @param rows The rows.
 * @param requiredCount How many gates are required.
 * @param satisfiedCount How many of them are satisfied.
 * @returns The page.
 */
function pageWith(rows: ReturnType<typeof gateRows>, requiredCount: number, satisfiedCount: number) {
  return prPage({
    gates: {
      revisionId: REV_2_ID,
      aggregate: {
        requiredCount,
        greenCount: satisfiedCount,
        redCount: 0,
        satisfiedCount,
        mergeReady: satisfiedCount === requiredCount,
      },
      rows,
    },
  });
}

describe("waitingOn", () => {
  it("names the seeded PR's one unsatisfied gate, and where it stands", () => {
    const waiting = waitingOn(prPage());

    expect(waiting.unreported).toBe(0);
    expect(waiting.gates).toHaveLength(1);
    expect(waiting.gates[0]).toMatchObject({
      key: "model_review",
      label: "Second-model review",
      verdict: "unavailable",
      line: "Second-model review — unavailable",
    });
    // Unavailable will not turn green on its own, and the reader is told so.
    expect(waiting.gates[0]?.note).toContain("will not turn green on its own");
  });

  it("counts green, waived and not-required gates as satisfied, and nothing else", () => {
    const rows = gateRows({
      build: ["waived", "waived by Ken S"],
      test_suite: ["pending", null],
      physical_hil: ["red", "overshoot 2.4%"],
    });

    expect(waitingOn(pageWith(rows, 7, 4)).gates.map((gate) => gate.line)).toEqual([
      "Test suite — pending",
      "Physical HIL — red",
      "Second-model review — unavailable",
    ]);
  });

  it("says what each standing means for the promise", () => {
    const rows = gateRows({ test_suite: ["pending", null], physical_hil: ["red", "overshoot"] });
    const notes = Object.fromEntries(
      waitingOn(pageWith(rows, 7, 4)).gates.map((gate) => [gate.verdict, gate.note]),
    );

    expect(notes.pending).toBe("It is being evaluated.");
    expect(notes.red).toContain("would disarm rather than merge");
    expect(notes.unavailable).toContain("green, waived or no longer required");
  });

  it("leaves a gate that is not required out — it blocks nothing", () => {
    const rows = [
      gateRow("build", "green"),
      { ...gateRow("test_suite", "red"), required: false },
      gateRow("physical_hil", "pending"),
    ];

    expect(waitingOn(pageWith(rows, 2, 1)).gates.map((gate) => gate.key)).toEqual([
      "physical_hil",
    ]);
  });

  it("counts a required gate that has not reported — it is absent from the rows", () => {
    // Seven required, four satisfied, and only one of the three unsatisfied has a row.
    const rows = [
      gateRow("build", "green"),
      gateRow("test_suite", "green"),
      gateRow("physical_hil", "green"),
      gateRow("diff_vs_plan", "green"),
      gateRow("model_review", "pending"),
    ];

    expect(waitingOn(pageWith(rows, 7, 4))).toMatchObject({ unreported: 2 });
    expect(waitingOn(pageWith(rows, 7, 4)).gates).toHaveLength(1);
  });

  it("waits on nothing when every required gate is green, or none was evaluated", () => {
    expect(waitingOn(readyPage())).toEqual({ gates: [], unreported: 0 });
    expect(waitingOn(prPage({ gates: null }))).toEqual({ gates: [], unreported: 0 });
    expect(
      waitingOn(prPage({ gates: { revisionId: REV_2_ID, aggregate: null, rows: [] } })),
    ).toEqual({ gates: [], unreported: 0 });
  });
});

describe("armTerms — the confirmation names the specific gate", () => {
  it("is the issue's own sentence on the seeded PR", () => {
    expect(armTerms(waitingOn(prPage()))).toBe(
      "Merges automatically when Second-model review turns green.",
    );
  });

  it("names two, and three, and keeps the verb in number", () => {
    const two = gateRows({ test_suite: ["pending", null] });
    const three = gateRows({ test_suite: ["pending", null], physical_hil: ["pending", null] });

    expect(armTerms(waitingOn(pageWith(two, 7, 5)))).toBe(
      "Merges automatically when Test suite and Second-model review turn green.",
    );
    expect(armTerms(waitingOn(pageWith(three, 7, 4)))).toBe(
      "Merges automatically when Test suite, Physical HIL and Second-model review turn green.",
    );
  });

  it("names every red gate of a blocked PR rather than summarising them", () => {
    expect(armTerms(waitingOn(blockedPage()))).toBe(
      "Merges automatically when Test suite, Physical HIL and Second-model review turn green.",
    );
  });

  it("counts what it cannot name, after what it can", () => {
    expect(armTerms({ gates: waitingOn(prPage()).gates, unreported: 1 })).toBe(
      "Merges automatically when Second-model review and 1 more required gate that has not " +
        "reported turn green.",
    );
    expect(armTerms({ gates: waitingOn(prPage()).gates, unreported: 2 })).toBe(
      "Merges automatically when Second-model review and 2 more required gates that have not " +
        "reported turn green.",
    );
  });

  it("counts alone when no gate can be named", () => {
    expect(armTerms({ gates: [], unreported: 1 })).toBe(
      "Merges automatically when 1 required gate that has not reported turns green.",
    );
    expect(armTerms({ gates: [], unreported: 3 })).toBe(
      "Merges automatically when 3 required gates that have not reported turn green.",
    );
    expect(unreportedLine(1, false)).not.toContain("more");
  });

  it("falls back to every required gate when there is nothing to name or count", () => {
    expect(armTerms({ gates: [], unreported: 0 })).toBe(EVERY_GATE);
  });
});

describe("the re-check, stated", () => {
  it("names the three things checked again at merge time, and what a failure does", () => {
    for (const checked of ["Gates", "head commit", "mergeability"]) {
      expect(RECHECK_TERMS).toContain(checked);
    }
    expect(RECHECK_TERMS).toContain("re-checked at merge time");
    expect(RECHECK_TERMS).toContain("disarms and says why");
    expect(RECHECK_TERMS).toContain("nothing merges");
  });

  it("states the same checks for a direct merge", () => {
    expect(MERGE_NOW_TERMS).toContain("Every required gate is green");
    expect(MERGE_NOW_TERMS).toContain("re-checked first");
  });
});

describe("refusalView — a failed re-check says why", () => {
  const CODES: readonly PrMergeRefusalCode[] = [
    "head_moved",
    "gate_red",
    "gates_pending",
    "host_not_open",
    "host_head_moved",
    "host_conflict",
    "host_refused",
  ];

  it("gives the issue's three reasons their own headline", () => {
    expect(refusalView("gate_red", "Physical HIL is red on revision 2.")).toMatchObject({
      headline: "A gate went red",
      message: "Physical HIL is red on revision 2.",
    });
    expect(refusalView("head_moved", "Revision 3 was recorded.").headline).toBe("The head moved");
    expect(refusalView("host_conflict", "The host reports a conflict.").headline).toBe(
      "The host reports a conflict",
    );
  });

  it("gives every designed code a headline of its own and a next step — never a generic error", () => {
    const views = CODES.map((code) => refusalView(code, "as the service said it"));

    expect(new Set(views.map((view) => view.headline)).size).toBe(CODES.length);
    for (const view of views) {
      expect(view.headline).not.toMatch(/error|failed|went wrong/i);
      expect(view.next.length).toBeGreaterThan(0);
      expect(view.message).toBe("as the service said it");
    }
  });

  it("points a refusal for pending gates at arming instead", () => {
    expect(refusalView("gates_pending", "5 of 7 required gates are satisfied.").next).toContain(
      "Arm the merge instead",
    );
  });
});
