import { DslErrorCode } from "./dsl.errors";
import type { Predicate, WorkflowDocument, WorkflowEdge, WorkflowNode } from "./dsl.schema";
import { checkStructure } from "./dsl.structure";

/**
 * Documents are built here rather than read from `schemas/workflow-dsl/fixtures/`.
 *
 * The golden fixtures are the *parity* contract — the same document, the same verdict, in
 * two languages — and `dsl.parity.spec.ts` is where they are asserted. This file is about
 * the rules themselves, one at a time, including the combinations the fixture set has no
 * reason to hold: a rule that is skipped, two rules that could both fire on one edge, a
 * graph with no trigger *and* no terminal.
 */
const trigger = (id: string): WorkflowNode => ({
  id,
  type: "trigger",
  title: id,
  position: { x: 0, y: 0 },
  config: {},
});

const term = (id: string): WorkflowNode => ({
  id,
  type: "term",
  title: id,
  position: { x: 0, y: 0 },
  config: { action: "needs_review", options: {} },
});

const stage = (id: string): WorkflowNode => ({
  id,
  type: "infra",
  title: id,
  position: { x: 0, y: 0 },
  config: {},
});

const always: Predicate = { kind: "always" };

const edge = (
  from: string,
  to: string,
  kind: WorkflowEdge["kind"] = "default",
  condition?: Predicate,
): WorkflowEdge => ({ from, to, kind, ...(condition ? { condition } : {}) });

const document = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDocument => ({
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: {} },
  nodes,
  edges,
});

/** The codes reported, in the order `checkStructure` happened to produce them. */
const codes = (doc: WorkflowDocument) => checkStructure(doc).map((d) => d.code);

describe("checkStructure — the node rules", () => {
  it("accepts a trigger, a terminal and the edge between them", () => {
    expect(checkStructure(document([trigger("a"), term("b")], [edge("a", "b")]))).toEqual([]);
  });

  it("reports a workflow with no trigger, anchored at the collection that lacks one", () => {
    const [diagnostic] = checkStructure(document([stage("a"), term("b")], [edge("a", "b")]));
    expect(diagnostic.code).toBe(DslErrorCode.DOCUMENT_NO_TRIGGER);
    expect(diagnostic.path).toBe("/nodes");
    expect(diagnostic.node).toBeUndefined();
  });

  it("reports every trigger after the first, anchored at that node", () => {
    const doc = document(
      [trigger("a"), term("b"), trigger("c"), trigger("d")],
      [edge("a", "b"), edge("c", "b"), edge("d", "b")],
    );
    expect(checkStructure(doc)).toEqual([
      expect.objectContaining({
        code: DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS,
        path: "/nodes/2",
        node: "c",
      }),
      expect.objectContaining({
        code: DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS,
        path: "/nodes/3",
        node: "d",
      }),
    ]);
  });

  it("reports a workflow no path through which ends", () => {
    expect(codes(document([trigger("a"), stage("b")], [edge("a", "b")]))).toEqual([
      DslErrorCode.DOCUMENT_NO_TERMINAL,
    ]);
  });

  it("reports both when a graph has neither a trigger nor a terminal", () => {
    expect(codes(document([stage("a")], []))).toEqual([
      DslErrorCode.DOCUMENT_NO_TRIGGER,
      DslErrorCode.DOCUMENT_NO_TERMINAL,
    ]);
  });

  it("reports every node after the first that reuses an id, anchored at its own id", () => {
    const doc = document([trigger("a"), term("b"), term("b"), term("b")], [edge("a", "b")]);
    expect(checkStructure(doc)).toEqual([
      expect.objectContaining({
        code: DslErrorCode.NODE_DUPLICATE_ID,
        path: "/nodes/2/id",
        node: "b",
      }),
      expect.objectContaining({
        code: DslErrorCode.NODE_DUPLICATE_ID,
        path: "/nodes/3/id",
        node: "b",
      }),
    ]);
  });
});

