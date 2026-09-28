import { describe, expect, it } from "vitest";

import type { CaseHint } from "@/app/api/test-results";
import {
  NO_FAILURES,
  boundIndex,
  buildTag,
  caseTriage,
  confidenceText,
  didNotFail,
  failureScope,
  figureSegments,
  isErrorLine,
  logLines,
  noFailuresIn,
  pagerStep,
  pagerView,
  pathLine,
  ruleText,
  triageActor,
  triageView,
} from "@/app/test-results/failure";
import { physicalView } from "@/app/test-results/physical";
import { suitesView } from "@/app/test-results/suites";

import {
  FLAKY_CASE,
  MODEL_NAME,
  MODEL_NARRATIVE,
  OVERSHOOT_CASE,
  OVERSHOOT_LOG,
  OVERSHOOT_MESSAGE,
  OVERSHOOT_PATH,
  OVERSHOOT_REASON,
  caseFailure,
  caseHint,
  hints,
  mockupPage,
  modelHint,
  seededSuites,
  suite,
  testCase,
} from "../helpers/test-results";

/**
 * The failure-detail card's rules (#339): what the page's selections leave on the card, the
 * pager, the path and the log as they came, and the triage section decided by the payload's
 * actor.
 */

/** A hint entry whose fields are whatever a malformed payload put there. */
function malformed(entry: unknown): CaseHint {
  return entry as CaseHint;
}

describe("failureScope", () => {
  const suites = seededSuites();

  it("holds every failure of the attempt, in the payload's order, when nothing is selected", () => {
    const scope = failureScope(suites, null, null, 3);

    expect(scope.entries.map((each) => each.caseId)).toEqual([FLAKY_CASE.caseId, OVERSHOOT_CASE.caseId]);
    expect(scope.entries[1]).toEqual({
      caseId: OVERSHOOT_CASE.caseId,
      name: OVERSHOOT_CASE.name,
      suite: "PHYSICAL · HIL rig",
      platform: "rig:helios-rig-02",
      status: "failed",
    });
    expect(scope.note).toBeNull();
  });

  it("holds the selected suite's failures alone", () => {
    const { scope } = suitesView(suites, { name: "telemetry integration", platform: null });

    expect(failureScope(suites, scope, null, 3).entries.map((each) => each.caseId)).toEqual([FLAKY_CASE.caseId]);
  });

  it("says a selected suite has no failures, and which build", () => {
    const { scope } = suitesView(suites, { name: "motor control", platform: null });

    expect(failureScope(suites, scope, null, 2)).toEqual({ entries: [], note: noFailuresIn("motor control", 2) });
  });

  it("holds the selected physical case alone — the mockup's 1 of 1", () => {
    const page = mockupPage();
    const { scope } = physicalView(page, null, { name: "Motor overshoot on e-stop release", platform: null }, null);

    expect(failureScope(page.suites, null, scope, 3).entries.map((each) => each.caseId)).toEqual([
      OVERSHOOT_CASE.caseId,
    ]);
  });

  it("says a selected case did not fail, rather than showing another case's failure", () => {
    const page = mockupPage();
    const { scope } = physicalView(page, null, { name: "Power-loss mid-flash recovery", platform: null }, null);

    expect(failureScope(page.suites, null, scope, 3)).toEqual({
      entries: [],
      note: didNotFail("Power-loss mid-flash recovery", 3),
    });
  });

  it("says a build has no failures", () => {
    expect(failureScope([suite()], null, null, 3)).toEqual({ entries: [], note: NO_FAILURES });
    expect(failureScope([], null, null, 3).note).toBe(NO_FAILURES);
  });

  it("counts a case by its failure payload, not its status", () => {
    const only = suite({
      cases: [testCase({ id: "a", status: "failed", hasFailure: false }), testCase({ id: "b", status: "error", hasFailure: true })],
    });

    expect(failureScope([only], null, null, 1).entries.map((each) => each.caseId)).toEqual(["b"]);
  });
});

