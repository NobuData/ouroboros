import { describe, expect, it } from "vitest";

import { STAGE_KINDS } from "@/app/workflows/canvas/graph";
import {
  CANVAS_HINT,
  FLOW_ROLE_WORDS,
  NO_STAGES_NOTE,
  RULE_REASONS,
  STAGE_GLYPHS,
  STAGE_KIND_WORDS,
  UNSAVED_NOTE,
  connectionRefused,
  deletePrompt,
  edgeName,
  insertMenuLabel,
  selectionSentence,
  stageName,
} from "@/app/workflows/canvas/view";

/**
 * The canvas's words (#148, #149, #151): what an unsaved edit and a blank canvas say, how a stage and
 * an edge are named to a screen reader, the glyphs and words a node's type line begins with, the
 * sentence the selection becomes, every rule's reason, and what a delete asks.
 */

describe("the stage's words", () => {
  it("has a word for every node type the DSL defines", () => {
    for (const kind of STAGE_KINDS) {
      expect(STAGE_KIND_WORDS[kind]).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("gives every node type the mockup's glyph, each a single character and each different", () => {
    expect(STAGE_GLYPHS).toEqual({ trigger: "▸", llm: "◆", infra: "▣", flow: "◇", term: "●" });
    expect(new Set(STAGE_KINDS.map((kind) => STAGE_GLYPHS[kind])).size).toBe(STAGE_KINDS.length);
  });

  it("names the two kinds of flow node the mockup draws", () => {
    expect(FLOW_ROLE_WORDS).toEqual({ decision: "Decision", gate: "Gate" });
  });

  it("names a stage by its kind and its title", () => {
    expect(stageName({ kind: "llm", title: "Code the change" })).toBe("Model stage: Code the change");
    expect(stageName({ kind: "trigger", title: "Issue queued" })).toBe("Trigger stage: Issue queued");
  });

  it("names an edge by its two ends, with the label it prints", () => {
    expect(edgeName("Checks green?", "Code the change", "fail ↺")).toBe(
      "Checks green? to Code the change (fail ↺)",
    );
    expect(edgeName("Issue queued", "Understand & scope", null)).toBe("Issue queued to Understand & scope");
  });
});

describe("the toolbar's words", () => {
  it("says an edit is not saved, naming the issue that saves it", () => {
    expect(UNSAVED_NOTE).toMatch(/not saved/);
    expect(UNSAVED_NOTE).toMatch(/#152/);
  });

  it("says where a blank canvas's first stage comes from", () => {
    expect(NO_STAGES_NOTE).toMatch(/Add stage/);
  });

  it("prints the mockup's hint — both halves work now — with the keyboard beside the mouse", () => {
    expect(CANVAS_HINT).toMatch(/⌥ drag to pan/);
    expect(CANVAS_HINT).toMatch(/double-click edge to add stage/);
    expect(CANVAS_HINT).toMatch(/Tab/);
    expect(CANVAS_HINT).toMatch(/Delete/);
  });

  it("names an insertion by the two stages it goes between", () => {
    expect(insertMenuLabel("Write attack plan", "Code the change")).toBe(
      "Insert a stage between Write attack plan and Code the change",
    );
  });
});

describe("the selection, in a sentence", () => {
  const stage = {
    id: "implement",
    kind: "llm",
    title: "Code the change",
    position: { x: 0, y: 0 },
    config: {},
  } as const;

  it("names the stage and where it is edited — the inspector beside the canvas (#150)", () => {
    expect(selectionSentence({ kind: "node", id: "implement", stage }, 12)).toBe(
      "Code the change selected — configure it in the inspector.",
    );
  });

  it("names the edge's ends and where it is edited", () => {
    expect(
      selectionSentence(
        {
          kind: "edge",
          id: "a→b",
          connection: { from: "checks-green", to: "implement", kind: "loop", label: "fail ↺", condition: null },
        },
        12,
      ),
    ).toBe("Edge checks-green → implement selected — edit it in the inspector.");
  });

  it("counts a larger selection, with the nouns agreeing", () => {
    expect(selectionSentence({ kind: "many", nodes: 3, edges: 1 }, 12)).toBe("3 stages and 1 edge selected.");
    expect(selectionSentence({ kind: "many", nodes: 1, edges: 2 }, 12)).toBe("1 stage and 2 edges selected.");
  });

  it("says nothing about nothing on a canvas with stages, and says there are none on one without", () => {
    expect(selectionSentence(null, 12)).toBe("");
    expect(selectionSentence(null, 0)).toBe(NO_STAGES_NOTE);
  });
});

describe("the rules, in words", () => {
  it("has one sentence for each of the ten rules an edit can break", () => {
    expect(Object.keys(RULE_REASONS)).toHaveLength(10);
    for (const reason of Object.values(RULE_REASONS)) expect(reason).toMatch(/^[A-Z].*\.$/);
  });

  it("says the second-trigger rule in the ticket's own words", () => {
    expect(RULE_REASONS["document.multiple_triggers"]).toBe("A workflow can only have one trigger.");
  });

  it("prefixes a refused connection so the notice reads as a refusal", () => {
    expect(connectionRefused("edge.into_trigger")).toBe(`Not connected: ${RULE_REASONS["edge.into_trigger"]}`);
  });
});

describe("what a delete asks", () => {
  it("names one stage, counts the edges that go with it, and says Undo brings them back", () => {
    expect(deletePrompt({ stages: ["Split the work"], edges: [], attached: 2 })).toEqual({
      title: "Delete Split the work?",
      body: "2 edges connected to it go too. Undo brings them back.",
    });
  });

  it("names one edge by its two ends", () => {
    expect(deletePrompt({ stages: [], edges: ["Checks green? → Code the change"], attached: 0 })).toEqual({
      title: "Delete the edge Checks green? → Code the change?",
      body: "Undo brings it back.",
    });
  });

  it("counts a larger selection, and agrees in number", () => {
    expect(deletePrompt({ stages: ["A", "B"], edges: ["C → D"], attached: 1 })).toEqual({
      title: "Delete 2 stages and 1 edge?",
      body: "One edge connected to them goes too. Undo brings them back.",
    });
    expect(deletePrompt({ stages: ["Build"], edges: [], attached: 0 }).body).toBe("Undo brings it back.");
  });
});
