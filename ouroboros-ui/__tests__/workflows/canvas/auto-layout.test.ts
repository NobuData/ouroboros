import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { COLUMN_GAP, LAYOUT_ORIGIN, layoutPositions, stageBox, withLayout } from "@/app/workflows/canvas/auto-layout";
import {
  PILL_BOX,
  type Point,
  STAGE_BOX,
  type Size,
  readConnections,
  readStages,
} from "@/app/workflows/canvas/graph";

import { standardFixDefinition } from "../../helpers/workflows";

/**
 * **Auto-layout** (#151) over the seeded `standard-fix`, in the ticket's words: *the seeded graph stays
 * readable with no node overlaps, and keeps left-to-right flow*. Readable is asserted as the two things
 * a script can measure — no box overlaps another at the size it is drawn, and every edge that is not a
 * loop leaves its stage's right side for a stage wholly to its right — plus the loop still reading as
 * a way back.
 */

/** The seeded document. */
const SEEDED = standardFixDefinition();

/** A stage's box on the stage, edge to edge. */
interface Box {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Every stage's box where the layout put it.
 *
 * @param definition The document.
 * @param positions The layout.
 * @param measured The sizes it was laid out with.
 * @returns The boxes, by id.
 */
function boxes(
  definition: WorkflowDefinition,
  positions: ReadonlyMap<string, Point>,
  measured: ReadonlyMap<string, Size> = new Map(),
): Map<string, Box> {
  return new Map(
    readStages(definition).map((stage) => {
      const { x, y } = positions.get(stage.id) ?? { x: Number.NaN, y: Number.NaN };
      const size = stageBox(stage, measured.get(stage.id));
      return [stage.id, { id: stage.id, left: x, top: y, right: x + size.width, bottom: y + size.height }];
    }),
  );
}

/**
 * Every pair of boxes that overlap.
 *
 * @param all The boxes.
 * @returns The pairs, by id — empty when none do.
 */
function overlapping(all: Iterable<Box>): string[] {
  const list = [...all];
  const pairs: string[] = [];

  list.forEach((a, index) => {
    for (const b of list.slice(index + 1)) {
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) pairs.push(`${a.id}/${b.id}`);
    }
  });

  return pairs;
}

describe("the seeded graph, laid out", () => {
  const positions = layoutPositions(SEEDED);
  const laid = boxes(SEEDED, positions);

  it("places every stage, in whole pixels", () => {
    expect(positions.size).toBe(12);
    for (const { x, y } of positions.values()) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });

  it("overlaps no stage with another", () => {
    expect(overlapping(laid.values())).toEqual([]);
  });

  it("flows left to right: every edge but the loop ends in a later column", () => {
    const forward = readConnections(SEEDED, readStages(SEEDED)).filter((edge) => edge.kind !== "loop");

    expect(forward).toHaveLength(11);
    for (const { from, to } of forward) {
      const source = laid.get(from);
      const target = laid.get(to);
      expect(target?.left, `${from}→${to}`).toBeGreaterThanOrEqual((source?.right ?? Number.NaN) + COLUMN_GAP);
    }
  });

  it("draws the loop as a way back: the stage it returns to sits left of the gate it leaves", () => {
    expect(laid.get("implement")?.right).toBeLessThan(laid.get("checks-green")?.left ?? Number.NaN);
  });

  it("starts where the mockup's graph starts", () => {
    const all = [...laid.values()];

    expect(Math.min(...all.map((box) => box.left))).toBe(LAYOUT_ORIGIN.x);
    expect(Math.min(...all.map((box) => box.top))).toBe(LAYOUT_ORIGIN.y);
  });
});

describe("writing the layout into the document", () => {
  it("changes positions and nothing else", () => {
    const next = withLayout(SEEDED);
    const before = SEEDED.nodes as Record<string, unknown>[];
    const after = next.nodes as Record<string, unknown>[];

    expect(next.edges).toBe(SEEDED.edges);
    expect(next.trigger).toBe(SEEDED.trigger);
    after.forEach((node, index) => {
      const { position: _moved, ...rest } = node;
      const { position: _was, ...was } = before[index];
      void _moved;
      void _was;
      expect(rest).toEqual(was);
    });
  });

  it("answers the same document when every stage is already where the layout puts it", () => {
    const once = withLayout(SEEDED);

    expect(withLayout(once)).toBe(once);
  });

  it("answers the same document, and no positions, for a document with no stages", () => {
    const blank = {};

    expect(layoutPositions(blank).size).toBe(0);
    expect(withLayout(blank)).toBe(blank);
  });

  it("lays out a cycle of plain edges without throwing", () => {
    const cycle = {
      nodes: [
        { id: "a", type: "llm", position: { x: 0, y: 0 }, config: {} },
        { id: "b", type: "llm", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { from: "a", to: "b", kind: "default" },
        { from: "b", to: "a", kind: "default" },
      ],
    };

    expect(overlapping(boxes(cycle, layoutPositions(cycle)).values())).toEqual([]);
  });
});

describe("the size a stage is laid out at", () => {
  it("is the drawn box at the least, and the pill's for Back to queue", () => {
    const [implement] = readStages(SEEDED).filter((stage) => stage.id === "implement");
    const [pill] = readStages(SEEDED).filter((stage) => stage.id === "back-to-queue");

    expect(stageBox(implement)).toEqual(STAGE_BOX);
    expect(stageBox(pill)).toEqual(PILL_BOX);
    expect(stageBox(implement, { width: 1, height: 1 })).toEqual(STAGE_BOX);
    expect(stageBox(implement, { width: 300, height: 90 })).toEqual({ width: 300, height: 104 });
  });

  it("keeps a stage measured larger than its floor from overlapping its neighbours", () => {
    const measured = new Map<string, Size>([
      ["implement", { width: 420, height: 320 }],
      ["plan", { width: 260, height: 240 }],
    ]);

    expect(overlapping(boxes(SEEDED, layoutPositions(SEEDED, measured), measured).values())).toEqual([]);
  });
});
