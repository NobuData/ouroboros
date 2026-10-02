import { describe, expect, it } from "vitest";

import type { Intervention } from "@/app/api/insights";
import {
  CAUSES,
  CAUSE_NAMES,
  DIM_SHARE,
  INTERVENTIONS_TITLE,
  NO_INTERVENTIONS,
  NO_STAGES,
  STAGES_TITLE,
  eventLabel,
  interventionsView,
  isCause,
  moreEventsNote,
  movedNote,
  stagesView,
  targetCauses,
} from "@/app/insights/bars-view";

import { barCard, seededInterventions, seededStages } from "../helpers/insights";

/**
 * The interventions and stage-medians cards' decisions (#445): which rows are lifted and which
 * recede, the tags, the empty states, the event picker's words — and that the insight lines are
 * the service's, passed through rather than composed.
 */

/**
 * One intervention event.
 *
 * @param over What differs.
 * @returns The event.
 */
function event(over: Partial<Intervention> = {}): Intervention {
  return {
    id: "5eed005c-0000-4000-8000-000000000482",
    runId: "5eed0009-0000-4000-8000-000000000482",
    source: "waiver",
    sourceRef: "5eed0039-0000-4000-8000-000000000482",
    detectedAt: "2026-09-30T17:49:30.897Z",
    signals: [],
    cause: "other",
    causeOrigin: "rule",
    ruleId: "residue",
    ruleVersion: 1,
    override: null,
    ...over,
  };
}

describe("the interventions card", () => {
  it("draws the mockup's seeded card: tag, top row lifted, the smallest two receded", () => {
    const view = interventionsView(seededInterventions(), "30d");

    expect(view.title).toBe(INTERVENTIONS_TITLE);
    expect(view.tag).toBe("30d · 20 total");
    expect(view.rows.map((row) => [row.name, row.value, row.emphasis])).toEqual([
      ["Flaky env / rig", 8, "top"],
      ["Ambiguous ticket", 5, undefined],
      ["Policy gate", 4, undefined],
      ["Model disagreement", 2, "dim"],
      ["Other", 1, "dim"],
    ]);
    expect(view.line).toBe("Fix the top row and interventions drop ~40%.");
    expect(view.empty).toBeNull();
  });

  it("passes the service's line through — changed data, changed sentence, nothing composed", () => {
    const moved = barCard(
      [
        ["ambiguous_ticket", "Ambiguous ticket", 6],
        ["infra_rig", "Flaky env / rig", 4],
      ],
      { line: "Fix the top row and interventions drop ~60%." },
    );

    expect(interventionsView(moved, "7d")).toMatchObject({
      tag: "7d · 10 total",
      line: "Fix the top row and interventions drop ~60%.",
    });
    expect(interventionsView(barCard([["other", "Other", 1]]), "7d").line).toBeNull();
  });

  it("recedes a row at a quarter of the top or less, and no further", () => {
    const rows = interventionsView(
      barCard([
        ["infra_rig", "a", 8],
        ["ambiguous_ticket", "b", 8 * DIM_SHARE],
        ["policy_gate", "c", 8 * DIM_SHARE + 1],
      ]),
      "30d",
    ).rows;

    expect(rows.map((row) => row.emphasis)).toEqual(["top", "dim", undefined]);
  });

  it("totals the bars itself only when the service sent no total", () => {
    expect(interventionsView(barCard([["other", "Other", 3]], { total: null }), "30d").tag).toBe("30d · 3 total");
  });

  it("is a designed empty state over a quiet range, never a bare zero", () => {
    expect(interventionsView(barCard([]), "90d")).toMatchObject({
      tag: "90d · 0 total",
      rows: [],
      line: null,
      empty: NO_INTERVENTIONS,
    });
  });
});

describe("the stage-medians card", () => {
  it("draws the mockup's seeded card: Implement lifted, the rest receded, medians spelled out", () => {
    const view = stagesView(seededStages(), "30d");

    expect(view.title).toBe(STAGES_TITLE);
    expect(view.tag).toBe("30d");
    expect(view.rows.map((row) => [row.name, row.display, row.emphasis])).toEqual([
      ["Analyze", "1m", "dim"],
      ["Plan", "2m", "dim"],
      ["Implement", "6m 04s", "top"],
      ["Build", "2m", "dim"],
      ["Test", "2m 40s", "dim"],
      ["Verify", "40s", "dim"],
    ]);
    expect(view.line).toBe("Implement dominates the loop — the other five stages sum to 8m 20s.");
  });

  it("lifts whichever stage dominates the data, and only the first of a tie", () => {
    const rows = stagesView(
      barCard(
        [
          ["plan", "Plan", 500_000],
          ["implement", "Implement", 100_000],
          ["test", "Test", 500_000],
        ],
        { unit: "duration_ms", total: null },
      ),
      "7d",
    ).rows;

    expect(rows.map((row) => row.emphasis)).toEqual(["top", "dim", "dim"]);
  });

  it("emphasises nothing with one stage, and is empty with none", () => {
    expect(stagesView(barCard([["plan", "Plan", 60_000]]), "7d").rows[0]!.emphasis).toBeUndefined();
    expect(stagesView(barCard([]), "7d").empty).toBe(NO_STAGES);
  });
});

describe("the re-categorize picker's words", () => {
  it("knows the five causes, and nothing else", () => {
    expect(CAUSES).toEqual(["infra_rig", "ambiguous_ticket", "policy_gate", "model_disagreement", "other"]);
    expect(isCause("policy_gate")).toBe(true);
    expect(isCause("implement")).toBe(false);
  });

  it("offers every cause but the event's own", () => {
    expect(targetCauses("other")).toEqual(["infra_rig", "ambiguous_ticket", "policy_gate", "model_disagreement"]);
  });

  it("names an event by its plane and day, and says when a person set its cause", () => {
    expect(eventLabel(event())).toBe("Waiver · Sep 30");
    expect(eventLabel(event({ source: "vote_block", causeOrigin: "human" }))).toBe(
      "Blocking vote · Sep 30 · set by a person",
    );
  });

  it("says where a moved event now counts, and when the list was cut", () => {
    expect(movedNote("ambiguous_ticket")).toBe(
      `Moved to ${CAUSE_NAMES.ambiguous_ticket}. The bars and the line now count it there.`,
    );
    expect(moreEventsNote(50, 64)).toBe("Showing the newest 50 of 64.");
    expect(moreEventsNote(3, 3)).toBeNull();
  });
});
