import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { act, render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { STAGE_NODE_TYPE, toNodes } from "@/app/workflows/canvas/graph";

import { shimReactFlow } from "../../helpers/react-flow";
import { standardFixDefinition } from "../../helpers/workflows";

/**
 * The stage node through React Flow (#149): the ticket's *chips derive from config — editing a
 * stage's skill updates its chip*, as a render.
 *
 * The canvas itself reads its document once, at mount (`studio-canvas.tsx` says why), and the
 * edits that will change a config are S.4's. So this suite stands in for that caller: it hands
 * React Flow the projection of one document, then of the same document with one config field
 * changed, and asserts the node redraws its chip. **Nothing but the config changes between the
 * two renders** — no chip is written anywhere — which is the property the inspector will rely
 * on.
 */

beforeAll(() => {
  shimReactFlow();
});

const { StageNode } = await import("@/app/workflows/canvas/stage-node");

/** The one node type, as the canvas registers it. */
const NODE_TYPES = { [STAGE_NODE_TYPE]: StageNode };

/**
 * A bare graph of the document's stages.
 *
 * @param props.definition The document.
 * @returns React Flow, drawing only the nodes.
 */
function Graph({ definition }: Readonly<{ definition: WorkflowDefinition }>) {
  return (
    <ReactFlowProvider>
      <ReactFlow nodeTypes={NODE_TYPES} nodes={toNodes(definition)} />
    </ReactFlowProvider>
  );
}

/** Let React Flow measure and draw. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The document with one stage's config changed, and nothing else.
 *
 * @param definition The document.
 * @param id The stage.
 * @param change The config fields to replace.
 * @returns A new document.
 */
function withConfig(
  definition: WorkflowDefinition,
  id: string,
  change: Record<string, unknown>,
): WorkflowDefinition {
  const nodes = definition.nodes as { id: string; config: Record<string, unknown> }[];

  return {
    ...definition,
    nodes: nodes.map((node) => (node.id === id ? { ...node, config: { ...node.config, ...change } } : node)),
  };
}

/**
 * What one stage's chips print.
 *
 * @param container The render.
 * @param id The stage.
 * @returns The texts, in order.
 */
function chips(container: HTMLElement, id: string): string[] {
  const node = container.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (node === null) throw new Error(`no stage ${id}`);

  return [...node.querySelectorAll(".studio-node__chip")].map((chip) => chip.textContent ?? "");
}

describe("a stage's chips follow its config", () => {
  it("redraws a stage's skill chip when the skill is edited", async () => {
    const definition = standardFixDefinition();
    const { container, rerender } = render(<Graph definition={definition} />);
    await settle();

    expect(chips(container, "implement")).toEqual(["skill:zephyr-conventions", "routed by task"]);

    rerender(<Graph definition={withConfig(definition, "implement", { skill: "rust-conventions" })} />);
    await settle();

    expect(chips(container, "implement")).toEqual(["skill:rust-conventions", "routed by task"]);
    // The other stages were handed the same configs and print the same chips.
    expect(chips(container, "analyze")).toEqual(["skill:repo-map", "coder-std"]);
  });

  it("redraws the route chip when a model is pinned", async () => {
    const definition = standardFixDefinition();
    const { container, rerender } = render(<Graph definition={definition} />);
    await settle();

    rerender(
      <Graph definition={withConfig(definition, "split", { routing: { pinned_model: { alias: "local-docs" } } })} />,
    );
    await settle();

    expect(chips(container, "split")).toEqual(["prompt template", "local-docs"]);
  });

  it("redraws the trigger's chip when the document's root trigger changes", async () => {
    const definition = standardFixDefinition();
    const { container, rerender } = render(<Graph definition={definition} />);
    await settle();

    expect(chips(container, "issue-queued")).toEqual(["effort ≤ M"]);

    rerender(
      <Graph definition={{ ...definition, trigger: { event: "ticket_queued", conditions: { effort_lte: "l" } } }} />,
    );
    await settle();

    expect(chips(container, "issue-queued")).toEqual(["effort ≤ L"]);
  });

  it("redraws a terminal as the pill when its action becomes back to queue", async () => {
    const definition = standardFixDefinition();
    const { container, rerender } = render(<Graph definition={definition} />);
    await settle();

    const node = () => container.querySelector('.react-flow__node[data-id="open-pr"] .studio-node');

    expect(node()).not.toHaveClass("studio-node--pill");

    rerender(<Graph definition={withConfig(definition, "open-pr", { action: "back_to_queue", options: {} })} />);
    await settle();

    expect(node()).toHaveClass("studio-node--pill");
    expect(chips(container, "open-pr")).toEqual([]);
  });
});