describe("checkStructure — reachability", () => {
  it("reports a node no path of edges reaches", () => {
    const doc = document([trigger("a"), term("b"), stage("c")], [edge("a", "b")]);
    expect(checkStructure(doc)).toEqual([
      expect.objectContaining({ code: DslErrorCode.NODE_UNREACHABLE, path: "/nodes/2", node: "c" }),
    ]);
  });

  it("counts a node reachable only by following a loop edge as reachable", () => {
    // A stage a run arrives at by looping back to it is a stage a run arrives at.
    const doc = document(
      [trigger("a"), stage("b"), term("c"), stage("d")],
      [edge("a", "b"), edge("b", "c"), edge("b", "d"), edge("d", "b", "loop")],
    );
    expect(checkStructure(doc)).toEqual([]);
  });

  it("does not ask about reachability when there is no trigger to walk from", () => {
    // The node would be unreachable from *any* start; saying so would be reporting the
    // absence of the trigger a second time, under a name that points at the wrong node.
    expect(codes(document([term("b"), stage("c")], []))).toEqual([
      DslErrorCode.DOCUMENT_NO_TRIGGER,
    ]);
  });

  it("does not ask about reachability when two triggers make the question ambiguous", () => {
    // Walking from the first reports the second's subgraph as unreachable, which is an
    // artefact of the choice of start rather than a fact about the document.
    const doc = document(
      [trigger("a"), term("b"), trigger("c"), stage("d")],
      [edge("a", "b"), edge("c", "d"), edge("d", "b")],
    );
    expect(codes(doc)).toEqual([DslErrorCode.DOCUMENT_MULTIPLE_TRIGGERS]);
  });
});

