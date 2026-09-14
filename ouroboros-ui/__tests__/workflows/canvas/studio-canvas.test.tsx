import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { type EdgeRef, readStages, toEdges } from "@/app/workflows/canvas/graph";
import {
  ADD_STAGE_LABEL,
  ADD_STAGE_SOON,
  AUTO_LAYOUT_LABEL,
  AUTO_LAYOUT_SOON,
  CANVAS_HINT,
  CANVAS_LABEL,
  NO_STAGES_NOTE,
  UNSAVED_NOTE,
  ZOOM_HOME_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_LABEL,
  ZOOM_OUT_LABEL,
} from "@/app/workflows/canvas/view";
import { viewportKey } from "@/app/workflows/canvas/viewport";

import { hostileStorage, memoryStorage } from "../../helpers/match-media";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../../helpers/palettes";
import { shimReactFlow } from "../../helpers/react-flow";
import { MOCKUP_ACTIVE_PATH, standardFixDefinition } from "../../helpers/workflows";

/**
 * The canvas as it is drawn (#148, #149) — `docs/mockups/04-workflow-builder.html`'s
 * `.canvas-card` on React Flow, opened on the committed `standard-fix` v14.
 *
 * The acceptance criteria this suite exists for, in the two tickets' words: **the seeded graph
 * renders at the mockup's node positions**; **dragging a node updates the draft definition**;
 * **viewport persists per workflow across navigation**; **both themes render from tokens**;
 * **every node type renders its mockup treatment, including the octagonal flow node and the mini
 * term pill**; **the loop edge renders dashed**; **highlight mode is exercised by a fixture**;
 * and the selection model and keyboard baseline the first scope names. What it cannot prove is a
 * pixel — 60fps, the dot grid's spacing, the glow — because jsdom paints nothing; the colours are
 * `canvas-styles.test.ts`'s, the picture is the e2e studio leg's screenshot pair, and
 * `__tests__/helpers/react-flow.ts` says what the shim gives the library and what it does not.
 * The projection in each direction is `graph.test.ts`'s, the treatments' decisions
 * `treatment.test.ts`'s, the ladder and the storage rules `viewport.test.ts`'s, the words
 * `view.test.ts`'s.
 */

beforeAll(() => {
  shimReactFlow();
});

const { StudioCanvas } = await import("@/app/workflows/canvas/studio-canvas");

/** The seeded document, as the fixture holds it. */
const SEEDED = standardFixDefinition();

/** The seeded document's node entries, as stored. */
const SEEDED_NODES = SEEDED.nodes as { id: string; config: Record<string, unknown> }[];

/**
 * Let React Flow's effects — measuring, the initial viewport — run, and one timer tick with
 * them: the library reports the end of a pan or zoom from a zero-delay timeout.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Open the canvas on the seeded document.
 *
 * @param props Anything this case overrides — a storage, a listener, a path.
 * @returns The render, settled.
 */
async function open(
  props: Partial<Parameters<typeof StudioCanvas>[0]> = {},
): Promise<ReturnType<typeof render>> {
  const rendered = render(
    <StudioCanvas
      definition={standardFixDefinition()}
      storage={memoryStorage()}
      workflowId="5eed001b-0000-4000-8000-000000000001"
      {...props}
    />,
  );
  await settle();

  return rendered;
}

/** React Flow's wrapper for one stage. */
function stage(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`no stage ${id}`);
  return node;
}

/** The stage node's own box inside the wrapper — where the treatment is. */
function box(container: HTMLElement, id: string): HTMLElement {
  const found = stage(container, id).querySelector(".studio-node");
  if (!(found instanceof HTMLElement)) throw new Error(`no box for ${id}`);
  return found;
}

/** React Flow's wrapper for one edge. */
function edge(container: HTMLElement, id: string): Element {
  const found = container.querySelector(`.react-flow__edge[data-id="${id}"]`);
  if (found === null) throw new Error(`no edge ${id}`);
  return found;
}

/** One edge's line. */
function line(container: HTMLElement, id: string): Element {
  const found = edge(container, id).querySelector(".react-flow__edge-path");
  if (found === null) throw new Error(`no line for ${id}`);
  return found;
}

