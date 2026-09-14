import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import {
  DSL_VERSION,
  NODE_ID_PATTERN,
  freePosition,
  freshStageId,
  slugify,
  startingTrigger,
  withAddedStage,
  withConnection,
  withConnectionFields,
  withInsertedStage,
  withoutConnection,
  withoutItems,
} from "@/app/workflows/canvas/edit";
import { structuralFindings } from "@/app/workflows/canvas/rules";

import { standardFixDefinition } from "../../helpers/workflows";

/**
 * The canvas's edits as values (#151): a stage added from the catalog, a connection drawn, an edge's
 * fields replaced, a stage inserted into an edge, and a selection deleted — each a document in and
 * a new document out, the input untouched. Insertion is also held to the ticket's *rewires both
 * sides correctly and leaves a valid graph*, on every edge of the seeded `standard-fix`.
 */

/** The seeded document. */
const SEEDED = standardFixDefinition();

/** The seeded catalog's model stage, as **Add stage ▾** drops it. */
const MODEL = {
  type: "llm",
  title: "Model stage",
  config: { mode: "prompt", limits: { max_retries: 2, token_budget: 400_000 } },
} as const;

/** One entry of a document's list. */
type Entry = Record<string, unknown>;

/** A document's nodes. */
function nodes(definition: WorkflowDefinition): Entry[] {
  return definition.nodes as Entry[];
}

/** A document's edges. */
function edges(definition: WorkflowDefinition): Entry[] {
  return definition.edges as Entry[];
}

/** The seeded loop — the gate's *fail ↺* back to implement. */
const LOOP = { from: "checks-green", to: "implement" };

describe("a new stage's id", () => {
  it("is the title as a slug", () => {
    expect(slugify("Open PR & auto-merge")).toBe("open-pr-auto-merge");
    expect(slugify("--Build--")).toBe("build");
    expect(slugify("!!!")).toBe("");
    expect(freshStageId(SEEDED, "Model stage", "llm")).toBe("model-stage");
  });

  it("is numbered from two when the slug is taken", () => {
    expect(freshStageId(SEEDED, "Build", "infra")).toBe("build-2");

    const twice = { nodes: [{ id: "build" }, { id: "build-2" }] };
    expect(freshStageId(twice, "Build", "infra")).toBe("build-3");
  });

  it("falls back to the type, then to `stage`, when the title has nothing to slug", () => {
    expect(freshStageId({}, "!!!", "llm")).toBe("llm");
    expect(freshStageId({}, "", "")).toBe("stage");
  });

  it("is never longer than an id may be, numbered or not", () => {
    const long = "a".repeat(70);
    const first = freshStageId({}, long, "llm");
    const second = freshStageId({ nodes: [{ id: first }] }, long, "llm");

    expect(first).toHaveLength(64);
    expect(second).toBe(`${"a".repeat(62)}-2`);
    expect(first).toMatch(NODE_ID_PATTERN);
    expect(second).toMatch(NODE_ID_PATTERN);
  });
});

describe("adding a stage", () => {
  it("makes a blank draft a document: the version, the stage, and an empty edge list", () => {
    const { definition, id } = withAddedStage({}, MODEL, { x: 10.4, y: 20.6 });

    expect(id).toBe("model-stage");
    expect(definition).toEqual({
      dsl_version: DSL_VERSION,
      nodes: [{ id: "model-stage", type: "llm", title: "Model stage", position: { x: 10, y: 21 }, config: MODEL.config }],
      edges: [],
    });
  });

  it("gives a document its root trigger with its first trigger stage, in the schema's key order", () => {
    const { definition } = withAddedStage({}, { type: "trigger", title: "Issue queued", config: {} }, { x: 0, y: 0 });

    expect(definition.trigger).toEqual(startingTrigger());
    expect(Object.keys(definition)).toEqual(["dsl_version", "trigger", "nodes", "edges"]);
  });

  it("keeps a root trigger and every other root field the document already has", () => {
    const trigger = { event: "ticket_queued", conditions: { effort_lte: "s" } };
    const { definition } = withAddedStage(
      { trigger, note: "kept" },
      { type: "trigger", title: "Issue queued", config: {} },
      { x: 0, y: 0 },
    );

    expect(definition.trigger).toBe(trigger);
    expect(definition.note).toBe("kept");
  });

  it("copies the template's config rather than sharing it", () => {
    const { definition } = withAddedStage({}, MODEL, { x: 0, y: 0 });
    const config = nodes(definition)[0].config as Entry;

    expect(config).toEqual(MODEL.config);
    expect(config).not.toBe(MODEL.config);
    expect(config.limits).not.toBe(MODEL.config.limits);
  });

  it("appends to the seeded document and leaves the input untouched", () => {
    const { definition } = withAddedStage(SEEDED, MODEL, { x: 0, y: 900 });

    expect(nodes(definition)).toHaveLength(13);
    expect(nodes(definition).slice(0, 12)).toEqual(nodes(SEEDED));
    expect(nodes(SEEDED)).toHaveLength(12);
    expect(definition.edges).toBe(SEEDED.edges);
  });

  it("titles a template with no title by its type", () => {
    const { definition } = withAddedStage({}, { type: "infra", title: "", config: {} }, { x: 0, y: 0 });

    expect(nodes(definition)[0].title).toBe("infra");
  });
});

