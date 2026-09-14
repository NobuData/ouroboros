import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { withLayout } from "@/app/workflows/canvas/auto-layout";
import { readStages } from "@/app/workflows/canvas/graph";
import {
  ADD_STAGE_LABEL,
  ADD_STAGE_MENU_LABEL,
  AUTO_LAYOUT_EMPTY,
  AUTO_LAYOUT_LABEL,
  NOTHING_TO_REDO,
  NOTHING_TO_UNDO,
  REDO_LABEL,
  RULE_REASONS,
  UNDO_LABEL,
  UNSAVED_NOTE,
  connectionRefused,
  insertMenuLabel,
} from "@/app/workflows/canvas/view";

import { memoryStorage } from "../../helpers/match-media";
import { shimReactFlow } from "../../helpers/react-flow";
import { stageCatalog, standardFixDefinition } from "../../helpers/workflows";

/**
 * The canvas as a builder (#151) — mockup 04's toolbar made good, on the real React Flow canvas over the
 * seeded `standard-fix`: **Add stage ▾** from the catalog, **connect by drag** with DSL-rule feedback,
 * **double-click an edge** to insert a stage, **Delete** asking first, **Auto-layout**, and **Undo** and
 * **Redo** — each illegal edit refused with a visible reason. The history itself and the inspector's half
 * are `studio-editor-editing.test.tsx`'s; the rules are `rules.test.ts`'s and the edits `edit.test.ts`'s.
 *
 * A connection is made here the way jsdom can make one: React Flow's click-to-connect, a click on one
 * stage's handle and then another's, which runs the same `onConnect` a drag does.
 */

beforeAll(() => {
  shimReactFlow();
});

const { StudioCanvas } = await import("@/app/workflows/canvas/studio-canvas");

/** Let React Flow's effects and its zero-delay timers run. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** What a case hands the held canvas. */
type HeldProps = Partial<Parameters<typeof StudioCanvas>[0]> & {
  /** The document to open on. */
  readonly initial?: WorkflowDefinition;
  /** Told every document the canvas hands up. */
  readonly onChange?: (definition: WorkflowDefinition) => void;
};

/**
 * The canvas with its document held and handed back, as `studio-editor.tsx` holds it.
 *
 * @param props What this case changes.
 * @returns The canvas.
 */
function Held({ initial, onChange, ...props }: HeldProps) {
  const [definition, setDefinition] = useState(() => initial ?? standardFixDefinition());

  return (
    <StudioCanvas
      catalog={stageCatalog()}
      definition={definition}
      onDefinitionChange={(next) => {
        setDefinition(next);
        onChange?.(next);
      }}
      storage={memoryStorage()}
      workflowId="w"
      {...props}
    />
  );
}

/**
 * Open the held canvas.
 *
 * @param props What this case changes.
 * @returns The render, settled, and the change spy.
 */
async function open(props: HeldProps = {}) {
  const onChange = vi.fn<(definition: WorkflowDefinition) => void>();
  const view = render(<Held onChange={onChange} {...props} />);
  await settle();
  return { ...view, onChange };
}

/** The last document handed up. */
function last(onChange: ReturnType<typeof vi.fn>): WorkflowDefinition {
  return onChange.mock.lastCall?.[0] as WorkflowDefinition;
}

/** React Flow's wrapper for one stage, or `null`. */
function stage(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`.react-flow__node[data-id="${id}"]`);
}

/** React Flow's wrapper for one edge. */
function edge(container: HTMLElement, id: string): Element {
  const found = container.querySelector(`.react-flow__edge[data-id="${id}"]`);
  if (found === null) throw new Error(`no edge ${id}`);
  return found;
}

/**
 * One handle of a stage.
 *
 * @param container The render's container.
 * @param id The stage.
 * @param side Which side.
 * @param type Its source or its target handle.
 * @returns The handle.
 */
