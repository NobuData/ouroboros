import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHANGED, NO_ROUTE_NOTE, POLICY_NOTE, editChainHint, savedRoutes } from "@/app/models/chain";
import {
  EM_DASH,
  INSPECTOR_EMPTY_TITLE,
  MATRIX_CAPTION,
  MATRIX_TITLE,
  REORDER_HINT,
  ROUTE_PARAM,
  matrixRows,
  selectionAnnouncement,
  type MatrixRow,
} from "@/app/models/matrix";

import { seededRules, seededTaskKinds, unmeasuredMatrix } from "../helpers/models";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The routing matrix as it is drawn (#201) — mockup 06's densest region, and the selection
 * that drives the route card beside it; and, since #202, the marks an edit leaves on a row and
 * the shortcut in the handle column.
 *
 * What every cell *says* is `matrix.test.ts`'s, decided as functions over the dev seed's own
 * rows. What is here is what only a render can show: that the eight rows come out as the
 * mockup draws them, that selection is a real state with a real address, that the keyboard
 * reaches every row, that a workspace which has run nothing gets em-dashes without the table
 * falling apart, and that an edit made in the route card shows in the row it is about.
 *
 * ### What a render test in this module can and cannot prove about the palettes
 *
 * jsdom applies no stylesheet, so no test here can read a computed colour — the violet inset
 * on the selected row is checked by `models-styles.test.ts` and `ui-styles.test.ts`, where the
 * declarations are. What *this* file proves is the half that matters at the component level:
 * the two palettes produce identical markup, so nothing about the selection is decided in
 * JavaScript from the theme.
 */

// The editor's save and the menus' registry read sit on the server-only client; both are
// other suites' subjects (`route-actions.test.ts`, `alias-menu.test.tsx`).
vi.mock("@/app/models/route-actions", () => ({ saveRoutes: vi.fn() }));
vi.mock("@/app/models/rule-actions", () => ({
  readRuleTargets: vi.fn().mockResolvedValue({ ok: true, aliases: [] }),
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { RoutingMatrix } = await import("@/app/models/routing-matrix");
const { RouteEditorProvider } = await import("@/app/models/route-editor");

/** The seeded matrix's rows, decided. */
const ROWS: readonly MatrixRow[] = matrixRows(seededTaskKinds(), seededRules());

/** The seeded routes, as the screen hands them to the editor. */
const ROUTES = savedRoutes(seededTaskKinds());

/**
 * Where these tests pretend to be, so an assertion about the address bar is about `/models`.
 *
 * Relative, deliberately: `replaceState` refuses a cross-origin URL, and jsdom's document
 * origin is not this application's.
 */
const AT = "/models";

beforeEach(() => {
  window.history.replaceState(null, "", AT);
});

afterEach(() => {
  window.history.replaceState(null, "", AT);
});

/**
 * The matrix, rendered under an editor.
 *
 * @param props.rows Which rows. Defaults to the seeded eight.
 * @param props.selected Which row the URL asked for. Defaults to none.
 * @param props.editable Whether the reader may edit. Defaults to yes — the mockup is drawn
 *   for an owner.
 * @param props.aside What stands under the route card.
 * @returns The Testing Library render result.
 */
function matrix({
  rows = ROWS,
  selected = null,
  editable = true,
  aside,
}: {
  rows?: readonly MatrixRow[];
  selected?: string | null;
  editable?: boolean;
  aside?: React.ReactNode;
} = {}) {
  return render(
    <RouteEditorProvider editable={editable} routes={ROUTES}>
      <RoutingMatrix aside={aside} rows={rows} selected={selected} />
    </RouteEditorProvider>,
  );
}

/** Every body row, in order. */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

/** One body row, by the task kind in it. */
function rowFor(kind: string): HTMLElement {
  const found = bodyRows().find((row) => row.dataset.rowKey === kind);

  if (found === undefined) throw new Error(`no rendered row for ${kind}`);
  return found;
}

/** What the address bar's `?route=` currently says. */
function reflected(): string | null {
  return new URL(window.location.href).searchParams.get(ROUTE_PARAM);
}

/** Every live region's text. */
function announced(): string[] {
  return screen.getAllByRole("status").map((region) => region.textContent ?? "");
}

describe("the matrix, row for row", () => {
  it("names itself and counts what it holds", () => {
    matrix();

    expect(screen.getByRole("heading", { level: 2, name: MATRIX_TITLE })).toBeInTheDocument();
    expect(screen.getByText("8 task kinds")).toBeInTheDocument();
  });

  it("draws the eight seeded kinds in the mockup's order", () => {
    matrix();

    expect(bodyRows().map((row) => row.dataset.rowKey)).toEqual([
      "analyze",
      "estimate",
      "plan",
      "implement",
      "test-gen",
      "review",
      "docs",
      "commit-msg",
    ]);
  });

  it("draws the mockup's `implement` row whole — task, both aliases, both resolutions, both figures", () => {
    // The row the mockup opens. Every cell in it, so that a change to any one of the six is a
    // failure here rather than something noticed in a screenshot.
    matrix();

    const row = within(rowFor("implement"));

    expect(row.getByText("implement")).toBeInTheDocument();
    expect(row.getByText("Write the change, run tests, iterate to green")).toBeInTheDocument();
    expect(row.getByText("implement-primary")).toBeInTheDocument();
    expect(row.getByText("coder-max")).toBeInTheDocument();
    expect(row.getByText("claude-fable-5 · Anthropic Claude")).toBeInTheDocument();
    expect(row.getByText("coder-fallback")).toBeInTheDocument();
    expect(row.getByText("gpt-5-codex · GitHub Copilot")).toBeInTheDocument();
    expect(row.getByText("$0.87")).toBeInTheDocument();
    expect(row.getByText("41.0s")).toBeInTheDocument();
  });

  it("draws the escalation summary on the row whose kind the rule names", () => {
    // …and an em-dash on the row the mockup drew it on, which is the schema's answer rather
    // than the mockup's — see the seed and `matrix.test.ts`.
    matrix();

    expect(
      within(rowFor("implement")).getByText("effort ≥ L → implement uses coder-max (max thinking)"),
    ).toBeInTheDocument();
    expect(within(rowFor("plan")).getByText(EM_DASH)).toBeInTheDocument();
  });

  it("heads the seven columns the mockup does, for a role that may edit", () => {
    matrix();

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Edit",
      "Task",
      "Primary model",
      "Fallback",
      "Escalation",
      "$/run avg",
      "p50 latency",
    ]);
  });

  it("names the table itself, for a reader moving by table rather than by landmark", () => {
    matrix();

    expect(screen.getByRole("grid", { name: MATRIX_CAPTION })).toBeInTheDocument();
  });
});

describe("a workspace that has run nothing (decision M7)", () => {
  it("draws an em-dash in both numeric columns rather than a zero", () => {
    matrix({ rows: matrixRows(unmeasuredMatrix().taskKinds, seededRules()) });

    const row = within(rowFor("implement"));

    expect(row.queryByText("$0.87")).not.toBeInTheDocument();
    expect(row.queryByText("41.0s")).not.toBeInTheDocument();
    // Two, not three: this row's escalation cell still has a rule in it. What the ledger
    // could not measure is empty; what the rules say is not.
    expect(row.getAllByText(EM_DASH)).toHaveLength(2);
  });

  it("keeps the row's rhythm and the column's alignment while it does", () => {
    // "Alignment holds whether the cell has a number or a dash": the em-dash is in the same
    // cell, wearing the same column class, as the figure it stands in for.
    matrix({ rows: matrixRows(unmeasuredMatrix().taskKinds, seededRules()) });

    // `cell` rather than `gridcell`: HTML-AAM maps a `td` inside `role="grid"` to `gridcell`,
    // but Testing Library's mapping is the context-free one. The role the *browser* exposes is
    // the grid's business and is covered by the primitive's own suite.
    const cells = within(rowFor("implement")).getAllByRole("cell");

    expect(cells).toHaveLength(7);
    expect(cells.at(-1)).toHaveClass("ou-table__cell--end", "models-matrix__num");
    expect(cells.at(-1)).toHaveTextContent(EM_DASH);
  });
});

describe("the selection", () => {
  it("selects nothing until a row is chosen", () => {
    // A matrix that selected its first row on arrival would put a route into the inspector
    // that nobody chose — and would have to rewrite the URL on load to stay honest about it.
    matrix();

    expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
    expect(screen.getByText(INSPECTOR_EMPTY_TITLE)).toBeInTheDocument();
  });

  it("starts on the row the server read out of the URL", () => {
    matrix({ selected: "implement" });

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("implement"));
  });

  it("marks exactly one row selected, so `.selected` can mean one thing", () => {
    matrix({ selected: "implement" });

    expect(screen.getAllByRole("row", { selected: true })).toHaveLength(1);
  });

  it("takes the violet inset treatment on the selected row and on no other", () => {
    matrix({ selected: "implement" });

    expect(rowFor("implement")).toHaveClass("ou-table__row--selected");
    expect(rowFor("review")).not.toHaveClass("ou-table__row--selected");
  });

  it("moves to the row that was clicked", () => {
    matrix();

    fireEvent.click(rowFor("review"));

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("review"));
  });
});