describe("where a dropped stage lands", () => {
  it("is the point itself, in whole pixels, when no stage is there", () => {
    expect(freePosition(SEEDED, { x: 900.4, y: 12.5 })).toEqual({ x: 900, y: 13 });
  });

  it("is nudged down and right until no stage has its corner there", () => {
    // `analyze` sits at (306, 40).
    expect(freePosition(SEEDED, { x: 306, y: 40 })).toEqual({ x: 330, y: 64 });

    const stacked = {
      nodes: [
        { id: "a", type: "llm", position: { x: 0, y: 0 } },
        { id: "b", type: "llm", position: { x: 24, y: 24 } },
      ],
    };
    expect(freePosition(stacked, { x: 0, y: 0 })).toEqual({ x: 48, y: 48 });
  });

  it("stays inside the schema's bounds on a position", () => {
    expect(freePosition({}, { x: 200_000, y: -200_000 })).toEqual({ x: 100_000, y: -100_000 });
  });
});

describe("connecting two stages", () => {
  it("appends a plain edge with no label and no condition field at all", () => {
    const next = withConnection(SEEDED, { from: "plan", to: "build" }, { kind: "default", label: null });
    const added = edges(next).at(-1);

    expect(added).toEqual({ from: "plan", to: "build", kind: "default" });
    expect(Object.keys(added ?? {})).toEqual(["from", "to", "kind"]);
    expect(edges(SEEDED)).toHaveLength(12);
  });

  it("stores a label trimmed, and a condition as given", () => {
    const next = withConnection(
      SEEDED,
      { from: "plan", to: "split" },
      { kind: "branch", label: "  pass → ", condition: { kind: "always" } },
    );

    expect(edges(next).at(-1)).toEqual({
      from: "plan",
      to: "split",
      kind: "branch",
      label: "pass →",
      condition: { kind: "always" },
    });
  });

  it("gives a blank draft its version and edge list", () => {
    expect(withConnection({}, { from: "a", to: "b" }, { kind: "default", label: null })).toEqual({
      dsl_version: DSL_VERSION,
      nodes: [],
      edges: [{ from: "a", to: "b", kind: "default" }],
    });
  });
});

describe("editing an edge", () => {
  it("replaces the kind, label and condition in place, and touches no other edge", () => {
    const next = withConnectionFields(SEEDED, LOOP, { kind: "loop", label: null });

    expect(edges(next)[11]).toEqual({ from: "checks-green", to: "implement", kind: "loop" });
    edges(next)
      .slice(0, 11)
      .forEach((edge, index) => expect(edge).toBe(edges(SEEDED)[index]));
  });

  it("stores a new condition and label", () => {
    const next = withConnectionFields(
      SEEDED,
      { from: "plan", to: "implement" },
      { kind: "branch", label: "go", condition: { kind: "always" } },
    );

    expect(edges(next)[5]).toEqual({
      from: "plan",
      to: "implement",
      kind: "branch",
      label: "go",
      condition: { kind: "always" },
    });
  });

  it("answers the same document for a pair no edge joins", () => {
    expect(withConnectionFields(SEEDED, { from: "a", to: "b" }, { kind: "default", label: null })).toBe(SEEDED);
    expect(withConnectionFields({}, LOOP, { kind: "default", label: null })).toEqual({});
  });
});

describe("deleting", () => {
  it("removes one edge, and answers the same document for one it does not hold", () => {
    const next = withoutConnection(SEEDED, LOOP);

    expect(edges(next)).toHaveLength(11);
    expect(edges(next).some((edge) => edge.from === "checks-green" && edge.to === "implement")).toBe(false);
    expect(withoutConnection(SEEDED, { from: "a", to: "b" })).toBe(SEEDED);
    const bare = { nodes: [] };
    expect(withoutConnection(bare, LOOP)).toBe(bare);
  });

  it("removes a selection of stages and edges, each stage with its own edges", () => {
    const next = withoutItems(SEEDED, { stages: ["split"], edges: [LOOP] });

    expect(nodes(next).map((node) => node.id)).not.toContain("split");
    expect(nodes(next)).toHaveLength(11);
    // Twelve edges, less the split's two and the loop.
    expect(edges(next)).toHaveLength(9);
  });

  it("answers the same document when nothing named is in it", () => {
    expect(withoutItems(SEEDED, { stages: [], edges: [] })).toBe(SEEDED);
    expect(withoutItems(SEEDED, { stages: ["nope"], edges: [{ from: "a", to: "b" }] })).toBe(SEEDED);
  });
});

describe("inserting a stage into an edge", () => {
  it("rewires both sides: the first hop keeps the old edge's kind, label and condition, the second is plain", () => {
    const inserted = withInsertedStage(SEEDED, LOOP, MODEL);
    if (inserted === null) throw new Error("the loop is in the seed");
    const { definition, id } = inserted;

    expect(id).toBe("model-stage");
    expect(edges(definition)).toHaveLength(13);
    expect(edges(definition)[11]).toEqual({
      from: "checks-green",
      to: "model-stage",
      kind: "loop",
      label: "fail ↺",
      condition: { kind: "checks", op: "any_failed" },
    });
    expect(edges(definition)[12]).toEqual({ from: "model-stage", to: "implement", kind: "default" });
    // Halfway between checks-green (306, 630) and implement (588, 420).
    expect(nodes(definition).at(-1)?.position).toEqual({ x: 447, y: 525 });
  });

  it.each(edges(SEEDED).map((edge) => [`${String(edge.from)}→${String(edge.to)}`, edge] as const))(
    "leaves a valid graph when a stage is inserted into %s",
    (_name, edge) => {
      const inserted = withInsertedStage(SEEDED, { from: String(edge.from), to: String(edge.to) }, MODEL);

      expect(inserted).not.toBeNull();
      expect(structuralFindings(inserted?.definition ?? {})).toEqual([]);
    },
  );

  it("answers null for a pair no edge joins", () => {
    expect(withInsertedStage(SEEDED, { from: "a", to: "b" }, MODEL)).toBeNull();
    expect(withInsertedStage({}, LOOP, MODEL)).toBeNull();
  });
});
