import type { ReactNode } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * The mockups' `.tbl`, and the wrapper the app shell requires around it.
 *
 * ### Why it is declarative rather than composed
 *
 * A table could be `<Table>`, `<Row>`, `<Cell>` and a lot of freedom. It is a column
 * description plus rows instead, because the three things that go wrong with a table in
 * this product all go wrong at the *call site* and none of them can go wrong here:
 *
 * 1. **The scroll wrapper is forgotten.** The content pane is the only scroll container in
 *    the product (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3, decision S2), so wide content
 *    scrolls sideways inside its own box — one table without that wrapper is all it takes
 *    to start the whole pane scrolling sideways. Here the wrapper is not optional.
 * 2. **A header and its cells drift apart.** One column description produces both, so a
 *    column cannot be inserted into the body and missed in the head.
 * 3. **A numeric column is left ragged.** Alignment and tabular figures are a property of
 *    the column, declared once, rather than a class remembered per cell.
 *
 * A table that genuinely needs a composed body — a grouped one, a row that expands — is a
 * different primitive, and is not this one. Nothing in the product needs it yet.
 */

/** How a column's cells are aligned, which is a property of what is in them. */
export type ColumnAlign =
  /** Text: aligned to the reading edge. The default. */
  | "start"
  /** Figures: aligned to the trailing edge, in tabular numerals. */
  | "end";

/**
 * One column: what it is called, and how to get its cell out of a row.
 *
 * @typeParam Row The shape of one row of data.
 */
export interface Column<Row> {
  /** Stable identifier, and the React key for every cell in the column. */
  readonly key: string;
  /** The column heading. */
  readonly header: ReactNode;
  /** Which edge its cells align to. Defaults to `start`. */
  readonly align?: ColumnAlign;
  /** Whether its cells are values read character by character rather than prose. */
  readonly mono?: boolean;
  /**
   * Classes from the page, worn by this column's heading and every one of its cells —
   * placement only, never colour or type.
   *
   * It exists for the one thing a column description cannot derive: how wide the column
   * should be. The mockups set that per table (`<th style="width:180px">`), and a page that
   * had no way to say it here would have to reach into `.ou-table` from its own sheet, which
   * is the fork of the design system this primitive exists to prevent.
   */
  readonly className?: string;
  /** The cell for one row. */
  readonly cell: (row: Row) => ReactNode;
}

/** What a table takes. */
export interface TableProps<Row> {
  /**
   * What the table is, in a sentence. It is rendered as a `<caption>` — the table's own
   * name, which is what a reader moving between tables hears, and which no heading above
   * it can supply.
   */
  readonly caption: ReactNode;
  /** Whether the caption is visible, or only in the accessibility tree. */
  readonly captionHidden?: boolean;
  /** The columns, in order. */
  readonly columns: readonly Column<Row>[];
  /** The rows, in the order they should be drawn. */
  readonly rows: readonly Row[];
  /** The React key for a row — stable, and never the index. */
  readonly rowKey: (row: Row) => string;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/**
 * A table, inside its own horizontal scroll container.
 *
 * @param props See {@link TableProps}.
 * @returns The table. An empty `rows` renders the head alone — a table with no rows is a
 *   table that is still a table, and what to say instead is an {@link EmptyState} the
 *   caller renders in its place.
 * @typeParam Row The shape of one row of data.
 */
export function Table<Row>({
  caption,
  captionHidden,
  columns,
  rows,
  rowKey,
  className,
}: TableProps<Row>) {
  return (
    <div className={cx("ou-table-scroll", className)}>
      <table className="ou-table">
        <caption className={captionHidden ? "sr-only" : "ou-table__caption"}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The classes a column's cells wear, head and body alike — which is what keeps a numeric
 * column's heading over its own figures.
 *
 * @param column The column.
 * @returns The joined class list, or `""` for an ordinary text column.
 * @typeParam Row The shape of one row of data.
 */
function cellClass<Row>(column: Column<Row>): string {
  return cx(
    column.mono && "ou-table__cell--mono",
    column.align === "end" && "ou-table__cell--end",
    column.className,
  );
}
