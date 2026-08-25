"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";

import { Card, CardHead, Chip, EmptyState, Table, Tag, type Column } from "@/app/ui";

import { CHANGED, type EditedRow, NO_ROUTE_NOTE, editChainHint, editedRow } from "./chain";
import { ChainEditor } from "./chain-editor";
import { HEALTH_UNREAD, type HopHealthIndex, SIMULATE_ROUTE } from "./inspector";
import {
  EM_DASH,
  INSPECTOR_EMPTY_NOTE,
  INSPECTOR_EMPTY_TITLE,
  MATRIX_CAPTION,
  MATRIX_TITLE,
  REORDER_HINT,
  ROUTE_PARAM,
  type AliasCell,
  type MatrixRow,
  inspectorTitle,
  selectionAnnouncement,
  taskKindCount,
} from "./matrix";
import { ModelsGrid } from "./models-grid";
import { useRouteEditor } from "./route-editor";
import { RoutePolicy } from "./route-policy";
import { SimulateButton } from "./simulate-sheet";

import "./models.css";

/**
 * Mockup 06's **ROUTING MATRIX** — the eight-kind table, and the route card beside it
 * ([#201](https://github.com/NobuData/ouroboros/issues/201)); since AA.3
 * ([#202](https://github.com/NobuData/ouroboros/issues/202)), the card holds the selected
 * route's chain and edits it, and since AA.4
 * ([#203](https://github.com/NobuData/ouroboros/issues/203)) it is the inspector whole: the
 * hops with their health, the policy controls under them, and the way into the simulate panel.
 *
 * This table is the page: everything else on `/models` explains or edits what it shows. Which
 * makes its two hard properties the ticket's two hard properties — **density** (two levels of
 * type across two model columns, plus a rule summary, plus two figures, eight kinds deep, in
 * both palettes and at every font-scale step) and **honesty** (half the cells can legitimately
 * be empty, and the row has to stay readable when they are).
 *
 * Neither is decided here. Every cell arrives already decided from `app/models/matrix.ts`, so
 * this file is a description of a table plus the two things a pure module cannot hold: which
 * row is selected, and — through `app/models/route-editor.tsx` — which routes have an unsaved
 * edit, whose first two hops the model columns then draw instead of the server's.
 *
 * ### The one Client Component on this page, and why
 *
 * Selection is a keystroke, and a keystroke that cost a server round trip would make arrowing
 * down eight rows eight fetches of a matrix nobody changed. So the selection lives here, in
 * state — and it is **reflected into the URL** with `history.replaceState` rather than with
 * `router.replace`, which is the same decision from the other side: `router.replace` would
 * re-render the route, and the route re-reads the matrix. The address bar is a *record* of the
 * selection, not the thing driving it.
 *
 * `replaceState` rather than `pushState` for the same reason: arrowing through eight rows must
 * not leave eight entries in the back stack, which would make **Back** mean *the row above*
 * rather than *the page I came from*.
 *
 * The initial selection comes from the server, which read it out of `?route=` — see
 * `app/(app)/models/(routing)/page.tsx`. That is what makes a selected route survive a reload without
 * this component reading the URL at all, and it is why nothing here needs `useSearchParams`
 * or the Suspense boundary that hook requires.
 *
 * ### The handle column is a shortcut, and the handles that reorder are the hops' own
 *
 * The mockup draws ⠿ on every row under *drag ⠿ to reorder fallback chains*. What is
 * reordered is a chain's **hops**, and a row is a route — so the row's ⠿ is the pointer's way
 * into the editor for that row (select it, focus its chain), and the ⠿ that is dragged is on
 * each hop in the route card. The column is drawn for a role that may edit and not at all for
 * one that may not: read-only is a rendering mode, and a member's matrix has no editing
 * affordance to explain. The shortcut stays out of the tab order so the table keeps its one
 * stop; the keyboard's path is the row, then Tab into the card the selection drives.
 */

