import { describe, expect, it } from "vitest";

import {
  type Connection,
  EDGE_KINDS,
  ORIGIN,
  STAGE_EDGE_TYPE,
  STAGE_KINDS,
  STAGE_NODE_TYPE,
  type Stage,
  type StageEdge,
  type StageNode,
  edgeIds,
  edgeSides,
  isEdgeKind,
  isStageKind,
  readConnections,
  readPoint,
  readStages,
  selectionOf,
  toEdges,
  toNodes,
  withHighlight,
  withPositions,
} from "@/app/workflows/canvas/graph";

import { MOCKUP_ACTIVE_PATH, standardFixDefinition } from "../../helpers/workflows";

/**
 * The document ⇄ graph projection (#148): what the canvas reads out of a definition, what it
 * hands React Flow, and what it writes back — and the execution path laid over the edges
 * (#149's highlight mode).
 *
 * Every case is a judgement about two values — the seeded `standard-fix` in, nodes and edges
 * out; nodes in, the document out — because *positions round-trip* is a property of the
 * projection and not of a rendered page. The rendering is `studio-canvas.test.tsx`'s.
 */

/** The seeded document. */
const SEEDED = standardFixDefinition();

/** The seeded document's node entries, as stored. */
const SEEDED_NODES = SEEDED.nodes as { id: string; config: Record<string, unknown> }[];

/** A stage, for the cases that build one by hand. */
function stage(overrides: Partial<Stage> = {}): Stage {
  return { id: "s", kind: "llm", title: "S", position: ORIGIN, config: {}, ...overrides };
}

/** A node as React Flow holds one, for the cases that hand nodes back. */
function node(id: string, x: number, y: number): StageNode {
  return { id, type: STAGE_NODE_TYPE, position: { x, y }, data: { stage: stage({ id }) } };
}

/** A connection, for the cases that build one by hand. */
function connection(from: string, to: string, kind: Connection["kind"] = "default"): Connection {
  return { from, to, kind, label: null, condition: null };
}

/** An edge as React Flow holds one, for the selection and highlight cases. */
function edge(from: string, to: string, kind: Connection["kind"] = "default"): StageEdge {
  return {
    id: `${from}→${to}`,
    source: from,
    target: to,
    data: { connection: connection(from, to, kind) },
  };
}

describe("the vocabulary", () => {
  it("knows the five node types and the three edge kinds, and nothing else", () => {
    expect(STAGE_KINDS).toEqual(["trigger", "llm", "infra", "flow", "term"]);
    expect(EDGE_KINDS).toEqual(["default", "branch", "loop"]);
    for (const kind of STAGE_KINDS) expect(isStageKind(kind)).toBe(true);
    for (const kind of EDGE_KINDS) expect(isEdgeKind(kind)).toBe(true);
    expect(isStageKind("model")).toBe(false);
    expect(isStageKind(undefined)).toBe(false);
    expect(isEdgeKind("branch ")).toBe(false);
  });

  it("reads a point only when both coordinates are finite numbers", () => {
    expect(readPoint({ x: 24, y: 40 })).toEqual({ x: 24, y: 40 });
    expect(readPoint({ x: -3.5, y: 0 })).toEqual({ x: -3.5, y: 0 });
    expect(readPoint({ x: "24", y: 40 })).toBe(ORIGIN);
    expect(readPoint({ x: Number.NaN, y: 40 })).toBe(ORIGIN);
    expect(readPoint({ x: 24 })).toBe(ORIGIN);
    expect(readPoint(null)).toBe(ORIGIN);
    expect(readPoint([24, 40])).toBe(ORIGIN);
  });
});