/** One edge's label pill, in the label layer above the edges. */
function label(container: HTMLElement, id: string): Element {
  const found = container.querySelector(`.studio-edge-label[data-edge="${id}"]`);
  if (found === null) throw new Error(`no label for ${id}`);
  return found;
}

/** What one stage's chips print. */
function chips(container: HTMLElement, id: string): string[] {
  return [...box(container, id).querySelectorAll(".studio-node__chip")].map((chip) => chip.textContent ?? "");
}

/**
 * Where React Flow put an element: the `translate(Xpx,Ypx)` in its inline transform.
 *
 * @param element A node wrapper, or the viewport.
 * @returns `[x, y]`.
 */
function placed(element: Element): [number, number] {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(element.getAttribute("style") ?? "");
  if (match === null) throw new Error(`not placed: ${element.getAttribute("style")}`);
  return [Number(match[1]), Number(match[2])];
}

/** The viewport's inline transform — where the reader is. */
function viewport(container: HTMLElement): string {
  const found = container.querySelector(".react-flow__viewport");
  return found?.getAttribute("style") ?? "";
}

/** The toolbar's zoom readout. */
function readout(): HTMLElement {
  return screen.getByRole("button", { name: ZOOM_HOME_LABEL });
}

/**
 * A mouse event with a `view`, for a drag.
 *
 * d3-drag listens for the rest of a gesture on `event.view` and jsdom's synthetic events carry
 * none — and jsdom refuses the `view` this environment offers at construction, so it is put on
 * the event afterwards, over the prototype's getter.
 *
 * @param type Which event.
 * @param clientX Where, horizontally.
 * @param clientY Where, vertically.
 * @returns The event, bubbling, from the left button.
 */
function mouse(type: string, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });

  Object.defineProperty(event, "view", { value: window });

  return event;
}

describe("the seeded graph", () => {
  it("renders every stage at the mockup's position", async () => {
    // The fixture's positions are the seed's, and the seed's are the mockup's
    // (`left:24px;top:40px` on the trigger node) — so the picture the canvas opens on is the
    // design's, node for node.
    const { container } = await open();
    const stages = readStages(SEEDED);

    expect(stages).toHaveLength(12);
    for (const { id, position } of stages) {
      expect(placed(stage(container, id)), id).toEqual([position.x, position.y]);
    }
    expect(placed(stage(container, "issue-queued"))).toEqual([24, 40]);
    expect(placed(stage(container, "implement"))).toEqual([588, 420]);
    expect(placed(stage(container, "open-pr"))).toEqual([588, 630]);
  });

  it("prints each stage's type line and title", async () => {
    const { container } = await open();
    const implement = stage(container, "implement");

    expect(implement).toHaveTextContent("Implement");
    expect(implement).toHaveTextContent("Code the change");
    expect(stage(container, "issue-queued")).toHaveTextContent("Trigger");
    expect(stage(container, "checks-green")).toHaveTextContent("Gate");
  });

  it("draws every connection, and a pill for each labelled one", async () => {
    const { container } = await open();

    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(12);
    expect(label(container, "checks-green→implement")).toHaveTextContent("fail ↺");
    expect(label(container, "effort-recheck→plan")).toHaveTextContent("≤ M ↓");
    expect(label(container, "effort-recheck→split")).toHaveTextContent("> M ↘");
    expect(label(container, "checks-green→open-pr")).toHaveTextContent("pass →");
    expect(container.querySelector('.studio-edge-label[data-edge="issue-queued→analyze"]')).toBeNull();
    expect(container.querySelectorAll(".studio-edge-label")).toHaveLength(4);
  });

  it("names every stage and edge for a screen reader, and keeps both in the tab order", async () => {
    // React Flow's nodes are focusable groups; without a name a rotor lists twelve "node"s.
    const { container } = await open();

    expect(stage(container, "implement")).toHaveAttribute("aria-label", "Model stage: Code the change");
    expect(stage(container, "implement")).toHaveAttribute("tabindex", "0");
    expect(edge(container, "checks-green→implement")).toHaveAttribute(
      "aria-label",
      "Checks green? to Code the change (fail ↺)",
    );
    expect(edge(container, "checks-green→implement")).toHaveAttribute("tabindex", "0");
  });

  it("opens at home — the origin at 100% — when nothing is remembered", async () => {
    const { container } = await open();

    expect(viewport(container)).toContain("translate(0px,0px) scale(1)");
    expect(readout()).toHaveTextContent("100%");
  });

  it("is a named region with the library's application role inside it", async () => {
    await open();

    const region = screen.getByRole("region", { name: CANVAS_LABEL });

    expect(within(region).getByRole("application")).toBeInTheDocument();
  });
});

