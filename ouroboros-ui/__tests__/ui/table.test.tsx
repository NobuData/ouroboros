import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type Column, Table } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The table primitive (#46).
 *
 * The reason it is a component at all is the app shell's scroll rule: the content pane is
 * the only scroll container in the product, so wide content scrolls sideways **inside its
 * own box** — and one table without that wrapper is enough to start the whole pane
 * scrolling sideways. Making the wrapper part of the primitive is what turns a rule
 * somebody has to remember into one nobody can forget.
 */

/** One row of the world this suite tables. */
interface Run {
  readonly id: string;
  readonly repo: string;
  readonly minutes: number;
}

const RUNS: readonly Run[] = [
  { id: "run-1", repo: "acme/helios", minutes: 12 },
  { id: "run-2", repo: "acme/atlas", minutes: 4 },
];

const COLUMNS: readonly Column<Run>[] = [
  { key: "repo", header: "Repository", mono: true, cell: (run) => run.repo },
  { key: "minutes", header: "Minutes", align: "end", cell: (run) => run.minutes },
];

/**
 * Render the suite's table.
 *
 * @param rows Which rows to draw. Defaults to both.
 * @returns The Testing Library render result.
 */
function table(rows: readonly Run[] = RUNS) {
  return render(
    <Table caption="Recent runs" columns={COLUMNS} rows={rows} rowKey={(run) => run.id} />,
  );
}

describe("the structure", () => {
  it("names itself, so a reader moving between tables knows which one this is", () => {
    table();

    expect(screen.getByRole("table", { name: "Recent runs" })).toBeInTheDocument();
  });

  it("can hide that name from the page without taking it out of the tree", () => {
    render(
      <Table
        caption="Recent runs"
        captionHidden
        columns={COLUMNS}
        rows={RUNS}
        rowKey={(run) => run.id}
      />,
    );

    expect(screen.getByRole("table", { name: "Recent runs" })).toBeInTheDocument();
    expect(screen.getByText("Recent runs")).toHaveClass("sr-only");
  });

  it("draws one header per column, scoped to it", () => {
    table();

    const headers = screen.getAllByRole("columnheader");

    expect(headers.map((cell) => cell.textContent)).toEqual(["Repository", "Minutes"]);
    for (const header of headers) expect(header).toHaveAttribute("scope", "col");
  });

  it("draws one row per row, in the order it was given them", () => {
    table();

    const rows = screen.getAllByRole("row").slice(1);

    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("acme/helios")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("acme/atlas")).toBeInTheDocument();
  });

  it("draws the head alone when there is nothing to list", () => {
    // A table with no rows is still a table; what to say instead is an empty state the
    // caller renders in its place, which is a decision only the screen can make.
    table([]);

    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});

describe("the columns", () => {
  it("scrolls sideways inside its own box rather than moving the pane", () => {
    const { container } = table();

    expect(container.firstElementChild).toHaveClass("ou-table-scroll");
  });

  it("gives a column's treatment to its heading as well as to its cells", () => {
    // Alignment declared once per column is what keeps a numeric heading over its own
    // figures — the drift a per-cell class invites.
    table();

    const [, minutes] = screen.getAllByRole("columnheader");
    const cell = screen.getByText("12");

    expect(minutes).toHaveClass("ou-table__cell--end");
    expect(cell).toHaveClass("ou-table__cell--end");
  });

  it("marks a column of values as values", () => {
    table();

    expect(screen.getByText("acme/helios")).toHaveClass("ou-table__cell--mono");
  });

  it("gives a page's own class to the heading and the cells alike", () => {
    // The one thing a column description cannot derive is how wide the column should be, and
    // the mockups fix that per table. A page that had no way to say it here would reach into
    // `.ou-table` from its own sheet, which is the fork of the design system this primitive
    // exists to prevent.
    render(
      <Table
        caption="Runs"
        columns={[
          {
            key: "repo",
            header: "Repository",
            className: "dash-runs__stage",
            cell: (run: Run) => run.repo,
          },
        ]}
        rows={RUNS}
        rowKey={(run) => run.id}
      />,
    );

    expect(screen.getByRole("columnheader")).toHaveClass("dash-runs__stage");
    expect(screen.getByText("acme/helios")).toHaveClass("dash-runs__stage");
  });

  it("leaves an ordinary text column unclassed", () => {
    render(
      <Table
        caption="Runs"
        columns={[{ key: "repo", header: "Repository", cell: (run: Run) => run.repo }]}
        rows={RUNS}
        rowKey={(run) => run.id}
      />,
    );

    expect(screen.getByText("acme/helios").className).toBe("");
  });
});

describe("the sticky head", () => {
  it("leaves the wrapper scrolling and the head in flow by default", () => {
    const { container } = table();

    expect(container.firstElementChild).not.toHaveClass("ou-table-scroll--open");
    expect(screen.getByRole("table")).not.toHaveClass("ou-table--sticky");
  });

  it("opens the wrapper when the head is to stick, because sticky needs the pane", () => {
    // The two behaviours are exclusive: `overflow-x: auto` makes the wrapper the head's
    // scrollport in both axes, and the wrapper never scrolls vertically — so the head
    // would stick to a box that never moves. The recipe in `table.tsx` says it once.
    const { container } = render(
      <Table
        caption="Recent runs"
        columns={COLUMNS}
        rows={RUNS}
        rowKey={(run) => run.id}
        stickyHeader
      />,
    );

    expect(container.firstElementChild).toHaveClass("ou-table-scroll", "ou-table-scroll--open");
    expect(screen.getByRole("table")).toHaveClass("ou-table", "ou-table--sticky");
  });

  it("keeps the page's own class beside the opened wrapper's", () => {
    const { container } = render(
      <Table
        caption="Recent runs"
        className="dash-runs"
        columns={COLUMNS}
        rows={RUNS}
        rowKey={(run) => run.id}
        stickyHeader
      />,
    );

    expect(container.firstElementChild).toHaveClass("ou-table-scroll--open", "dash-runs");
  });
});

describe("selectable rows (#201)", () => {
  /**
   * The suite's table, with its rows selectable.
   *
   * @param selected Which row is current, or `null`.
   * @param onSelect What to call when the reader picks one.
   * @returns The Testing Library render result.
   */
  function selectable(selected: string | null, onSelect = vi.fn()) {
    return {
      onSelect,
      ...render(
        <Table
          caption="Recent runs"
          columns={COLUMNS}
          rowKey={(run) => run.id}
          rows={RUNS}
          selection={{ selected, onSelect }}
        />,
      ),
    };
  }

  /** One body row, by its key. */
  function row(id: string): HTMLElement {
    const found = screen
      .getAllByRole("row")
      .find((candidate) => candidate.dataset.rowKey === id);

    if (found === undefined) throw new Error(`no rendered row for ${id}`);
    return found;
  }

  it("is a grid rather than a table, because that is what makes the state mean anything", () => {
    // `aria-selected` on a `<tr>` inside a plain `<table>` is not valid ARIA. Declaring the
    // selection declares the role, so the two can never be set apart.
    selectable("run-1");

    expect(screen.getByRole("grid", { name: "Recent runs" })).toBeInTheDocument();
  });

  it("stays an ordinary table when no selection is declared", () => {
    // The rows of a table nobody can select must not be announced as selectable, must not be
    // in the tab order, and must not respond to a click.
    table();

    expect(screen.getByRole("table", { name: "Recent runs" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    for (const candidate of screen.getAllByRole("row")) {
      expect(candidate).not.toHaveAttribute("aria-selected");
      expect(candidate).not.toHaveAttribute("tabindex");
    }
  });

  it("marks the selected row and only the selected row", () => {
    selectable("run-2");

    expect(screen.getAllByRole("row", { selected: true })).toEqual([row("run-2")]);
    expect(row("run-2")).toHaveClass("ou-table__row", "ou-table__row--selected");
    expect(row("run-1")).toHaveClass("ou-table__row");
    expect(row("run-1")).not.toHaveClass("ou-table__row--selected");
  });

  it("selects nothing when nothing is selected, rather than falling back to the first row", () => {
    // A table that selected its own first row would put a row into whatever the selection
    // drives that nobody chose.
    selectable(null);

    expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
  });

  it("tells the caller which row was clicked", () => {
    const { onSelect } = selectable(null);

    fireEvent.click(row("run-2"));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("run-2");
  });

  it("puts exactly one row in the tab order — the selected one", () => {
    // A `tabIndex` on every row would put one stop per row in the tab sequence of a page
    // that should have one.
    selectable("run-2");

    expect(row("run-1").tabIndex).toBe(-1);
    expect(row("run-2").tabIndex).toBe(0);
  });

  it("holds that tab stop on the first row while nothing is selected", () => {
    selectable(null);

    expect(row("run-1").tabIndex).toBe(0);
    expect(row("run-2").tabIndex).toBe(-1);
  });

  it("moves by one row on the arrow keys, and moves focus with it", () => {
    const { onSelect } = selectable("run-1");

    fireEvent.keyDown(row("run-1"), { key: "ArrowDown" });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("run-2");
    expect(row("run-2")).toHaveFocus();
  });

  it("goes to the ends on Home and End", () => {
    const { onSelect } = selectable("run-2");

    fireEvent.keyDown(row("run-2"), { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith("run-1");

    fireEvent.keyDown(row("run-1"), { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("run-2");
  });

  it("does nothing at the ends rather than wrapping round", () => {
    const { onSelect } = selectable("run-1");

    fireEvent.keyDown(row("run-1"), { key: "ArrowUp" });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("re-selects the focused row on Enter and Space, for a reader who arrived by Tab", () => {
    const { onSelect } = selectable(null);

    fireEvent.keyDown(row("run-1"), { key: "Enter" });
    fireEvent.keyDown(row("run-1"), { key: " " });

    expect(onSelect.mock.calls).toEqual([["run-1"], ["run-1"]]);
  });

  it("prevents the default of every key it handles, so the pane does not scroll under it", () => {
    selectable("run-1");

    expect(fireEvent.keyDown(row("run-1"), { key: "ArrowDown" })).toBe(false);
    expect(fireEvent.keyDown(row("run-2"), { key: "ArrowDown" })).toBe(false);
    expect(fireEvent.keyDown(row("run-1"), { key: " " })).toBe(false);
  });

  it("leaves a key pressed on a control inside a cell to that control", () => {
    // The second axis AA.3 (#202) added: the routing matrix's handle column holds a button,
    // and an arrow pressed on it must not move the selection underneath it.
    const onSelect = vi.fn();
    render(
      <Table
        caption="Recent runs"
        columns={[
          ...COLUMNS,
          { key: "act", header: "Act", cell: (run) => <button type="button">edit {run.id}</button> },
        ]}
        rowKey={(run) => run.id}
        rows={RUNS}
        selection={{ selected: "run-1", onSelect }}
      />,
    );

    const handled = fireEvent.keyDown(screen.getByRole("button", { name: "edit run-1" }), { key: "ArrowDown" });

    expect(handled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("leaves a key it does not own entirely alone", () => {
    const { onSelect } = selectable("run-1");

    expect(fireEvent.keyDown(row("run-1"), { key: "a" })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("checkable rows (#117)", () => {
  /** The three verbs, recorded. */
  function verbs() {
    return { onCurrent: vi.fn(), onToggle: vi.fn(), onActivate: vi.fn() };
  }

  /**
   * The suite's table, with its rows checkable.
   *
   * @param selected Which rows are checked.
   * @param current Which row holds the tab stop, or `null`.
   * @param withActivate Whether `Enter` and a click do anything beyond moving.
   * @returns The render result and the recorded verbs.
   */
  function checkable(selected: readonly string[], current: string | null, withActivate = true) {
    const recorded = verbs();

    return {
      ...recorded,
      ...render(
        <Table
          caption="Recent runs"
          columns={[
            ...COLUMNS,
            { key: "pick", header: "Pick", cell: (run) => <input aria-label={`pick ${run.id}`} type="checkbox" /> },
          ]}
          rowKey={(run) => run.id}
          rows={RUNS}
          selection={{
            kind: "multi",
            selected: new Set(selected),
            current,
            onCurrent: recorded.onCurrent,
            onToggle: recorded.onToggle,
            ...(withActivate ? { onActivate: recorded.onActivate } : {}),
            tone: "accent",
          }}
        />,
      ),
    };
  }

  /** One body row, by its key. */
  function row(id: string): HTMLElement {
    const found = screen.getAllByRole("row").find((candidate) => candidate.dataset.rowKey === id);

    if (found === undefined) throw new Error(`no rendered row for ${id}`);
    return found;
  }

  it("is a multiselectable grid, and aria-selected means checked", () => {
    checkable(["run-2"], null);

    expect(screen.getByRole("grid", { name: "Recent runs" })).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getAllByRole("row", { selected: true })).toEqual([row("run-2")]);
    expect(row("run-2")).toHaveClass("ou-table__row--selected");
    expect(row("run-1")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("grid")).toHaveClass("ou-table--accent");
  });

  it("can check every row at once — there is no one current selection to be exclusive with", () => {
    checkable(["run-1", "run-2"], null);

    expect(screen.getAllByRole("row", { selected: true })).toHaveLength(2);
  });

  it("holds the tab stop on the current row, and on the first when there is none on the page", () => {
    checkable([], "run-2");
    expect(row("run-2").tabIndex).toBe(0);
    expect(row("run-1").tabIndex).toBe(-1);

    cleanupAnd(() => checkable([], null));
    expect(row("run-1").tabIndex).toBe(0);

    cleanupAnd(() => checkable([], "run-gone"));
    expect(row("run-1").tabIndex).toBe(0);
    expect(row("run-2").tabIndex).toBe(-1);
  });

  it("checks the focused row on Space and does nothing else", () => {
    const { onToggle, onCurrent, onActivate } = checkable([], "run-1");

    expect(fireEvent.keyDown(row("run-1"), { key: " " })).toBe(false);

    expect(onToggle).toHaveBeenCalledExactlyOnceWith("run-1");
    expect(onCurrent).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("activates the focused row on Enter, and on a click that is not on a control", () => {
    const { onActivate, onCurrent, onToggle } = checkable([], "run-1");

    expect(fireEvent.keyDown(row("run-1"), { key: "Enter" })).toBe(false);
    fireEvent.click(within(row("run-2")).getByText("acme/atlas"));

    expect(onActivate.mock.calls).toEqual([["run-1"], ["run-2"]]);
    expect(onCurrent).toHaveBeenCalledExactlyOnceWith("run-2");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("leaves a click on a control inside a cell to that control", () => {
    const { onActivate, onCurrent } = checkable([], "run-1");

    fireEvent.click(screen.getByRole("checkbox", { name: "pick run-2" }));

    expect(onActivate).not.toHaveBeenCalled();
    expect(onCurrent).not.toHaveBeenCalled();
  });

  it("only moves on Enter and a click when nothing is there to activate", () => {
    const { onCurrent, onToggle } = checkable([], "run-1", false);

    expect(fireEvent.keyDown(row("run-1"), { key: "Enter" })).toBe(false);
    fireEvent.click(row("run-2"));

    expect(onCurrent).toHaveBeenCalledExactlyOnceWith("run-2");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("moves focus and the current row on the arrows, Home and End, checking nothing", () => {
    const { onCurrent, onToggle } = checkable([], "run-1");

    expect(fireEvent.keyDown(row("run-1"), { key: "ArrowDown" })).toBe(false);
    expect(row("run-2")).toHaveFocus();
    expect(onCurrent).toHaveBeenLastCalledWith("run-2");

    fireEvent.keyDown(row("run-2"), { key: "Home" });
    expect(row("run-1")).toHaveFocus();
    expect(onCurrent).toHaveBeenLastCalledWith("run-1");

    fireEvent.keyDown(row("run-1"), { key: "End" });
    expect(onCurrent).toHaveBeenLastCalledWith("run-2");

    fireEvent.keyDown(row("run-2"), { key: "ArrowDown" });
    expect(onCurrent).toHaveBeenCalledTimes(3);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("leaves a key it does not own, and a key pressed on a control, entirely alone", () => {
    const { onCurrent, onToggle, onActivate } = checkable([], "run-1");

    expect(fireEvent.keyDown(row("run-1"), { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole("checkbox", { name: "pick run-1" }), { key: " " })).toBe(true);

    expect(onCurrent).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  /**
   * Unmount what a case rendered and render again — for the cases that compare renders.
   *
   * @param next What to render next.
   */
  function cleanupAnd(next: () => void): void {
    document.body.innerHTML = "";
    next();
  }
});

describe("a page's own row class (#592)", () => {
  it("wears it on the row it is given for, and on no other", () => {
    // Mockup 21's dimmed unbound row: a state the row as a whole is in, which no column can say.
    render(
      <Table
        caption="Recent runs"
        columns={COLUMNS}
        rowClassName={(run) => run.minutes < 10 && "runs__row--short"}
        rowKey={(run) => run.id}
        rows={RUNS}
      />,
    );

    const [, first, second] = screen.getAllByRole("row");

    expect(second).toHaveClass("runs__row--short");
    expect(first).not.toHaveClass("runs__row--short");
    expect(first).not.toHaveAttribute("class");
  });

  it("keeps it beside the selection's own classes on a selectable row", () => {
    render(
      <Table
        caption="Recent runs"
        columns={COLUMNS}
        rowClassName={() => "runs__row--own"}
        rowKey={(run) => run.id}
        rows={RUNS}
        selection={{ selected: "run-1", onSelect: vi.fn() }}
      />,
    );

    const [, first] = screen.getAllByRole("row");

    expect(first).toHaveClass("ou-table__row", "ou-table__row--selected", "runs__row--own");
  });
});

describe("the selection's tone (#592)", () => {
  it("selects in the model hue by default — mockup 06's `.selected`", () => {
    render(
      <Table
        caption="Recent runs"
        columns={COLUMNS}
        rowKey={(run) => run.id}
        rows={RUNS}
        selection={{ selected: "run-1", onSelect: vi.fn() }}
      />,
    );

    expect(screen.getByRole("grid")).not.toHaveClass("ou-table--accent");
  });

  it("selects in the accent when told to — mockup 21's", () => {
    render(
      <Table
        caption="Recent runs"
        columns={COLUMNS}
        rowKey={(run) => run.id}
        rows={RUNS}
        selection={{ selected: "run-1", onSelect: vi.fn(), tone: "accent" }}
      />,
    );

    expect(screen.getByRole("grid")).toHaveClass("ou-table", "ou-table--accent");
  });

  it("wears no tone at all when nothing is selectable", () => {
    table();

    expect(screen.getByRole("table")).not.toHaveClass("ou-table--accent");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <Table
        caption="Recent runs"
        columns={COLUMNS}
        rows={RUNS}
        rowKey={(run) => run.id}
      />,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("table", { name: "Recent runs" })).toHaveClass("ou-table");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <Table
        caption="Recent runs"
        columns={COLUMNS}
        rows={RUNS}
        rowKey={(run) => run.id}
      />,
    );

    expect(light).toBe(dark);
  });
});
