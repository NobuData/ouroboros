import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Ajv2020 from "ajv/dist/2020";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { structuralFindings } from "@/app/workflows/canvas/rules";
import {
  ADD_STAGE_LABEL,
  ADD_STAGE_MENU_LABEL,
  AUTO_LAYOUT_LABEL,
  NOTHING_TO_UNDO,
  REDO_LABEL,
  RULE_REASONS,
  UNDO_LABEL,
} from "@/app/workflows/canvas/view";
import { CONNECT_LABEL, CONNECT_TARGET_LABEL, MEMBER_REASON } from "@/app/workflows/inspector/inspector";

import { shimReactFlow } from "../helpers/react-flow";
import { docsLoopDefinition, dslSchema, inspectorReadings, standardFixDefinition } from "../helpers/workflows";

/**
 * The studio as a builder (#151) — the canvas and the inspector over one draft and its history, on the
 * real React Flow canvas.
 *
 * The acceptance criteria this suite exists for, in the ticket's words: **`docs-loop` can be built from a
 * blank canvas to a publishable state using only the canvas and inspector (scripted test)**; **undo/redo
 * works across add, move and delete**; **double-click-edge insertion rewires both sides correctly and
 * leaves a valid graph**; **illegal edits are blocked with a visible reason**; and **every operation is
 * reachable by keyboard** — the Connect row and the edge panel are the keyboard's half, and every step
 * below that is not a pointer gesture by nature is taken with one.
 *
 * *Publishable* is held to what the publish gate holds a document to: the published `v1.json` (ajv, in the
 * JSON Schema 2020-12 dialect with strict mode on, as `ouroboros-rest`'s conformance suite compiles it) and
 * the DSL's structural rules (`rules.ts`, itself held to the parity contract).
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
 * Open the editor.
 *
 * @param definition The document to open on.
 * @param mayAdminister Whether the reader may edit.
 * @returns The render, settled, and the draft spy.
 */
async function open(definition: WorkflowDefinition = standardFixDefinition(), mayAdminister = true) {
  const onDraftChange = vi.fn<(draft: WorkflowDefinition) => void>();
  const view = render(
    <StudioEditor
      definition={definition}
      inspector={inspectorReadings()}
      mayAdminister={mayAdminister}
      onDraftChange={onDraftChange}
      workflowId="5eed001b-0000-4000-8000-000000000004"
    />,
  );
  await settle();
  return { ...view, draft: () => onDraftChange.mock.lastCall?.[0] as WorkflowDefinition };
}

/** React Flow's wrapper for one stage, or `null`. */
function stage(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`.react-flow__node[data-id="${id}"]`);
}

/** React Flow's wrapper for one edge, or `null`. */
function edge(container: HTMLElement, id: string): Element | null {
  return container.querySelector(`.react-flow__edge[data-id="${id}"]`);
}

/**
 * Select a stage from the keyboard: focus it and press Enter.
 *
 * @param container The render's container.
 * @param id The stage.
 */
async function select(container: HTMLElement, id: string): Promise<void> {
  const node = stage(container, id);
  if (node === null) throw new Error(`no stage ${id}`);
  node.focus();
  fireEvent.keyDown(node, { key: "Enter" });
  await settle();
}

/**
 * Add a stage from the toolbar's menu.
 *
 * @param type The menu row's name.
 */
async function addStage(type: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: ADD_STAGE_LABEL }));
  fireEvent.click(within(screen.getByRole("menu", { name: ADD_STAGE_MENU_LABEL })).getByRole("menuitem", { name: type }));
  await settle();
}

/**
 * Connect the selected stage to another with the inspector's Connect row.
 *
 * @param to The stage to connect to.
 */
async function connectTo(to: string): Promise<void> {
  fireEvent.change(screen.getByRole("combobox", { name: CONNECT_TARGET_LABEL }), { target: { value: to } });
  fireEvent.click(screen.getByRole("button", { name: CONNECT_LABEL }));
  await settle();
}

/** Press the inspector's Apply. */
async function apply(): Promise<void> {
  const button = screen.getByRole("button", { name: "Apply" });
  expect(button, "Apply is live").not.toHaveAttribute("aria-disabled");
  fireEvent.click(button);
  await settle();
}