describe("the five treatments", () => {
  it("draws each stage in its type's treatment, and Back to queue as the mini pill", async () => {
    const { container } = await open();

    expect(Object.fromEntries(readStages(SEEDED).map(({ id }) => [id, box(container, id).className]))).toEqual({
      "issue-queued": "studio-node studio-node--trigger",
      analyze: "studio-node studio-node--llm",
      "effort-recheck": "studio-node studio-node--flow",
      plan: "studio-node studio-node--llm",
      split: "studio-node studio-node--llm",
      "back-to-queue": "studio-node studio-node--term studio-node--pill",
      implement: "studio-node studio-node--llm",
      build: "studio-node studio-node--infra",
      test: "studio-node studio-node--infra",
      review: "studio-node studio-node--llm",
      "checks-green": "studio-node studio-node--flow",
      "open-pr": "studio-node studio-node--term",
    });
  });

  it("begins each type line with the type's glyph, hidden from a screen reader", async () => {
    const { container } = await open();
    const typeLine = (id: string) => box(container, id).querySelector(".studio-node__kind");
    const glyph = typeLine("implement")?.querySelector(".studio-node__glyph");

    expect(glyph).toHaveTextContent("◆");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(typeLine("implement")).toHaveTextContent("◆Implement");
    expect(typeLine("issue-queued")).toHaveTextContent("▸Trigger");
    expect(typeLine("build")).toHaveTextContent("▣Build");
    expect(typeLine("effort-recheck")).toHaveTextContent("◇Decision");
    expect(typeLine("checks-green")).toHaveTextContent("◇Gate");
    expect(typeLine("open-pr")).toHaveTextContent("●Terminal");
  });

  it("draws the pill as a dot and the title — no type line, no chips — and keeps its name", async () => {
    const { container } = await open();
    const pill = box(container, "back-to-queue");

    expect(pill.querySelector(".studio-node__dot")).toHaveAttribute("aria-hidden", "true");
    expect(pill.querySelector(".studio-node__title")).toHaveTextContent("Back to queue");
    expect(pill.querySelector(".studio-node__kind")).toBeNull();
    expect(pill.querySelector(".studio-node__chips")).toBeNull();
    expect(stage(container, "back-to-queue")).toHaveAttribute("aria-label", "Terminal stage: Back to queue");
    // Its four sides still connect: the split's edge arrives at it.
    expect(pill.querySelectorAll(".studio-node__port")).toHaveLength(8);
  });
});

describe("the chips", () => {
  it("prints each stage's chips as its config derives them", async () => {
    const { container } = await open();

    expect(chips(container, "issue-queued")).toEqual(["effort ≤ M"]);
    expect(chips(container, "analyze")).toEqual(["skill:repo-map", "coder-std"]);
    expect(chips(container, "implement")).toEqual(["skill:zephyr-conventions", "routed by task"]);
    expect(chips(container, "plan")).toEqual(["prompt template", "coder-max"]);
    expect(chips(container, "build")).toEqual(["runner pool-a"]);
    expect(chips(container, "test")).toEqual(["twister -p native_sim", "runner pool-a"]);
    expect(chips(container, "checks-green")).toEqual(["required checks: 3"]);
    expect(chips(container, "open-pr")).toEqual(["squash · delete branch"]);
  });

  it("dots the runner chips alone, and titles every chip with its whole text", async () => {
    const { container } = await open();

    expect(box(container, "build").querySelector('[data-chip="runner"] .studio-node__chip-dot')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelectorAll(".studio-node__chip-dot")).toHaveLength(2);
    for (const chip of container.querySelectorAll(".studio-node__chip")) {
      expect(chip).toHaveAttribute("title", chip.textContent ?? "");
    }
  });

  it("draws no chip row for a stage with nothing to print", async () => {
    const { container } = await open({
      definition: {
        nodes: [{ id: "build", type: "infra", title: "Build", position: { x: 0, y: 0 }, config: {} }],
        edges: [],
      },
    });

    expect(box(container, "build").querySelector(".studio-node__chips")).toBeNull();
    expect(box(container, "build")).toHaveTextContent("Build");
  });
});

