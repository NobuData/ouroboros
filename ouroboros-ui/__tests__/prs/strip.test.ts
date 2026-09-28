import { describe, expect, it } from "vitest";

import { PR_REVISION_PARAM } from "@/app/paths";
import {
  CORRECTION_LABEL,
  NOT_EVALUATED,
  ON_ALL_GREEN,
  blockingGates,
  blockingReason,
  correctionStep,
  futureStep,
  gatesScope,
  revisionParam,
  revisionStep,
  scopedRevision,
  scrollTarget,
  shortSha,
  snapshotSummary,
  stripSteps,
  withRevision,
} from "@/app/prs/strip";

import {
  CORRECTION_NOTE,
  HIL_RED,
  REV_1_ID,
  REV_2_ID,
  TESTS_RED,
  classification,
  gateRow,
  gateRows,
  prPage,
  returned,
  revision,
  revisionOne,
  revisionTwo,
  stripPage,
} from "../helpers/pull-requests";

/**
 * The revision cycle strip's rules (#364), without rendering: every step a join — the blocking
 * reason from the red gates, the correction from the classification, the model pill from its
 * provenance, the future step from the merge plan — and the scope the address carries.
 */

describe("the seeded strip", () => {
  it("is mockup 12's four steps, with their treatments, shas and summaries", () => {
    expect(stripSteps(stripPage())).toEqual([
      {
        kind: "revision",
        id: REV_1_ID,
        seq: 1,
        treatment: "err",
        label: "Revision 1 · 14:10 — blocked: Test suite, Physical HIL ✗",
        meta: "3f9c2ae · 2 gates red",
        latest: false,
      },
      {
        kind: "correction",
        id: `correction-${REV_2_ID}`,
        label: "Correction round · attempt 4",
        note: CORRECTION_NOTE,
        model: "claude-fable-5",
      },
      {
        kind: "revision",
        id: REV_2_ID,
        seq: 2,
        treatment: "live",
        label: "Revision 2 · 14:31 — pushed, re-verification running",
        meta: "b7e41d0 · 5/7 gates green",
        latest: true,
      },
      {
        kind: "future",
        id: "future",
        treatment: "ghosted",
        label: "Auto-merge (squash)",
        meta: "on all gates green · policy: standard-fix",
      },
    ]);
  });

  it("is empty before the first revision — not even the future step", () => {
    expect(stripSteps(prPage({ revisions: [] }))).toEqual([]);
  });
});

describe("the blocking reason", () => {
  it("is composed from the gates that are red, so it changes when they do", () => {
    const hilOnly = revisionOne({
      gates: {
        revisionId: REV_1_ID,
        aggregate: null,
        rows: gateRows({ physical_hil: ["red", HIL_RED] }),
      },
    });
    const renamed = revisionOne({
      gates: {
        revisionId: REV_1_ID,
        aggregate: null,
        rows: [{ ...gateRow("build", "red"), label: "Firmware build" }],
      },
    });

    expect(blockingReason(blockingGates(revisionOne()))).toBe(
      "blocked: Test suite, Physical HIL ✗",
    );
    expect(blockingReason(blockingGates(hilOnly))).toBe("blocked: Physical HIL ✗");
    expect(blockingReason(blockingGates(renamed))).toBe("blocked: Firmware build ✗");
  });

  it("names two gates and counts the rest", () => {
    const rows = gateRows({
      build: ["red", null],
      test_suite: ["red", TESTS_RED],
      physical_hil: ["red", HIL_RED],
      diff_vs_plan: ["red", null],
    });

    expect(blockingReason(rows.filter((row) => row.verdict === "red"))).toBe(
      "blocked: Build, Test suite +2 more ✗",
    );
  });

  it("is nothing when no gate is red", () => {
    expect(blockingReason(blockingGates(revisionTwo()))).toBeNull();
    expect(blockingReason([])).toBeNull();
  });

  it("leaves out a red gate the policy does not require — it blocks nothing", () => {
    const optional = revisionTwo({
      gates: {
        revisionId: REV_2_ID,
        aggregate: null,
        rows: [{ ...gateRow("custom:lint", "red"), required: false }],
      },
    });

    expect(blockingGates(optional)).toEqual([]);
    expect(revisionStep(optional, "verifying", true).treatment).toBe("live");
  });
});

