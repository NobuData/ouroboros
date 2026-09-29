import { describe, expect, it } from "vitest";

import type { CaseHint } from "@/app/api/test-results";
import { currentDecision } from "@/app/test-results/mark-route-decision";
import {
  AI_PICK_AFFIX,
  CLASSES,
  HEURISTIC_AFFIX,
  asFailureClass,
  casePick,
  classLabel,
  heuristicAffix,
  isCorrection,
  pickView,
  storedPick,
} from "@/app/test-results/mark-route-pick";

import {
  FLAKY_CASE,
  OVERSHOOT_CASE,
  OVERSHOOT_REASON,
  caseHint,
  classification,
  hints,
  modelHint,
} from "../helpers/test-results";

/**
 * What may pre-select a Mark & Route radio, and what its affix may say (#340), without
 * rendering: the four classes, a rule's pick and a model's, and a classification a rule or a
 * model stored.
 */

/** Anything that reads as a percentage. */
const PERCENTAGE = /\d\s*%/;

describe("the classes", () => {
  it("are the mockup's four, in its order", () => {
    expect(CLASSES.map((each) => [each.value, each.label])).toEqual([
      ["product_bug", "Product bug"],
      ["test_update", "Test needs update"],
      ["flake_retry", "Flake — retry"],
      ["infra_rig", "Infra — rig issue"],
    ]);
  });

  it("reads a class from anything, and nothing that is not one", () => {
    expect(asFailureClass("flake_retry")).toBe("flake_retry");

    for (const value of ["wontfix", "", "PRODUCT_BUG", null, undefined, 1, {}]) {
      expect(asFailureClass(value)).toBeNull();
    }
  });

  it("names each, and only two of them queue a correction round", () => {
    expect(classLabel("infra_rig")).toBe("Infra — rig issue");
    expect(CLASSES.map((each) => isCorrection(each.value))).toEqual([true, true, false, false]);
    expect(isCorrection(null)).toBe(false);
  });
});

