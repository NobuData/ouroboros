/**
 * The P.2 document as a React Flow graph, and back (S.2,
 * [#148](https://github.com/NobuData/ouroboros/issues/148)).
 *
 * The canvas is a **controlled** React Flow: what it draws is a projection of the workflow
 * definition, and what a reader changes on it is written back into that document. This module
 * is the projection in both directions, as pure functions — the document in, nodes and edges
 * out ({@link toNodes}, {@link toEdges}); nodes in, the document with their positions out
 * ({@link withPositions}) — so the ticket's *positions round-trip: what the canvas shows is
 * what the definition stores* is a unit test over two values rather than a claim about a
 * rendered page.
 *
 * **React-free**, the way `app/workflows/view.ts` is. The one thing it takes from the library
 * is its vocabulary — the `Node` and `Edge` shapes — because a projection *into* React Flow has
 * to speak React Flow.
 *
 * ### The document is read defensively, and drawn as far as it can be
 *
 * A definition is typed as a JSON object and nothing more (`app/api/workflows.ts` says why): a
 * draft is stored unvalidated, so the canvas may be handed `{}`, a node with no position, an
 * edge naming a stage that was deleted, or a `nodes` that is not an array. Each is read as
 * *absent* rather than thrown on — a node the canvas cannot place is placed at the origin, an
 * edge it cannot attach is not drawn — because the studio's job is to let a reader repair a
 * half-built document, and a canvas that refused to open one would be the one place that could
 * not be done. Validation is the publish gate's (P.3), not the canvas's.
 *
 * ### One node type, one edge type, four sides
 *
 * Every stage is drawn by one node component, `stage-node.tsx`, with a connection point on each
 * of its four sides, and every connection by one edge component, `stage-edge.tsx`. Which side an
 * edge leaves from and arrives at is decided here ({@link edgeSides}) from where the two stages
 * sit — the mockup's edges run right along a row, down between rows and left back along the
 * next — so the seeded graph reads as the mockup draws it without the document carrying a side
 * per edge. What the nodes and edges look like is S.3's
 * ([#149](https://github.com/NobuData/ouroboros/issues/149)) and decided in `treatment.ts`; this
 * module owns which is connected to which, where, and which edges an execution path takes
 * ({@link withHighlight}).
 */

import type { Edge, Node } from "@xyflow/react";

import type { WorkflowDefinition } from "@/app/api/workflows";

import { edgeName, stageName } from "./view";

/* ------------------------------------------------------------------ the document's vocabulary */

/** The five node types the DSL defines (`docs/WORKFLOW_DSL.md` § 4), in the schema's order. */
export const STAGE_KINDS = ["trigger", "llm", "infra", "flow", "term"] as const;

/** One of the five. */
export type StageKind = (typeof STAGE_KINDS)[number];

/** The three edge kinds: the plain path, one outcome of a flow node, and the loop back. */
export const EDGE_KINDS = ["default", "branch", "loop"] as const;

/** One of the three. */
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** A point on the stage, in the document's own pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where a node the document does not place is drawn. */
export const ORIGIN: Point = { x: 0, y: 0 };

/** What a stage's `config` is read as when the document's is not an object. */
const NO_CONFIG: Readonly<Record<string, unknown>> = Object.freeze({});

/**
 * One stage as the canvas needs it: the fields of a DSL node that decide where and as what it is
 * drawn. `description` stays in the document, which S.4's inspector reads from there.
 */
export interface Stage {
  /** The node's id — the React Flow node's id, and what edges name. */
  readonly id: string;
  /** Which of the five treatments. */
  readonly kind: StageKind;
  /** The title the node prints. The id when the document has none. */
  readonly title: string;
  /** Its top-left corner on the stage. */
  readonly position: Point;
  /**
   * Its `config`, exactly as the document holds it — the object the node's chips are derived
   * from on every render (`treatment.ts`), so editing a stage's config is editing its chips.
   * An empty object when the document's is not one.
   */
  readonly config: Readonly<Record<string, unknown>>;
}

