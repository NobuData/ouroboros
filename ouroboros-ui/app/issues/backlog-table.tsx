"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { BacklogListing } from "@/app/api/backlog";
import type { Reading } from "@/app/api/reading";
import {
  Card,
  CardHead,
  Chip,
  type Column,
  EffortChip,
  EmptyState,
  Table,
  type TableMultiSelection,
  Tag,
} from "@/app/ui";

import { type BacklogPollOptions, backlogUrl } from "./backlog-poll";
import { type BacklogFilter, isFiltered } from "./filter";
import { FreshnessTag } from "./freshness-tag";
import { syncBacklog } from "./head-actions";
import { HeadOutcomeLine } from "./head-outcome";
import { PageFooter } from "./page-footer";
import { PAST_END, isPaged, pagination } from "./paging";
import { useIssueSelection } from "./selection";
import {
  BACKLOG_UNREAD,
  type BacklogStatus,
  COLUMN_HEADERS,
  NOTHING_MIRRORED,
  NOTHING_MIRRORED_NOTE,
  NO_MATCHES,
  NO_MATCHES_NOTE,
  REFRESH_FAILED,
  SELECT_ALL_LABEL,
  SIZING,
  STATUS_LABEL,
  STATUS_TONE,
  SYNC_ROLE_REASON,
  TABLE_CAPTION,
  TABLE_TITLE,
  type TableRow,
  UNESTIMATED,
  coverage,
  emptyKind,
  selectLabel,
  statusChanges,
  tableRows,
} from "./table";
import { useBacklogPoll } from "./use-backlog-poll";
import type { HeadOutcome } from "./view";

/**
 * Mockup 03's `BACKLOG · AS OUROBOROS SEES IT` card — the page's core
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)): the dense rows, the checkbox
 * column, the freshness tag, and the live statuses.
 *
 * ### The rows are the last answer, and the first is the server's
 *
 * The route reads one page for the first paint (`app/issues/data.ts`); from then on
 * {@link useBacklogPoll} asks `app/api/backlog/route.ts` for the same address on the DASH-I.8
 * cadence, and what this draws is the latest listing there is — the poll's once it has one,
 * the server's until then. That is what makes *`estimating…` rows flip to `sized` within one
 * poll of pipeline completion* a property of the page rather than of a reload, and the pill
 * that changed says so: it is keyed on its status, so a change remounts it, and a row that has
 * been seen to change carries the attribute the sheet animates ({@link statusChanges}).
 *
 * ### Two selections, one store
 *
 * The checkboxes write `app/issues/selection.tsx`'s store, which the head's **Queue N
 * selected ⟳** and the selection bar ([#118](https://github.com/NobuData/ouroboros/issues/118))
 * read: `toggle` per row, `select`/`deselect` over the page for the header's box. The store is
 * above the route's re-renders, so a chip press or a page turn redraws the rows and the
 * selection stays — including ids no longer on the page, which is what *survives filter
 * changes* means. The header's box reports the *page's* coverage — checked when every row on
 * it is selected, indeterminate when some are — and the checked rows wear the mockup's `tr.sel`
 * through the primitive's own accent selection.
 *
 * Every listing drawn is also published to the store's `seen` rows, which is how the bar can
 * sum an estimate over ids that are no longer on the page (`app/issues/seen-rows.ts`).
 *
 * A row's click, or `Enter` on it, is the other state: it opens the issue's detail, which is
 * `inspect` on the same store and N.5's panel ([#119](https://github.com/NobuData/ouroboros/issues/119))
 * to draw. The row whose detail is open lights its number in the accent — a quiet mark, distinct
 * from the check glow, since the mockup's `#485` is both and nothing in it draws the second
 * state alone. `Space` checks. The primitive's `TableMultiSelection` is where the three verbs
 * are kept apart.
 *
 * ### It scrolls inside its own wrapper
 *
 * The ticket's shell line asks for both a wrapper the table scrolls inside and a sticky
 * header, and `app/ui/table.tsx`'s recipe makes the two exclusive: a sticky head opens the
 * wrapper and hands the pane a table that must fit the measure. The acceptance criterion names
 * the wrapper — *the table scrolls within its own wrapper; the page body never scrolls
 * horizontally* — so the wrapper it is, and a six-column table with a title measure keeps the
 * head close enough to any row that the trade costs little.
 *
 * @param props.listing The page the route read, or why it could not.
 * @param props.filter The filter the address carries.
 * @param props.page The page the address carries.
 * @param props.readAt When the route read it, in milliseconds since the epoch.
 * @param props.mayContribute Whether this reader may sync — every role but `viewer`.
 * @param props.poll Test seams for the poll; production passes none.
 * @returns The card.
 */