describe("the edges", () => {
  it("defines the three arrowheads once, out of the accessibility tree, for every edge to name", async () => {
    const { container } = await open();
    const markers = container.querySelector(".studio-canvas__markers");

    expect([...container.querySelectorAll(".studio-canvas__markers marker")].map((marker) => marker.id)).toEqual([
      "studio-arrow-plain",
      "studio-arrow-active",
      "studio-arrow-loop",
    ]);
    expect(markers).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the ouroboros dashed, ending in its own arrowhead, and every other edge plain", async () => {
    const { container } = await open();
    const loop = line(container, "checks-green→implement");

    expect(loop).toHaveClass("studio-edge", "studio-edge--loop");
    expect(loop).not.toHaveClass("studio-edge--active");
    expect(loop).toHaveAttribute("marker-end", "url(#studio-arrow-loop)");

    for (const { id } of toEdges(SEEDED).filter((e) => e.id !== "checks-green→implement")) {
      expect(line(container, id).getAttribute("class"), id).toBe("react-flow__edge-path studio-edge");
      expect(line(container, id), id).toHaveAttribute("marker-end", "url(#studio-arrow-plain)");
    }
  });

  it("draws each label as a pill in the tone its condition reports, hidden behind the edge's own name", async () => {
    const { container } = await open();
    const labels = [...container.querySelectorAll(".studio-edge-label")];

    expect(labels.map((pill) => [pill.textContent, pill.getAttribute("class")])).toEqual([
      ["≤ M ↓", "studio-edge-label studio-edge-label--accent"],
      ["> M ↘", "studio-edge-label studio-edge-label--warn"],
      ["pass →", "studio-edge-label studio-edge-label--ok"],
      ["fail ↺", "studio-edge-label studio-edge-label--err"],
    ]);
    for (const pill of labels) expect(pill).toHaveAttribute("aria-hidden", "true");
  });

  it("sets each pill against its line: beside a column's edge, above a row's, on a curve", async () => {
    const { container } = await open();

    expect(label(container, "effort-recheck→plan")).toHaveAttribute("data-anchor", "beside");
    expect(label(container, "checks-green→open-pr")).toHaveAttribute("data-anchor", "above");
    expect(label(container, "effort-recheck→split")).toHaveAttribute("data-anchor", "on");
    expect(label(container, "checks-green→implement")).toHaveAttribute("data-anchor", "on");
  });
});

describe("highlight mode", () => {
  /** The ids of the edges drawn in the active treatment. */
  function active(container: HTMLElement): string[] {
    return [...container.querySelectorAll(".react-flow__edge")]
      .filter((element) => element.querySelector(".studio-edge--active") !== null)
      .map((element) => element.getAttribute("data-id") ?? "");
  }

  /** The ids the mockup draws active. */
  const MOCKUP_ACTIVE_IDS = MOCKUP_ACTIVE_PATH.map(({ from, to }) => `${from}→${to}`);

  it("draws nothing active when no path is given", async () => {
    const { container } = await open();

    expect(active(container)).toEqual([]);
  });

  it("draws the mockup's active path in the accent, each edge ending in the active arrowhead", async () => {
    const { container } = await open({ highlight: MOCKUP_ACTIVE_PATH });

    expect(active(container)).toEqual(MOCKUP_ACTIVE_IDS);
    for (const id of MOCKUP_ACTIVE_IDS) {
      expect(line(container, id), id).toHaveAttribute("marker-end", "url(#studio-arrow-active)");
    }
    expect(line(container, "implement→build")).toHaveAttribute("marker-end", "url(#studio-arrow-plain)");
    expect(line(container, "checks-green→implement")).toHaveAttribute("marker-end", "url(#studio-arrow-loop)");
  });

  it("keeps the loop dashed when the path takes it", async () => {
    const { container } = await open({ highlight: [{ from: "checks-green", to: "implement" }] });
    const loop = line(container, "checks-green→implement");

    expect(loop).toHaveClass("studio-edge--loop", "studio-edge--active");
    expect(loop).toHaveAttribute("marker-end", "url(#studio-arrow-active)");
  });

  it("clears when the path is taken away, without remounting the canvas under the reader", async () => {
    // S.6 clears the overlay on the first edit; a canvas that remounted to do it would throw
    // away the reader's selection and place.
    const storage = memoryStorage();
    const definition = standardFixDefinition();
    const canvas = (highlight: readonly EdgeRef[] | null) => (
      <StudioCanvas definition={definition} highlight={highlight} storage={storage} workflowId="w" />
    );
    const { container, rerender } = render(canvas(MOCKUP_ACTIVE_PATH));
    await settle();

    fireEvent.click(stage(container, "plan"));
    await settle();
    expect(active(container)).toEqual(MOCKUP_ACTIVE_IDS);

    rerender(canvas(null));
    await settle();

    expect(active(container)).toEqual([]);
    expect(stage(container, "plan")).toHaveClass("selected");

    rerender(canvas([{ from: "plan", to: "implement" }]));
    await settle();

    expect(active(container)).toEqual(["plan→implement"]);
  });

  it("draws a path naming a stage the canvas does not hold as no path at all", async () => {
    const { container } = await open({ highlight: [{ from: "gone", to: "implement" }] });

    expect(active(container)).toEqual([]);
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(12);
  });
});