describe("a revision step", () => {
  it("is err whenever its own snapshot has a red gate — the latest revision too", () => {
    const step = revisionStep(revisionOne(), "blocked", true);

    expect(step.treatment).toBe("err");
    expect(step.label).toBe("Revision 1 · 14:10 — blocked: Test suite, Physical HIL ✗");
  });

  it("is live only as the latest revision while verification runs", () => {
    expect(revisionStep(revisionTwo(), "verifying", true).treatment).toBe("live");
    expect(revisionStep(revisionTwo(), "armed", true).treatment).toBe("live");
    expect(revisionStep(revisionTwo(), "verifying", false).treatment).toBe("plain");
    expect(revisionStep(revisionTwo(), "merged", true).treatment).toBe("plain");
    expect(revisionStep(revisionTwo(), "closed", true).treatment).toBe("plain");
  });

  it("says a first push is verifying, not re-verifying", () => {
    const first = revisionTwo({ seq: 1, correction: null });

    expect(revisionStep(first, "verifying", true).label).toBe(
      "Revision 1 · 14:31 — pushed, verification running",
    );
  });

  it("says verification has not started on an open PR", () => {
    expect(revisionStep(revision(), "open", true)).toMatchObject({
      treatment: "plain",
      label: "Revision 2 · 14:30 — pushed, verification has not started",
      meta: `b7e41d0 · ${NOT_EVALUATED}`,
    });
  });

  it("leaves the time out when the payload's is not a date", () => {
    expect(revisionStep(revision({ pushedAt: "soon" }), "merged", true).label).toBe(
      "Revision 2 — pushed",
    );
  });

  it("prints a full sha short", () => {
    expect(shortSha("b7e41d0c9a1f4e2d8b7a6c5d4e3f2a1b0c9d8e7f")).toBe("b7e41d0");
    expect(shortSha("b7e4")).toBe("b7e4");
  });

  it("summarises one red gate in the singular", () => {
    const one = revisionOne({
      gates: {
        revisionId: REV_1_ID,
        aggregate: {
          requiredCount: 7,
          greenCount: 4,
          redCount: 1,
          satisfiedCount: 5,
          mergeReady: false,
        },
        rows: [],
      },
    });

    expect(snapshotSummary(one)).toBe("1 gate red");
  });
});

describe("the correction step", () => {
  it("names the model only when the classification's provenance is a model", () => {
    const by = (actor: "human" | "heuristic" | "model") =>
      correctionStep(
        revisionTwo({
          correction: {
            fromRevisionId: REV_1_ID,
            classification: classification({ actor }),
            loopReturn: null,
          },
        }),
        "claude-fable-5",
      );

    expect(by("model")?.model).toBe("claude-fable-5");
    expect(by("human")?.model).toBeNull();
    expect(by("heuristic")?.model).toBeNull();
  });

  it("names no model for a PR no loop opened, whatever the provenance", () => {
    expect(correctionStep(revisionTwo(), null)?.model).toBeNull();
  });

  it("names no model when only a loop return bridged the revisions", () => {
    const step = correctionStep(
      revisionTwo({
        correction: {
          fromRevisionId: REV_1_ID,
          classification: null,
          loopReturn: returned().loopReturn,
        },
      }),
      "claude-fable-5",
    );

    expect(step).toMatchObject({ note: "returned to the loop with 2 gates", model: null });
  });

  it("prefers the classification's note, and says nothing when there is none", () => {
    const silent = correctionStep(
      revisionTwo({
        correction: {
          fromRevisionId: REV_1_ID,
          classification: classification({ note: null }),
          loopReturn: null,
        },
      }),
      "claude-fable-5",
    );

    expect(correctionStep(revisionTwo(), "claude-fable-5")?.note).toBe(CORRECTION_NOTE);
    expect(silent?.note).toBeNull();
  });

  it("takes the attempt from the revision's test verdict, then from its stage", () => {
    const staged = revisionTwo({
      testAttempt: null,
      stageAttempt: { stageKey: "implement", attempt: 5 },
    });
    const unknown = revisionTwo({ testAttempt: null });

    expect(correctionStep(revisionTwo(), null)?.label).toBe("Correction round · attempt 4");
    expect(correctionStep(staged, null)?.label).toBe("Correction round · attempt 5");
    expect(correctionStep(unknown, null)?.label).toBe(CORRECTION_LABEL);
  });

  it("is not drawn when nothing recorded bridged the revisions", () => {
    const pushed = revisionTwo({
      correction: { fromRevisionId: REV_1_ID, classification: null, loopReturn: null },
    });

    expect(correctionStep(pushed, "claude-fable-5")).toBeNull();
    expect(correctionStep(revisionOne(), "claude-fable-5")).toBeNull();
    expect(stripSteps(stripPage({ revisions: [revisionOne(), pushed] })).map((s) => s.kind)).toEqual(
      ["revision", "revision", "future"],
    );
  });
});

