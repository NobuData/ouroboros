import { describe, expect, it } from "vitest";

import type { WorkflowFinding } from "@/app/api/workflows";
import { findingDiagnostics, outlineDefinition, stageRevealOf } from "@/app/workflows/code/code-findings";
import type { AnchoredOutline } from "@/app/workflows/code/code-panel";
import { findingAnchor } from "@/app/workflows/publish";

/**
 * A refused publish's findings, anchored in the code view (V.6, #174) — **publish failures anchor their
 * findings into the code view**: each finding names its stage through the file's span map, is drawn on that
 * stage's lines as `ouroboros-rest`'s `code.diagnostics.ts` places Validate's, and selecting it puts the
 * cursor on the stage.
 */

/** A small file, printed as U.1 prints one: two stage calls, on lines 6–8 and 9–11. */
const TEXT = [
  'import { defineLoop, trigger, needsReview } from "@ouroboros/sdk";',
  "",
  'export default defineLoop("minimal", {',
  '  dsl: "1.0",',
  "  stages: [",
  '    trigger("start", {',
  '      next: "done",',
  "    }),",
  '    needsReview("done", {',
  '      title: "Needs review",',
  "    }),",
  "  ],",
  "});",
  "",
].join("\n");

const OUTLINE: AnchoredOutline = {
  anchor: TEXT,
  spans: [
    { node: "start", startLine: 6, endLine: 8 },
    { node: "done", startLine: 9, endLine: 11 },
  ],
};

/** `done`'s call: from its first character, under `stages: [`, to the end of its `    }),`. */
const DONE_RANGE = { line: 9, column: 5, endLine: 11, endColumn: 8 };

/** `start`'s call. */
const START_RANGE = { line: 6, column: 5, endLine: 8, endColumn: 8 };

/**
 * A finding, as a refused publish carries it.
 *
 * @param overrides What this case is about.
 * @returns The finding.
 */
function finding(overrides: Partial<WorkflowFinding> = {}): WorkflowFinding {
  return { source: "engine", code: "engine.stage_refused", message: "The engine cannot run this stage.", ...overrides };
}

describe("the definition a finding is anchored in", () => {
  it("is the file's stage ids in node order, and nothing else", () => {
    expect(outlineDefinition(OUTLINE)).toEqual({ nodes: [{ id: "start" }, { id: "done" }] });
    expect(outlineDefinition(null)).toEqual({ nodes: [] });
  });

  it("anchors a finding as the canvas would: by node, by the edge's leaving stage, by a node pointer", () => {
    const definition = outlineDefinition(OUTLINE);

    expect(findingAnchor(finding({ node: "done" }), definition)).toBe("done");
    expect(findingAnchor(finding({ edge: { from: "start", to: "done" } }), definition)).toBe("start");
    expect(findingAnchor(finding({ path: "/nodes/1/config" }), definition)).toBe("done");
    expect(findingAnchor(finding({ node: "gone" }), definition)).toBeNull();
  });
});

describe("a refused publish's findings, drawn in the editor", () => {
  it("puts each finding on its stage's lines, as an error kept with the text it was placed in", () => {
    expect(findingDiagnostics([finding({ node: "done" })], OUTLINE)).toEqual({
      anchor: TEXT,
      items: [
        {
          severity: "error",
          range: DONE_RANGE,
          code: "engine.stage_refused",
          message: "The engine cannot run this stage.",
          node: "done",
        },
      ],
    });
  });

  it("places an edge's finding and a pointer's finding on the stage each names, in the service's order", () => {
    const { items } = findingDiagnostics(
      [finding({ path: "/nodes/1" }), finding({ edge: { from: "start", to: "done" } })],
      OUTLINE,
    );

    expect(items.map((item) => [item.node, item.range])).toEqual([
      ["done", DONE_RANGE],
      ["start", START_RANGE],
    ]);
  });

  it("puts a finding about no stage in the file on the defineLoop line, naming no stage", () => {
    const [item] = findingDiagnostics([finding({ code: "document.no_terminal", node: "gone" })], OUTLINE).items;

    // `export default defineLoop("minimal", {` is 38 characters long.
    expect(item.range).toEqual({ line: 3, column: 1, endLine: 3, endColumn: 39 });
    expect(item).not.toHaveProperty("node");
  });

  it("falls back to the first line for a text with no defineLoop, and clamps a span past the end", () => {
    const outline: AnchoredOutline = { anchor: "  one\ntwo", spans: [{ node: "late", startLine: 7, endLine: 9 }] };

    expect(findingDiagnostics([finding()], outline).items[0]?.range).toEqual({
      line: 1,
      column: 3,
      endLine: 1,
      endColumn: 6,
    });
    expect(findingDiagnostics([finding({ node: "late" })], outline).items[0]?.range).toEqual({
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 4,
    });
  });
});

describe("selecting a finding", () => {
  it("puts the cursor at the start of its stage call, with a new request each time", () => {
    const first = stageRevealOf(OUTLINE, "done");

    expect(first).toEqual({ anchor: TEXT, range: { line: 9, column: 1, endLine: 9, endColumn: 1 } });
    expect(stageRevealOf(OUTLINE, "done")).not.toBe(first);
  });

  it("asks for nothing when no stage call has that id", () => {
    expect(stageRevealOf(OUTLINE, "gone")).toBeNull();
  });
});
