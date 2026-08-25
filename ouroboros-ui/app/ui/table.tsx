import type { ComponentProps, KeyboardEvent, ReactNode } from "react";

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
 *
 * ### Selectable rows ([#201](https://github.com/NobuData/ouroboros/issues/201))
 *
 * {@link TableProps.selection} turns the table into a single-select list of rows: one row is
 * current, clicking or arrowing onto a row selects it, and the caller is told which. It is
 * here rather than in the one screen that needs it for the same reason the scroll wrapper
 * is — everything that goes wrong with a selectable table goes wrong at the call site:
 *
 * - **`aria-selected` on a `<tr>` inside a plain `<table>` is not valid ARIA.** It means
 *   something only in a grid, so declaring the selection also declares `role="grid"`, and the
 *   two can never be set apart. A `td` inside a grid maps to `gridcell` by HTML-AAM, so the
 *   cells need nothing.
 * - **A selectable row that is not reachable from the keyboard.** The rows carry a roving
 *   tabindex: exactly one is in the tab order — the selected row, or the first when nothing
 *   is selected — and the arrow keys move between them from there. A `tabIndex` on every row
 *   would put eight stops in the tab sequence of a page that should have one.
 * - **Selection that moves without saying so.** Announcing the new selection is the caller's
 *   (it is the caller that knows what a row *is*), but the row is the focused element when it
 *   moves, so what a screen reader reads is the row's own cells — which is why the task cell
 *   comes first in the routing matrix.
 *
 * **Rows are the focusable unit, not cells.** The WAI-ARIA grid pattern allows either; rows
 * are right here because cell-level navigation over cells that cannot be acted on is a second
 * axis of movement that arrives nowhere. A cell *may* hold a control — AA.3's edit shortcut in
 * the routing matrix's handle column ([#202](https://github.com/NobuData/ouroboros/issues/202))
 * is one — and the rule for it is the narrow one: a key pressed on that control is the
 * control's, and the row's handler leaves it alone. The control stays out of the tab order
 * (`tabIndex={-1}`), so the page still has one stop per table and the keyboard's path to what
 * the control does is the row plus whatever the selection drives.
 *
 * ### The sticky-header recipe ([#646](https://github.com/NobuData/ouroboros/issues/646))
 *
 * `stickyHeader` keeps the head row visible while a long table scrolls under it — against
 * the **pane**, which is the detail worth writing down once. `position: sticky` pins an
 * element within its nearest scrollport, and the wrapper this primitive insists on is one:
 * `overflow-x: auto` makes it the header's scrollport in *both* axes, and since the wrapper
 * never scrolls vertically, a sticky header inside it would simply never stick. CSS offers
 * no way to split the axes, so the two behaviours are genuinely exclusive, and the prop
 * chooses: a sticky header opens the wrapper up (`overflow-x: visible`), letting the header
 * stick against the pane — layer 3 of the stacking contract in `app/ui/chrome.ts`, under
 * the page's subnav and sticky bar.
 *
 * The price is stated rather than hidden: a `stickyHeader` table must fit the § 2 measure,
 * because the pane refuses horizontal scroll (§ 1.3) and the opened wrapper no longer
 * offers it. Long tables of figures — the ones that want sticky headers — fit by design;
 * a genuinely wide table (a diff, a gantt) keeps the scrolling wrapper and forgoes the
 * sticky header. The other half of the recipe — separate borders so the hairline travels
 * with the stuck row, the scrim ground so rows fade under it rather than showing through —
 * is in `ui.css`, on the modifier.
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

/**
 * Single-row selection: which row is current, and what to do when the reader picks another.
 *
 * Controlled, with no state of its own. The caller owns the selection because the caller is
 * what the selection is *for* — a details panel, a URL, a filter — and a table that
 * remembered its own would be a second answer to which row is current.
 */
