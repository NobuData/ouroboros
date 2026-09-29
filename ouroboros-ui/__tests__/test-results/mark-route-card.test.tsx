import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FailureEntry } from "@/app/test-results/failure";
import {
  CLASSIFY_LEGEND,
  KEEP_DECISION_LABEL,
  MARK_ROUTE_ID,
  MARK_ROUTE_TITLE,
  NOTE_LABEL,
  NOTE_REQUIRED,
  NOTHING_TO_CLASSIFY,
  RECEIPT_LABEL,
  RECLASSIFY_LABEL,
  STAGED_LABEL,
  STAGED_UNOPENABLE,
  VIEWER_NOTE,
  VIEWER_TOGGLE_REASON,
  WAIVE_LABEL,
  formView,
  togglesView,
  worklistView,
} from "@/app/test-results/mark-route";
import {
  NOTHING_DISPATCHED,
  WAIVE_DEFERRED,
  currentDecision,
  recordedView,
  waiverView,
} from "@/app/test-results/mark-route-decision";
import { pickView } from "@/app/test-results/mark-route-pick";
import { MarkRouteCard, type MarkRouteCardProps } from "@/app/test-results/mark-route-card";

import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_3_ID,
  CONTROL_ID,
  CORRECTION_NOTE,
  DECIDER_ID,
  FLAKY_CASE,
  OVERSHOOT_CASE,
  OVERSHOOT_REASON,
  PEOPLE,
  classification,
  classifyResult,
  hints,
  modelHint,
  timeline,
  waiver,
} from "../helpers/test-results";

/**
 * The Mark & Route card, drawn (#340): the radios with their honest affix, the labelled note,
 * the toggles with their activation tooltip, the receipt as evidence, the recorded decision with
 * its re-classify affordance — and what a viewer and a member are not offered.
 */

/** Anything that reads as a percentage. */
const PERCENTAGE = /\d\s*%/;

/** The failure on the card. */
const TARGET: FailureEntry = {
  caseId: OVERSHOOT_CASE.caseId,
  name: OVERSHOOT_CASE.name,
  suite: OVERSHOOT_CASE.suite,
  platform: "rig:helios-rig-02",
  status: "failed",
};

/** The recorded decision the page serves. */
function recorded(over: Parameters<typeof classification>[0] = {}) {
  return recordedView({
    current: currentDecision([classification(over)], null, OVERSHOOT_CASE.caseId)!,
    runId: SEEDED_RUN_ID,
    from: "build-farm",
    readerId: DECIDER_ID,
    people: PEOPLE,
  });
}

/**
 * Draw the card.
 *
 * @param over What to change from an undecided failure in front of a member.
 * @returns The handlers, to be asked what was called.
 */
function draw(over: Partial<MarkRouteCardProps> = {}) {
  const handlers = {
    onPick: vi.fn(),
    onChoose: vi.fn(),
    onNote: vi.fn(),
    onSubmit: vi.fn(),
    onReclassify: vi.fn(),
    onKeep: vi.fn(),
    onToggle: vi.fn(),
    onWaive: vi.fn(),
  };

  render(
    <MarkRouteCard
      editing={false}
      empty={NOTHING_TO_CLASSIFY}
      form={formView({
        pick: pickView(hints(), OVERSHOOT_CASE.caseId),
        chosen: null,
        note: "",
        nextAttempt: 4,
        sending: false,
      })}
      mayClassify
      mayWaive={false}
      note=""
      recorded={null}
      refusal={null}
      target={TARGET}
      toggleRefusal={null}
      toggles={togglesView({
        next: timeline().next,
        held: {},
        mayClassify: true,
        sending: false,
      })}
      waiver={null}
      worklist={null}
      {...handlers}
      {...over}
    />,
  );

  return handlers;
}

/** The card. */
function card() {
  return within(screen.getByRole("region", { name: MARK_ROUTE_TITLE }));
}

describe("the card's frame", () => {
  it("keeps the id Send failures back to loop lands on, and takes focus", () => {
    draw();

    const region = screen.getByRole("region", { name: MARK_ROUTE_TITLE });

    expect(region).toHaveAttribute("id", MARK_ROUTE_ID);
    expect(region).toHaveAttribute("tabindex", "-1");
  });

  it("names the failure being decided in its head, as the mockup's tag does", () => {
    draw();

    expect(card().getByText(OVERSHOOT_CASE.name)).toBeInTheDocument();
  });

  it("says there is nothing to classify, and draws no form, without a failure", () => {
    draw({ target: null });

    expect(card().getByText(NOTHING_TO_CLASSIFY)).toBeInTheDocument();
    expect(card().queryByRole("radio")).toBeNull();
    expect(card().queryByRole("textbox")).toBeNull();
    expect(card().queryByRole("button", { name: /correction round/ })).toBeNull();
    // The toggles are the run's, and stay.
    expect(card().getAllByRole("switch")).toHaveLength(2);
  });
});