/** One connection as the canvas needs it. */
export interface Connection {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  /** What the document prints beside the edge, or `null` when it prints nothing. */
  readonly label: string | null;
  /**
   * The edge's `condition`, as the document holds it — what its label's tone is derived from
   * (`treatment.ts`'s `labelTone`). `null` when it has none, or none that is an object.
   */
  readonly condition: Readonly<Record<string, unknown>> | null;
}

/* ------------------------------------------------------------------ React Flow's vocabulary */

/** The one node type the canvas registers — `nodeTypes[STAGE_NODE_TYPE]` is the stage node. */
export const STAGE_NODE_TYPE = "stage";

/** The one edge type the canvas registers — `edgeTypes[STAGE_EDGE_TYPE]` is the stage edge. */
export const STAGE_EDGE_TYPE = "stage";

/** What a stage node carries. */
export type StageNodeData = {
  /** The stage. */
  readonly stage: Stage;
  /**
   * The document's root `trigger`, as stored — on the trigger node alone. The DSL keeps the
   * trigger's predicate on the root rather than in the node's config (§ 3) and renders it as the
   * node's chip, so the trigger node is handed the one thing it prints that its config does not
   * hold.
   */
  readonly trigger?: unknown;
};

/** A stage on the canvas. React Flow owns everything but its `data`. */
export type StageNode = Node<StageNodeData, typeof STAGE_NODE_TYPE>;

/** What a stage edge carries. */
export type StageEdgeData = {
  /** The connection. */
  readonly connection: Connection;
  /** Whether the execution path being drawn takes this edge ({@link withHighlight}). */
  readonly onPath?: boolean;
};

/** A connection on the canvas. */
export type StageEdge = Edge<StageEdgeData, typeof STAGE_EDGE_TYPE>;

/** The four sides of a node, each a handle id, clockwise from the top. */
export const SIDES = ["top", "right", "bottom", "left"] as const;

/** One of the four. */
export type Side = (typeof SIDES)[number];

/** Which side an edge leaves from and which it arrives at. */
export interface EdgeSides {
  readonly source: Side;
  readonly target: Side;
}

/* ------------------------------------------------------------------ reading the document */

/**
 * Whether a value is a plain object — the only thing true of every document on this API.
 *
 * @param value Anything.
 * @returns `true` for a non-null object that is not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value names one of the five node types.
 *
 * @param value Anything.
 * @returns `true` for `trigger` … `term`, exactly as the DSL spells them.
 */
export function isStageKind(value: unknown): value is StageKind {
  return typeof value === "string" && (STAGE_KINDS as readonly string[]).includes(value);
}

/**
 * Whether a value names one of the three edge kinds.
 *
 * @param value Anything.
 * @returns `true` for `default`, `branch` or `loop`.
 */
export function isEdgeKind(value: unknown): value is EdgeKind {
  return typeof value === "string" && (EDGE_KINDS as readonly string[]).includes(value);
}

/**
 * Read a position, or place it at the origin.
 *
 * @param value The node's `position`, or whatever a draft holds there.
 * @returns The point, when both coordinates are finite numbers; {@link ORIGIN} otherwise.
 */
export function readPoint(value: unknown): Point {
  if (!isRecord(value)) return ORIGIN;

  const { x, y } = value;

  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
    ? { x, y }
    : ORIGIN;
}

/**
 * Read a document's stages.
 *
 * In document order, because the order is the document's and the canvas has no opinion of its
 * own. A node with no string id or no known type is not a stage the canvas can draw and is
 * skipped; a second node carrying an id already seen is skipped too, because two nodes with
 * one id is one node to React Flow and the first is the one the edges were written against.
 *
 * @param definition The document, or `null` for a workflow with none.
 * @returns The stages the canvas can draw, in document order.
 */
