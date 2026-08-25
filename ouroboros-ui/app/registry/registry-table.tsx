"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ALIAS_PARAM, PROVIDERS_PATH } from "@/app/paths";
import { ProviderMonogram } from "@/app/providers/provider-monogram";
import { Button, Card, CardHead, Chip, EmptyState, Table, Tag, type Column, cx } from "@/app/ui";

import { AliasSwitch } from "./alias-switch";
import {
  EM_DASH,
  FIX_IN_PROVIDERS,
  INSPECTOR_NEXT_NOTE,
  INSPECTOR_NEXT_TITLE,
  MANAGE_PROVIDERS,
  NO_PROVIDER,
  TABLE_CAPTION,
  TABLE_NOTE,
  TABLE_TITLE,
  type HealthCell,
  type HealthTone,
  type TableRow,
  aliasCount,
  inspectorTitle,
  selectionAnnouncement,
} from "./table";

import "./registry.css";

/**
 * Mockup 21's **ALLOWED MODELS** table — eight columns, each a different subsystem's truth —
 * and the inspector's seat beneath it that the selection drives
 * ([#592](https://github.com/NobuData/ouroboros/issues/592)).
 *
 * This table is the page: everything else on `/models/registry` names or edits what it
 * shows. Every cell arrives already decided from `app/registry/table.ts` over CH.5's payload,
 * so this file is a description of a table plus the two things a pure module cannot hold:
 * which row is selected, and — through `app/registry/alias-switch.tsx` — a switch that writes.
 *
 * ### Each cell, and what it must not do
 *
 * - **Alias** is the vocabulary: the accent-tinted mono pill (`.pill.alias`), because it is
 *   the name everything else in the product points at and must not read like a cell of data.
 * - **Provider** is the AE.2 monogram — the same component mockup 07's cards draw, at its
 *   smaller size — beside the connection's name; *no provider* in the faint ink on the
 *   unbound row.
 * - **Model** is the raw id in mono, the only place in the product one renders (decision
 *   **M1**).
 * - **Params** are the server's chips (CH.2), `—` when there are none. No client-side
 *   derivation.
 * - **Health** carries an action. `✗ no key — connect a provider` with **Fix in Providers →**
 *   inside a table cell is unusual, and it is the entire reason the orphan row reads as
 *   deliberate rather than broken. The row is dimmed; this cell is exempt.
 * - **$ per 1M in·out** prints what CH.3 resolved and never re-derives; the provenance is on
 *   hover so the number is auditable.
 * - **Used by** is `N routes`; clicking it selects the row, so the inspector answers *which
 *   ones*.
 * - **On** is CH.1's switch, asking first when it would drop hops.
 *
 * ### The one Client Component on this page below the head, and why
 *
 * Selection is a keystroke, and a keystroke that cost a server round trip would make arrowing
 * down eight rows eight fetches of a table nobody changed. So the selection lives here, in
 * state — and it is **reflected into the URL** with `history.replaceState` rather than with
 * `router.replace`, for the reason `app/models/routing-matrix.tsx` gives at length: the
 * address bar is a *record* of the selection, not the thing driving it, and **Back** must keep
 * meaning *the page I came from*. The parameter is `app/paths.ts`'s `ALIAS_PARAM`, which the
 * provider card's *not listed upstream* flag already writes, and the initial value is read
 * server-side out of it (`app/(app)/models/registry/page.tsx`) so the right row is selected on
 * the first paint.
 *
 * The one thing that *does* drive the selection from outside is a navigation, and since CI.4
 * ([#594](https://github.com/NobuData/ouroboros/issues/594)) there is one: creating an alias
 * lands the page on `?alias=<the new name>`, so the row that was just made is the selected one
 * and the inspector's seat is already open on it. The state below is what adopts it.
 *
 * The seat beneath the table is CI.3's ([#593](https://github.com/NobuData/ouroboros/issues/593))
 * to fill. What it already does is follow the selection — its title is the mockup's
 * `EDIT — CODER-MAX` for the selected row — which is the wiring the inspector builds on, and
 * what its body says is which issues fill it rather than a mock-up of fields.
 */

/** What the table takes. */
export interface RegistryTableProps {
  /** The rows, already decided, in the order the service sends them. */
  readonly rows: readonly TableRow[];
  /**
   * The row the URL asked for, validated against the rows by `selectedAlias`, or `null`.
   *
   * The selection this component then owns — it reflects its own moves back into the address
   * bar without navigating, so this prop does not change for them. It **does** change when
   * something navigates, which since CI.4 is the create dialog landing on the row it made, and
   * a changed value is adopted (see the state below).
   */
  readonly selected: string | null;
  /** Whether this reader may press the switches. */
  readonly mayAdminister: boolean;
}

