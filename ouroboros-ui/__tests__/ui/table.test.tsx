import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