describe("the classify radios", () => {
  it("are the mockup's four under their legend, the pick's pre-selected", () => {
    draw();

    const group = card().getByRole("group", { name: CLASSIFY_LEGEND });
    const radios = within(group).getAllByRole("radio");

    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      "product_bug",
      "test_update",
      "flake_retry",
      "infra_rig",
    ]);
    expect(radios.map((radio) => (radio as HTMLInputElement).checked)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(within(group).getByRole("radio", { name: /^Test needs update$/ })).toBeInTheDocument();
  });

  it("reads `heuristic` with its rule, and never a percentage, while the actor is heuristic", () => {
    draw();

    const affix = card().getByText("heuristic · new failure ∩ diff-path overlap");

    expect(affix).toHaveAttribute("title", OVERSHOOT_REASON);
    expect(screen.getByRole("region", { name: MARK_ROUTE_TITLE }).textContent).not.toMatch(
      PERCENTAGE,
    );
    expect(card().queryByText(/AI pick/)).toBeNull();
  });

  it("reads `AI pick · 84%` only when the actor is model", () => {
    draw({
      form: formView({
        pick: pickView(hints([modelHint()]), OVERSHOOT_CASE.caseId),
        chosen: null,
        note: "",
        nextAttempt: 4,
        sending: false,
      }),
    });

    expect(card().getByText("AI pick · 84%")).toBeInTheDocument();
    expect(card().queryByText(/heuristic/)).toBeNull();
  });

  it("tells the panel which radio was pressed", () => {
    const { onChoose } = draw();

    fireEvent.click(card().getByRole("radio", { name: /^Flake — retry$/ }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith("flake_retry");
  });
});

describe("the correction note", () => {
  it("is labelled, and described by the mockup's injected-into-attempt hint", () => {
    draw();

    const note = card().getByRole("textbox", { name: NOTE_LABEL });

    expect(note).toHaveAccessibleDescription("Injected into attempt 4's planning context.");
    expect(note).toHaveAttribute("aria-required", "true");
  });

  it("tells the panel what was typed", () => {
    const { onNote } = draw();

    fireEvent.change(card().getByRole("textbox", { name: NOTE_LABEL }), {
      target: { value: CORRECTION_NOTE },
    });

    expect(onNote).toHaveBeenCalledExactlyOnceWith(CORRECTION_NOTE);
  });

  it("cannot be submitted empty for a correction round: the action is inert, and says why", () => {
    const { onSubmit } = draw();

    const primary = card().getByRole("button", { name: "Queue correction round → attempt 4" });

    expect(primary).toHaveAttribute("aria-disabled", "true");
    expect(primary).toHaveAttribute("title", NOTE_REQUIRED);

    fireEvent.click(primary);
    fireEvent.submit(primary.closest("form")!);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits once there is one", () => {
    const { onSubmit } = draw({
      note: CORRECTION_NOTE,
      form: formView({
        pick: pickView(hints(), OVERSHOOT_CASE.caseId),
        chosen: null,
        note: CORRECTION_NOTE,
        nextAttempt: 4,
        sending: false,
      }),
    });

    const primary = card().getByRole("button", { name: "Queue correction round → attempt 4" });

    expect(primary).not.toHaveAttribute("aria-disabled");
    fireEvent.click(primary);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("draws a refusal in the service's words, as an alert", () => {
    draw({ refusal: "The run has already finished." });

    expect(card().getByRole("alert")).toHaveTextContent("The run has already finished.");
  });
});

describe("the toggles", () => {
  it("are two labelled switches, in the state the timeline stores", () => {
    draw();

    const block = card().getByRole("switch", { name: "Switch off: Block PR #514 until green" });
    const rerun = card().getByRole("switch", {
      name: "Switch on: Auto re-run physical suite after fix",
    });

    expect(block).toHaveAttribute("aria-checked", "true");
    expect(rerun).toHaveAttribute("aria-checked", "false");
    expect(card().getByText("Block PR #514 until green")).toBeInTheDocument();
  });

  it("state the Block-PR toggle's activation point — as a tooltip, and as its description", () => {
    const stored = { ...timeline().next, activation: "intent_stored" as const, gate: null };
    draw({
      toggles: togglesView({ next: stored, held: {}, mayClassify: true, sending: false }),
    });

    const note =
      "Stored as an intent. Enforcement activates with the PR plane: PR #514's test-suite gate becomes required when its gates are next evaluated.";
    const block = card().getByRole("switch", { name: /Block PR #514 until green$/ });

    expect(block).toHaveAccessibleDescription(note);
    expect(card().getByTitle(note)).toBeInTheDocument();
  });

  it("state the gate that holds the PR once it is armed", () => {
    draw();

    expect(
      card().getByRole("switch", { name: /Block PR #514 until green$/ }),
    ).toHaveAccessibleDescription(
      "Enforced now: PR #514's test-suite gate is required (standard-fix v14), and the merge re-checks it.",
    );
  });

  it("tell the panel which was pressed", () => {
    const { onToggle } = draw();

    fireEvent.click(card().getByRole("switch", { name: /Auto re-run/ }));

    expect(onToggle).toHaveBeenCalledExactlyOnceWith("autoRerunPhysical");
  });

  it("draw a refusal as an alert", () => {
    draw({ toggleRefusal: "No such run." });

    expect(card().getByRole("alert")).toHaveTextContent("No such run.");
  });
});

describe("the routed receipt", () => {
  it("renders the control id and a working link to the target attempt — evidence, not a toast", () => {
    draw({ recorded: recorded() });

    const receipt = within(card().getByRole("group", { name: RECEIPT_LABEL }));

    expect(receipt.getByText(CONTROL_ID)).toBeInTheDocument();
    expect(receipt.getByRole("link", { name: "attempt 4 ↗" })).toHaveAttribute(
      "href",
      `/runs/${SEEDED_RUN_ID}?from=build-farm`,
    );
    expect(receipt.getByText("Correction round queued")).toBeInTheDocument();
    expect(receipt.getByText("14:22 UTC")).toHaveAttribute("datetime", "2026-09-19T14:22:10.000Z");
    // Not announced and gone: it is part of the card.
    expect(card().queryByRole("status")).toBeNull();
  });

  it("says so when a decision dispatched nothing, and lists what routing could not do", () => {
    const held = {
      result: classifyResult(
        { routed: null },
        { skipped: ["The run has finished, so no correction round was queued: rejected."] },
      ),
      prior: null,
    };

    draw({
      recorded: recordedView({
        current: currentDecision([], held, OVERSHOOT_CASE.caseId)!,
        runId: SEEDED_RUN_ID,
        from: "dashboard",
        readerId: DECIDER_ID,
        people: PEOPLE,
      }),
    });

    expect(card().getByText(NOTHING_DISPATCHED)).toBeInTheDocument();
    expect(card().queryByRole("group", { name: RECEIPT_LABEL })).toBeNull();
    expect(
      within(card().getByRole("list", { name: "What routing could not do" })).getByRole(
        "listitem",
      ),
    ).toHaveTextContent("The run has finished, so no correction round was queued: rejected.");
  });
});

describe("after routing", () => {
  it("is not a blank form: it shows what was decided, by whom, and the note", () => {
    draw({ recorded: recorded() });

    expect(card().getByText("Product bug")).toBeInTheDocument();
    expect(card().getByText(/by you/)).toBeInTheDocument();
    expect(card().getByText(CORRECTION_NOTE)).toBeInTheDocument();
    expect(card().queryByRole("radio")).toBeNull();
    expect(card().queryByRole("textbox")).toBeNull();
  });

  it("offers Re-classify, and opens the form over the decision it would replace", () => {
    const { onReclassify } = draw({ recorded: recorded() });

    fireEvent.click(card().getByRole("button", { name: RECLASSIFY_LABEL }));
    expect(onReclassify).toHaveBeenCalledTimes(1);
  });

  it("keeps the recorded decision on the card while the form is open over it", () => {
    const { onKeep } = draw({ recorded: recorded(), editing: true });

    expect(card().getByText(CORRECTION_NOTE)).toBeInTheDocument();
    expect(card().getAllByRole("radio")).toHaveLength(4);
    expect(card().queryByRole("button", { name: RECLASSIFY_LABEL })).toBeNull();

    fireEvent.click(card().getByRole("button", { name: KEEP_DECISION_LABEL }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("shows the new decision and the one it replaced", () => {
    const held = {
      result: classifyResult({
        id: "next",
        class: "test_update",
        note: "The test assumes FIFO.",
        createdAt: "2026-09-19T14:40:00.000Z",
      }),
      prior: classification(),
    };

    draw({
      recorded: recordedView({
        current: currentDecision([classification()], held, OVERSHOOT_CASE.caseId)!,
        runId: SEEDED_RUN_ID,
        from: "dashboard",
        readerId: DECIDER_ID,
        people: PEOPLE,
      }),
    });

    expect(card().getByText("Test needs update")).toBeInTheDocument();
    expect(card().getByText("The test assumes FIFO.")).toBeInTheDocument();
    expect(
      card().getByText(
        "Replaced: Product bug, by you at 14:22 — kept in the record as superseded.",
      ),
    ).toBeInTheDocument();
  });
});

describe("who may do what", () => {
  it("draws no waive action for a member", () => {
    draw({ mayWaive: false });

    expect(card().queryByRole("button", { name: /waive/i })).toBeNull();
  });

  it("draws it for an administrator, and opens a dialog", () => {
    const { onWaive } = draw({ mayWaive: true });

    const waive = card().getByRole("button", { name: WAIVE_LABEL });

    expect(waive).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(waive);
    expect(onWaive).toHaveBeenCalledTimes(1);
  });

  it("draws a viewer the decision and the toggles, read-only — and no form", () => {
    draw({
      mayClassify: false,
      recorded: recorded(),
      toggles: togglesView({
        next: timeline().next,
        held: {},
        mayClassify: false,
        sending: false,
      }),
    });

    expect(card().getByText(VIEWER_NOTE)).toBeInTheDocument();
    expect(card().getByText(CORRECTION_NOTE)).toBeInTheDocument();
    expect(card().queryByRole("radio")).toBeNull();
    expect(card().queryByRole("button", { name: RECLASSIFY_LABEL })).toBeNull();

    for (const toggle of card().getAllByRole("switch")) {
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      expect(toggle).toHaveAttribute("title", VIEWER_TOGGLE_REASON);
    }
  });

  it("does not tell the panel about a viewer's press on a switch", () => {
    const { onToggle } = draw({
      mayClassify: false,
      toggles: togglesView({
        next: timeline().next,
        held: {},
        mayClassify: false,
        sending: false,
      }),
    });

    fireEvent.click(card().getAllByRole("switch")[0]!);

    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("a recorded waiver", () => {
  it("names its author and its reason, and says the PR was not annotated", () => {
    draw({ mayWaive: true, waiver: waiverView(waiver(), DECIDER_ID, PEOPLE) });

    const said = card().getByRole("status");

    expect(said).toHaveTextContent("Waived by you at 14:25");
    expect(said).toHaveTextContent("Known rig drift on helios-rig-02; tracked in #512.");
    expect(said).toHaveTextContent(WAIVE_DEFERRED);
  });
});

describe("the staged worklist", () => {
  const staged = {
    testRunId: BUILD_3_ID,
    cases: [OVERSHOOT_CASE, FLAKY_CASE, { ...FLAKY_CASE, caseId: "unreported", name: "silent" }],
  };

  it("lists each staged failure, marks the one on the card and what was decided", () => {
    draw({
      worklist: worklistView(
        staged,
        new Set([OVERSHOOT_CASE.caseId, FLAKY_CASE.caseId]),
        [classification()],
        OVERSHOOT_CASE.caseId,
      ),
    });

    const rows = within(card().getByRole("list", { name: STAGED_LABEL })).getAllByRole(
      "listitem",
    );

    expect(rows).toHaveLength(3);
    expect(
      within(rows[0]!).getByRole("button", {
        name: "PHYSICAL · HIL rig › pid_overshoot_under_load",
      }),
    ).toHaveAttribute("aria-current", "true");
    expect(rows[0]).toHaveTextContent("Product bug");
    expect(within(rows[1]!).getByRole("button")).not.toHaveAttribute("aria-current");
    expect(within(rows[2]!).queryByRole("button")).toBeNull();
    expect(rows[2]).toHaveTextContent(STAGED_UNOPENABLE);
  });

  it("tells the panel which staged failure was chosen", () => {
    const { onPick } = draw({
      worklist: worklistView(
        staged,
        new Set([OVERSHOOT_CASE.caseId, FLAKY_CASE.caseId]),
        [],
        OVERSHOOT_CASE.caseId,
      ),
    });

    fireEvent.click(card().getByRole("button", { name: "telemetry › can_frame_roundtrip" }));

    expect(onPick).toHaveBeenCalledExactlyOnceWith(FLAKY_CASE.caseId);
  });
});