/** The id the table card's `aria-labelledby` points at. */
const TABLE_TITLE_ID = "registry-table-title";

/**
 * The modifier each health tone adds. Every tone has one — a cell never falls back to
 * another's hue — and the names are written out so the sheet's own suite can find each of
 * them rendered.
 */
const HEALTH_TONE_CLASS: Record<HealthTone, string> = {
  ok: "registry-table__health-cell--ok",
  warn: "registry-table__health-cell--warn",
  err: "registry-table__health-cell--err",
};

/** The id the inspector card's `aria-labelledby` points at. */
const INSPECTOR_TITLE_ID = "registry-inspector-title";

/**
 * The columns, in the order mockup 21 draws them.
 *
 * Built where they are used because the switch column closes over `mayAdminister`; the other
 * seven close over nothing and are the same array across renders through `useMemo`, so the
 * table has one column-array identity to diff on every arrow key.
 *
 * The **alias column comes first for a reason beyond the mockup**: the row is the focused
 * element while the selection moves, so what a screen reader reads out is the row's own cells
 * in order — and the first thing a reader arrowing down this table needs to hear is which
 * alias they have landed on.
 *
 * @param mayAdminister Whether the switches may be pressed.
 * @returns The eight columns.
 */
function columns(mayAdminister: boolean): readonly Column<TableRow>[] {
  return [
    {
      key: "alias",
      header: "Alias",
      className: "registry-table__alias",
      cell: (row) => (
        <Chip mono tone="accent">
          {row.alias}
        </Chip>
      ),
    },
    {
      key: "provider",
      header: "Provider",
      className: "registry-table__provider",
      cell: (row) =>
        row.provider === null ? (
          <span className="registry-table__none">{NO_PROVIDER}</span>
        ) : (
          <span className="registry-table__provider-cell">
            <ProviderMonogram monogram={row.provider.monogram} size="cell" />
            {row.provider.name}
          </span>
        ),
    },
    {
      key: "model",
      header: "Model",
      mono: true,
      className: "registry-table__model",
      cell: (row) => row.modelId,
    },
    {
      key: "params",
      header: "Params",
      className: "registry-table__params",
      cell: (row) =>
        row.chips.length === 0 ? (
          <span className="registry-table__none">{EM_DASH}</span>
        ) : (
          <span className="registry-table__chips">
            {row.chips.map((chip) => (
              <Tag key={chip}>{chip}</Tag>
            ))}
          </span>
        ),
    },
    {
      key: "health",
      header: "Health",
      className: "registry-table__health",
      cell: (row) => <HealthCellView cell={row.health} />,
    },
    {
      key: "price",
      header: "$ per 1M in·out",
      align: "end",
      mono: true,
      className: "registry-table__num",
      cell: (row) => (
        // The provenance is the hover — `bundled@…` or `org override` — so the figure is
        // auditable without a column for it. A price that does not exist has none.
        <span title={row.price.provenance ?? undefined}>{row.price.display}</span>
      ),
    },
    {
      key: "used",
      header: "Used by",
      align: "end",
      mono: true,
      className: "registry-table__num",
      cell: (row) => row.usedBy,
    },
    {
      key: "on",
      header: "On",
      className: "registry-table__switch",
      cell: (row) => <AliasSwitch mayAdminister={mayAdminister} row={row} />,
    },
  ];
}

/**
 * The health cell: the dot, the word, the note where it adds something, and — where the
 * server said there is somewhere to go — the **Fix in Providers →** button.
 *
 * The dot is `aria-hidden`: it repeats in shape and hue what the label says in words. The
 * button navigates, so it is the primitive's link form, to the page the app spells as
 * `PROVIDERS_PATH` — the server's `fix` is the *trigger*, and the route is the application's
 * to spell, in the one file every in-app route is written down in.
 *
 * @param props.cell The decided cell.
 * @returns The cell.
 */