function handle(container: HTMLElement, id: string, side: string, type: "source" | "target"): HTMLElement {
  const found = container.querySelector(`.react-flow__handle.${type}[data-nodeid="${id}"][data-handleid="${side}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`no ${type} handle on ${id}'s ${side}`);
  return found;
}

/**
 * Connect two stages with React Flow's click-to-connect.
 *
 * @param container The render's container.
 * @param from The stage to connect from — its right side.
 * @param to The stage to connect to — its left side.
 */
async function connect(container: HTMLElement, from: string, to: string): Promise<void> {
  fireEvent.click(handle(container, from, "right", "source"));
  fireEvent.click(handle(container, to, "left", "target"));
  await settle();
}

/**
 * Pick a row from the stage menu the toolbar holds open.
 *
 * @param name The menu's name.
 * @param type The row's name.
 */
async function pick(name: string, type: string): Promise<void> {
  fireEvent.click(within(screen.getByRole("menu", { name })).getByRole("menuitem", { name: type }));
  await settle();
}

/** The seeded document's titles, by id. */
const TITLES = new Map(readStages(standardFixDefinition()).map((entry) => [entry.id, entry.title]));

describe("Add stage ▾", () => {
  it("lists the catalog, refuses a second trigger with the ticket's reason, and drops a defaulted stage", async () => {
    const { container, onChange } = await open();

    fireEvent.click(screen.getByRole("button", { name: ADD_STAGE_LABEL }));
    const menu = screen.getByRole("menu", { name: ADD_STAGE_MENU_LABEL });
    const trigger = within(menu).getAllByRole("menuitem")[0];

    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveTextContent("A workflow can only have one trigger.");

    await pick(ADD_STAGE_MENU_LABEL, "Model stage");

    const added = (last(onChange).nodes as Record<string, unknown>[]).at(-1);
    expect(added).toMatchObject({ id: "model-stage", type: "llm", title: "Model stage", config: stageCatalog().nodeTypes[1].defaults.config });
    expect(stage(container, "model-stage")).toHaveTextContent("Model stage");
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(13);
    expect(screen.getByText(UNSAVED_NOTE)).toBeInTheDocument();
  });

  it("starts a blank canvas with its trigger, and the document's root trigger with it", async () => {
    const { container, onChange } = await open({ initial: {} });

    expect(screen.getByRole("button", { name: AUTO_LAYOUT_LABEL })).toHaveAttribute("title", AUTO_LAYOUT_EMPTY);
    fireEvent.click(screen.getByRole("button", { name: ADD_STAGE_LABEL }));
    await pick(ADD_STAGE_MENU_LABEL, "Trigger");

    expect(last(onChange)).toMatchObject({
      dsl_version: "1.0",
      trigger: { event: "ticket_queued", conditions: {} },
      nodes: [{ id: "issue-queued", type: "trigger" }],
      edges: [],
    });
    expect(stage(container, "issue-queued")).not.toBeNull();
  });
});

describe("connecting two stages", () => {
  it("draws a default edge between them", async () => {
    const { container, onChange } = await open();

    await connect(container, "plan", "build");

    expect((last(onChange).edges as unknown[]).at(-1)).toEqual({ from: "plan", to: "build", kind: "default" });
    expect(edge(container, "plan→build")).toBeInTheDocument();
  });

  it.each([
    ["out of a terminal", "open-pr", "analyze", "edge.out_of_terminal"],
    ["into the trigger", "analyze", "issue-queued", "edge.into_trigger"],
    ["a second time", "plan", "implement", "edge.duplicate"],
  ] as const)("refuses a connection %s, saying why", async (_what, from, to, rule) => {
    const { container, onChange } = await open();

    await connect(container, from, to);

    expect(screen.getByRole("alert")).toHaveTextContent(connectionRefused(rule));
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(12);
  });

  it("clears the refusal on the next edit that succeeds", async () => {
    const { container } = await open();

    await connect(container, "open-pr", "analyze");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await connect(container, "plan", "build");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("double-clicking an edge", () => {
  it("opens the menu to insert between its stages, and rewires both sides", async () => {
    const { container, onChange } = await open();
    const name = insertMenuLabel(TITLES.get("checks-green") ?? "", TITLES.get("implement") ?? "");

    fireEvent.doubleClick(edge(container, "checks-green→implement"));
    await settle();

    const rows = within(screen.getByRole("menu", { name })).getAllByRole("menuitem");
    expect(document.activeElement).toBe(rows[0]);
    expect(rows[4]).toHaveTextContent(RULE_REASONS["edge.out_of_terminal"]);

    await pick(name, "Model stage");

    const edges = last(onChange).edges as Record<string, unknown>[];
    expect(edges).toContainEqual({ from: "checks-green", to: "model-stage", kind: "loop", label: "fail ↺", condition: { kind: "checks", op: "any_failed" } });
    expect(edges).toContainEqual({ from: "model-stage", to: "implement", kind: "default" });
    expect(container.querySelector('.react-flow__edge[data-id="checks-green→implement"]')).toBeNull();
    expect(edge(container, "model-stage→implement")).toBeInTheDocument();
  });

  it("goes back to adding once the insert menu closes", async () => {
    const { container } = await open();

    fireEvent.doubleClick(edge(container, "plan→implement"));
    await settle();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: ADD_STAGE_LABEL }));

    expect(screen.getByRole("menu", { name: ADD_STAGE_MENU_LABEL })).toBeInTheDocument();
  });
});

describe("Delete", () => {
  it("asks to delete a selected stage", async () => {
    const onDeleteRequest = vi.fn();
    const { container } = await open({ onDeleteRequest });
    const implement = stage(container, "implement") as HTMLElement;

    fireEvent.click(implement);
    await settle();
    fireEvent.keyDown(implement, { key: "Delete" });

    expect(onDeleteRequest).toHaveBeenCalledExactlyOnceWith({ stages: ["implement"], edges: [] });
  });

  it("asks to delete a selected edge with Backspace", async () => {
    const onDeleteRequest = vi.fn();
    const { container } = await open({ onDeleteRequest });
    const loop = edge(container, "checks-green→implement");

    fireEvent.click(loop);
    await settle();
    fireEvent.keyDown(loop, { key: "Backspace" });

    expect(onDeleteRequest).toHaveBeenCalledExactlyOnceWith({ stages: [], edges: [{ from: "checks-green", to: "implement" }] });
  });

  it("asks nothing with nothing selected", async () => {
    const onDeleteRequest = vi.fn();
    const { container } = await open({ onDeleteRequest });

    fireEvent.keyDown(stage(container, "implement") as HTMLElement, { key: "Delete" });

    expect(onDeleteRequest).not.toHaveBeenCalled();
  });
});

describe("Auto-layout", () => {
  it("lays the graph out left to right, and draws the stages where the layout put them", async () => {
    const { container, onChange } = await open();

    fireEvent.click(screen.getByRole("button", { name: AUTO_LAYOUT_LABEL }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    await settle();

    const laid = withLayout(standardFixDefinition());
    expect(last(onChange)).toEqual(laid);

    const trigger = (laid.nodes as { id: string; position: { x: number; y: number } }[]).find((node) => node.id === "issue-queued");
    expect(stage(container, "issue-queued")?.getAttribute("style")).toContain(`translate(${trigger?.position.x}px,${trigger?.position.y}px)`);
  });
});

describe("Undo and Redo", () => {
  it("are inert with their reasons when there is nothing to step to", async () => {
    await open();

    expect(screen.getByRole("button", { name: UNDO_LABEL })).toHaveAttribute("title", NOTHING_TO_UNDO);
    expect(screen.getByRole("button", { name: REDO_LABEL })).toHaveAttribute("title", NOTHING_TO_REDO);
  });

  it("step through the caller's history from the toolbar and from the keyboard", async () => {
    const history = { canUndo: true, canRedo: true, onUndo: vi.fn(), onRedo: vi.fn() };
    await open({ history });
    const canvas = screen.getByRole("region", { name: "Canvas" });

    fireEvent.click(screen.getByRole("button", { name: UNDO_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: REDO_LABEL }));
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    fireEvent.keyDown(canvas, { key: "z", metaKey: true, shiftKey: true });
    fireEvent.keyDown(canvas, { key: "y", ctrlKey: true });

    expect(history.onUndo).toHaveBeenCalledTimes(2);
    expect(history.onRedo).toHaveBeenCalledTimes(3);
  });

  it("does not undo from the keyboard when there is nothing to undo", async () => {
    const history = { canUndo: false, canRedo: false, onUndo: vi.fn(), onRedo: vi.fn() };
    await open({ history });

    fireEvent.keyDown(screen.getByRole("region", { name: "Canvas" }), { key: "z", ctrlKey: true });

    expect(history.onUndo).not.toHaveBeenCalled();
  });
});

describe("a reader who may not edit", () => {
  const REASON = "Only an owner or admin may change a workflow.";

  it("sees every structural edit inert with the reason, and no connectable handle", async () => {
    const { container } = await open({ readOnlyReason: REASON });

    expect(screen.getByRole("button", { name: ADD_STAGE_LABEL })).toHaveAttribute("title", REASON);
    expect(screen.getByRole("button", { name: AUTO_LAYOUT_LABEL })).toHaveAttribute("title", REASON);
    expect(container.querySelectorAll(".react-flow__handle.connectable")).toHaveLength(0);
  });

  it("is told why a Delete or a double-click did nothing", async () => {
    const onDeleteRequest = vi.fn();
    const { container } = await open({ readOnlyReason: REASON, onDeleteRequest });
    const implement = stage(container, "implement") as HTMLElement;

    fireEvent.click(implement);
    await settle();
    fireEvent.keyDown(implement, { key: "Delete" });
    expect(screen.getByRole("alert")).toHaveTextContent(REASON);
    expect(onDeleteRequest).not.toHaveBeenCalled();

    fireEvent.doubleClick(edge(container, "plan→implement"));
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