export function BacklogTable({
  listing,
  filter,
  page,
  readAt,
  mayContribute,
  poll,
}: Readonly<{
  listing: Reading<BacklogListing>;
  filter: BacklogFilter;
  page: number;
  readAt: number;
  mayContribute: boolean;
  poll?: BacklogPollOptions;
}>) {
  const { snapshot, refresh } = useBacklogPoll(backlogUrl(filter, page), poll);

  /** The listing on screen: the poll's latest, else what the server rendered for this address. */
  const shown = snapshot.data ?? (listing.ok ? listing.value : null);
  const rows = useMemo(() => (shown === null ? [] : tableRows(shown.items)), [shown]);

  /**
   * Which pills have changed since they were first drawn. Adjusted during render, guarded on
   * the rows' identity — the pattern the filter bar keeps for its search box — so the pill that
   * changed is animated on the very render that changes it.
   */
  const [changes, setChanges] = useState(() => ({
    rows,
    ...statusChanges(new Map<string, BacklogStatus>(), rows, new Set<string>()),
  }));
  if (changes.rows !== rows) {
    setChanges({ rows, ...statusChanges(changes.seen, rows, changes.swapped) });
  }

  const { ids, toggle, select, deselect, detail, inspect, seen } = useIssueSelection();
  const [current, setCurrent] = useState<string | null>(null);

  // The rows are a fact the poll delivers, and the store is the bar's; publishing after the
  // commit is what keeps the two from racing, and the store itself decides whether anything
  // changed.
  useEffect(() => {
    seen.publish(rows);
  }, [seen, rows]);
  const checked = useMemo(() => new Set(ids), [ids]);
  const visible = useMemo(() => rows.map((row) => row.id), [rows]);
  const cover = coverage(visible, ids);

  const selection = useMemo<TableMultiSelection>(
    () => ({
      kind: "multi",
      selected: checked,
      current,
      onCurrent: setCurrent,
      onToggle: toggle,
      onActivate: inspect,
      tone: "accent",
    }),
    [checked, current, toggle, inspect],
  );

  /** The header's box: every row on the page, or none of them. */
  const toggleAll = useCallback(() => {
    if (cover === "all") deselect(visible);
    else select(visible);
  }, [cover, visible, select, deselect]);

  const columns = useMemo(
    () => tableColumns(cover, toggleAll, toggle, checked, changes.swapped),
    [cover, toggleAll, toggle, checked, changes.swapped],
  );

  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<HeadOutcome | null>(null);

  /** Press the freshness tag: ask for a sync, report what came back, and ask the poll now. */
  async function sync(): Promise<void> {
    if (pending) return;

    setPending(true);
    setOutcome(null);

    try {
      const result = await syncBacklog();
      setOutcome(result);
      if (result.ok) refresh();
    } finally {
      setPending(false);
    }
  }

  const paging =
    shown === null
      ? null
      : pagination({ shown: rows.length, total: shown.total, offset: shown.offset }, page);

  return (
    <Card aria-labelledby={TITLE_ID} as="section">
      <CardHead
        title={TABLE_TITLE}
        titleId={TITLE_ID}
        trailing={
          <div className="issues__action">
            <FreshnessTag
              onPress={() => void sync()}
              pending={pending}
              readAtSeconds={Math.floor(readAt / 1000)}
              reason={mayContribute ? undefined : SYNC_ROLE_REASON}
              syncedAt={shown?.meta.syncedAt ?? null}
            />
            <HeadOutcomeLine outcome={outcome} />
          </div>
        }
      />

      {shown === null ? (
        <EmptyState note={listing.ok ? undefined : listing.reason} title={BACKLOG_UNREAD} />
      ) : rows.length === 0 ? (
        <EmptyPage
          filtered={isFiltered(filter)}
          listing={shown}
          pastEnd={paging?.pastEnd ?? false}
        />
      ) : (
        <Table
          caption={TABLE_CAPTION}
          captionHidden
          columns={columns}
          rowClassName={(row) => row.id === detail && "issues-table__row--inspected"}
          rowKey={(row) => row.id}
          rows={rows}
          selection={selection}
        />
      )}

      {snapshot.error !== null && (
        <p className="issues-table__unread" role="status">
          {REFRESH_FAILED} {snapshot.error}
        </p>
      )}

      {shown !== null && paging !== null && isPaged(paging, shown.total) && (
        <PageFooter filter={filter} pagination={paging} />
      )}
    </Card>
  );
}

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "backlog-table-title";