describe("a document with nothing on it", () => {
  it("draws the stage, says there are no stages, and names what adds one", async () => {
    const { container } = await open({ definition: {} });

    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(NO_STAGES_NOTE);
    expect(NO_STAGES_NOTE).toMatch(/#151/);
  });
});

describe("the toolbar", () => {
  it("draws the mockup's zoom group as three controls", async () => {
    await open();

    const zoom = screen.getByRole("group", { name: ZOOM_LABEL });

    expect(within(zoom).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      ZOOM_OUT_LABEL,
      ZOOM_HOME_LABEL,
      ZOOM_IN_LABEL,
    ]);
  });

  it("draws Auto-layout and Add stage inert, each naming #151 as its reason", async () => {
    await open();

    for (const [name, reason] of [
      [AUTO_LAYOUT_LABEL, AUTO_LAYOUT_SOON],
      [ADD_STAGE_LABEL, ADD_STAGE_SOON],
    ] as const) {
      const control = screen.getByRole("button", { name });

      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", reason);
      expect(reason).toMatch(/#151/);
      // `aria-disabled` rather than `disabled`, so the explanation stays reachable.
      expect(control).not.toBeDisabled();
    }
  });

  it("prints the hint, naming the keyboard beside the mouse", async () => {
    await open();

    expect(screen.getByText(CANVAS_HINT)).toBeInTheDocument();
    expect(CANVAS_HINT).toMatch(/⌥/);
    expect(CANVAS_HINT).toMatch(/Tab/);
  });
});

describe("zoom", () => {
  it("steps up the ladder on +, and clamps at 200%", async () => {
    const { container } = await open();
    const zoomIn = screen.getByRole("button", { name: ZOOM_IN_LABEL });

    for (const expected of ["125%", "150%", "200%", "200%"]) {
      fireEvent.click(zoomIn);
      await settle();
      expect(readout()).toHaveTextContent(expected);
    }
    expect(viewport(container)).toContain("scale(2)");
  });

  it("steps down the ladder on −, and clamps at 50%", async () => {
    const { container } = await open();
    const zoomOut = screen.getByRole("button", { name: ZOOM_OUT_LABEL });

    for (const expected of ["75%", "50%", "50%"]) {
      fireEvent.click(zoomOut);
      await settle();
      expect(readout()).toHaveTextContent(expected);
    }
    expect(viewport(container)).toContain("scale(0.5)");
  });

  it("returns home on the readout, whatever the reader did", async () => {
    const { container } = await open();

    fireEvent.click(screen.getByRole("button", { name: ZOOM_IN_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: ZOOM_IN_LABEL }));
    await settle();
    expect(readout()).toHaveTextContent("150%");

    fireEvent.click(readout());
    await settle();

    expect(readout()).toHaveTextContent("100%");
    expect(viewport(container)).toContain("translate(0px,0px) scale(1)");
  });
});

describe("the viewport, remembered per workflow", () => {
  const WORKFLOW = "5eed001b-0000-4000-8000-000000000001";

  it("opens where the reader left this workflow", async () => {
    const storage = memoryStorage({
      [viewportKey(WORKFLOW)]: JSON.stringify({ x: 40, y: -20, zoom: 1.5 }),
    });
    const { container } = await open({ storage, workflowId: WORKFLOW });

    expect(viewport(container)).toContain("translate(40px,-20px) scale(1.5)");
    expect(readout()).toHaveTextContent("150%");
  });

  it("remembers every move under the workflow's id", async () => {
    const storage = memoryStorage();
    await open({ storage, workflowId: WORKFLOW });

    fireEvent.click(screen.getByRole("button", { name: ZOOM_IN_LABEL }));
    await settle();

    expect(JSON.parse(storage.getItem(viewportKey(WORKFLOW)) ?? "null")).toEqual({
      x: 0,
      y: 0,
      zoom: 1.25,
    });
  });

  it("does not open where the reader left a different workflow", async () => {
    const storage = memoryStorage({
      [viewportKey("some-other-workflow")]: JSON.stringify({ x: 40, y: -20, zoom: 1.5 }),
    });
    const { container } = await open({ storage, workflowId: WORKFLOW });

    expect(viewport(container)).toContain("translate(0px,0px) scale(1)");
  });

  it("opens at home over a place it cannot read", async () => {
    const storage = memoryStorage({ [viewportKey(WORKFLOW)]: "not json" });
    const { container } = await open({ storage, workflowId: WORKFLOW });

    expect(viewport(container)).toContain("translate(0px,0px) scale(1)");
  });

  it("still works when storage refuses every operation", async () => {
    // Safari's private mode: the place is simply not remembered.
    const { container } = await open({ storage: hostileStorage(), workflowId: WORKFLOW });

    fireEvent.click(screen.getByRole("button", { name: ZOOM_IN_LABEL }));
    await settle();

    expect(readout()).toHaveTextContent("125%");
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(12);
  });
});

describe("selection", () => {
  it("selects a stage from the keyboard, says so, and tells the listener", async () => {
    // Enter on a focused stage is React Flow's own keyboard model; the sentence is the one
    // confirmation a keyboard reader gets, and it points at the inspector (#150).
    const onSelectionChange = vi.fn();
    const { container } = await open({ onSelectionChange });
    const implement = stage(container, "implement");

    implement.focus();
    fireEvent.keyDown(implement, { key: "Enter" });
    await settle();

    // The wrapper's `selected` is what the `.sel` glow ring is drawn from (canvas.css).
    expect(implement).toHaveClass("selected");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Code the change selected — configure it in the inspector.",
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      kind: "node",
      id: "implement",
      stage: {
        id: "implement",
        kind: "llm",
        title: "Code the change",
        position: { x: 588, y: 420 },
        config: SEEDED_NODES[6].config,
      },
    });
  });

  it("selects a stage with a click", async () => {
    const { container } = await open();

    fireEvent.click(stage(container, "plan"));
    await settle();

    expect(stage(container, "plan")).toHaveClass("selected");
    expect(screen.getByRole("status")).toHaveTextContent("Write attack plan selected");
  });

  it("selects an edge, for S.5's editing", async () => {
    const onSelectionChange = vi.fn();
    const { container } = await open({ onSelectionChange });

    fireEvent.click(edge(container, "checks-green→implement"));
    await settle();

    expect(edge(container, "checks-green→implement")).toHaveClass("selected");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Edge checks-green → implement selected — edge editing arrives with #151.",
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      kind: "edge",
      id: "checks-green→implement",
      connection: {
        from: "checks-green",
        to: "implement",
        kind: "loop",
        label: "fail ↺",
        condition: { kind: "checks", op: "any_failed" },
      },
    });
  });

  it("clears on Escape, and says nothing about nothing", async () => {
    const onSelectionChange = vi.fn();
    const { container } = await open({ onSelectionChange });
    const implement = stage(container, "implement");

    implement.focus();
    fireEvent.keyDown(implement, { key: "Enter" });
    await settle();
    fireEvent.keyDown(implement, { key: "Escape" });
    await settle();

    expect(implement).not.toHaveClass("selected");
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });
});