export function readStages(definition: WorkflowDefinition | null): readonly Stage[] {
  const nodes = definition?.nodes;
  if (!Array.isArray(nodes)) return [];

  const seen = new Set<string>();
  const stages: Stage[] = [];

  for (const node of nodes) {
    if (!isRecord(node) || typeof node.id !== "string" || !isStageKind(node.type)) continue;
    if (seen.has(node.id)) continue;
    seen.add(node.id);

    stages.push({
      id: node.id,
      kind: node.type,
      title: typeof node.title === "string" && node.title !== "" ? node.title : node.id,
      position: readPoint(node.position),
      config: isRecord(node.config) ? node.config : NO_CONFIG,
    });
  }

  return stages;
}

/**
 * Read a document's connections, keeping only those between stages that exist.
 *
 * An edge naming a stage the document does not hold — one deleted by hand, one the reader has
 * not added yet — cannot be drawn and is left out; it is still in the document, and the publish
 * gate is what will say so. A `kind` the DSL does not know is read as `default`, so the edge is
 * at least drawn.
 *
 * @param definition The document, or `null` for a workflow with none.
 * @param stages The document's stages, as {@link readStages} read them.
 * @returns The connections the canvas can draw, in document order.
 */
export function readConnections(
  definition: WorkflowDefinition | null,
  stages: readonly Stage[],
): readonly Connection[] {
  const edges = definition?.edges;
  if (!Array.isArray(edges)) return [];

  const known = new Set(stages.map((stage) => stage.id));
  const connections: Connection[] = [];

  for (const edge of edges) {
    if (!isRecord(edge) || typeof edge.from !== "string" || typeof edge.to !== "string") continue;
    if (!known.has(edge.from) || !known.has(edge.to)) continue;

    connections.push({
      from: edge.from,
      to: edge.to,
      kind: isEdgeKind(edge.kind) ? edge.kind : "default",
      label: typeof edge.label === "string" && edge.label !== "" ? edge.label : null,
      condition: isRecord(edge.condition) ? edge.condition : null,
    });
  }

  return connections;
}

/* ------------------------------------------------------------------ the projection */

/**
 * Which sides an edge runs between, from where its two stages sit.
 *
 * The rule is the dominant axis: an edge whose target is further along than down leaves the
 * source's right side and arrives at the target's left (or left to right, going back), and one
 * whose target is further down than along leaves the bottom and arrives at the top (or the
 * reverse, going up). A tie is read as horizontal, because the mockup's rows are horizontal.
 *
 * **A loop and a fork's outcome prefer the vertical axis** whenever there is one. The mockup's
 * ouroboros edge — the gate's *fail ↺* back to implement — leaves the gate's top and arrives at
 * implement's bottom, arcing over the row between them, and a loop drawn side-to-side would share
 * its source side with the gate's *pass →* and read as a second branch rather than as a return.
 * A branch that changes rows is the same picture from the other side (#149): the decision's
 * *> M ↘* leaves its bottom beside *≤ M ↓* and arrives at the split's top, as the mockup draws it,
 * where the dominant axis would send it out of the decision's left side and back across the edge
 * that arrived there. A branch along its own row — the gate's *pass →* — still runs along it.
 *
 * @param from The source stage's top-left corner.
 * @param to The target stage's top-left corner.
 * @param kind The edge's kind — a loop and a branch are placed differently.
 * @returns The two sides.
 */
export function edgeSides(from: Point, to: Point, kind: EdgeKind = "default"): EdgeSides {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const vertical = kind === "default" ? Math.abs(dy) > Math.abs(dx) : dy !== 0;

  if (vertical) {
    return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
  }

  return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
}

/**
 * How an ordered pair is named — `from→to`. The DSL identifies an edge by its pair (§ 6), and so
 * does the dry run's `highlight_path`, so one spelling serves an edge's id and a path's lookup.
 *
 * @param from The id of the stage the edge leaves.
 * @param to The id of the stage it arrives at.
 * @returns The name.
 */
function pairName(from: string, to: string): string {
  return `${from}→${to}`;
}

