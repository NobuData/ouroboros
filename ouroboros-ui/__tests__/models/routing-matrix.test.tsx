import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
import { RoutingMatrix } from "@/app/models/routing-matrix";

import {
  seededRules,
  seededTaskKinds,
  unmeasuredMatrix,
} from "../helpers/models";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The routing matrix as it is drawn (#201) — mockup 06's densest region, and the selection
 * that drives the inspector.
 *
 * What every cell *says* is `matrix.test.ts`'s, decided as functions over the dev seed's own
 * rows. What is here is what only a render can show: that the eight rows come out as the
 * mockup draws them, that selection is a real state with a real address, that the keyboard
 * reaches every row, and that a workspace which has run nothing gets em-dashes without the
 * table falling apart.
 *
 * ### What a render test in this module can and cannot prove about the palettes
 *
 * jsdom applies no stylesheet, so no test here can read a computed colour — the violet inset
 * on the selected row is checked by `models-styles.test.ts` and `ui-styles.test.ts`, where the
 * declarations are. What *this* file proves is the half that matters at the component level:
 * the two palettes produce identical markup, so nothing about the selection is decided in
 * JavaScript from the theme.
 */

/** The seeded matrix's rows, decided. */
const ROWS: readonly MatrixRow[] = matrixRows(seededTaskKinds(), seededRules());

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
 * The matrix, rendered.
 *
 * @param props.rows Which rows. Defaults to the seeded eight.
 * @param props.selected Which row the URL asked for. Defaults to none.
 * @returns The Testing Library render result.
 */
function matrix({
  rows = ROWS,
  selected = null,
}: { rows?: readonly MatrixRow[]; selected?: string | null } = {}) {
  return render(<RoutingMatrix rows={rows} selected={selected} />);
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

  it("heads the seven columns the mockup does", () => {
    matrix();

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Reorder",
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
    // should have one.
    matrix({ selected: "implement" });

    expect(bodyRows().filter((row) => row.tabIndex === 0)).toEqual([rowFor("implement")]);
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

    expect(screen.getByRole("status")).toHaveTextContent(selectionAnnouncement("review"));
  });

  it("keeps the region in the document while nothing is selected, so the first move is heard", () => {
    // A live region added to the page at the same moment its content appears is not announced.
    matrix();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("the inspector's seat", () => {
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

  it("names the issue that builds it rather than drawing a chain nobody resolved", () => {
    matrix({ selected: "implement" });

    expect(screen.getByText(/#203/)).toBeInTheDocument();
  });
});

describe("the drag handle, which is drawn and inert", () => {
  it("is kept out of the accessibility tree, because it is not a control yet", () => {
    matrix();

    const handle = within(rowFor("analyze")).getByTitle(REORDER_HINT);

    expect(handle).toHaveAttribute("aria-hidden", "true");
  });

  it("says which issue wires it, rather than the word soon", () => {
    matrix();

    expect(REORDER_HINT).toMatch(/#202/);
    expect(screen.getByText(REORDER_HINT)).toBeInTheDocument();
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
    renderInPalette(palette, <RoutingMatrix rows={ROWS} selected="implement" />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("row", { selected: true })).toHaveClass("ou-table__row--selected");
  });

  it("draws the same markup in both, selection included", () => {
    const [light, dark] = renderInBothPalettes(
      <RoutingMatrix rows={ROWS} selected="implement" />,
    );

    expect(light).toBe(dark);
  });
});

describe("the right column's aside (#204)", () => {
  it("draws what it is handed under the inspector's seat, in the same column", () => {
    render(<RoutingMatrix aside={<p data-testid="aside">cards</p>} rows={ROWS} selected={null} />);

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

    render(<RoutingMatrix aside={aside} rows={ROWS} selected={null} />);
    const before = renders;

    fireEvent.click(screen.getAllByRole("row")[1]);

    expect(screen.getByRole("row", { selected: true })).toBeInTheDocument();
    expect(renders).toBe(before);
  });
});
