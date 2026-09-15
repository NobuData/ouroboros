import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { NodeSpan } from "@/app/api/workflows";
import type { CodeWorkspace } from "@/app/workflows/code/code-screen";
import { PANEL_LABEL, PANEL_TOGGLE_LABEL } from "@/app/workflows/code/code-panel";
import { TABS_LABEL } from "@/app/workflows/code/code-view";

import { STANDARD_FIX, wordIn } from "../../helpers/code-symbols";
import { PALETTES, maskIds, renderInPalette } from "../../helpers/palettes";
import { stubRangeLayout } from "../../helpers/range-layout";
import { codeReadings, fileRead, panelReadings, workflowCode } from "../../helpers/workflow-code";

/**
 * The right panel on the code view, drawn and driven whole (V.5, #173) — the ticket's acceptance
 * criteria in its own words:
 *
 * - **the seeded file reproduces the mockup panel, minus the C7-omitted infra row**;
 * - **outline jump is accurate, including for the loopback row**;
 * - **the hover-doc follows the cursor and reproduces the mockup's `route.task` card**;
 * - **an unknown symbol produces no hover card**;
 * - **below 1000px the panel collapses to a toggle and its content stays reachable**;
 * - **both themes**.
 *
 * The file is the printer's golden `standard-fix.loop.ts` with the span map `ouroboros-rest` serves
 * for it, and the table is the golden symbol table, so this is the page as a seeded workspace sees it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The file's save is a Server Action (V.4, #172); here it never answers, so typing stays unsaved.
vi.mock("@/app/workflows/code/code-actions", () => ({ saveCode: vi.fn(() => new Promise(() => undefined)) }));
// Publish is S.6's shared Server Action on the server-only client (V.6, #174); nothing here publishes.
vi.mock("@/app/workflows/draft-actions", () => ({ publishWorkflow: vi.fn() }));
// The empty seat's Start blank is S.1's create dialog on a Server Action (V.7, #175); nothing here creates.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));

const { CodeScreen } = await import("@/app/workflows/code/code-screen");

beforeAll(() => {
  stubRangeLayout();
});

const SPANS = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "..", "..", "schemas", "workflow-dsl", "fixtures", "code-intelligence", "spans.json"),
      "utf8",
    ),
  ) as { cases: Record<string, NodeSpan[]> }
).cases.standard_fix_v14;

/** The seeded `standard-fix` as the code route reads it. */
const SEEDED = codeReadings({
  selected: {
    entry: codeReadings().selected!.entry,
    file: fileRead(workflowCode({ text: STANDARD_FIX, spans: SPANS })),
  },
});

let workspaces = 0;

/**
 * A workspace no other case has used, so its session starts empty.
 *
 * @returns The workspace.
 */
function freshWorkspace(): CodeWorkspace {
  workspaces += 1;
  return { id: `code-panel-${workspaces}`, name: "Acme Robotics" };
}

/**
 * The code view as the route draws it.
 *
 * @param readings What the route read. Defaults to the seeded `standard-fix`.
 * @param mayAdminister Whether the reader may type — an owner, or a member.
 * @returns The element.
 */
function page(readings = SEEDED, mayAdminister = true) {
  return (
    <CodeScreen
      mayAdminister={mayAdminister}
      readings={readings}
      role={mayAdminister ? "owner" : "member"}
      workspace={freshWorkspace()}
    />
  );
}

/** The right panel. */
function aside(): HTMLElement {
  return screen.getByRole("complementary", { name: PANEL_LABEL });
}

/** The route file's editor. */
function editor(): EditorView {
  const content = document.querySelector<HTMLElement>(".cm-content");
  expect(content, "the editor is mounted").not.toBeNull();
  return EditorView.findFromDOM(content as HTMLElement) as EditorView;
}

/**
 * Put the cursor somewhere, as a click or an arrow key would.
 *
 * @param pos The offset.
 */
function moveCursor(pos: number): void {
  act(() => {
    editor().dispatch({ selection: { anchor: pos }, userEvent: "select" });
  });
}

/**
 * The line the editor's cursor is on.
 *
 * @returns The 1-based line.
 */
