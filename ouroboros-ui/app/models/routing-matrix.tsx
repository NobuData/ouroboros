"use client";

import { useCallback, useState } from "react";

import { Card, CardHead, Chip, EmptyState, Table, Tag, type Column } from "@/app/ui";

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
  inspectorNote,
  inspectorTitle,
  selectionAnnouncement,
  taskKindCount,
} from "./matrix";

import "./models.css";

/**
 * Mockup 06's **ROUTING MATRIX** — the eight-kind table, and the seat the route inspector
 * takes beside it ([#201](https://github.com/NobuData/ouroboros/issues/201)).
 *
 * This table is the page: everything else on `/models` explains or edits what it shows. Which
 * makes its two hard properties the ticket's two hard properties — **density** (two levels of
 * type across two model columns, plus a rule summary, plus two figures, eight kinds deep, in
 * both palettes and at every font-scale step) and **honesty** (half the cells can legitimately
 * be empty, and the row has to stay readable when they are).
 *
 * Neither is decided here. Every cell arrives already decided from `app/models/matrix.ts`, so
 * this file is a description of a table plus the one thing a pure module cannot hold: which
 * row is selected.
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
 * `app/(app)/models/page.tsx`. That is what makes a selected route survive a reload without
 * this component reading the URL at all, and it is why nothing here needs `useSearchParams`
 * or the Suspense boundary that hook requires.
 *
 * ### What drives the inspector today
 *
 * AA.4 ([#203](https://github.com/NobuData/ouroboros/issues/203)) builds the panel. Until it
 * does, the seat beside the matrix is held by a card that names the selected route and says
 * plainly what is not built — § 3.5's rule, and the only honest way to have a selection that
 * demonstrably *drives* something. An invented chain of hops there would be indistinguishable,
 * in a screenshot, from the real one AA.4 ships.
 */

/**
 * The columns, in the order mockup 06 draws them.
 *
 * Declared outside the component because they close over nothing: a `Column<MatrixRow>[]`
 * rebuilt on every render would be a new array identity for `Table` to diff on every arrow
 * key.
 *
 * The **task column comes first for a reason beyond the mockup**: the row is the focused
 * element while the selection moves, so what a screen reader reads out is the row's own cells
 * in order — and the first thing a reader arrowing down this table needs to hear is which task
 * kind they have landed on.
 */
const COLUMNS: readonly Column<MatrixRow>[] = [
  {
    key: "handle",
    // Visually the mockup's empty 26px column; named in the accessibility tree, because a
    // column header that is genuinely empty leaves its cells belonging to nothing.
    header: <span className="sr-only">Reorder</span>,
    className: "models-matrix__handle",
    cell: () => (
      // Inert, and it says so. AA.3 (#202) wires it; drawn now because the column is part of
      // the row's rhythm and a table that grew a column later would re-flow every width on
      // the page. `aria-hidden` because a handle that cannot be dragged is not a control —
      // the hint in the card head is where a reader is told about reordering at all.
      <span aria-hidden className="models-matrix__drag" title={REORDER_HINT}>
        ⠿
      </span>
    ),
  },
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
          lines above already say which row this is.
        */}
        {row.tag !== null && <Tag className="models-matrix__tag">{row.tag}</Tag>}
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
}

/**
 * The matrix, and the seat the inspector takes beside it.
 *
 * @param props See {@link RoutingMatrixProps}.
 * @returns The two cards.
 */
export function RoutingMatrix({ rows, selected: initial }: RoutingMatrixProps) {
  const [selected, setSelected] = useState<string | null>(initial);

  const select = useCallback((kind: string) => {
    setSelected(kind);
    reflect(kind);
  }, []);

  const row = rows.find((candidate) => candidate.kind === selected) ?? null;

  return (
    <div className="models-grid">
      <Card aria-labelledby={MATRIX_TITLE_ID} as="section" className="models-col--8" fill>
        <CardHead
          beside={<Tag>{taskKindCount(rows.length)}</Tag>}
          className="models-matrix__head"
          title={MATRIX_TITLE}
          titleId={MATRIX_TITLE_ID}
          trailing={<span className="models-matrix__hint">{REORDER_HINT}</span>}
        />

        <Table
          caption={MATRIX_CAPTION}
          captionHidden
          columns={COLUMNS}
          rowKey={(candidate) => candidate.kind}
          rows={rows}
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

      <RouteInspectorSeat row={row} />
    </div>
  );
}

/**
 * The seat mockup 06's **ROUTE — implement-primary** card takes, holding the selection until
 * AA.4 ([#203](https://github.com/NobuData/ouroboros/issues/203)) fills it.
 *
 * It draws two states and neither of them pretends: with no row chosen it says how to choose
 * one, and with a row chosen it names the route, marks it *selected* in the mockup's own
 * violet pill, and says which issue brings the chain and the policy switches.
 *
 * @param props.row The selected row, or `null` when none is.
 * @returns The card.
 */
function RouteInspectorSeat({ row }: Readonly<{ row: MatrixRow | null }>) {
  return (
    <Card aria-labelledby={INSPECTOR_TITLE_ID} as="section" className="models-col--4" fill>
      <CardHead
        title={inspectorTitle(row?.tag ?? null)}
        titleId={INSPECTOR_TITLE_ID}
        trailing={row === null ? undefined : <Chip tone="model">selected</Chip>}
      />

      {row === null ? (
        <EmptyState fill note={INSPECTOR_EMPTY_NOTE} title={INSPECTOR_EMPTY_TITLE} />
      ) : (
        <EmptyState fill note={inspectorNote(row.kind)} title={row.kind} />
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