describe("checkStructure — the edge rules", () => {
  it("reports an endpoint that names no node, on the side that names it", () => {
    const doc = document([trigger("a"), term("b")], [edge("a", "b"), edge("x", "y")]);
    expect(checkStructure(doc)).toEqual([
      expect.objectContaining({
        code: DslErrorCode.EDGE_UNKNOWN_FROM,
        path: "/edges/1/from",
        edge: { from: "x", to: "y" },
      }),
      expect.objectContaining({
        code: DslErrorCode.EDGE_UNKNOWN_TO,
        path: "/edges/1/to",
        edge: { from: "x", to: "y" },
      }),
    ]);
  });

  it("reports a second edge between a pair already joined, whatever its kind", () => {
    const doc = document(
      [trigger("a"), stage("b"), term("c")],
      [edge("a", "b"), edge("b", "c"), edge("a", "b", "branch", always)],
    );
    expect(codes(doc)).toEqual([DslErrorCode.EDGE_DUPLICATE]);
  });

  it("does not call a reversed edge a duplicate", () => {
    // An edge is identified by its *ordered* pair: b→a is not a second a→b.
    const doc = document(
      [trigger("a"), stage("b"), term("c")],
      [edge("a", "b"), edge("b", "c"), edge("b", "a")],
    );
    expect(codes(doc)).toEqual([DslErrorCode.EDGE_INTO_TRIGGER]);
  });

  it("reports an edge from a stage to itself, and nothing else about that edge", () => {
    // A self edge is neither upstream nor downstream of itself; reporting the loop rule as
    // well would be two names for one mistake.
    const doc = document(
      [trigger("a"), stage("b"), term("c")],
      [edge("a", "b"), edge("b", "b", "loop"), edge("b", "c")],
    );
    expect(codes(doc)).toEqual([DslErrorCode.EDGE_SELF_REFERENCE]);
  });

  it("reports an edge arriving at the trigger", () => {
    const doc = document([trigger("a"), term("b")], [edge("a", "b"), edge("b", "a", "loop")]);
    expect(codes(doc)).toEqual(
      expect.arrayContaining([DslErrorCode.EDGE_INTO_TRIGGER, DslErrorCode.EDGE_OUT_OF_TERMINAL]),
    );
  });

  it("reports an edge leaving a terminal", () => {
    const doc = document(
      [trigger("a"), stage("b"), term("c")],
      [edge("a", "b"), edge("b", "c"), edge("c", "b", "loop")],
    );
    expect(codes(doc)).toEqual([DslErrorCode.EDGE_OUT_OF_TERMINAL]);
  });

  it("reports a branch edge with nothing to decide it, anchored at the missing condition", () => {
    const doc = document([trigger("a"), term("b")], [edge("a", "b", "branch")]);
    expect(checkStructure(doc)).toEqual([
      expect.objectContaining({
        code: DslErrorCode.EDGE_BRANCH_WITHOUT_CONDITION,
        path: "/edges/0/condition",
        edge: { from: "a", to: "b" },
      }),
    ]);
  });

  it("reports a condition on a default edge, which is always taken", () => {
    const doc = document([trigger("a"), term("b")], [edge("a", "b", "default", always)]);
    expect(codes(doc)).toEqual([DslErrorCode.EDGE_UNEXPECTED_CONDITION]);
  });

  it("lets a loop edge carry a condition or not", () => {
    const both = document(
      [trigger("a"), stage("b"), term("c")],
      [edge("a", "b"), edge("b", "c"), edge("c", "b", "loop", always)],
    );
    // The only complaint is the terminal the loop leaves, never the condition it carries.
    expect(codes(both)).toEqual([DslErrorCode.EDGE_OUT_OF_TERMINAL]);
  });

  it("accepts the ouroboros edge: a loop back to a stage that reaches its own source", () => {
    const doc = document(
      [trigger("a"), stage("impl"), stage("gate"), term("done")],
      [
        edge("a", "impl"),
        edge("impl", "gate"),
        edge("gate", "done", "branch", always),
        edge("gate", "impl", "loop", always),
      ],
    );
    expect(checkStructure(doc)).toEqual([]);
  });

  it("reports a loop edge that goes forward rather than back up the graph", () => {
    const doc = document(
      [trigger("a"), stage("b"), term("c")],
      [edge("a", "b"), edge("b", "c"), edge("a", "c", "loop")],
    );
    expect(checkStructure(doc)).toEqual([
      expect.objectContaining({
        code: DslErrorCode.EDGE_LOOP_NOT_UPSTREAM,
        path: "/edges/2",
        edge: { from: "a", to: "c" },
      }),
    ]);
  });

  it("does not let a loop edge prove its own target upstream", () => {
    // Walking a→b would find b from a and call the loop legal; the edge has to be taken out
    // of the graph before the question is asked.
    const doc = document([trigger("a"), term("b")], [edge("a", "b"), edge("b", "a", "loop")]);
    expect(codes(doc)).toEqual(
      expect.arrayContaining([DslErrorCode.EDGE_INTO_TRIGGER, DslErrorCode.EDGE_OUT_OF_TERMINAL]),
    );
    // …and a→b is genuinely upstream of b, so the loop rule itself does not fire.
    expect(codes(doc)).not.toContain(DslErrorCode.EDGE_LOOP_NOT_UPSTREAM);
  });

  it("says nothing about the endpoints of an edge whose endpoints do not resolve", () => {
    // `x` might have been the terminal, or the trigger, or upstream. A second diagnostic
    // derived from a name that means nothing would crowd out the one that matters.
    const doc = document([trigger("a"), term("b")], [edge("a", "b"), edge("x", "b", "loop")]);
    expect(codes(doc)).toEqual([DslErrorCode.EDGE_UNKNOWN_FROM]);
  });

  it("resolves a duplicated id to the first node carrying it", () => {
    // The duplicate is already reported; resolving to the first keeps the edge rules from
    // reporting it a second time under another name.
    const doc = document([trigger("a"), term("b"), stage("b")], [edge("a", "b")]);
    expect(codes(doc)).toEqual([DslErrorCode.NODE_DUPLICATE_ID]);
  });
});
