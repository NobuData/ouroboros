import { describe, expect, it } from "vitest";

import type { FailureClass } from "@/app/api/test-results";
import {
  AUTO_RERUN_NOTE,
  CLASSIFY_SENDING,
  CLASS_REQUIRED,
  MAX_NOTE_LENGTH,
  NOTE_REQUIRED,
  NOTE_TOO_LONG,
  RECORD_LABEL,
  TOGGLE_SENDING,
  VIEWER_TOGGLE_REASON,
  activationNote,
  blockText,
  formView,
  nextAttemptOf,
  noteHint,
  primaryLabel,
  togglesView,
  worklistView,
} from "@/app/test-results/mark-route";
import { pickView } from "@/app/test-results/mark-route-pick";

import {
  BUILD_3_ID,
  CORRECTION_NOTE,
  FLAKY_CASE,
  OVERSHOOT_CASE,
  OVERSHOOT_REASON,
  classification,
  hints,
  timeline,
} from "../helpers/test-results";

/**
 * The Mark & Route card's form, toggles and worklist (#340), without rendering: when a note is
 * required, what each action says it does, what each toggle states about its enforcement, and
 * the attempt a correction round would open.
 */

/** The seeded timeline's next step. */
const NEXT = timeline().next;

describe("the form", () => {
  /** The form over the seeded heuristic pick. */
  function form(over: Partial<Parameters<typeof formView>[0]> = {}) {
    return formView({
      pick: pickView(hints(), OVERSHOOT_CASE.caseId),
      chosen: null,
      note: "",
      nextAttempt: 4,
      sending: false,
      ...over,
    });
  }

  it("pre-selects the pick's radio and puts the affix on it", () => {
    const view = form();

    expect(view.selected).toBe("product_bug");
    expect(view.radios.map((radio) => [radio.label, radio.checked, radio.affix])).toEqual([
      ["Product bug", true, "heuristic · new failure ∩ diff-path overlap"],
      ["Test needs update", false, null],
      ["Flake — retry", false, null],
      ["Infra — rig issue", false, null],
    ]);
    expect(view.radios[0]!.affixTitle).toBe(OVERSHOOT_REASON);
  });

  it("keeps the affix on the pick's radio when the reader chooses another", () => {
    const view = form({ chosen: "flake_retry" });

    expect(view.selected).toBe("flake_retry");
    expect(view.radios.map((radio) => radio.checked)).toEqual([false, false, true, false]);
    expect(view.radios.map((radio) => radio.affix !== null)).toEqual([true, false, false, false]);
  });

  it("selects nothing, and waits for a class, when there is no pick", () => {
    const view = form({ pick: { kind: "none" } });

    expect(view.selected).toBeNull();
    expect(view.radios.every((radio) => !radio.checked && radio.affix === null)).toBe(true);
    expect(view.primary).toBe(RECORD_LABEL);
    expect(view.reason).toBe(CLASS_REQUIRED);
  });

  it.each(["product_bug", "test_update"] as const)(
    "cannot submit %s without a note",
    (chosen) => {
      for (const note of ["", "   ", "\n\t"]) {
        const view = form({ chosen, note });

        expect(view.noteRequired).toBe(true);
        expect(view.reason).toBe(NOTE_REQUIRED);
      }

      expect(form({ chosen, note: CORRECTION_NOTE }).reason).toBeNull();
    },
  );

  it.each(["flake_retry", "infra_rig"] as const)("submits %s with or without one", (chosen) => {
    expect(form({ chosen }).noteRequired).toBe(false);
    expect(form({ chosen }).reason).toBeNull();
    expect(form({ chosen, note: "rig PSU browned out" }).reason).toBeNull();
  });

  it("refuses a note longer than the service keeps", () => {
    const view = form({ note: "x".repeat(MAX_NOTE_LENGTH + 1) });

    expect(view.noteError).toBe(NOTE_TOO_LONG);
    expect(view.reason).toBe(NOTE_TOO_LONG);
    expect(form({ note: "x".repeat(MAX_NOTE_LENGTH) }).noteError).toBeNull();
  });

  it("waits, and says so, while a decision is being sent", () => {
    expect(form({ note: CORRECTION_NOTE, sending: true }).reason).toBe(CLASSIFY_SENDING);
  });

  it("names the attempt a correction round opens, in the action and under the note", () => {
    expect(primaryLabel("product_bug", 4)).toBe("Queue correction round → attempt 4");
    expect(primaryLabel("test_update", 2)).toBe("Queue correction round → attempt 2");
    expect(noteHint("product_bug", 4)).toBe("Injected into attempt 4's planning context.");
  });

  it("names no attempt it was not told", () => {
    expect(primaryLabel("product_bug", null)).toBe("Queue correction round");
    expect(noteHint("product_bug", null)).toBe(
      "Injected into the next attempt's planning context.",
    );
    expect(noteHint(null, null)).not.toMatch(/\d/);
  });

  it("says what the other two routes do, and promises neither a correction round", () => {
    for (const chosen of ["flake_retry", "infra_rig"] as FailureClass[]) {
      expect(primaryLabel(chosen, 4)).not.toMatch(/correction|attempt/i);
      expect(noteHint(chosen, 4)).not.toMatch(/planning context|attempt/i);
      expect(noteHint(chosen, 4)).toMatch(/^Optional/);
    }

    expect(primaryLabel("flake_retry", 4)).toBe("Mark as flake & re-run the case");
    expect(primaryLabel("infra_rig", 4)).toBe("Flag the rig's runner");
  });
});

