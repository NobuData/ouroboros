/**
 * **Auto-layout** (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151)) — a layered,
 * left-to-right arrangement of the graph, on [dagre](https://github.com/dagrejs/dagre).
 *
 * The mockup's graph reads left to right: a run enters at the trigger on the left and each stage
 * hands on to the next one along. So the layout is dagre's layered one with `rankdir: LR` — every
 * stage in a column by how far it is from the start, and every plain or branch edge pointing right —
 * spaced at the mockup's own rhythm: its columns sit 282px apart (`24`, `306`, `588`), which is a
 * 204px node and a 78px gap, and the graph starts where the mockup's does, at `(24, 40)`.
 *
 * **Loop edges are left out of the layering.** A loop returns *up* the graph by definition (§ 7), so
 * laying it out as a forward edge would either invert the flow around it or be reversed by dagre's
 * cycle breaking at a place dagre picks; without it, the stage a loop returns to sits before the
 * stage it returns from, and the loop is drawn as what it is — a way back.
 *
 * **Sizes are floors.** dagre spaces boxes by their size, and the canvas knows a stage's size only
 * once React Flow has measured it — which a server render, a test, or a stage that has not painted
 * yet has not. So each stage is laid out at least as large as `canvas.css` draws it
 * (`graph.ts`'s `STAGE_BOX` and `PILL_BOX`), and larger when a measurement says so, which is what
 * keeps a stage with a long title or two rows of chips from overlapping its neighbour.
 *
 * dagre is loaded with this module, and this module is loaded when **Auto-layout** is pressed
 * (`studio-canvas.tsx` imports it dynamically), so the studio's first paint carries none of it.
 * It is `auto-layout.ts` rather than `layout.ts` because, anywhere under `app/`, Next.js reads a file
 * named `layout` as a route's layout.
 */

import dagre from "@dagrejs/dagre";

import type { WorkflowDefinition } from "@/app/api/workflows";

import {
  PILL_BOX,
  type Point,
  STAGE_BOX,
  type Size,
  type Stage,
  readConnections,
  readStages,
  withPositions,
} from "./graph";
import { isPill } from "./treatment";

/** The gap between two columns — the mockup's 282px column pitch less a 204px node. */
export const COLUMN_GAP = 78;

/** The gap between two stages in one column — the mockup's 190px row pitch less a 104px node. */
export const ROW_GAP = 86;

/** Where the laid-out graph's top-left corner is: the mockup's trigger node's `left:24px;top:40px`. */
export const LAYOUT_ORIGIN: Point = { x: 24, y: 40 };

/**
 * The box a stage is laid out as.
 *
 * @param stage The stage.
 * @param measured What React Flow measured it as, when it has.
 * @returns The larger of the drawn floor and the measurement, on each axis.
 */
export function stageBox(stage: Stage, measured?: Size): Size {
  const floor = isPill(stage) ? PILL_BOX : STAGE_BOX;
  if (measured === undefined) return floor;

  return { width: Math.max(floor.width, measured.width), height: Math.max(floor.height, measured.height) };
}

/**
 * Where auto-layout puts each stage.
 *
 * @param definition The document.
 * @param measured Each stage's measured size, by id, where one is known.
 * @returns Each drawable stage's top-left corner, in whole pixels. Empty for a document with no
 *   stages.
 */
export function layoutPositions(
  definition: WorkflowDefinition,
  measured: ReadonlyMap<string, Size> = new Map(),
): Map<string, Point> {
  const stages = readStages(definition);
  const positions = new Map<string, Point>();
  if (stages.length === 0) return positions;

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "LR",
    ranksep: COLUMN_GAP,
    nodesep: ROW_GAP,
    marginx: LAYOUT_ORIGIN.x,
    marginy: LAYOUT_ORIGIN.y,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const boxes = new Map(stages.map((stage) => [stage.id, stageBox(stage, measured.get(stage.id))]));
  for (const [id, box] of boxes) graph.setNode(id, { width: box.width, height: box.height });
  for (const connection of readConnections(definition, stages)) {
    if (connection.kind !== "loop" && connection.from !== connection.to) graph.setEdge(connection.from, connection.to);
  }

  dagre.layout(graph);

  for (const [id, box] of boxes) {
    // dagre places a node by its centre; the document stores its top-left corner.
    const { x, y } = graph.node(id);
    positions.set(id, { x: Math.round(x - box.width / 2), y: Math.round(y - box.height / 2) });
  }

  return positions;
}

/**
 * The document, auto-laid-out — the toolbar's **Auto-layout**.
 *
 * @param definition The document.
 * @param measured Each stage's measured size, by id, where one is known.
 * @returns The document with every drawable stage's position replaced and nothing else touched, or
 *   `definition` itself when every stage is already where the layout would put it.
 */
export function withLayout(
  definition: WorkflowDefinition,
  measured: ReadonlyMap<string, Size> = new Map(),
): WorkflowDefinition {
  const positions = layoutPositions(definition, measured);
  return withPositions(definition, [...positions].map(([id, position]) => ({ id, position })));
}