/**
 * An id for every connection, unique within the graph.
 *
 * The DSL gives an edge no id of its own — it is named by its two ends — so the canvas names it
 * `from→to`. Two edges between the same pair are legal in the document (a branch and a loop,
 * say), and the second and later ones are numbered so React Flow, which keys on the id, draws
 * every one of them.
 *
 * @param connections The connections, in document order.
 * @returns One id per connection, in the same order.
 */
export function edgeIds(connections: readonly Connection[]): readonly string[] {
  const taken = new Map<string, number>();

  return connections.map((connection) => {
    const base = pairName(connection.from, connection.to);
    const ordinal = taken.get(base) ?? 0;
    taken.set(base, ordinal + 1);

    return ordinal === 0 ? base : `${base}#${ordinal + 1}`;
  });
}

/**
 * The document's stages as React Flow nodes.
 *
 * One node per stage, in document order, at the document's position: the canvas opens on
 * exactly the picture the document describes, which is the ticket's *seeded graph renders at
 * the mockup's node positions*. Each carries its stage as `data` for the node component — and
 * the trigger node the document's root trigger besides, which is what its chip prints — and an
 * accessible name, because React Flow's nodes are focusable and a screen reader would otherwise
 * announce twelve of them as *node*.
 *
 * @param definition The document, or `null` for a workflow with none.
 * @returns The nodes.
 */
export function toNodes(definition: WorkflowDefinition | null): StageNode[] {
  return readStages(definition).map((stage) => ({
    id: stage.id,
    type: STAGE_NODE_TYPE,
    position: stage.position,
    data: stage.kind === "trigger" ? { stage, trigger: definition?.trigger } : { stage },
    ariaLabel: stageName(stage),
  }));
}

/**
 * The document's connections as React Flow edges.
 *
 * Each is the one edge type, names the handle it leaves from and the one it arrives at
 * ({@link edgeSides}), and carries its connection for the edge component to draw — its label,
 * its tone, its dash and its arrowhead are all decided from that (`treatment.ts`).
 *
 * @param definition The document, or `null` for a workflow with none.
 * @returns The edges, between the stages {@link toNodes} draws.
 */
export function toEdges(definition: WorkflowDefinition | null): StageEdge[] {
  const stages = readStages(definition);
  const positions = new Map(stages.map((stage) => [stage.id, stage.position]));
  const titles = new Map(stages.map((stage) => [stage.id, stage.title]));
  const connections = readConnections(definition, stages);
  const ids = edgeIds(connections);

  return connections.map((connection, index) => {
    const sides = edgeSides(
      positions.get(connection.from) ?? ORIGIN,
      positions.get(connection.to) ?? ORIGIN,
      connection.kind,
    );

    return {
      id: ids[index],
      type: STAGE_EDGE_TYPE,
      source: connection.from,
      target: connection.to,
      sourceHandle: sides.source,
      targetHandle: sides.target,
      label: connection.label ?? undefined,
      data: { connection },
      ariaLabel: edgeName(
        titles.get(connection.from) ?? connection.from,
        titles.get(connection.to) ?? connection.to,
        connection.label,
      ),
    };
  });
}

/* ------------------------------------------------------------------ the execution path */

/**
 * An edge, named the way the document and the dry run name one: by its ordered pair. The
 * engine's `highlight_path` (`ouroboros-engine`'s `EdgeRef`, `from` on the wire) is a list of
 * these, so S.6 hands the dry run's answer to the canvas as it arrives.
 */
export interface EdgeRef {
  readonly from: string;
  readonly to: string;
}

/**
 * The edges with an execution path drawn on them — the **highlight mode** S.6's dry-run overlay
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)) consumes.
 *
 * An edge is on the path when the path names its pair, and is then drawn in the mockup's active
 * treatment (`treatment.ts`'s `edgeVariant`). A pair the path names that the canvas does not draw
 * is ignored — a dry run of a document that has since been edited is S.6's to clear, and a stale
 * path must not throw here — and a path that names a pair twice (a walk that came round a loop)
 * marks it once.
 *
 * @param edges The edges, as the canvas holds them.
 * @param path The edges the walk took, in any order; `null` or empty for no highlight.
 * @returns The edges, each marked on or off the path. **An edge whose mark did not change is the
 *   same object**, so turning the highlight off and on redraws only the edges that changed.
 */