describe("the toggles", () => {
  /** The toggles over the seeded next step. */
  function toggles(over: Partial<Parameters<typeof togglesView>[0]> = {}) {
    return togglesView({ next: NEXT, held: {}, mayClassify: true, sending: false, ...over });
  }

  it("are the mockup's two, in its order, as the timeline stores them", () => {
    expect(toggles().map((each) => [each.field, each.text, each.checked, each.reason])).toEqual([
      ["blockUntilGreen", "Block PR #514 until green", true, null],
      ["autoRerunPhysical", "Auto re-run physical suite after fix", false, null],
    ]);
  });

  it("name what pressing each would do — never the row's own words", () => {
    const [block, rerun] = toggles();

    expect(block!.label).toBe("Switch off: Block PR #514 until green");
    expect(rerun!.label).toBe("Switch on: Auto re-run physical suite after fix");
    expect(block!.label).not.toBe(block!.text);
  });

  it("name no PR before the run has opened one", () => {
    expect(blockText({ pullRequest: null })).toBe("Block PR until green");
    expect(toggles({ next: { ...NEXT, pullRequest: null, activation: "none", gate: null } })[0]!.text).toBe(
      "Block PR until green",
    );
  });

  it("draw a value just stored until the timeline agrees", () => {
    const [block, rerun] = toggles({ held: { blockUntilGreen: false, autoRerunPhysical: true } });

    expect(block!.checked).toBe(false);
    expect(rerun!.checked).toBe(true);
  });

  it("are read-only, with the reason, for a viewer — and wait while one is stored", () => {
    expect(toggles({ mayClassify: false }).map((each) => each.reason)).toEqual([
      VIEWER_TOGGLE_REASON,
      VIEWER_TOGGLE_REASON,
    ]);
    expect(toggles({ sending: true }).map((each) => each.reason)).toEqual([
      TOGGLE_SENDING,
      TOGGLE_SENDING,
    ]);
    // A viewer is told they are a viewer, not that something is being stored.
    expect(toggles({ mayClassify: false, sending: true })[0]!.reason).toBe(VIEWER_TOGGLE_REASON);
  });

  it("states the gate that holds the PR, and where it comes from, when the gate is armed", () => {
    expect(activationNote(NEXT)).toBe(
      "Enforced now: PR #514's test-suite gate is required (standard-fix v14), and the merge re-checks it.",
    );
    expect(activationNote({ ...NEXT, gate: null })).toBe(
      "Enforced now: PR #514's test-suite gate is required, and the merge re-checks it.",
    );
  });

  it.each(["intent_stored", "none"] as const)(
    "states the activation point while nothing holds the PR (%s)",
    (activation) => {
      const withPr = activationNote({ ...NEXT, activation, gate: null });
      const without = activationNote({ activation, pullRequest: null, gate: null });

      for (const note of [withPr, without]) {
        expect(note).toMatch(/^Stored as an intent\./);
        expect(note).toContain("Enforcement activates with the PR plane");
        expect(note).not.toMatch(/Enforced now/);
      }

      expect(withPr).toContain("PR #514's test-suite gate becomes required");
      expect(without).toContain("once this run opens a pull request");
    },
  );

  it("never claims an armed gate for a run with no PR to hold", () => {
    expect(
      activationNote({ activation: "gate_armed", pullRequest: null, gate: null }),
    ).toMatch(/^Stored as an intent\./);
  });

  it("says nothing acts on the auto re-run intent yet", () => {
    expect(toggles()[1]!.note).toBe(AUTO_RERUN_NOTE);
    expect(AUTO_RERUN_NOTE).toMatch(/^Stored as an intent\./);
  });
});

describe("the staged worklist", () => {
  const staged = {
    testRunId: BUILD_3_ID,
    cases: [OVERSHOOT_CASE, { ...FLAKY_CASE, caseId: "unreported" }],
  };

  it("is nothing while nothing is staged", () => {
    expect(worklistView(null, new Set(), [], null)).toBeNull();
  });

  it("lists each staged failure, which is bound, and what each was decided as", () => {
    expect(
      worklistView(
        staged,
        new Set([OVERSHOOT_CASE.caseId]),
        [classification()],
        OVERSHOOT_CASE.caseId,
      ),
    ).toEqual([
      {
        caseId: OVERSHOOT_CASE.caseId,
        text: "PHYSICAL · HIL rig › pid_overshoot_under_load",
        decided: "Product bug",
        bound: true,
        state: "openable",
      },
      {
        caseId: "unreported",
        text: "telemetry › can_frame_roundtrip",
        decided: null,
        bound: false,
        state: "unopenable",
      },
    ]);
  });

  it("claims nothing about a failure before the attempt's page has been read", () => {
    expect(worklistView(staged, null, [], null)!.map((row) => row.state)).toEqual([
      "unread",
      "unread",
    ]);
  });
});

describe("the attempt a correction round would open", () => {
  it("is one more than the active stage's attempt", () => {
    expect(
      nextAttemptOf([
        { status: "succeeded", attempt: 1, startedAt: "2026-09-19T13:40:00.000Z" },
        { status: "active", attempt: 3, startedAt: "2026-09-19T14:30:00.000Z" },
        { status: "pending", attempt: 1, startedAt: null },
      ]),
    ).toBe(4);
  });

  it("is one more than the most recently started stage's when none is active", () => {
    expect(
      nextAttemptOf([
        { status: "succeeded", attempt: 1, startedAt: "2026-09-19T13:40:00.000Z" },
        { status: "failed", attempt: 2, startedAt: "2026-09-19T14:30:00.000Z" },
        { status: "succeeded", attempt: 5, startedAt: null },
      ]),
    ).toBe(3);
  });

  it("is unknown before any stage has started, and when the stages could not be read", () => {
    expect(nextAttemptOf(null)).toBeNull();
    expect(nextAttemptOf([])).toBeNull();
    expect(nextAttemptOf([{ status: "pending", attempt: 1, startedAt: null }])).toBeNull();
  });
});