/** The seeded document's stage ids, as the canvas draws them. */
function drawn(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".react-flow__node")].map((node) => node.getAttribute("data-id") ?? "");
}

describe("building docs-loop from a blank canvas, with the canvas and the inspector alone", () => {
  it("reaches a document the published schema and the structural rules both accept, in docs-loop's shape", async () => {
    const seeded = docsLoopDefinition();
    const seededNodes = seeded.nodes as { id: string; type: string; config: Record<string, unknown> }[];
    const { container, draft } = await open({});

    // The four stages, from the catalog.
    await addStage("Trigger");
    await addStage("Model stage");
    await addStage("Build or test");
    await addStage("Terminal");
    expect(drawn(container)).toEqual(["issue-queued", "model-stage", "build", "needs-review"]);

    // The model stage: docs-loop's prompt, the docs route, its limits and its two declarations.
    const write = seededNodes[1].config;
    await select(container, "model-stage");
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt template" }), { target: { value: write.prompt_template } });
    fireEvent.click(screen.getByRole("radio", { name: /Inherit route/ }));
    // The task field suggests the workspace's routes from a datalist, which makes it a combobox.
    fireEvent.change(screen.getByRole("combobox", { name: "Task" }), { target: { value: "docs" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Max retries" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Token budget" }), { target: { value: "120k" } });
    fireEvent.click(screen.getByRole("switch", { name: "May push fixup commits" }));
    fireEvent.click(screen.getByRole("switch", { name: "May touch CI config" }));
    fireEvent.click(screen.getByRole("switch", { name: "May touch CI config" }));
    await apply();

    // The infra stage: docs-loop's runner pool and prose-lint command.
    await select(container, "build");
    fireEvent.change(screen.getByRole("textbox", { name: "Runner pool" }), { target: { value: "pool-b" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Command" }), { target: { value: "vale docs/" } });
    await apply();

    // The terminal: open a PR and auto-merge it, squashed, with the branch deleted.
    await select(container, "needs-review");
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "open_pr_automerge" } });
    fireEvent.click(screen.getByRole("switch", { name: "Delete branch" }));
    await apply();

    // The three connections: two from the keyboard's Connect row, one by React Flow's click-to-connect.
    await select(container, "issue-queued");
    await connectTo("model-stage");
    fireEvent.click(container.querySelector('.react-flow__handle.source[data-nodeid="model-stage"][data-handleid="right"]') as HTMLElement);
    fireEvent.click(container.querySelector('.react-flow__handle.target[data-nodeid="build"][data-handleid="left"]') as HTMLElement);
    await settle();
    await select(container, "build");
    await connectTo("needs-review");

    // And laid out, left to right.
    fireEvent.click(screen.getByRole("button", { name: AUTO_LAYOUT_LABEL }));
    await waitFor(() => expect((draft().nodes as { position: { x: number } }[])[3].position.x).toBeGreaterThan(0));

    const built = draft();
    const nodes = built.nodes as { id: string; type: string; position: { x: number }; config: Record<string, unknown> }[];

    // Publishable: the schema accepts it, and so do the structural rules.
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(dslSchema());
    expect(validate(built), JSON.stringify(validate.errors)).toBe(true);
    expect(structuralFindings(built)).toEqual([]);

    // docs-loop's shape: its node types and configs in order, and its three connections between them.
    expect(nodes.map(({ type, config }) => ({ type, config }))).toEqual(seededNodes.map(({ type, config }) => ({ type, config })));
    const typeOf = (list: { id: string; type: string }[], id: unknown) => list.find((node) => node.id === id)?.type;
    const shape = (definition: WorkflowDefinition, list: { id: string; type: string }[]) =>
      (definition.edges as { from: string; to: string; kind: string }[]).map((entry) => `${typeOf(list, entry.from)}→${typeOf(list, entry.to)}:${entry.kind}`);
    expect(shape(built, nodes)).toEqual(shape(seeded, seededNodes));
    expect(built.trigger).toMatchObject({ event: (seeded.trigger as { event: string }).event });

    // Left to right, as the seed draws it.
    expect(nodes.map((node) => node.position.x)).toEqual([...nodes.map((node) => node.position.x)].sort((a, b) => a - b));
  });
});