/**
 * The columns every reader sees, in the order mockup 06 draws them.
 *
 * Declared outside the component because they close over nothing: a `Column<EditedRow>[]`
 * rebuilt on every render would be a new array identity for `Table` to diff on every arrow
 * key. The handle column is the one exception and is built where it is used, because it
 * closes over the shortcut.
 *
 * The **task column comes first for a reason beyond the mockup**: the row is the focused
 * element while the selection moves, so what a screen reader reads out is the row's own cells
 * in order — and the first thing a reader arrowing down this table needs to hear is which task
 * kind they have landed on.
 */
const COLUMNS: readonly Column<EditedRow>[] = [
  {
    key: "task",
    header: "Task",
    className: "models-matrix__task",
    cell: (row) => (
      <>
        <span className="models-matrix__kind">{row.kind}</span>
        <span className="models-matrix__desc">{row.description}</span>
        {/*
          The route's own tag, never one composed from the kind: `test-gen` tags
          `testgen-primary`. A kind with no route has no tag, and nothing is drawn — the two
          lines above already say which row this is. Beside it, the mark a route with an
          unsaved edit wears, so a reader scanning the matrix sees which rows the bar counts.
        */}
        {(row.tag !== null || row.changed) && (
          <span className="models-matrix__marks">
            {row.tag !== null && <Tag>{row.tag}</Tag>}
            {row.changed && <Chip tone="accent">{CHANGED}</Chip>}
          </span>
        )}
        {/*
          What the server refused about this route on the last save. On the row it names,
          because that is the ticket's whole point about a partial failure: it names *which*
          route, and the reader finds it where the route is.
        */}
        {row.problems.length > 0 && (
          <ul className="models-matrix__problems" role="alert">
            {row.problems.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </>
    ),
  },
  {
    key: "primary",
    header: "Primary model",
    // The model hue: this is the alias a run reaches for first.
    cell: (row) => <AliasCellView cell={row.primary} tone="model" />,
  },
  {
    key: "fallback",
    header: "Fallback",
    // The mockup's `.pill.model.dim`, which is the primitive's own neutral chip to the
    // declaration — a quieter border on the raised plane. Passing a tone here rather than a
    // class is what keeps the page out of the design system's colours.
    cell: (row) => <AliasCellView cell={row.fallback} tone="neutral" />,
  },
  {
    key: "escalation",
    header: "Escalation",
    className: "models-matrix__escalation",
    cell: (row) => <EscalationCell summaries={row.escalation} />,
  },
  {
    key: "cost",
    header: "$/run avg",
    align: "end",
    mono: true,
    className: "models-matrix__num",
    cell: (row) => row.cost,
  },
  {
    key: "p50",
    header: "p50 latency",
    align: "end",
    mono: true,
    className: "models-matrix__num",
    cell: (row) => row.latency,
  },
];

/**
 * The handle column — the mockup's 26px gutter, holding the shortcut into the editor.
 *
 * @param onEdit What the shortcut does: select the row and put focus in its chain.
 * @returns The column.
 */
function handleColumn(onEdit: (kind: string) => void): Column<EditedRow> {
  return {
    key: "handle",
    // Named in the accessibility tree, because a column header that is genuinely empty
    // leaves its cells belonging to nothing.
    header: <span className="sr-only">Edit</span>,
    className: "models-matrix__handle",
    cell: (row) =>
      row.tag === null ? null : (
        // Out of the tab order (`tabIndex={-1}`), in the accessibility tree: a pointer's
        // shortcut, and a control a screen reader browsing by button can still find and
        // press. The row's own key handler ignores keys from inside it (`app/ui/table.tsx`).
        <button
          aria-label={editChainHint(row.kind)}
          className="models-matrix__edit"
          onClick={() => {
            onEdit(row.kind);
          }}
          tabIndex={-1}
          title={editChainHint(row.kind)}
          type="button"
        >
          ⠿
        </button>
      ),
  };
}

/**
 * One of the two model columns: the alias pill, and the resolution line beneath it.
 *
 * @param props.cell The decided cell, or `null` where the chain does not reach — a kind with
 *   no route at all, or a chain one hop long.
 * @param props.tone The pill's hue: the model violet for the primary, the quiet neutral for
 *   the fallback.
 * @returns The cell, or the em-dash. The em-dash is drawn in the same place the pill would
 *   have been, which is what keeps a half-configured row on the same baseline as a full one.
 */
function AliasCellView({
  cell,
  tone,
}: Readonly<{ cell: AliasCell | null; tone: "model" | "neutral" }>) {
  if (cell === null) return <span className="models-matrix__none">{EM_DASH}</span>;

  return (
    <span className="models-matrix__alias">
      <Chip mono tone={tone}>
        {cell.alias}
      </Chip>
      <span className="models-matrix__resolution">{cell.resolution}</span>
    </span>
  );
}

/**
 * The escalation cell: the database's own sentences for the rules naming this kind.
 *
 * Rendered as a list rather than as joined text, because two rules on one row are two
 * separate statements and a reader hearing them run together would have no way to tell where
 * one ends. Which rules land here at all is `escalationFor`'s decision, and this component
 * composes nothing.
 *
 * @param props.summaries The `display` strings, in evaluation order.
 * @returns The sentences, or the em-dash for a row no rule names.
 */
function EscalationCell({ summaries }: Readonly<{ summaries: readonly string[] }>) {
  if (summaries.length === 0) return <span className="models-matrix__none">{EM_DASH}</span>;

  return (
    <ul className="models-matrix__rules">
      {summaries.map((summary) => (
        <li className="models-matrix__rule" key={summary}>
          {summary}
        </li>
      ))}
    </ul>
  );
}

/** The id the matrix card's `aria-labelledby` points at. */
const MATRIX_TITLE_ID = "models-matrix-title";

/** The id the inspector card's `aria-labelledby` points at. */
const INSPECTOR_TITLE_ID = "models-inspector-title";

/** What the matrix and the inspector take. */
export interface RoutingMatrixProps {
  /** The rows, already decided, in the order the service sends them. */
  readonly rows: readonly MatrixRow[];
  /**
   * Which row `?route=` asked for, already checked against the rows this workspace has.
   *
   * The initial value only: this component owns the selection from its first render on, and
   * writes the address bar rather than reading it.
   */
  readonly selected: string | null;
  /**
   * What stands under the inspector's seat in the right column — AA.5's
   * ([#204](https://github.com/NobuData/ouroboros/issues/204)) rules and spend cards.
   *
   * Handed in rather than rendered here, because neither card has anything to do with the
   * selection this component exists to hold: the rules card has its own client state and the
   * spend card has none, and both would re-render on every arrow key if they were this
   * component's children by import. Server Components handed to a Client Component as a
   * prop are rendered where they are placed and no further.
   */
  readonly aside?: ReactNode;
  /**
   * The strip, indexed by connection — what the inspector's health dots are drawn from
   * (`app/models/inspector.ts`'s `hopHealthIndex`), formed on the server from the same read
   * the strip above the matrix is drawn from.
   *
   * Defaults to *not read*, which draws every dot as a ring with a hover saying so.
   */
  readonly health?: HopHealthIndex;
}

/**
 * The matrix, and the route card beside it.
 *
 * @param props See {@link RoutingMatrixProps}.
 * @returns The two cards.
 */
export function RoutingMatrix({
  rows,
  selected: initial,
  aside,
  health = HEALTH_UNREAD,
}: RoutingMatrixProps) {
  const editor = useRouteEditor();
  const [selected, setSelected] = useState<string | null>(initial);
  const [focusToken, setFocusToken] = useState(0);

  const select = useCallback((kind: string) => {
    setSelected(kind);
    reflect(kind);
  }, []);

  // The shortcut: select the row, then ask the chain to take focus.
  const edit = useCallback(
    (kind: string) => {
      select(kind);
      setFocusToken((token) => token + 1);
    },
    [select],
  );

  const columns = useMemo(
    () => (editor.editable ? [handleColumn(edit), ...COLUMNS] : COLUMNS),
    [editor.editable, edit],
  );

  // The rows with their edits laid over them. Recomputed whenever the editor changes, which
  // is every edit — eight small objects, and the alternative is a matrix that lags its own
  // editor by a render.
  const view = useMemo(
    () => rows.map((row) => editedRow(row, editor.edit(row.kind), editor.problems[row.kind])),
    [rows, editor],
  );

  const row = view.find((candidate) => candidate.kind === selected) ?? null;

  return (
    <ModelsGrid
      main={
        <Card aria-labelledby={MATRIX_TITLE_ID} as="section" className="models-col--8" fill>
          <CardHead
            beside={<Tag>{taskKindCount(rows.length)}</Tag>}
            className="models-matrix__head"
            title={MATRIX_TITLE}
            titleId={MATRIX_TITLE_ID}
            trailing={
              editor.editable ? <span className="models-matrix__hint">{REORDER_HINT}</span> : undefined
            }
          />

          <Table
            caption={MATRIX_CAPTION}
            captionHidden
            columns={columns}
            rowKey={(candidate) => candidate.kind}
            rows={view}
            selection={{ selected, onSelect: select }}
          />

          {/*
            Where the selection is said out loud. `role="status"` rather than an alert: moving
            between rows is what the reader asked for, not an interruption — and it is the half
            of "announced to assistive technology" that focus alone does not cover, since a
            pointer selection moves no focus at all.
          */}
          <p className="sr-only" role="status">
            {selected === null ? "" : selectionAnnouncement(selected)}
          </p>
        </Card>
      }
      aside={
        <>
          <RouteInspectorSeat
            focusToken={focusToken}
            health={health}
            kinds={rows.map((candidate) => candidate.kind)}
            row={row}
          />
          {aside}
        </>
      }
    />
  );
}

/**
 * Mockup 06's **ROUTE — implement-primary** card: the selected route's chain, its policy and
 * its way into the simulate panel — or the two states in which there is no route to draw.
 *
 * With no row chosen it says how to choose one; with a kind chosen that has no route it says
 * so rather than drawing an empty rail; and with a route it draws the inspector — read-only
 * for a member, editable for a role that may. The chain is `app/models/chain-editor.tsx`'s,
 * the switches and the cap are `app/models/route-policy.tsx`'s, and both edit one draft, so
 * a policy edit and a chain edit are one entry in one batch.
 *
 * **Simulate this route** is the head's own button with the selected kind preset; it is keyed
 * by the kind so the sheet opens on the route the reader is looking at rather than on the one
 * they looked at first.
 *
 * @param props.row The selected row, or `null` when none is.
 * @param props.focusToken The matrix's shortcut, passed through to the chain.
 * @param props.health The strip, indexed, for the health dots.
 * @param props.kinds Every row's kind, for the simulate panel's select.
 * @returns The card.
 */
function RouteInspectorSeat({
  row,
  focusToken,
  health,
  kinds,
}: Readonly<{
  row: EditedRow | null;
  focusToken: number;
  health: HopHealthIndex;
  kinds: readonly string[];
}>) {
  return (
    <Card aria-labelledby={INSPECTOR_TITLE_ID} as="section" fill>
      <CardHead
        title={inspectorTitle(row?.tag ?? null)}
        titleId={INSPECTOR_TITLE_ID}
        trailing={
          row === null ? undefined : (
            <span className="models-inspector__marks">
              <Chip tone="model">selected</Chip>
              {row.changed && <Chip tone="accent">{CHANGED}</Chip>}
            </span>
          )
        }
      />

      {row === null ? (
        <EmptyState fill note={INSPECTOR_EMPTY_NOTE} title={INSPECTOR_EMPTY_TITLE} />
      ) : row.tag === null ? (
        <EmptyState fill note={NO_ROUTE_NOTE} title={row.kind} />
      ) : (
        <>
          <ChainEditor focusToken={focusToken} health={health} kind={row.kind} />
          <RoutePolicy kind={row.kind} />
          <div className="models-inspector__foot">
            <SimulateButton key={row.kind} kind={row.kind} label={SIMULATE_ROUTE} size="sm" taskKinds={kinds} />
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Write the selection into the address bar, without navigating.
 *
 * The native history API rather than the router, deliberately — the module note says why at
 * length. Next.js supports it explicitly for exactly this case: updating the URL to record
 * client state, without asking the route to render again.
 *
 * The path and hash are preserved and only the one parameter is set, so a URL carrying
 * anything else — a future filter, a fragment somebody linked to — survives a selection.
 *
 * @param kind The selected task kind.
 * @returns Nothing.
 */
function reflect(kind: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(ROUTE_PARAM, kind);

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