function cursorLine(): number {
  const view = editor();
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

describe("the seeded file", () => {
  it("reproduces mockup 05's panel: two ✓ rows, no infra row, and the outline with its back-edge", () => {
    render(page());

    expect(within(aside()).getAllByRole("heading").map((head) => head.textContent)).toEqual([
      "Loop Checks",
      "Types",
      "Outline",
    ]);

    const checks = aside().querySelectorAll(".code-panel__check");
    expect([...checks].map((row) => row.textContent)).toEqual([
      "✓passed: Graph acyclic except declared gate loop",
      "✓passed: All task routes resolve" + "models configured for analyze · plan · split · implement · review",
    ]);
    // Decision C7, verified on the page: the mockup's third row reports state nothing here observes.
    expect(aside()).not.toHaveTextContent(/runner offline|pool-a/);

    const rows = within(aside()).getAllByRole("button");
    expect(rows).toHaveLength(12);
    expect(rows.filter((row) => row.classList.contains("code-panel__row--loopback")).map((row) => row.textContent)).toEqual([
      "11⟲checks-greenback-edge → 07",
    ]);
    expect(rows[6]).toHaveTextContent("07▸implement");
  });
});

describe("the Types card follows the cursor", () => {
  it("draws nothing before the cursor is on a symbol", () => {
    render(page());

    expect(aside().querySelector(".code-hover-doc")).toBeNull();
  });

  it("reproduces the mockup's route.task card with the cursor on route.task, and follows it away", () => {
    render(page());

    moveCursor(wordIn(STANDARD_FIX, 'route.task("implement")', "task") + 2);
    expect(aside().querySelector(".code-hover-doc")?.textContent).toBe(
      "route.task(name: TaskKind): ModelRoute" + "Resolves the model assigned to a task kind in Model Routing.",
    );

    moveCursor(wordIn(STANDARD_FIX, "tokenBudget: 400_000", "tokenBudget"));
    expect(aside().querySelector(".code-hover-doc__name")?.textContent).toBe("tokenBudget");
  });

  it("draws no card for a word the table does not describe — a node id inside a string, a comment", () => {
    render(page());

    moveCursor(wordIn(STANDARD_FIX, 'llm("implement", {', "implement") + 1);
    expect(aside().querySelector(".code-hover-doc")).toBeNull();

    moveCursor(wordIn(STANDARD_FIX, "// Round-trips with the visual canvas", "visual"));
    expect(aside().querySelector(".code-hover-doc")).toBeNull();
  });

  it("follows the cursor for a member reading the file, whose editor is read-only", () => {
    render(page(SEEDED, false));

    moveCursor(wordIn(STANDARD_FIX, 'route.task("split")', "task"));
    expect(aside().querySelector(".code-hover-doc__name")?.textContent).toBe("route.task");
  });
});

describe("the outline jump", () => {
  it("puts the cursor on each stage's call line, the loopback row included", () => {
    render(page());

    for (const span of SPANS) {
      // The glyph is hidden from assistive technology, so a row's name is its number, id and note.
      fireEvent.click(within(aside()).getByRole("button", { name: new RegExp(`^\\d{2}${span.node}(back-edge|$)`) }));
      expect(cursorLine(), span.node).toBe(span.startLine);
    }

    const gate = within(aside()).getByRole("button", { name: /checks-green/ });
    fireEvent.click(gate);
    expect(editor().state.doc.line(cursorLine()).text).toBe('    gate("checks-green", {');
    expect(document.activeElement).toBe(editor().contentDOM);
    // Twelve jumps over the 160-line golden file, each re-rendering the page: slower than the default
    // budget when the whole suite shares the machine.
  }, 20_000);

  it("stays accurate after lines are typed above the stage", () => {
    render(page());

    act(() => {
      editor().dispatch({ changes: { from: 0, insert: "// one\n// two\n" }, userEvent: "input.type" });
    });
    fireEvent.click(within(aside()).getByRole("button", { name: /checks-green/ }));

    expect(editor().state.doc.line(cursorLine()).text).toBe('    gate("checks-green", {');
    expect(cursorLine()).toBe(116);
  });

  it("jumps in a member's read-only editor too", () => {
    render(page(SEEDED, false));

    fireEvent.click(within(aside()).getByRole("button", { name: /implement/ }));

    expect(cursorLine()).toBe(71);
  });
});

describe("where the panel stands", () => {
  it("stands only beside the route's own file — not over the configuration", () => {
    render(page());
    expect(aside()).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("tree")).getByText("ouroboros.config.ts"));

    expect(screen.queryByRole("complementary", { name: PANEL_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: PANEL_TOGGLE_LABEL })).toBeNull();
    fireEvent.click(within(screen.getByRole("tablist", { name: TABS_LABEL })).getByRole("tab", { name: /standard-fix/ }));
    expect(aside()).toBeInTheDocument();
  });

  it("is not drawn for a route whose panel was not read", () => {
    render(page(codeReadings({ panel: null })));

    expect(screen.queryByRole("complementary", { name: PANEL_LABEL })).toBeNull();
  });

  it("degrades one section at a time: refused checks say why, and the outline still jumps", () => {
    render(
      page(
        codeReadings({
          selected: SEEDED.selected,
          panel: panelReadings({ checks: { ok: false, reason: "The checks are unavailable." } }),
        }),
      ),
    );

    expect(aside()).toHaveTextContent("The checks are unavailable.");
    fireEvent.click(within(aside()).getByRole("button", { name: /open-pr/ }));
    expect(cursorLine()).toBe(123);
  });
});

describe("below 1000px", () => {
  it("collapses to a toggle over the file that shows the panel again, so its content stays reachable", () => {
    render(page());

    const toggle = screen.getByRole("button", { name: PANEL_TOGGLE_LABEL });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", aside().id);
    expect(aside()).not.toHaveClass("code-panel--open");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(aside()).toHaveClass("code-panel--open");
    // Reachable when shown: the outline still jumps.
    fireEvent.click(within(aside()).getByRole("button", { name: /analyze/ }));
    expect(cursorLine()).toBe(15);

    fireEvent.click(toggle);
    expect(aside()).not.toHaveClass("code-panel--open");
  });
});

describe("both themes", () => {
  it("draws the same page in both palettes", () => {
    const [light, dark] = PALETTES.map((palette) => {
      const { container, unmount } = renderInPalette(palette, page());
      const html = maskIds(container.innerHTML).replace(/code-panel-\d+/g, "workspace");
      unmount();
      return html;
    });

    expect(light).toBe(dark);
  });
});