describe("Undo and Redo across add, move and delete", () => {
  it("steps back through each edit, and forward again", async () => {
    const { container } = await open();
    const undoButton = () => screen.getByRole("button", { name: UNDO_LABEL });

    expect(undoButton()).toHaveAttribute("title", NOTHING_TO_UNDO);

    // Add.
    await addStage("Model stage");
    expect(drawn(container)).toContain("model-stage");

    // Move, from the keyboard.
    await select(container, "implement");
    fireEvent.keyDown(stage(container, "implement") as HTMLElement, { key: "ArrowRight" });
    await settle();
    expect(stage(container, "implement")?.getAttribute("style")).toContain("translate(593px,420px)");

    // Delete, confirmed.
    await select(container, "split");
    fireEvent.keyDown(stage(container, "split") as HTMLElement, { key: "Delete" });
    await settle();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await settle();
    expect(stage(container, "split")).toBeNull();

    // Undo the delete from the keyboard, then the move and the add from the toolbar.
    fireEvent.keyDown(screen.getByRole("region", { name: "Canvas" }), { key: "z", ctrlKey: true });
    await settle();
    expect(stage(container, "split")).not.toBeNull();
    expect(edge(container, "effort-recheck→split")).not.toBeNull();

    fireEvent.click(undoButton());
    await settle();
    expect(stage(container, "implement")?.getAttribute("style")).toContain("translate(588px,420px)");

    fireEvent.click(undoButton());
    await settle();
    expect(drawn(container)).not.toContain("model-stage");
    expect(undoButton()).toHaveAttribute("title", NOTHING_TO_UNDO);

    // And forward through all three.
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: REDO_LABEL }));
      await settle();
    }
    expect(drawn(container)).toContain("model-stage");
    expect(stage(container, "implement")?.getAttribute("style")).toContain("translate(593px,420px)");
    expect(stage(container, "split")).toBeNull();
  });
});

describe("deleting asks first", () => {
  it("keeps the edge on Cancel, and removes it on Delete", async () => {
    const { container } = await open();
    const loop = edge(container, "checks-green→implement") as HTMLElement;

    fireEvent.click(loop);
    await settle();
    fireEvent.keyDown(loop, { key: "Delete" });
    await settle();

    const dialog = screen.getByRole("dialog", { name: "Delete the edge Checks green? → Code the change?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await settle();
    expect(edge(container, "checks-green→implement")).not.toBeNull();

    fireEvent.keyDown(edge(container, "checks-green→implement") as HTMLElement, { key: "Delete" });
    await settle();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await settle();

    expect(edge(container, "checks-green→implement")).toBeNull();
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(11);
  });
});

describe("editing an edge in the inspector", () => {
  it("refuses a branch with no condition, then applies one with its condition and label to the canvas", async () => {
    const { container, draft } = await open();

    fireEvent.click(edge(container, "plan→implement") as HTMLElement);
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "branch" } });
    expect(screen.getByText(RULE_REASONS["edge.branch_without_condition"])).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Tests" }), { target: { value: "always" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), { target: { value: "go" } });
    await apply();

    expect(draft().edges).toContainEqual({ from: "plan", to: "implement", kind: "branch", label: "go", condition: { kind: "always" } });
    expect(container.querySelector('.studio-edge-label[data-edge="plan→implement"]')).toHaveTextContent("go");
  });
});

describe("inserting into an edge", () => {
  it("rewires both sides from a double-click, and leaves a valid graph", async () => {
    const { container, draft } = await open();

    fireEvent.doubleClick(edge(container, "checks-green→implement") as HTMLElement);
    await settle();
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Model stage" }));
    await settle();

    expect(edge(container, "checks-green→implement")).toBeNull();
    expect(edge(container, "checks-green→model-stage")).not.toBeNull();
    expect(edge(container, "model-stage→implement")).not.toBeNull();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(13);
    expect(structuralFindings(draft())).toEqual([]);
  });
});

describe("a reader who may not edit", () => {
  it("sees Add stage and Connect inert with the reason", async () => {
    const { container } = await open(standardFixDefinition(), false);

    expect(screen.getByRole("button", { name: ADD_STAGE_LABEL })).toHaveAttribute("title", MEMBER_REASON);
    await select(container, "plan");
    expect(screen.getByRole("button", { name: CONNECT_LABEL })).toHaveAttribute("title", MEMBER_REASON);
  });
});