describe("the address bar, which is what makes a selection survive a reload", () => {
  it("records the selection in `?route=`", () => {
    matrix();

    fireEvent.click(rowFor("docs"));

    expect(reflected()).toBe("docs");
  });

  it("replaces rather than pushes, so arrowing through rows does not fill the back stack", () => {
    // Eight entries in the history would make **Back** mean *the row above* rather than *the
    // page I came from*.
    const before = window.history.length;

    matrix();
    fireEvent.click(rowFor("docs"));
    fireEvent.click(rowFor("review"));

    expect(window.history.length).toBe(before);
  });

  it("keeps the path and anything else the URL was carrying", () => {
    window.history.replaceState(null, "", `${AT}?tab=chains#matrix`);

    matrix();
    fireEvent.click(rowFor("plan"));

    const url = new URL(window.location.href);

    expect(url.pathname).toBe("/models");
    expect(url.searchParams.get("tab")).toBe("chains");
    expect(url.hash).toBe("#matrix");
    expect(url.searchParams.get(ROUTE_PARAM)).toBe("plan");
  });
});

describe("the keyboard", () => {
  it("puts exactly one row in the tab order", () => {
    // A `tabIndex` on every row would put eight stops in the tab sequence of a page that
    // should have one — and the handle column's shortcut adds none (see below).
    matrix({ selected: "implement" });

    expect(bodyRows().filter((row) => row.tabIndex === 0)).toEqual([rowFor("implement")]);
    expect(within(screen.getByRole("grid")).queryAllByRole("button").filter((b) => b.tabIndex === 0)).toEqual([]);
  });

  it("holds that one tab stop on the first row while nothing is selected", () => {
    matrix();

    expect(bodyRows().filter((row) => row.tabIndex === 0)).toEqual([rowFor("analyze")]);
  });

  it("moves the selection down and up with the arrow keys", () => {
    matrix({ selected: "plan" });

    fireEvent.keyDown(rowFor("plan"), { key: "ArrowDown" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("implement"));

    fireEvent.keyDown(rowFor("implement"), { key: "ArrowUp" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("plan"));
  });

  it("moves focus with the selection, so the row the reader is on is the row that is read", () => {
    matrix({ selected: "plan" });

    fireEvent.keyDown(rowFor("plan"), { key: "ArrowDown" });

    expect(rowFor("implement")).toHaveFocus();
  });

  it("jumps to the ends with Home and End", () => {
    matrix({ selected: "implement" });

    fireEvent.keyDown(rowFor("implement"), { key: "Home" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("analyze"));

    fireEvent.keyDown(rowFor("analyze"), { key: "End" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("commit-msg"));
  });

  it("stays put at the ends rather than wrapping", () => {
    // Wrapping would make a reader holding the down arrow cycle forever with no signal that
    // the list had ended.
    matrix({ selected: "analyze" });

    fireEvent.keyDown(rowFor("analyze"), { key: "ArrowUp" });

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("analyze"));
  });

  it("selects the focused row on Enter and on Space, for a reader who arrived by Tab", () => {
    matrix();

    fireEvent.keyDown(rowFor("analyze"), { key: "Enter" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("analyze"));

    fireEvent.keyDown(rowFor("analyze"), { key: " " });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("analyze"));
  });

  it("records a keyboard selection in the URL exactly as a click does", () => {
    matrix({ selected: "plan" });

    fireEvent.keyDown(rowFor("plan"), { key: "ArrowDown" });

    expect(reflected()).toBe("implement");
  });

  it("leaves a key it does not own entirely alone", () => {
    matrix({ selected: "plan" });

    const event = fireEvent.keyDown(rowFor("plan"), { key: "a" });

    expect(event).toBe(true);
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("plan"));
  });

  it("prevents the pane from scrolling under an arrow it handled", () => {
    matrix({ selected: "plan" });

    const handled = fireEvent.keyDown(rowFor("plan"), { key: "ArrowDown" });

    expect(handled).toBe(false);
  });
});

describe("what is announced", () => {
  it("says which route was selected, in a sentence", () => {
    // The half that focus alone does not cover: a pointer selection moves no focus at all.
    matrix();

    fireEvent.click(rowFor("review"));

    expect(announced()).toContain(selectionAnnouncement("review"));
  });

  it("keeps the region in the document while nothing is selected, so the first move is heard", () => {
    // A live region added to the page at the same moment its content appears is not announced.
    matrix();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("the route card", () => {
  it("says how to choose a route while none is chosen", () => {
    matrix();

    expect(screen.getByRole("heading", { level: 2, name: "Route" })).toBeInTheDocument();
    expect(screen.getByText(INSPECTOR_EMPTY_TITLE)).toBeInTheDocument();
  });

  it("names the selected route in the mockup's own title", () => {
    matrix({ selected: "implement" });

    expect(
      screen.getByRole("heading", { level: 2, name: "Route — implement-primary" }),
    ).toBeInTheDocument();
  });

  it("follows the selection as it moves", () => {
    matrix({ selected: "implement" });

    fireEvent.click(rowFor("docs"));

    expect(
      screen.getByRole("heading", { level: 2, name: "Route — docs-primary" }),
    ).toBeInTheDocument();
  });

  it("draws the selected route's chain — the mockup's three numbered hops (#202)", () => {
    matrix({ selected: "implement" });

    const chain = screen.getByRole("list", { name: "Chain" });
    const hops = within(chain).getAllByRole("listitem");

    expect(hops).toHaveLength(3);
    expect(hops[0]).toHaveTextContent("coder-max");
    expect(hops[1]).toHaveTextContent("coder-fallback");
    expect(hops[2]).toHaveTextContent("local-docs");
    expect(within(chain).getByText("→ claude-fable-5 · Anthropic Claude")).toBeInTheDocument();
  });

  it("names the issue that brings the policy switches rather than drawing a mock-up of them", () => {
    matrix({ selected: "implement" });

    expect(screen.getByText(POLICY_NOTE)).toBeInTheDocument();
    expect(screen.getByText(/#203/)).toBeInTheDocument();
  });

  it("says so for a selected kind that has no route", () => {
    const rows = matrixRows(
      seededTaskKinds().map((kind) => (kind.name === "docs" ? { ...kind, route: null } : kind)),
      seededRules(),
    );
    matrix({ rows, selected: "docs" });

    expect(screen.getByRole("heading", { level: 2, name: "Route" })).toBeInTheDocument();
    expect(screen.getByText(NO_ROUTE_NOTE)).toBeInTheDocument();
  });
});

describe("the marks an edit leaves (#202)", () => {
  it("redraws the row's model columns from the draft, and marks the row changed", () => {
    matrix({ selected: "implement" });

    fireEvent.click(screen.getByRole("button", { name: "Move coder-max down" }));

    const row = within(rowFor("implement"));
    const cells = row.getAllByRole("cell");

    expect(cells[2]).toHaveTextContent("coder-fallback");
    expect(cells[2]).toHaveTextContent("gpt-5-codex · GitHub Copilot");
    expect(cells[3]).toHaveTextContent("coder-max");
    expect(row.getByText(CHANGED)).toBeInTheDocument();
    expect(within(rowFor("plan")).queryByText(CHANGED)).not.toBeInTheDocument();
  });

  it("marks the route card too, beside its title", () => {
    matrix({ selected: "implement" });

    fireEvent.click(screen.getByRole("button", { name: "Move coder-max down" }));

    const head = screen.getByRole("heading", { level: 2, name: "Route — implement-primary" }).parentElement;

    expect(within(head as HTMLElement).getByText(CHANGED)).toBeInTheDocument();
  });

  it("leaves the figures and the summaries as the server sent them — an edit changes no cost", () => {
    matrix({ selected: "implement" });

    fireEvent.click(screen.getByRole("button", { name: "Move coder-max down" }));

    const row = within(rowFor("implement"));

    expect(row.getByText("$0.87")).toBeInTheDocument();
    expect(row.getByText("effort ≥ L → implement uses coder-max (max thinking)")).toBeInTheDocument();
  });
});

describe("the handle column's shortcut (#202)", () => {
  it("is a named button on every routed row, out of the tab order", () => {
    matrix();

    for (const kind of ["analyze", "implement", "commit-msg"]) {
      const shortcut = within(rowFor(kind)).getByRole("button", { name: editChainHint(kind) });

      expect(shortcut).toHaveAttribute("tabindex", "-1");
      expect(shortcut).toHaveTextContent("⠿");
    }
  });

  it("selects the row and puts focus in its chain", () => {
    matrix();

    fireEvent.click(within(rowFor("plan")).getByRole("button", { name: editChainHint("plan") }));

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("plan"));
    expect(reflected()).toBe("plan");
    expect(screen.getByRole("list", { name: "Chain" })).toContainElement(document.activeElement as HTMLElement);
  });

  it("draws no shortcut on a row with no route to edit", () => {
    const rows = matrixRows(
      seededTaskKinds().map((kind) => (kind.name === "docs" ? { ...kind, route: null } : kind)),
      seededRules(),
    );
    matrix({ rows });

    expect(within(rowFor("docs")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("prints the mockup's hint in the card head, naming the keyboard's path as well", () => {
    matrix();

    expect(screen.getByText(REORDER_HINT)).toBeInTheDocument();
    expect(REORDER_HINT).toMatch(/⠿/);
    expect(REORDER_HINT).toMatch(/move buttons/);
  });
});

describe("a role that may not edit — read-only as a rendering mode (#202)", () => {
  it("draws six columns: no handle column, and no hint to explain one", () => {
    matrix({ editable: false });

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Task",
      "Primary model",
      "Fallback",
      "Escalation",
      "$/run avg",
      "p50 latency",
    ]);
    expect(screen.queryByText(REORDER_HINT)).not.toBeInTheDocument();
  });

  it("draws the selected route's chain with nothing that looks like a control", () => {
    matrix({ editable: false, selected: "implement" });

    expect(within(screen.getByRole("list", { name: "Chain" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the shell's scroll rule", () => {
  it("scrolls sideways inside the table's own wrapper, never the content pane", () => {
    // § 1.3, decision S2: the pane is the only scroll container in the product, and a wide
    // table without its wrapper is all it takes to start the whole pane scrolling sideways.
    const { container } = matrix();

    expect(container.querySelector(".ou-table-scroll")).toBeInTheDocument();
    expect(container.querySelector(".ou-table-scroll--open")).toBeNull();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the matrix in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <RouteEditorProvider editable routes={ROUTES}>
        <RoutingMatrix rows={ROWS} selected="implement" />
      </RouteEditorProvider>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("row", { selected: true })).toHaveClass("ou-table__row--selected");
  });

  it("draws the same markup in both, selection and chain included", () => {
    const [light, dark] = renderInBothPalettes(
      <RouteEditorProvider editable routes={ROUTES}>
        <RoutingMatrix rows={ROWS} selected="implement" />
      </RouteEditorProvider>,
    );

    expect(light).toBe(dark);
  });
});

describe("the right column's aside (#204)", () => {
  it("draws what it is handed under the route card, in the same column", () => {
    matrix({ aside: <p data-testid="aside">cards</p> });

    const column = document.querySelector(".models-aside") as HTMLElement;

    expect(column).not.toBeNull();
    expect(within(column).getByRole("heading", { name: "Route" })).toBeInTheDocument();
    expect(within(column).getByTestId("aside")).toBeInTheDocument();
    // Inspector first, then the cards — the mockup's order.
    expect(column.firstElementChild).toHaveTextContent(INSPECTOR_EMPTY_TITLE);
    expect(column.lastElementChild).toHaveTextContent("cards");
  });

  it("does not re-render the aside on a selection, because it has nothing to do with one", () => {
    // Server Components handed across as a prop are placed where they are placed; a
    // selection changes the inspector and leaves the cards alone.
    let renders = 0;
    function Counter() {
      renders += 1;
      return <p>cards</p>;
    }
    const aside = <Counter />;

    matrix({ aside });
    const before = renders;

    fireEvent.click(screen.getAllByRole("row")[1]);

    expect(screen.getByRole("row", { selected: true })).toBeInTheDocument();
    expect(renders).toBe(before);
  });
});
