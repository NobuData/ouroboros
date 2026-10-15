import {
  applyOperation,
  asDraftDocument,
  type DraftDocument,
  type DraftOperation,
} from "../copilot/copilot.operations";
import { diffDraft, type StudioOperation } from "./draft.diff";
import { readFixture } from "./dsl.golden.fixture";

/** Every valid golden document — the shapes a real save carries. */
const GOLDEN = ["minimal", "standard-fix", "infra-bare", "change-paths", "predicate-kinds"].map(
  (name) => [name, asDraftDocument(readFixture(`valid/${name}.json`))] as const,
);

const EMPTY = { dsl_version: "1.0", nodes: [], edges: [] };

const TRIGGER = { event: "ticket_queued", conditions: {} };
const START = {
  id: "start",
  type: "trigger",
  title: "Queued",
  position: { x: 0, y: 0 },
  config: {},
};
const TEST = { id: "test", type: "infra", title: "Test", position: { x: 240, y: 0 }, config: {} };
const DONE = {
  id: "done",
  type: "term",
  title: "Needs review",
  position: { x: 480, y: 0 },
  config: { action: "needs_review", options: {} },
};
const BASE = {
  dsl_version: "1.0",
  trigger: TRIGGER,
  nodes: [START, TEST, DONE],
  edges: [
    { from: "start", to: "test", kind: "default" },
    { from: "test", to: "done", kind: "default" },
  ],
};

/**
 * Replay a batch the way `workflow_draft_apply_op()` does — through the copilot's mirror of it.
 *
 * @param stored - The document before.
 * @param operations - The batch.
 * @returns The document after.
 */
function replay(stored: unknown, operations: readonly StudioOperation[]): DraftDocument {
  let document = asDraftDocument(stored);
  for (const operation of operations) {
    const applied = applyOperation(document, operation as unknown as DraftOperation);
    if (!applied.ok) throw new Error(applied.message);
    document = applied.document;
  }
  return document;
}

/** A document with its stages and edges sorted, so order does not count. */
function unordered(document: unknown): unknown {
  const read = asDraftDocument(document);
  const key = (value: unknown) => JSON.stringify(value);
  return {
    ...read,
    nodes: [...read.nodes].sort((a, b) => key(a).localeCompare(key(b))),
    edges: [...read.edges].sort((a, b) => key(a).localeCompare(key(b))),
  };
}

/** The batch, or a failure naming the problems. */
function batch(stored: unknown, saved: unknown): readonly StudioOperation[] {
  const diff = diffDraft(stored, saved);
  if (!diff.ok) throw new Error(JSON.stringify(diff.problems));
  return diff.operations;
}

/** The problems' paths, or a failure when the save was accepted. */
function refused(stored: unknown, saved: unknown): string[] {
  const diff = diffDraft(stored, saved);
  if (diff.ok) throw new Error("the save was accepted");
  return diff.problems.map((problem) => problem.path);
}