describe("the pick — what pre-selects a radio, and what its affix may say", () => {
  it("is the rule's, named, for a heuristic answer", () => {
    expect(pickView(hints(), OVERSHOOT_CASE.caseId)).toEqual({
      kind: "heuristic",
      class: "product_bug",
      affix: "heuristic · new failure ∩ diff-path overlap",
      reason: OVERSHOOT_REASON,
    });
  });

  it("names each of the service's three rules in the failure card's words", () => {
    expect(heuristicAffix("flake.pass_on_retry")).toBe("heuristic · passed on a sanctioned retry");
    expect(heuristicAffix("infra.rig_error")).toBe(
      "heuristic · job, runner or failure text names infrastructure",
    );
    expect(heuristicAffix("product.new_failure_in_diff")).toBe(
      "heuristic · new failure ∩ diff-path overlap",
    );
  });

  it("prints a rule this client does not know as its id, and no rule as the bare word", () => {
    expect(heuristicAffix("custom.rule_9")).toBe("heuristic · custom.rule_9");
    expect(heuristicAffix(null)).toBe(HEURISTIC_AFFIX);
  });

  it("never shows a percentage while the actor is heuristic — whatever the payload carries", () => {
    const malformed: CaseHint[] = [
      // A confidence beside a heuristic answer, which the contract forbids.
      caseHint({ triage: { ...caseHint().triage!, confidence: 84 } }),
      // The same, with a narrative and a model's name too.
      caseHint({
        triage: {
          ...caseHint().triage!,
          confidence: 84,
          narrative: "Confidence 84%.",
          provenance: { ...caseHint().triage!.provenance, model: "claude-fable-5" },
        },
      }),
      // A confidence on the hint itself.
      caseHint({ hint: { ...caseHint().hint!, confidence: 84 } as never }),
      // A rule whose name reads as a percentage.
      caseHint({
        hint: { ...caseHint().hint!, ruleId: "84% sure" as never },
        triage: null,
      }),
      // No hint at all, and a triage answer that says heuristic.
      caseHint({ hint: null, triage: { ...caseHint().triage!, confidence: 99 } }),
    ];

    for (const entry of malformed) {
      const pick = casePick(entry);

      expect(pick.kind).toBe("heuristic");
      if (pick.kind !== "heuristic") continue;

      expect(pick.affix).not.toMatch(PERCENTAGE);
      expect(pick.affix).not.toContain(AI_PICK_AFFIX);
      expect(pick.affix.startsWith(HEURISTIC_AFFIX)).toBe(true);
    }
  });

  it("is `AI pick · N%` only when the actor is model", () => {
    expect(casePick(modelHint())).toEqual({
      kind: "model",
      class: "product_bug",
      affix: "AI pick · 84%",
    });
    expect(casePick(modelHint({ class: "test_update", confidence: 61.4 }))).toEqual({
      kind: "model",
      class: "test_update",
      affix: "AI pick · 61%",
    });
  });

  it("draws a model's pick without a percentage when its confidence cannot be read as one", () => {
    for (const confidence of [null, 140, -3, Number.NaN, "84" as never]) {
      expect(casePick(modelHint({ confidence }))).toEqual({
        kind: "model",
        class: "product_bug",
        affix: AI_PICK_AFFIX,
      });
    }
  });

  it("pre-selects nothing when nothing suggested a class this card knows", () => {
    expect(pickView(null, OVERSHOOT_CASE.caseId)).toEqual({ kind: "none" });
    expect(pickView(hints(), FLAKY_CASE.caseId)).toEqual({ kind: "none" });
    expect(casePick(caseHint({ hint: null, triage: null }))).toEqual({ kind: "none" });
    expect(casePick(modelHint({ class: "wontfix" as never }))).toEqual({ kind: "none" });
    expect(
      casePick(
        caseHint({
          hint: { ...caseHint().hint!, suggestedClass: "wontfix" as never },
          triage: null,
        }),
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("a stored suggestion — a classification a rule or a model wrote", () => {
  /** The seed's precursor on Build 3's overshoot: a rule's, with no note and no receipt. */
  const precursor = classification({
    actor: "heuristic",
    ruleId: "hil.limit_exceeded",
    note: null,
    routed: null,
    createdBy: null,
  });

  it("pre-selects its class with the heuristic affix, naming its rule", () => {
    expect(storedPick(precursor)).toEqual({
      kind: "heuristic",
      class: "product_bug",
      affix: "heuristic · hil.limit_exceeded",
      reason: null,
    });
    expect(pickView(null, OVERSHOOT_CASE.caseId, [precursor])).toEqual(storedPick(precursor));
  });

  it("is never a decision: the case stays undecided, with nothing to re-classify", () => {
    expect(currentDecision([precursor], null, OVERSHOOT_CASE.caseId)).toBeNull();
    expect(
      currentDecision(
        [classification({ actor: "model", confidence: 84, createdBy: null })],
        null,
        OVERSHOOT_CASE.caseId,
      ),
    ).toBeNull();
  });

  it("never shows a percentage while its actor is heuristic — even one stored beside it", () => {
    const pick = storedPick({ ...precursor, confidence: 84 });

    expect(pick).toEqual(storedPick(precursor));
    expect(pick.kind === "heuristic" && pick.affix).not.toMatch(PERCENTAGE);
  });

  it("is `AI pick · N%` only when its actor is model", () => {
    expect(
      storedPick(classification({ actor: "model", confidence: 84, createdBy: null })),
    ).toEqual({ kind: "model", class: "product_bug", affix: "AI pick · 84%" });
    expect(
      storedPick(classification({ actor: "model", confidence: null, createdBy: null })),
    ).toEqual({ kind: "model", class: "product_bug", affix: AI_PICK_AFFIX });
  });

  it("is nothing for a person's decision, which is a decision and not a suggestion", () => {
    expect(storedPick(classification())).toEqual({ kind: "none" });
    expect(pickView(null, OVERSHOOT_CASE.caseId, [classification()])).toEqual({ kind: "none" });
  });

  it("gives way to the hint the failure-detail card states, and both to a model", () => {
    // The hint and the stored rule disagree about the rule: the hint is what the page states.
    expect(pickView(hints(), OVERSHOOT_CASE.caseId, [precursor])).toEqual(
      pickView(hints(), OVERSHOOT_CASE.caseId),
    );

    const model = classification({
      actor: "model",
      class: "test_update",
      confidence: 71,
      createdBy: null,
    });

    expect(pickView(hints(), OVERSHOOT_CASE.caseId, [model])).toEqual({
      kind: "model",
      class: "test_update",
      affix: "AI pick · 71%",
    });
    expect(pickView(hints([modelHint()]), OVERSHOOT_CASE.caseId, [precursor])).toEqual({
      kind: "model",
      class: "product_bug",
      affix: "AI pick · 84%",
    });
  });

  it("is read for its own case only", () => {
    expect(pickView(null, FLAKY_CASE.caseId, [precursor])).toEqual({ kind: "none" });
  });
});