describe("moving a stage", () => {
  it("writes the settled position into the document, hands it up, and says it is not saved", async () => {
    // The arrow keys are React Flow's keyboard move — 5px a press — and the one move a suite
    // can make deterministically. What comes back is the whole document with one position
    // changed and nothing else touched: the config, the trigger, the edges all travel through.
    const onDefinitionChange = vi.fn();
    const { container } = await open({ onDefinitionChange });
    const implement = stage(container, "implement");

    implement.focus();
    fireEvent.keyDown(implement, { key: "Enter" });
    fireEvent.keyDown(implement, { key: "ArrowRight" });
    await settle();

    expect(placed(implement)).toEqual([593, 420]);
    expect(onDefinitionChange).toHaveBeenCalledOnce();
    expect(onDefinitionChange).toHaveBeenLastCalledWith({
      ...SEEDED,
      nodes: (SEEDED.nodes as Record<string, unknown>[]).map((node) =>
        node.id === "implement" ? { ...node, position: { x: 593, y: 420 } } : node,
      ),
    });
    expect(screen.getByText(UNSAVED_NOTE)).toBeInTheDocument();
    expect(UNSAVED_NOTE).toMatch(/#152/);
  });

  it("accumulates: a second move is written over the first", async () => {
    const onDefinitionChange = vi.fn();
    const { container } = await open({ onDefinitionChange });
    const implement = stage(container, "implement");

    implement.focus();
    fireEvent.keyDown(implement, { key: "Enter" });
    fireEvent.keyDown(implement, { key: "ArrowDown" });
    fireEvent.keyDown(implement, { key: "ArrowDown", shiftKey: true });
    await settle();

    const last = onDefinitionChange.mock.lastCall?.[0] as { nodes: { id: string; position: unknown }[] };

    expect(placed(implement)).toEqual([588, 445]);
    expect(last.nodes.find((node) => node.id === "implement")?.position).toEqual({ x: 588, y: 445 });
  });

  it("says nothing about saving until something has moved", async () => {
    const { container } = await open();

    fireEvent.click(stage(container, "plan"));
    await settle();

    expect(screen.queryByText(UNSAVED_NOTE)).toBeNull();
  });

  it("hands a drag up when it ends, not while it is in progress", async () => {
    // A mouse drag through React Flow's own drag handling: the document gets the position the
    // stage was put at, once, and never the positions it passed through.
    const onDefinitionChange = vi.fn();
    const { container } = await open({ onDefinitionChange });
    const plan = stage(container, "plan");

    // The drag begins at the first move past the library's one-pixel threshold, and the
    // distance counts from there: two pixels to start, then thirty along and ten down.
    fireEvent(plan, mouse("mousedown", 600, 240));
    fireEvent(document, mouse("mousemove", 602, 240));
    fireEvent(document, mouse("mousemove", 632, 250));
    await settle();

    expect(onDefinitionChange).not.toHaveBeenCalled();
    expect(screen.queryByText(UNSAVED_NOTE)).toBeNull();

    fireEvent(document, mouse("mouseup", 632, 250));
    await settle();

    expect(onDefinitionChange).toHaveBeenCalledOnce();
    const last = onDefinitionChange.mock.lastCall?.[0] as { nodes: { id: string; position: unknown }[] };

    expect(last.nodes.find((node) => node.id === "plan")?.position).toEqual({ x: 618, y: 240 });
    expect(placed(plan)).toEqual([618, 240]);
    expect(screen.getByText(UNSAVED_NOTE)).toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the seeded graph in the %s palette", async (palette) => {
    const { container } = renderInPalette(
      palette,
      <StudioCanvas definition={standardFixDefinition()} storage={memoryStorage()} workflowId="w" />,
    );
    await settle();

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(12);
    expect(container.querySelectorAll(".studio-edge--loop")).toHaveLength(1);
  });

  it("draws the same markup in both, because the palette is the token sheet's", () => {
    // A canvas that branched on the theme in JavaScript — or let the library's own colour
    // mode do so — would render differently on the server than in the browser. The five
    // treatments, the arrowheads and the pills are classes; their colours are the sheet's.
    const [light, dark] = renderInBothPalettes(
      <StudioCanvas
        definition={standardFixDefinition()}
        highlight={MOCKUP_ACTIVE_PATH}
        storage={memoryStorage()}
        workflowId="w"
      />,
    );

    expect(light).toBe(dark);
  });

  it("leaves the library's own theme switch alone", async () => {
    // `colorMode` is never set: the `.dark` class would select the library's grey palette,
    // and the tokens already switch with the reader's theme.
    const { container } = await open();

    expect(container.querySelector(".react-flow")).not.toHaveClass("dark");
  });
});