export function withHighlight(edges: readonly StageEdge[], path: readonly EdgeRef[] | null): StageEdge[] {
  const taken = new Set((path ?? []).map((ref) => pairName(ref.from, ref.to)));

  return edges.map((edge) => {
    if (edge.data === undefined) return edge;

    const onPath = taken.has(pairName(edge.source, edge.target));
    if ((edge.data.onPath ?? false) === onPath) return edge;

    return { ...edge, data: { ...edge.data, onPath } };
  });
}

/* ------------------------------------------------------------------ writing back */

/**
 * The document with the canvas's positions written into it.
 *
 * This is the other half of *positions round-trip*: after a drag, the document's node holds the
 * position the canvas shows. Nothing but `position` is touched — the config, the title, every
 * field the canvas did not read travels through unchanged — and a node in the document that
 * the canvas does not draw (one it could not read) keeps whatever position it had. Positions
 * are stored as whole pixels: a drag at 125% zoom lands on a fraction of one, and a document
 * holding `305.6000000000001` is noise in every diff and in mockup 05's code view.
 *
 * **The same object comes back when nothing moved**, so a caller can tell an edit from a
 * re-render by identity, which is how the canvas knows to say *not saved*.
 *
 * @param definition The document the canvas opened on.
 * @param nodes The canvas's nodes, as React Flow holds them now.
 * @returns The document with every drawn node's position replaced, or `definition` itself when
 *   every position already matched. A document whose `nodes` is not an array comes back as is.
 */
export function withPositions(
  definition: WorkflowDefinition,
  nodes: ReadonlyArray<Pick<StageNode, "id" | "position">>,
): WorkflowDefinition {
  const { nodes: entries } = definition;
  if (!Array.isArray(entries)) return definition;

  const positions = new Map(
    nodes.map((node) => [node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) }]),
  );
  let changed = false;

  const next = entries.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return entry;

    const position = positions.get(entry.id);
    if (position === undefined) return entry;

    const current = isRecord(entry.position) ? readPoint(entry.position) : null;
    if (current !== null && current.x === position.x && current.y === position.y) return entry;

    changed = true;
    return { ...entry, position };
  });

  return changed ? { ...definition, nodes: next } : definition;
}

/* ------------------------------------------------------------------ selection */

/**
 * What is selected on the canvas, as the inspector will want it.
 *
 * One node is the case the inspector (S.4, [#150](https://github.com/NobuData/ouroboros/issues/150))
 * binds to; one edge is the case S.5's edge editing
 * ([#151](https://github.com/NobuData/ouroboros/issues/151)) binds to; more than one of either
 * is a selection the inspector has no form for and is reported as a count. `null` is nothing.
 */
export type CanvasSelection =
  | { readonly kind: "node"; readonly id: string; readonly stage: Stage }
  | { readonly kind: "edge"; readonly id: string; readonly connection: Connection }
  | { readonly kind: "many"; readonly nodes: number; readonly edges: number }
  | null;

/**
 * Decide the selection from what React Flow reports as selected.
 *
 * @param nodes The selected nodes.
 * @param edges The selected edges.
 * @returns The selection.
 */
export function selectionOf(
  nodes: readonly StageNode[],
  edges: readonly StageEdge[],
): CanvasSelection {
  if (nodes.length === 1 && edges.length === 0) {
    return { kind: "node", id: nodes[0].id, stage: nodes[0].data.stage };
  }
  if (edges.length === 1 && nodes.length === 0 && edges[0].data !== undefined) {
    return { kind: "edge", id: edges[0].id, connection: edges[0].data.connection };
  }
  if (nodes.length + edges.length === 0) return null;

  return { kind: "many", nodes: nodes.length, edges: edges.length };
}
