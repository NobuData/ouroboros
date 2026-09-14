import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { EDGE_SELECTED_NOTE, NOTHING_SELECTED_TITLE } from "@/app/workflows/inspector/inspector";

import { shimReactFlow } from "../helpers/react-flow";
import { inspectorReadings, standardFixDefinition } from "../helpers/workflows";

/**
 * The canvas and the inspector together (#150) — the ticket's **Apply round-trips into the draft
 * and updates the node's chips (S.3)**, on the real React Flow canvas over the seeded
 * `standard-fix`, plus **Delete stage** removing a stage and its edges and an applied config
 * surviving a later move.
 */

beforeAll(() => {
  shimReactFlow();
});

const { StudioEditor } = await import("@/app/workflows/studio-editor");

/** Let React Flow's effects and its zero-delay timers run. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Open the editor on the seeded document.
 *
 * @returns The render, settled.
 */
async function open(): Promise<ReturnType<typeof render>> {
  const view = render(
    <StudioEditor
      definition={standardFixDefinition()}
      inspector={inspectorReadings()}
      mayAdminister
      workflowId="5eed001b-0000-4000-8000-000000000001"
    />,
  );
  await settle();
  return view;
}

/** React Flow's wrapper for one stage, or `null`. */
function stage(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`.react-flow__node[data-id="${id}"]`);
}

/** What one stage's chips print. */
function chips(container: HTMLElement, id: string): string[] {
  return [...(stage(container, id)?.querySelectorAll(".studio-node__chip") ?? [])].map((chip) => chip.textContent ?? "");
}

/**
 * Select a stage with a click.
 *
 * @param container The render's container.
 * @param id The stage.
 */
async function select(container: HTMLElement, id: string): Promise<void> {
  const node = stage(container, id);
  if (node === null) throw new Error(`no stage ${id}`);
  fireEvent.click(node);
  await settle();
}

describe("the inspector follows the canvas's selection", () => {
  it("opens with nothing selected, then on the stage a click selects", async () => {
    const { container } = await open();

    expect(screen.getByText(NOTHING_SELECTED_TITLE)).toBeInTheDocument();

    await select(container, "implement");

    expect(screen.getByRole("heading", { level: 2, name: "Code the change" })).toBeInTheDocument();
  });

  it("explains an edge selection", async () => {
    const { container } = await open();
    const edge = container.querySelector('.react-flow__edge[data-id="checks-green→implement"]');
    if (edge === null) throw new Error("no loop edge");

    fireEvent.click(edge);
    await settle();

    expect(screen.getByText(EDGE_SELECTED_NOTE)).toBeInTheDocument();
  });
});

describe("Apply round-trips into the draft and the node's chips", () => {
  it("updates the chip the edited config derives, keeping the stage selected", async () => {
    const { container } = await open();
    expect(chips(container, "implement")).toContain("skill:zephyr-conventions");

    await select(container, "implement");
    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), { target: { value: "repo-map" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await settle();

    expect(chips(container, "implement")).toContain("skill:repo-map");
    expect(chips(container, "implement")).not.toContain("skill:zephyr-conventions");
    expect(stage(container, "implement")).toHaveClass("selected");
    // The panel now matches the draft, so there is nothing left to apply.
    expect(screen.getByRole("combobox", { name: "Skill" })).toHaveValue("repo-map");
    expect(screen.getByRole("button", { name: "Apply" })).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps an applied config through a later move of the stage", async () => {
    const { container } = await open();

    await select(container, "plan");
    fireEvent.click(screen.getByRole("radio", { name: /Inherit route/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await settle();
    expect(chips(container, "plan")).toContain("routed by task");

    const plan = stage(container, "plan");
    plan?.focus();
    fireEvent.keyDown(plan as HTMLElement, { key: "ArrowRight" });
    await settle();

    expect(chips(container, "plan")).toContain("routed by task");
  });
});

describe("Delete stage", () => {
  it("removes the stage and its edges from the canvas, and empties the panel", async () => {
    const { container } = await open();

    await select(container, "split");
    fireEvent.click(screen.getByRole("button", { name: "Delete stage" }));
    await settle();

    expect(stage(container, "split")).toBeNull();
    expect(container.querySelectorAll('.react-flow__edge[data-id*="split"]')).toHaveLength(0);
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(11);
    expect(screen.getByText(NOTHING_SELECTED_TITLE)).toBeInTheDocument();
  });
});
