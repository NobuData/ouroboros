import { describe, expect, it } from "vitest";

import { STAGE_KINDS } from "@/app/workflows/canvas/graph";
import {
  ADD_STAGE_SOON,
  AUTO_LAYOUT_SOON,
  CANVAS_HINT,
  FLOW_ROLE_WORDS,
  NO_STAGES_NOTE,
  STAGE_GLYPHS,
  STAGE_KIND_WORDS,
  UNSAVED_NOTE,
  edgeName,
  selectionSentence,
  stageName,
} from "@/app/workflows/canvas/view";

/**
 * The canvas's words (#148, #149): what each control says it waits for, how a stage and an edge
 * are named to a screen reader, the glyphs and words a node's type line begins with, and the
 * sentence the selection becomes.
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

describe("what waits, and for what", () => {
  it("names the issue each inert control waits for", () => {
    expect(AUTO_LAYOUT_SOON).toMatch(/#151/);
    expect(ADD_STAGE_SOON).toMatch(/#151/);
    expect(ADD_STAGE_SOON).toMatch(/#145/);
    expect(UNSAVED_NOTE).toMatch(/#152/);
    expect(NO_STAGES_NOTE).toMatch(/#151/);
  });

  it("does not advertise the mockup's double-click insertion, which does not work yet", () => {
    expect(CANVAS_HINT).not.toMatch(/double-click/);
    expect(CANVAS_HINT).toMatch(/pan/);
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

  it("names the stage and where it will be edited", () => {
    expect(selectionSentence({ kind: "node", id: "implement", stage }, 12)).toBe(
      "Code the change selected — the inspector arrives with #150.",
    );
  });

  it("names the edge's ends and where it will be edited", () => {
    expect(
      selectionSentence(
        {
          kind: "edge",
          id: "a→b",
          connection: { from: "checks-green", to: "implement", kind: "loop", label: "fail ↺", condition: null },
        },
        12,
      ),
    ).toBe("Edge checks-green → implement selected — edge editing arrives with #151.");
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