describe("a studio save as a batch of draft operations (#1751)", () => {
  describe("the batch replays to the saved document", () => {
    it.each(GOLDEN)("builds %s from the empty document", (_name, document) => {
      expect(replay(EMPTY, batch(EMPTY, document))).toEqual(document);
    });

    it.each(GOLDEN)("tears %s down to the empty document, trigger kept", (_name, document) => {
      const emptied = { ...document, nodes: [], edges: [] };

      expect(replay(document, batch(document, emptied))).toEqual(emptied);
    });

    it.each(GOLDEN)("turns %s into the standard fix and back", (_name, document) => {
      const target = GOLDEN[1][1];

      expect(unordered(replay(document, batch(document, target)))).toEqual(unordered(target));
      expect(unordered(replay(target, batch(target, document)))).toEqual(unordered(document));
    });
  });

  it("records nothing for a save that changes nothing", () => {
    expect(batch(BASE, structuredClone(BASE))).toEqual([]);
  });

  it("reads a blank {} as the empty document, on either side", () => {
    expect(batch({}, EMPTY)).toEqual([]);
    expect(batch(EMPTY, {})).toEqual([]);
  });

  it("records nothing for a save that only reorders stages and edges", () => {
    const reordered = {
      ...BASE,
      nodes: [...BASE.nodes].reverse(),
      edges: [...BASE.edges].reverse(),
    };

    expect(batch(BASE, reordered)).toEqual([]);
  });

  it("records a renamed stage as set_stage, in place", () => {
    const renamed = { ...TEST, title: "Run the tests" };
    const operations = batch(BASE, { ...BASE, nodes: [START, renamed, DONE] });

    expect(operations).toEqual([{ kind: "set_stage", params: { node: renamed } }]);
    expect(replay(BASE, operations).nodes).toEqual([START, renamed, DONE]);
  });

  it("records an added stage and its edges as add_stage and add_edge", () => {
    const lint = {
      id: "lint",
      type: "infra",
      title: "Lint",
      position: { x: 240, y: 120 },
      config: {},
    };
    const edge = { from: "start", to: "lint", kind: "default" };
    const operations = batch(BASE, {
      ...BASE,
      nodes: [...BASE.nodes, lint],
      edges: [...BASE.edges, edge],
    });

    expect(operations).toEqual([
      { kind: "add_stage", params: { node: lint } },
      { kind: "add_edge", params: { edge } },
    ]);
  });

  it("records a removed stage once, and lets it take its edges", () => {
    const operations = batch(BASE, {
      ...BASE,
      nodes: [START, DONE],
      edges: [{ from: "start", to: "done", kind: "default" }],
    });

    expect(operations).toEqual([
      { kind: "remove_stage", params: { id: "test" } },
      { kind: "add_edge", params: { edge: { from: "start", to: "done", kind: "default" } } },
    ]);
  });

  it("records a changed edge as its removal and its addition", () => {
    const labelled = { from: "test", to: "done", kind: "default", label: "pass →" };
    const operations = batch(BASE, { ...BASE, edges: [BASE.edges[0], labelled] });

    expect(operations).toEqual([
      { kind: "remove_edge", params: { from: "test", to: "done" } },
      { kind: "add_edge", params: { edge: labelled } },
    ]);
  });

  it("records a changed stage id as a removal and an addition, with its edges re-added", () => {
    const check = { ...TEST, id: "check" };
    const saved = {
      ...BASE,
      nodes: [START, check, DONE],
      edges: [
        { from: "start", to: "check", kind: "default" },
        { from: "check", to: "done", kind: "default" },
      ],
    };
    const operations = batch(BASE, saved);

    expect(operations.map((operation) => operation.kind)).toEqual([
      "remove_stage",
      "add_stage",
      "add_edge",
      "add_edge",
    ]);
    expect(unordered(replay(BASE, operations))).toEqual(unordered(saved));
  });

  it("records a changed trigger as set_trigger, and a first one too", () => {
    const narrowed = { event: "ticket_queued", conditions: { labels: ["security"] } };

    expect(batch(BASE, { ...BASE, trigger: narrowed })).toEqual([
      { kind: "set_trigger", params: { trigger: narrowed } },
    ]);
    expect(batch(EMPTY, { ...EMPTY, trigger: TRIGGER })).toEqual([
      { kind: "set_trigger", params: { trigger: TRIGGER } },
    ]);
  });

  it("records a half-built stage the DSL schema refuses, as autosave must", () => {
    const unrouted = { id: "fix", type: "llm", title: "Fix", position: { x: 0, y: 0 }, config: {} };

    expect(batch(BASE, { ...BASE, nodes: [...BASE.nodes, unrouted] })).toEqual([
      { kind: "add_stage", params: { node: unrouted } },
    ]);
  });

  it("keeps a key it cannot change when the save leaves it as it was", () => {
    const stored = { ...BASE, note: "carried" };

    expect(batch(stored, { ...stored })).toEqual([]);
  });

  describe("refuses what the operations cannot say", () => {
    it.each([
      ["a document that is not an object", BASE, [], [""]],
      ["a changed DSL version", BASE, { ...BASE, dsl_version: "1.1" }, ["/dsl_version"]],
      [
        "a removed trigger",
        BASE,
        { dsl_version: "1.0", nodes: BASE.nodes, edges: BASE.edges },
        ["/trigger"],
      ],
      ["a trigger that is not an object", BASE, { ...BASE, trigger: "always" }, ["/trigger"]],
      ["a top-level key the DSL has no operation for", BASE, { ...BASE, guard: {} }, ["/guard"]],
      ["a stored key the save changes", { ...BASE, note: "a" }, { ...BASE, note: "b" }, ["/note"]],
      ["a top-level key with a slash", BASE, { ...BASE, "a/b": 1 }, ["/a~1b"]],
      ["stages that are not a list", BASE, { ...BASE, nodes: {} }, ["/nodes"]],
      ["edges that are not a list", BASE, { ...BASE, edges: "none" }, ["/edges"]],
      [
        "a stage that is not an object",
        BASE,
        { ...BASE, nodes: [...BASE.nodes, "x"] },
        ["/nodes/3"],
      ],
      ["an edge that is not an object", BASE, { ...BASE, edges: [...BASE.edges, 1] }, ["/edges/2"]],
      [
        "a stage whose id is not a slug",
        BASE,
        { ...BASE, nodes: [...BASE.nodes, { ...TEST, id: "Not A Slug" }] },
        ["/nodes/3/id"],
      ],
      [
        "a stage with no id",
        BASE,
        { ...BASE, nodes: [...BASE.nodes, { title: "x" }] },
        ["/nodes/3/id"],
      ],
      ["a repeated stage id", BASE, { ...BASE, nodes: [...BASE.nodes, TEST] }, ["/nodes/3/id"]],
      [
        "an edge naming no stage",
        BASE,
        { ...BASE, edges: [...BASE.edges, { from: "done", to: "ghost", kind: "default" }] },
        ["/edges/2/to"],
      ],
      [
        "an edge with no ends",
        BASE,
        { ...BASE, edges: [...BASE.edges, { kind: "default" }] },
        ["/edges/2/from", "/edges/2/to"],
      ],
      [
        "a repeated pair",
        BASE,
        { ...BASE, edges: [...BASE.edges, { from: "start", to: "test", kind: "loop" }] },
        ["/edges/2"],
      ],
    ])("%s", (_what, stored, saved, paths) => {
      expect(refused(stored, saved)).toEqual(paths);
    });

    it("names every problem at once, each with a sentence", () => {
      const diff = diffDraft(BASE, {
        ...BASE,
        dsl_version: "2.0",
        nodes: [...BASE.nodes, TEST],
        edges: [...BASE.edges, { from: "test", to: "ghost", kind: "default" }],
      });

      expect(diff.ok).toBe(false);
      if (diff.ok) return;
      expect(diff.problems.map((problem) => problem.path)).toEqual([
        "/dsl_version",
        "/nodes/3/id",
        "/edges/2/to",
      ]);
      for (const problem of diff.problems) expect(problem.message).toMatch(/\S/);
    });
  });
});