describe("the future step", () => {
  it("is ghosted until the plan is armed, and armed while it is", () => {
    const plan = stripPage().plan;
    const armed = stripPage({
      plan: { ...plan, armed: true, armedAgainstRevisionId: REV_2_ID },
      pullRequest: { state: "armed" },
    });

    expect(futureStep(stripPage())).toMatchObject({
      treatment: "ghosted",
      label: "Auto-merge (squash)",
    });
    expect(futureStep(armed)).toMatchObject({
      treatment: "armed",
      label: "Auto-merge (squash) — armed",
      meta: "on all gates green · policy: standard-fix",
    });
    // Disarmed again, it is the plan as it was.
    expect(futureStep({ ...armed, plan })).toEqual(futureStep(stripPage()));
  });

  it("states the plan's own strategy", () => {
    const rebase = stripPage({ plan: { ...stripPage().plan, strategy: "rebase" } });

    expect(futureStep(rebase)?.label).toBe("Auto-merge (rebase)");
  });

  it("names no policy for a PR no loop opened", () => {
    expect(futureStep(stripPage({ pullRequest: { run: null } }))?.meta).toBe(ON_ALL_GREEN);
  });

  it("is not drawn for a merged or closed PR — there is no merge left to promise", () => {
    expect(futureStep(stripPage({ pullRequest: { state: "merged" } }))).toBeNull();
    expect(futureStep(stripPage({ pullRequest: { state: "closed" } }))).toBeNull();
  });
});

describe("the scope", () => {
  it("reads a revision's ordinal from the address, and nothing else", () => {
    expect(revisionParam("1")).toBe(1);
    expect(revisionParam("12")).toBe(12);

    for (const value of [undefined, "", "0", "-1", "1.5", "01", "one", " 1", "1e3", "9999999999"]) {
      expect(revisionParam(value), String(value)).toBeNull();
    }
    expect(revisionParam(["1", "2"])).toBeNull();
  });

  it("finds the revision chosen, and none for an ordinal the PR does not have", () => {
    expect(scopedRevision(stripPage(), 1)?.id).toBe(REV_1_ID);
    expect(scopedRevision(stripPage(), 9)).toBeNull();
    expect(scopedRevision(stripPage(), null)).toBeNull();
  });

  it("scopes the gates to revision 1's two-red snapshot, not today's", () => {
    const scope = gatesScope(stripPage(), 1);

    expect(scope).toMatchObject({
      seq: 1,
      scoped: true,
      heading: "Revision 1 · 3f9c2ae · 2 gates red",
    });
    expect(scope?.rows.filter((row) => row.verdict === "red").map((row) => row.evidence)).toEqual([
      TESTS_RED,
      HIL_RED,
    ]);
  });

  it("follows the latest revision when none is chosen, or the choice names none", () => {
    for (const scoped of [null, 9]) {
      expect(gatesScope(stripPage(), scoped)).toMatchObject({
        seq: 2,
        scoped: false,
        heading: "Revision 2 · b7e41d0 · 5/7 gates green",
      });
    }
    expect(gatesScope(prPage({ revisions: [] }), null)).toBeNull();
  });

  it("writes the scope into the address and keeps everything else", () => {
    expect(withRevision("", 1)).toBe(`?${PR_REVISION_PARAM}=1`);
    expect(withRevision("?from=build-farm", 1)).toBe("?from=build-farm&rev=1");
    expect(withRevision("?from=build-farm&rev=1", 2)).toBe("?from=build-farm&rev=2");
    expect(withRevision("?from=build-farm&rev=1", null)).toBe("?from=build-farm");
    expect(withRevision("?rev=1", null)).toBe("");
  });
});

describe("scrolling the current revision into view", () => {
  const view = { scrollLeft: 0, viewLeft: 100, viewWidth: 400 };

  it("leaves the wrapper alone when the step is wholly visible", () => {
    expect(scrollTarget({ ...view, stepLeft: 150, stepWidth: 200 })).toBe(0);
    expect(scrollTarget({ ...view, scrollLeft: 80, stepLeft: 300, stepWidth: 200 })).toBe(80);
  });

  it("moves the least that shows a step past the trailing edge", () => {
    // The step spans 600–800 in the viewport; the wrapper shows 100–500.
    expect(scrollTarget({ ...view, stepLeft: 600, stepWidth: 200 })).toBe(300);
  });

  it("brings back a step before the leading edge", () => {
    expect(scrollTarget({ ...view, scrollLeft: 300, stepLeft: -50, stepWidth: 200 })).toBe(150);
  });

  it("shows the leading edge of a step wider than the wrapper", () => {
    expect(scrollTarget({ ...view, stepLeft: 300, stepWidth: 500 })).toBe(200);
  });

  it("never scrolls before the start", () => {
    expect(scrollTarget({ ...view, scrollLeft: 10, stepLeft: 50, stepWidth: 200 })).toBe(0);
  });
});