function HealthCellView({ cell }: Readonly<{ cell: HealthCell }>) {
  return (
    <>
      <span className={cx("registry-table__health-cell", HEALTH_TONE_CLASS[cell.tone])}>
        <span
          aria-hidden="true"
          className={cx("registry-table__dot", cell.dot === "ring" && "registry-table__dot--ring")}
        />
        <span className="registry-table__state">{cell.label}</span>
        {cell.detail !== null && <span className="registry-table__detail">{cell.detail}</span>}
      </span>
      {cell.fix && (
        <Button className="registry-table__fix" href={PROVIDERS_PATH} size="sm" tone="ghost">
          {FIX_IN_PROVIDERS}
        </Button>
      )}
    </>
  );
}

/**
 * The table and the seat.
 *
 * @param props See {@link RegistryTableProps}.
 * @returns The table card, the announcement, and the inspector's seat.
 */
export function RegistryTable({ rows, selected: initial, mayAdminister }: RegistryTableProps) {
  /**
   * The selection, and the prop it was last adopted from.
   *
   * The pair is what makes *reflected into the URL* and *driven by the URL* coexist. Ordinarily
   * the table owns the selection and only writes it out (`reflect`, below), so a changed prop
   * would be the selection this component just caused and must not be re-applied. But CI.4's
   * create dialog ([#594](https://github.com/NobuData/ouroboros/issues/594)) **navigates** to
   * `?alias=<the new name>` so the row it just made is selected — a selection this table did not
   * make — and a `useState` initialiser is read once and never again.
   *
   * So the requested value is held beside the chosen one and compared during render: React's own
   * *adjusting state when a prop changes* pattern, which re-renders before anything is painted
   * rather than after, as an effect would.
   */
  const [selection, setSelection] = useState({ requested: initial, alias: initial });

  if (selection.requested !== initial) setSelection({ requested: initial, alias: initial });

  const selected = selection.alias;

  const select = useCallback((alias: string) => {
    // The requested value moves with it, so the row the reader just picked is not undone by the
    // next render comparing it against a prop that has not caught up.
    setSelection((held) => ({ requested: held.requested, alias }));
    reflect(alias);
  }, []);

  const cols = useMemo(() => columns(mayAdminister), [mayAdminister]);
  const row = rows.find((candidate) => candidate.alias === selected) ?? null;

  return (
    <>
      <Card aria-labelledby={TABLE_TITLE_ID} as="section" fill>
        <CardHead
          beside={<Tag>{aliasCount(rows.length)}</Tag>}
          title={TABLE_TITLE}
          titleId={TABLE_TITLE_ID}
          trailing={
            <Link className="registry-table__link" href={PROVIDERS_PATH}>
              {MANAGE_PROVIDERS}
            </Link>
          }
        />

        <Table
          caption={TABLE_CAPTION}
          captionHidden
          columns={cols}
          rowClassName={(candidate) => candidate.dim && "registry-table__row--dim"}
          rowKey={(candidate) => candidate.alias}
          rows={rows}
          selection={{ selected, onSelect: select, tone: "accent" }}
        />

        <p className="registry-table__caption">{TABLE_NOTE}</p>

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

      <div className="registry-aside">
        <InspectorSeat row={row} />
      </div>
    </>
  );
}

/**
 * Mockup 21's **EDIT — CODER-MAX** card's seat: titled for the selected alias, with its pill
 * beside the title as the mockup draws it, and — until CI.3 fills it — an empty state naming
 * what fills it.
 *
 * Exported so the screen can draw the same seat when there is no table to select from (a
 * refused or empty read), and the page keeps one shape across its states.
 *
 * @param props.row The selected row, or `null` when none is.
 * @returns The card.
 */
export function InspectorSeat({ row }: Readonly<{ row: TableRow | null }>) {
  return (
    <Card aria-labelledby={INSPECTOR_TITLE_ID} as="section" fill>
      <CardHead
        beside={
          row === null ? undefined : (
            <Chip mono tone="accent">
              {row.alias}
            </Chip>
          )
        }
        title={inspectorTitle(row?.alias ?? null)}
        titleId={INSPECTOR_TITLE_ID}
      />
      <EmptyState fill note={INSPECTOR_NEXT_NOTE} title={INSPECTOR_NEXT_TITLE} />
    </Card>
  );
}

/**
 * Write the selection into the address bar, without navigating.
 *
 * The native history API rather than the router, deliberately — the module note says why.
 * The path and hash are preserved and only the one parameter is set, so a URL carrying
 * anything else survives a selection.
 *
 * @param alias The selected alias.
 * @returns Nothing.
 */
function reflect(alias: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(ALIAS_PARAM, alias);

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