describe("the pager", () => {
  const { entries } = failureScope(seededSuites(), null, null, 3);

  it("binds the first failure until it is moved, and falls back to it for a case out of scope", () => {
    expect(boundIndex(entries, null)).toBe(0);
    expect(boundIndex(entries, OVERSHOOT_CASE.caseId)).toBe(1);
    expect(boundIndex(entries, "gone")).toBe(0);
    expect(boundIndex([], null)).toBe(-1);
  });

  it("counts 1 of N and leads to its neighbours", () => {
    expect(pagerView(entries, 0)).toEqual({
      text: "1 of 2",
      label: "Failure 1 of 2",
      paged: true,
      previous: null,
      next: OVERSHOOT_CASE.caseId,
    });
    expect(pagerView(entries, 1)).toEqual(expect.objectContaining({ text: "2 of 2", previous: FLAKY_CASE.caseId, next: null }));
  });

  it("is 1 of 1, with nowhere to go, for one failure", () => {
    expect(pagerView(entries.slice(0, 1), 0)).toEqual(expect.objectContaining({ text: "1 of 1", paged: false, previous: null, next: null }));
  });

  it("is nothing when there is no failure to count", () => {
    expect(pagerView([], -1)).toBeNull();
    expect(pagerView(entries, 2)).toBeNull();
  });

  it("steps with the arrows and stops at the ends, and jumps with Home and End", () => {
    expect(pagerStep("ArrowRight", 0, 3)).toBe(1);
    expect(pagerStep("ArrowRight", 2, 3)).toBeNull();
    expect(pagerStep("ArrowLeft", 1, 3)).toBe(0);
    expect(pagerStep("ArrowLeft", 0, 3)).toBeNull();
    expect(pagerStep("End", 0, 3)).toBe(2);
    expect(pagerStep("Home", 2, 3)).toBe(0);
    expect(pagerStep("Enter", 0, 3)).toBeNull();
    expect(pagerStep("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("pathLine", () => {
  it("is the path and the case's name — the mockup's line", () => {
    expect(pathLine(caseFailure())).toBe(`${OVERSHOOT_PATH}::overshoot_under_load`);
  });

  it("falls back to the classname, and then to the name alone", () => {
    expect(pathLine(caseFailure({ path: null, classname: "tests.hil.estop" }))).toBe("tests.hil.estop::overshoot_under_load");
    expect(pathLine(caseFailure({ path: "  ", classname: null }))).toBe("overshoot_under_load");
  });
});

describe("logLines", () => {
  it("draws the mockup's six lines, character for character, the assertion alone in err", () => {
    const lines = logLines(caseFailure());

    expect(lines).toHaveLength(6);
    expect(lines.map((line) => line.segments.map((segment) => segment.text).join("")).join("\n")).toBe(OVERSHOOT_LOG);
    expect(lines.map((line) => line.tone)).toEqual(["plain", "plain", "plain", "plain", "plain", "err"]);
  });

  it("marks a trial's percentage as a figure, and nothing in the assertion", () => {
    const lines = logLines(caseFailure());

    expect(lines[2]!.segments).toEqual([
      { text: "[rig] trial 2: peak 1228.8 rpm  → overshoot ", figure: false },
      { text: "2.4%", figure: true },
    ]);
    expect(lines[5]!.segments).toEqual([{ text: `E   ${OVERSHOOT_MESSAGE}`, figure: false }]);
  });

  it("adds the message as a last err line when the excerpt does not state it", () => {
    const lines = logLines(caseFailure({ logExcerpt: "[rig] trial 1", message: "timed out" }));

    expect(lines.map((line) => [line.segments[0]!.text, line.tone])).toEqual([
      ["[rig] trial 1", "plain"],
      ["timed out", "err"],
    ]);
  });

  it("is the message alone for a failure with no excerpt, and empty for one with neither", () => {
    expect(logLines(caseFailure({ logExcerpt: null })).map((line) => line.tone)).toEqual(["err"]);
    expect(logLines(caseFailure({ logExcerpt: null, message: null }))).toEqual([]);
    expect(logLines(caseFailure({ logExcerpt: "  \n", message: " " }))).toEqual([]);
  });

  it("keeps blank lines and leading whitespace, and reads CRLF as one break", () => {
    const lines = logLines(caseFailure({ logExcerpt: "a\r\n\r\n    b\n", message: null }));

    expect(lines.map((line) => line.segments.map((segment) => segment.text).join(""))).toEqual(["a", "", "    b"]);
  });

  it("knows pytest's marker and the message, and nothing else, as the assertion", () => {
    expect(isErrorLine("E   AssertionError: x", "")).toBe(true);
    expect(isErrorLine("Error budget ok", "")).toBe(false);
    expect(isErrorLine("FAILED: boom", "boom")).toBe(true);
    expect(figureSegments("")).toEqual([{ text: "", figure: false }]);
    expect(figureSegments("2% of 10%")).toEqual([
      { text: "2%", figure: true },
      { text: " of ", figure: false },
      { text: "10%", figure: true },
    ]);
  });
});

describe("the triage section", () => {
  it("states the heuristic hint's rule and why it fired", () => {
    expect(caseTriage(caseHint())).toEqual({
      kind: "heuristic",
      rule: "new failure ∩ diff-path overlap → product bug",
      ruleId: "product.new_failure_in_diff",
      reason: OVERSHOOT_REASON,
    });
  });

  it("states each of the three rules, and prints one it does not know as it came", () => {
    expect(ruleText("flake.pass_on_retry", "flake_retry")).toBe("passed on a sanctioned retry → flake — retry");
    expect(ruleText("infra.rig_error", "infra_rig")).toBe("job, runner or failure text names infrastructure → infra — rig issue");
    expect(ruleText("custom.rule", "new_class")).toBe("custom.rule → new_class");
    expect(ruleText(null, "test_update")).toBe("test needs update");
  });

  it("draws a model's narrative, pill and confidence only for the model actor", () => {
    expect(triageActor(modelHint())).toBe("model");
    expect(caseTriage(modelHint())).toEqual({
      kind: "model",
      narrative: MODEL_NARRATIVE,
      model: MODEL_NAME,
      confidence: "84%",
    });
  });

  it("never carries a confidence or a model while the actor is heuristic, whatever the payload says", () => {
    const lying = malformed({
      ...caseHint(),
      hint: { ...caseHint().hint, confidence: 84 },
      triage: {
        ...modelHint().triage,
        provenance: { contract: "triage/v0", actor: "heuristic", rule_id: "product.new_failure_in_diff", model: MODEL_NAME },
      },
    });
    const view = caseTriage(lying);

    expect(triageActor(lying)).toBe("heuristic");
    expect(view.kind).toBe("heuristic");
    expect(view).not.toHaveProperty("confidence");
    expect(view).not.toHaveProperty("model");
    expect(view).not.toHaveProperty("narrative");
    expect(JSON.stringify(view)).not.toMatch(/84|%|claude/);
  });

  it("treats an answer that names no actor as no model", () => {
    const anonymous = malformed({ ...caseHint(), triage: { ...modelHint().triage, provenance: {} } });

    expect(caseTriage(anonymous).kind).toBe("heuristic");
    expect(caseTriage(malformed({ ...caseHint(), hint: null, triage: { confidence: 84, narrative: "x" } }))).toEqual({ kind: "none" });
  });

  it("falls back to the heuristic hint when a model answered no narrative", () => {
    const view = caseTriage(modelHint({ narrative: "  " as never }));

    expect(view).toEqual(expect.objectContaining({ kind: "heuristic", ruleId: "product.new_failure_in_diff" }));
    expect(view).not.toHaveProperty("confidence");
  });

  it("reads the rule off the triage answer when the entry carries no hint", () => {
    expect(caseTriage(caseHint({ hint: null }))).toEqual({
      kind: "heuristic",
      rule: "new failure ∩ diff-path overlap → product bug",
      ruleId: "product.new_failure_in_diff",
      reason: null,
    });
  });

  it("is none when no rule fired", () => {
    expect(caseTriage(caseHint({ hint: null, triage: null }))).toEqual({ kind: "none" });
  });

  it("prints a confidence only from a number between 0 and 100", () => {
    expect(confidenceText(84)).toBe("84%");
    expect(confidenceText(83.6)).toBe("84%");
    expect(confidenceText(0)).toBe("0%");
    expect(confidenceText(101)).toBeNull();
    expect(confidenceText(-1)).toBeNull();
    expect(confidenceText("84")).toBeNull();
    expect(confidenceText(Number.NaN)).toBeNull();
    expect(confidenceText(null)).toBeNull();
  });

  it("finds the bound case's entry, and says reading or why until hints are held", () => {
    expect(triageView(null, OVERSHOOT_CASE.caseId, null)).toEqual({ kind: "reading" });
    expect(triageView(null, OVERSHOOT_CASE.caseId, "Unavailable.")).toEqual({ kind: "unread", reason: "Unavailable." });
    expect(triageView(hints(), OVERSHOOT_CASE.caseId, "Unavailable.").kind).toBe("heuristic");
    expect(triageView(hints(), FLAKY_CASE.caseId, null)).toEqual({ kind: "none" });
  });
});

describe("buildTag", () => {
  it("is the mockup's tag", () => {
    expect(buildTag(3)).toBe("build 3");
  });
});