/**
 * What the card draws instead of rows.
 *
 * Three facts that must not read alike: the address asked for a page the backlog has run out
 * of, the filter matched nothing, and the workspace mirrors nothing. The way back from the
 * first is the footer's link, drawn beneath this.
 *
 * @param props.listing The page's listing.
 * @param props.filtered Whether anything differs from the default view.
 * @param props.pastEnd Whether the page is past the end of the backlog.
 * @returns The empty state.
 */
function EmptyPage({
  listing,
  filtered,
  pastEnd,
}: Readonly<{ listing: BacklogListing; filtered: boolean; pastEnd: boolean }>) {
  if (pastEnd) return <EmptyState title={PAST_END} />;

  return emptyKind(listing, filtered) === "matches" ? (
    <EmptyState note={NO_MATCHES_NOTE} title={NO_MATCHES} />
  ) : (
    <EmptyState note={NOTHING_MIRRORED_NOTE} title={NOTHING_MIRRORED} />
  );
}

/**
 * The six columns, in the mockup's order: the checkbox, then the five the mockup heads.
 *
 * Built where they are used because four of them close over the selection; the descriptions
 * are the same shape every render, and `useMemo` above keeps one identity per change.
 *
 * @param cover How much of the page the selection covers — the header's box.
 * @param toggleAll What the header's box does.
 * @param toggle What a row's box does.
 * @param checked Which rows are checked.
 * @param swapped Which rows have been seen to change status — the pills to animate.
 * @returns The columns.
 */
function tableColumns(
  cover: ReturnType<typeof coverage>,
  toggleAll: () => void,
  toggle: (id: string) => void,
  checked: ReadonlySet<string>,
  swapped: ReadonlySet<string>,
): readonly Column<TableRow>[] {
  return [
    {
      key: "check",
      header: (
        <input
          aria-label={SELECT_ALL_LABEL}
          checked={cover === "all"}
          className="issues-table__ckbox"
          onChange={toggleAll}
          // `indeterminate` is a property rather than an attribute, so it is set on the node.
          ref={(node) => {
            if (node !== null) node.indeterminate = cover === "some";
          }}
          type="checkbox"
        />
      ),
      className: "issues-table__check",
      cell: (row) => (
        // Out of the tab order, as every control inside a row is (`app/ui/table.tsx`): the row
        // is the stop, and `Space` on it is what checks it. A pointer still reaches the box.
        <input
          aria-label={selectLabel(row.number)}
          checked={checked.has(row.id)}
          className="issues-table__ckbox"
          onChange={() => toggle(row.id)}
          tabIndex={-1}
          type="checkbox"
        />
      ),
    },
    {
      key: "issue",
      header: COLUMN_HEADERS.issue,
      className: "issues-table__issue",
      cell: (row) => (
        <>
          <span className="issues-table__number">{`#${row.number}`}</span>
          {/*
            A real space between the number and the title, so a screen reader does not read
            "#485Watchdog reset…" as one word — the mockup's own `&nbsp;`, in the one form that
            survives both layouts, and the same treatment the dashboard's tables give their
            issue cells.
          */}{" "}
          <span className="issues-table__title">{row.title}</span>
          {row.labels.length > 0 && (
            <div className="issues-table__tags">
              {row.labels.map((label) => (
                <Tag key={label}>{label}</Tag>
              ))}
            </div>
          )}
        </>
      ),
    },
    {
      key: "effort",
      header: COLUMN_HEADERS.effort,
      cell: (row) =>
        row.effort === null ? (
          <span className="issues-table__sizing">{SIZING}</span>
        ) : (
          <span className="issues-table__effort">
            <EffortChip effort={row.effort} />
            <span className="issues-table__conf">{row.confidence}</span>
          </span>
        ),
    },
    {
      key: "workflow",
      header: COLUMN_HEADERS.workflow,
      cell: (row) =>
        row.workflow === null ? (
          <span className="issues-table__none">{UNESTIMATED}</span>
        ) : (
          <Tag>{row.workflow}</Tag>
        ),
    },
    {
      key: "model",
      header: COLUMN_HEADERS.model,
      cell: (row) =>
        row.model === null ? (
          <span className="issues-table__none">{UNESTIMATED}</span>
        ) : (
          <Chip mono tone="model">
            {row.model}
          </Chip>
        ),
    },
    {
      key: "status",
      header: COLUMN_HEADERS.status,
      cell: (row) => (
        // Keyed on the status, so a change is a remount and the sheet's entry animation plays
        // — only on a row that has been seen to change, which is what the attribute says.
        <span
          key={row.status}
          className="issues-table__status"
          data-swapped={swapped.has(row.id) ? "" : undefined}
        >
          <Chip tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Chip>
        </span>
      ),
    },
  ];
}