describe("reading the seeded document", () => {
  it("reads all twelve stages, in document order, at the mockup's positions, with their configs", () => {
    const stages = readStages(SEEDED);

    expect(stages.map((s) => s.id)).toEqual([
      "issue-queued",
      "analyze",
      "effort-recheck",
      "plan",
      "split",
      "back-to-queue",
      "implement",
      "build",
      "test",
      "review",
      "checks-green",
      "open-pr",
    ]);
    expect(stages[0]).toEqual({
      id: "issue-queued",
      kind: "trigger",
      title: "Issue queued",
      position: { x: 24, y: 40 },
      config: {},
    });
    expect(stages[6]).toEqual({
      id: "implement",
      kind: "llm",
      title: "Code the change",
      position: { x: 588, y: 420 },
      config: SEEDED_NODES[6].config,
    });
    // The config is the document's own object — read, not copied — so a chip derived from it
    // is derived from what the document holds.
    expect(stages[6].config).toBe(SEEDED_NODES[6].config);
    expect(stages.map((s) => s.kind)).toEqual([
      "trigger",
      "llm",
      "flow",
      "llm",
      "llm",
      "term",
      "llm",
      "infra",
      "infra",
      "llm",
      "flow",
      "term",
    ]);
  });

  it("reads all twelve connections, with their kinds, labels and conditions", () => {
    const connections = readConnections(SEEDED, readStages(SEEDED));

    expect(connections).toHaveLength(12);
    expect(connections[0]).toEqual({
      from: "issue-queued",
      to: "analyze",
      kind: "default",
      label: null,
      condition: null,
    });
    expect(connections[2]).toEqual({
      from: "effort-recheck",
      to: "plan",
      kind: "branch",
      label: "≤ M ↓",
      condition: { kind: "effort", op: "lte", value: "m" },
    });
    expect(connections[11]).toEqual({
      from: "checks-green",
      to: "implement",
      kind: "loop",
      label: "fail ↺",
      condition: { kind: "checks", op: "any_failed" },
    });
  });
});

describe("reading a draft that is not yet a document", () => {
  it("reads nothing out of a blank document, or one with no node list", () => {
    expect(readStages({})).toEqual([]);
    expect(readStages(null)).toEqual([]);
    expect(readStages({ nodes: "twelve" })).toEqual([]);
    expect(readConnections({ edges: {} }, [])).toEqual([]);
    expect(readConnections(null, [])).toEqual([]);
  });

  it("skips a node it cannot draw and keeps the ones it can", () => {
    // No id, an id that is not a string, a type the DSL does not know, and something that is
    // not an object at all — each is left to the publish gate to name, not thrown on here.
    const stages = readStages({
      nodes: [
        { type: "llm", title: "no id", position: { x: 1, y: 1 } },
        { id: 7, type: "llm", position: { x: 1, y: 1 } },
        { id: "unknown", type: "model", position: { x: 1, y: 1 } },
        "not a node",
        null,
        { id: "ok", type: "term", title: "Fine", position: { x: 5, y: 6 }, config: {} },
      ],
    });

    expect(stages).toEqual([{ id: "ok", kind: "term", title: "Fine", position: { x: 5, y: 6 }, config: {} }]);
  });

  it("titles a stage by its id when the document gives it none, places one with no position at the origin, and reads a config that is not an object as empty", () => {
    const stages = readStages({ nodes: [{ id: "analyze", type: "llm", title: "", config: ["skill"] }] });

    expect(stages).toEqual([{ id: "analyze", kind: "llm", title: "analyze", position: ORIGIN, config: {} }]);
  });

  it("keeps the first of two nodes sharing an id", () => {
    // One id is one node to React Flow, and the first is what the edges were written against.
    const stages = readStages({
      nodes: [
        { id: "a", type: "llm", title: "First", position: { x: 1, y: 1 } },
        { id: "a", type: "term", title: "Second", position: { x: 2, y: 2 } },
      ],
    });

    expect(stages.map((s) => s.title)).toEqual(["First"]);
  });

  it("leaves out an edge naming a stage the document does not hold", () => {
    const stages = readStages({ nodes: [{ id: "a", type: "llm" }, { id: "b", type: "term" }] });
    const connections = readConnections(
      {
        edges: [
          { from: "a", to: "b", kind: "default" },
          { from: "a", to: "gone", kind: "default" },
          { from: "gone", to: "b", kind: "default" },
          { from: "a", kind: "default" },
          "not an edge",
        ],
      },
      stages,
    );

    expect(connections).toEqual([connection("a", "b")]);
  });

  it("reads a kind it does not know as the plain path, an empty label as none, and a condition that is not an object as none", () => {
    const stages = readStages({ nodes: [{ id: "a", type: "llm" }, { id: "b", type: "term" }] });
    const [read] = readConnections(
      { edges: [{ from: "a", to: "b", kind: "dashed", label: "", condition: "checks" }] },
      stages,
    );

    expect(read).toEqual(connection("a", "b"));
  });
});

