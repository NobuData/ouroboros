import { describe, expect, it } from "vitest";

import {
  reconcileEdges,
  reconcileNodes,
  stageEntry,
  toEdges,
  toNodes,
  upstreamStageIds,
  withStage,
  withoutStage,
} from "@/app/workflows/canvas/graph";

import { standardFixDefinition } from "../../helpers/workflows";

/**
 * The inspector's half of the document ⇄ graph projection (#150): reading one stage's editable
 * fields, writing an **Apply** back, removing a stage with its edges, the stages upstream of one
 * (the prompt palette), and reconciling the canvas's nodes and edges against a document the canvas
 * did not produce — each a judgement over the seeded `standard-fix` in and a value out.
 */

/** The seeded document. */
const SEEDED = standardFixDefinition();

/** The seeded document's nodes, as stored. */
const NODES = SEEDED.nodes as { id: string; type: string; position: unknown; config: Record<string, unknown> }[];

describe("reading one stage", () => {
  it("reads the seeded Implement stage's editable fields", () => {
    expect(stageEntry(SEEDED, "implement")).toEqual({
      id: "implement",
      type: "llm",
      title: "Code the change",
      description: "Writes the change described by the attack plan onto a fresh branch.",
      config: NODES.find((node) => node.id === "implement")?.config,
    });
  });

  it("answers null for an id the document does not hold, and for a document with no nodes", () => {
    expect(stageEntry(SEEDED, "nope")).toBeNull();
    expect(stageEntry({}, "implement")).toBeNull();
  });

  it("reads absent fields as empty rather than throwing", () => {
    expect(stageEntry({ nodes: [{ id: "x" }] }, "x")).toEqual({
      id: "x",
      type: "",
      title: "",
      description: "",
      config: {},
    });
  });
});

describe("applying a stage", () => {
  const config = { ...NODES[6].config, skill: "repo-map" };

  it("replaces the config and title, and nothing else about the node", () => {
    const next = withStage(SEEDED, "implement", { title: "Code it", description: "", config });
    const node = (next.nodes as typeof NODES).find((entry) => entry.id === "implement");

    expect(node).toMatchObject({ id: "implement", type: "llm", title: "Code it", config });
    expect(node?.position).toEqual(NODES[6].position);
    expect(node).not.toHaveProperty("description");
    // The input is not mutated.
    expect(NODES[6].config.skill).toBe("zephyr-conventions");
  });

  it("keeps a description that is not empty", () => {
    const next = withStage(SEEDED, "implement", { title: "Code the change", description: "Why.", config });

    expect((next.nodes as { id: string; description?: string }[])[6]?.description).toBe("Why.");
  });

  it("returns the same document for an id it does not hold, or a document with no nodes", () => {
    expect(withStage(SEEDED, "nope", { title: "", description: "", config })).toBe(SEEDED);

    const empty = {};
    expect(withStage(empty, "implement", { title: "", description: "", config })).toBe(empty);
  });
});

describe("deleting a stage", () => {
  it("removes the node and every edge that leaves or arrives at it", () => {
    const next = withoutStage(SEEDED, "split");
    const edges = next.edges as { from: string; to: string }[];

    expect((next.nodes as { id: string }[]).map((node) => node.id)).not.toContain("split");
    expect(next.nodes).toHaveLength(NODES.length - 1);
    expect(edges.some((edge) => edge.from === "split" || edge.to === "split")).toBe(false);
    expect(edges.length).toBeLessThan((SEEDED.edges as unknown[]).length);
  });

  it("returns the same document for an id it does not hold", () => {
    expect(withoutStage(SEEDED, "nope")).toBe(SEEDED);
  });

  it("leaves a document with no edges array without one", () => {
    const next = withoutStage({ nodes: [{ id: "a" }, { id: "b" }] }, "a");

    expect(next).toEqual({ nodes: [{ id: "b" }] });
  });
});

describe("the stages upstream of one", () => {
  it("names the model and infra stages before Implement, and not the gate its loop returns from", () => {
    // analyze → effort-recheck → plan → implement; the gate's `fail ↺` loop runs *after* implement.
    expect(upstreamStageIds(SEEDED, "implement")).toEqual(["analyze", "plan"]);
  });

  it("names nothing before the trigger, and only produces-output stages anywhere", () => {
    expect(upstreamStageIds(SEEDED, "issue-queued")).toEqual([]);
    expect(upstreamStageIds(SEEDED, "open-pr")).not.toContain("checks-green");
    expect(upstreamStageIds(SEEDED, "open-pr")).not.toContain("issue-queued");
  });
});

describe("reconciling the canvas with a new document", () => {
  it("keeps a node's position and selection and takes its new config", () => {
    const current = toNodes(SEEDED).map((node) =>
      node.id === "implement" ? { ...node, selected: true, position: { x: 700, y: 440 } } : node,
    );
    const next = withStage(SEEDED, "implement", {
      title: "Code the change",
      description: "",
      config: { ...NODES[6].config, skill: "repo-map" },
    });

    const reconciled = reconcileNodes(current, next);
    const implement = reconciled.find((node) => node.id === "implement");

    expect(implement?.selected).toBe(true);
    expect(implement?.position).toEqual({ x: 700, y: 440 });
    expect(implement?.data.stage.config.skill).toBe("repo-map");
  });

  it("drops a deleted stage's node and its edges, and keeps an edge's selection", () => {
    const edges = toEdges(SEEDED).map((edge, index) => (index === 0 ? { ...edge, selected: true } : edge));
    const next = withoutStage(SEEDED, "split");

    expect(reconcileNodes(toNodes(SEEDED), next).map((node) => node.id)).not.toContain("split");

    const reconciled = reconcileEdges(edges, next);
    expect(reconciled.some((edge) => edge.source === "split" || edge.target === "split")).toBe(false);
    expect(reconciled[0]?.selected).toBe(true);
  });

  it("adds a node the document newly holds", () => {
    const next = { ...SEEDED, nodes: [...NODES, { id: "extra", type: "infra", title: "Extra", position: { x: 1, y: 2 }, config: {} }] };

    expect(reconcileNodes(toNodes(SEEDED), next).map((node) => node.id)).toContain("extra");
  });
});