export interface TableSelection {
  /**
   * The key of the selected row, or `null` when none is.
   *
   * `null` is a first-class state rather than a bootstrapping accident: a table that selected
   * its first row on arrival would put a row into whatever the selection drives that nobody
   * chose.
   */
  readonly selected: string | null;
  /**
   * Called with a row's key when the reader selects it, by click or by arrow key.
   *
   * Selection follows focus, which is the right coupling for a single-select list driving a
   * panel: moving through the rows is *how* a reader compares them, and a separate commit
   * step would make the arrow keys move a highlight that means nothing yet.
   */
  readonly onSelect: (key: string) => void;
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
  /**
   * Whether the head row sticks against the pane while the table scrolls under it.
   *
   * Defaults to `false`. Setting it trades away the wrapper's horizontal scroll — the
   * module note's recipe section says why the two cannot coexist — so it belongs on long
   * tables that fit the measure, not wide ones.
   */
  readonly stickyHeader?: boolean;
  /**
   * Makes the rows selectable. Omitted, the table is a table and its rows are not
   * interactive.
   */
  readonly selection?: TableSelection;
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
  stickyHeader,
  selection,
  className,
}: TableProps<Row>) {
  return (
    <div className={cx("ou-table-scroll", stickyHeader && "ou-table-scroll--open", className)}>
      <table
        className={cx("ou-table", stickyHeader && "ou-table--sticky")}
        role={selection === undefined ? undefined : "grid"}
      >
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
          {rows.map((row, index) => {
            const key = rowKey(row);

            return (
              <tr
                key={key}
                {...(selection === undefined
                  ? {}
                  : selectableRow(key, index, selection))}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A selectable row's props: an ordinary `<tr>`'s, plus the data attribute the key handler
 * reads its destination's key back from.
 *
 * Spelled out because React's `tr` props do not admit arbitrary `data-*` keys through an
 * object literal — only through JSX itself — and this component builds the props as a value
 * so that a table with no selection wears none of them.
 */
type SelectableRowProps = ComponentProps<"tr"> & { readonly "data-row-key": string };

/**
 * The attributes a selectable row wears — its state, its place in the tab order, and the two
 * ways it can be picked.
 *
 * Split out rather than spelled inline so the body of {@link Table} stays a description of a
 * table: this is the whole of what selection adds to a row, in one place, where the roving
 * tabindex rule and the `data-row-key` the key handler reads back are next to each other.
 *
 * @param key The row's key — its identity, and what {@link TableSelection.onSelect} is given.
 * @param index Where the row sits, so the first one can hold the tab stop when nothing is
 *   selected.
 * @param selection What is selected, and what to call.
 * @returns The row's props.
 */
function selectableRow(
  key: string,
  index: number,
  selection: TableSelection,
): SelectableRowProps {
  const isSelected = selection.selected === key;

  return {
    "aria-selected": isSelected,
    className: cx("ou-table__row", isSelected && "ou-table__row--selected"),
    // Read back by the key handler off whichever row it moved to — which is how arrow
    // navigation names its destination without this component keeping a ref per row.
    "data-row-key": key,
    onClick: () => selection.onSelect(key),
    // A key pressed on a control *inside* a cell is that control's, not the row's: the second
    // axis AA.3 (#202) added — an edit shortcut in the handle column — must be able to take a
    // key without the row moving the selection underneath it. The row itself is the target
    // when the reader arrowed onto it, which is the only case this handler is for.
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      moveSelection(event, selection.onSelect);
    },
    // Exactly one row is in the tab order: the selected one, or the first when nothing is
    // selected yet. A table with no rows renders none of these at all, so there is no case
    // here where the fallback stop has nowhere to sit.
    tabIndex: isSelected || (selection.selected === null && index === 0) ? 0 : -1,
  };
}

/**
 * Move the selection with the keyboard, the way the grid pattern says.
 *
 * Up and down move by one row, `Home` and `End` to the ends, and `Enter` or `Space` select
 * the row already focused. The whole set is {@link MOVES}.
 *
 * **The destination is found in the DOM rather than in the row list**, by reading the
 * `data-row-key` off the sibling `<tr>`. That is what lets this be a plain function with no
 * hooks and no ref per row — so `table.tsx` stays a module a Server Component may import,
 * and only the pages that pass a `selection` pull it into a client bundle.
 *
 * Every handled key has its default prevented, including at the ends of the table: an arrow
 * that fell through would scroll the pane, which is the one thing a reader stepping through
 * rows did not ask for.
 *
 * @param event The key press, from the focused row.
 * @param onSelect What to tell about the new selection.
 * @returns Nothing. An unhandled key is left entirely alone.
 */
function moveSelection(
  event: KeyboardEvent<HTMLTableRowElement>,
  onSelect: (key: string) => void,
): void {
  // An unhandled key is left entirely alone, so typing still reaches whatever is listening.
  if (!MOVES.has(event.key)) return;

  const row = event.currentTarget;
  const body = row.parentElement;
  if (body === null) return;

  event.preventDefault();

  const target = MOVES.get(event.key)?.(row, body) ?? null;
  if (!(target instanceof HTMLElement)) return;

  const key = target.dataset.rowKey;
  if (key === undefined) return;

  // Focus first, then select: the row is the focused element while the caller re-renders, so
  // the roving tabindex lands where the reader is rather than where they were.
  target.focus();
  onSelect(key);
}

/**
 * The keys {@link moveSelection} owns, and where each one goes.
 *
 * A map rather than a `switch` so that *which keys are handled* and *what each does* are one
 * fact: a key added to the table below is handled, and a key absent from it falls through
 * untouched. There is no third place to keep the two in step.
 */
const MOVES: ReadonlyMap<string, (row: Element, body: Element) => Element | null> = new Map([
  ["ArrowDown", (row: Element) => row.nextElementSibling],
  ["ArrowUp", (row: Element) => row.previousElementSibling],
  ["Home", (_row: Element, body: Element) => body.firstElementChild],
  ["End", (_row: Element, body: Element) => body.lastElementChild],
  // The row already focused. A no-op for a selection that follows focus, and supported
  // anyway because a reader who arrived by `Tab` will press one of them.
  ["Enter", (row: Element) => row],
  [" ", (row: Element) => row],
]);

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