describe("which sides an edge runs between", () => {
  it("runs along the row for a target further along than down", () => {
    expect(edgeSides({ x: 24, y: 40 }, { x: 306, y: 40 })).toEqual({ source: "right", target: "left" });
    expect(edgeSides({ x: 588, y: 420 }, { x: 306, y: 420 })).toEqual({ source: "left", target: "right" });
    // Down a little, along a lot: still the row.
    expect(edgeSides({ x: 588, y: 40 }, { x: 306, y: 230 })).toEqual({ source: "left", target: "right" });
  });

  it("runs between rows for a target further down than along", () => {
    expect(edgeSides({ x: 588, y: 40 }, { x: 588, y: 230 })).toEqual({ source: "bottom", target: "top" });
    expect(edgeSides({ x: 24, y: 630 }, { x: 24, y: 420 })).toEqual({ source: "top", target: "bottom" });
  });

  it("reads a tie as the row, because the mockup's rows are horizontal", () => {
    expect(edgeSides({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ source: "right", target: "left" });
    expect(edgeSides({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ source: "right", target: "left" });
  });

  it("arcs a loop over the rows whenever there is a row to arc over", () => {
    // The ouroboros edge: the gate's *fail ↺* leaves its top and lands on implement's bottom,
    // rather than sharing the gate's right side with its *pass →*.
    expect(edgeSides({ x: 306, y: 630 }, { x: 588, y: 420 }, "loop")).toEqual({
      source: "top",
      target: "bottom",
    });
    expect(edgeSides({ x: 306, y: 630 }, { x: 588, y: 630 }, "loop")).toEqual({
      source: "right",
      target: "left",
    });
  });

  it("drops a fork's outcome a row the way the mockup does, and runs one along its own row", () => {
    // The decision's *> M ↘*: out of its bottom beside *≤ M ↓*, into the split's top — not out of
    // its left side and back across the edge from analyze. The gate's *pass →* stays on its row.
    expect(edgeSides({ x: 588, y: 40 }, { x: 306, y: 230 }, "branch")).toEqual({ source: "bottom", target: "top" });
    expect(edgeSides({ x: 306, y: 630 }, { x: 588, y: 630 }, "branch")).toEqual({ source: "right", target: "left" });
    expect(toEdges(SEEDED).find((e) => e.id === "effort-recheck→split")).toMatchObject({
      sourceHandle: "bottom",
      targetHandle: "top",
    });
  });
});

describe("edge ids", () => {
  it("names an edge by its two ends, and numbers a second edge between the same pair", () => {
    expect(
      edgeIds([
        connection("a", "b"),
        connection("a", "b", "loop"),
        connection("b", "a"),
        connection("a", "b", "branch"),
      ]),
    ).toEqual(["a→b", "a→b#2", "b→a", "a→b#3"]);
  });
});

describe("the projection into React Flow", () => {
  it("makes one node per stage, of the one type, at the document's position, carrying the stage", () => {
    const nodes = toNodes(SEEDED);

    expect(nodes).toHaveLength(12);
    expect(nodes[6]).toEqual({
      id: "implement",
      type: STAGE_NODE_TYPE,
      position: { x: 588, y: 420 },
      data: {
        stage: {
          id: "implement",
          kind: "llm",
          title: "Code the change",
          position: { x: 588, y: 420 },
          config: SEEDED_NODES[6].config,
        },
      },
      ariaLabel: "Model stage: Code the change",
    });
    expect(new Set(nodes.map((n) => n.id)).size).toBe(12);
  });

  it("hands the trigger node the document's root trigger, which its chip prints, and no other node", () => {
    const nodes = toNodes(SEEDED);

    expect(nodes[0].data.trigger).toEqual({ event: "ticket_queued", conditions: { effort_lte: "m" } });
    expect(nodes.slice(1).every((n) => !("trigger" in n.data))).toBe(true);
  });

  it("makes one edge per connection, of the one type, between the sides the positions decide", () => {
    const edges = toEdges(SEEDED);

    expect(edges).toHaveLength(12);
    expect(edges[0]).toMatchObject({
      id: "issue-queued→analyze",
      type: STAGE_EDGE_TYPE,
      source: "issue-queued",
      target: "analyze",
      sourceHandle: "right",
      targetHandle: "left",
      label: undefined,
      data: { connection: connection("issue-queued", "analyze") },
      ariaLabel: "Issue queued to Understand & scope",
    });
    expect(edges[11]).toMatchObject({
      id: "checks-green→implement",
      sourceHandle: "top",
      targetHandle: "bottom",
      label: "fail ↺",
      ariaLabel: "Checks green? to Code the change (fail ↺)",
    });
    // The arrowheads are the edge component's (`stage-edge.tsx`), not the library's markers.
    expect(edges.every((e) => e.markerEnd === undefined)).toBe(true);
    expect(new Set(edges.map((e) => e.id)).size).toBe(12);
  });

  it("projects a blank document as no nodes and no edges", () => {
    expect(toNodes({})).toEqual([]);
    expect(toEdges({})).toEqual([]);
    expect(toNodes(null)).toEqual([]);
  });
});

describe("the execution path", () => {
  /** The ids of the edges a path marks. */
  function onPath(edges: readonly StageEdge[]): string[] {
    return edges.filter((e) => e.data?.onPath === true).map((e) => e.id);
  }

  it("marks the mockup's active path, and nothing else", () => {
    const edges = withHighlight(toEdges(SEEDED), MOCKUP_ACTIVE_PATH);

    expect(onPath(edges)).toEqual([
      "issue-queued→analyze",
      "analyze→effort-recheck",
      "effort-recheck→plan",
      "plan→implement",
    ]);
  });

  it("names an edge by its ordered pair: the reverse of a taken edge is not taken", () => {
    const edges = [edge("a", "b"), edge("b", "a")];

    expect(onPath(withHighlight(edges, [{ from: "a", to: "b" }]))).toEqual(["a→b"]);
  });

  it("ignores a pair the canvas does not draw, and a pair named twice is marked once", () => {
    const edges = toEdges(SEEDED);
    const path = [
      { from: "gone", to: "implement" },
      { from: "checks-green", to: "implement" },
      { from: "checks-green", to: "implement" },
    ];

    expect(onPath(withHighlight(edges, path))).toEqual(["checks-green→implement"]);
  });

  it("returns every unchanged edge as the same object, so only the edges that changed redraw", () => {
    const edges = toEdges(SEEDED);
    const lit = withHighlight(edges, MOCKUP_ACTIVE_PATH);

    // Nothing to draw: every edge is the one it was.
    expect(withHighlight(edges, null).every((e, i) => e === edges[i])).toBe(true);
    expect(withHighlight(edges, []).every((e, i) => e === edges[i])).toBe(true);
    // A path marks four; the other eight are untouched.
    expect(lit.filter((e, i) => e !== edges[i])).toHaveLength(4);
    // Turning it off unmarks those four and leaves the eight alone.
    const cleared = withHighlight(lit, null);
    expect(cleared.filter((e, i) => e !== lit[i])).toHaveLength(4);
    expect(onPath(cleared)).toEqual([]);
  });

  it("never touches the edges it was given", () => {
    const edges = toEdges(SEEDED);

    withHighlight(edges, MOCKUP_ACTIVE_PATH);

    expect(onPath(edges)).toEqual([]);
    expect(edges[0].data).toEqual({ connection: connection("issue-queued", "analyze") });
  });

  it("leaves an edge with no data alone", () => {
    const bare: StageEdge = { id: "a→b", source: "a", target: "b" };

    expect(withHighlight([bare], [{ from: "a", to: "b" }])[0]).toBe(bare);
  });
});

describe("writing positions back", () => {
  it("round-trips: the seeded document through the projection and back is itself", () => {
    // The ticket's criterion as an identity: nothing moved, so the same object comes back.
    expect(withPositions(SEEDED, toNodes(SEEDED))).toBe(SEEDED);
  });

  it("writes a moved node's position into the document and touches nothing else", () => {
    const nodes = toNodes(SEEDED).map((n) => (n.id === "implement" ? { ...n, position: { x: 600, y: 430 } } : n));
    const next = withPositions(SEEDED, nodes);

    expect(next).not.toBe(SEEDED);
    expect(next).toEqual({
      ...SEEDED,
      nodes: (SEEDED.nodes as Record<string, unknown>[]).map((entry) =>
        entry.id === "implement" ? { ...entry, position: { x: 600, y: 430 } } : entry,
      ),
    });
    // The document it was given is not mutated: a draft is a value, not a place.
    expect((SEEDED.nodes as { id: string; position: unknown }[])[6].position).toEqual({ x: 588, y: 420 });
    expect(standardFixDefinition()).toEqual(SEEDED);
  });

  it("stores whole pixels", () => {
    const next = withPositions(SEEDED, [node("implement", 600.4, 429.6)]);

    expect((next.nodes as { id: string; position: unknown }[])[6].position).toEqual({ x: 600, y: 430 });
  });

  it("leaves a node the canvas does not draw as it was, and a document with no node list alone", () => {
    const document = {
      nodes: [{ id: 7, position: { x: 1, y: 1 } }, "not a node", { id: "a", type: "llm", position: { x: 1, y: 1 } }],
    };

    expect(withPositions(document, [node("a", 9, 9)])).toEqual({
      nodes: [{ id: 7, position: { x: 1, y: 1 } }, "not a node", { id: "a", type: "llm", position: { x: 9, y: 9 } }],
    });
    expect(withPositions({ nodes: "none" }, [node("a", 9, 9)])).toEqual({ nodes: "none" });
    expect(withPositions({}, [node("a", 9, 9)])).toEqual({});
  });

  it("gives a node with no position one, once the canvas has placed it", () => {
    // A draft's node with no position is drawn at the origin; writing it back repairs the draft.
    const next = withPositions({ nodes: [{ id: "a", type: "llm" }] }, [node("a", 0, 0)]);

    expect(next).toEqual({ nodes: [{ id: "a", type: "llm", position: { x: 0, y: 0 } }] });
  });
});

describe("the selection", () => {
  it("is the one node, for the inspector", () => {
    const [n] = toNodes(SEEDED);

    expect(selectionOf([n], [])).toEqual({ kind: "node", id: "issue-queued", stage: n.data.stage });
  });

  it("is the one edge, for edge editing", () => {
    expect(selectionOf([], [edge("a", "b", "loop")])).toEqual({
      kind: "edge",
      id: "a→b",
      connection: connection("a", "b", "loop"),
    });
  });

  it("is a count for anything more, and nothing for nothing", () => {
    expect(selectionOf([node("a", 0, 0), node("b", 0, 0)], [])).toEqual({ kind: "many", nodes: 2, edges: 0 });
    expect(selectionOf([node("a", 0, 0)], [edge("a", "b")])).toEqual({ kind: "many", nodes: 1, edges: 1 });
    expect(selectionOf([], [])).toBeNull();
  });
});
