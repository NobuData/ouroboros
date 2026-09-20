"use client";

import { useCallback, useMemo, useState } from "react";

import { Button, Card, CardHead, Chip, type Column, EmptyState, Table, Tag } from "@/app/ui";

import { useFarm } from "./farm-store";
import { JobSheet } from "./job-sheet";
import {
  RunnerActionsCell,
  RunnerCpuCell,
  RunnerJobCell,
  RunnerNameCell,
  RunnerStatusCell,
} from "./runner-cells";
import {
  GROUP_BY_STATUS,
  HEALTH_HISTORY,
  HEALTH_HISTORY_SOON,
  NO_RUNNERS_NOTE,
  NO_RUNNERS_TITLE,
  RUNNERS_CAPTION,
  RUNNERS_TITLE,
  RUNNERS_UNREAD_TITLE,
  RUNNER_COLUMNS,
  type RunnerGrouping,
  type RunnerRow,
  buildingPill,
  rowAnnouncement,
  runnerRows,
} from "./runners";
import { useFarmSelection } from "./selection-store";
import { SOON_MARK } from "./view";

/**
 * The build farm's runners table — mockup 08's `RUNNERS` card, live
 * (AI.2, [#257](https://github.com/NobuData/ouroboros/issues/257)).
 *
 * It reads the farm's one store (`app/farm/farm-store.tsx`), so the rows and the `4/5` tile above
 * them are one answer, and it moves with every poll. What each cell says is `runners.ts`'s; this
 * assembles the card, holds the state a reader owns — how the fleet is grouped and which job
 * sheet is open; *which row is current* is `app/farm/selection-store.tsx`'s, because the live log
 * card (AI.6, #261) reads it too — and decides nothing else.
 *
 * ### The row is a persistent thing whose numbers change
 *
 * Rows are keyed by the runner's id and the default order is *pool, then name* — facts that do
 * not move on a heartbeat — so a poll never reorders, remounts or replaces a row: it changes a
 * text node here and a meter's custom property there, and the meter's fill eases to its new
 * width (`app/ui/ui.css`, inside the reduced-motion guard). The cells are memoised over
 * primitives (`app/farm/runner-cells.tsx`), so React leaves an unchanged row alone too.
 * **Group by status** is the reader's opt-in to the one ordering that *does* move rows.
 *
 * ### Keyboard
 *
 * The table is the design system's selectable grid (`app/ui/table.tsx`): one tab stop, then
 * `↑` `↓` `Home` `End` between rows. The row is the focused element when it moves, so a screen
 * reader reads its cells; the status region under the table says the same for a pointer, which
 * moves no focus. Nothing is selected on arrival, and a selection naming a runner that has left
 * the fleet is dropped — otherwise no row would hold the tab stop and the table would be
 * unreachable.
 *
 * ### What cannot act yet says so
 *
 * `Health history →` is AJ.4 (#266) and each row's `⋯` is AI.5 (#260): both are inert *soon*
 * controls whose tooltips name the issue, and neither navigates anywhere. The current-job cell
 * opens the job sheet until the run console (#309) exists (`app/farm/job-sheet.tsx`).
 *
 * @returns The card, as a direct child of the farm's grid.
 */
export function RunnersCard() {
  const { page, dataAt } = useFarm();
  const [grouping, setGrouping] = useState<RunnerGrouping>("pool");
  // Held above the card since #261: the live log card follows the selected runner's build.
  const { runnerId: selectedId, select: setSelectedId } = useFarmSelection();
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  const rows = useMemo(() => runnerRows(page, dataAt, grouping), [page, dataAt, grouping]);

  // A selection outlives the row it names when a runner is removed; the table must never be
  // handed a key no row carries (see the module note's *Keyboard*).
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  // The sheet is held by the *job*, not by the runner: when the build ends — or the machine moves
  // on to the next one — no row carries it any more and the sheet closes, rather than quietly
  // becoming a sheet about a different build.
  const jobRow = rows.find((row) => row.jobId !== null && row.jobId === openJobId) ?? null;

  const openJob = useCallback((jobId: string) => setOpenJobId(jobId), []);
  const closeJob = useCallback(() => setOpenJobId(null), []);
  const columns = useMemo(() => runnerColumns(openJob), [openJob]);
  const building = buildingPill(rows);

  return (
    <Card aria-labelledby={TITLE_ID} as="section" className="farm-col--8" fill>
      <CardHead
        beside={
          building === null ? undefined : (
            <Chip dot="pulse" tone="accent">
              {building}
            </Chip>
          )
        }
        title={RUNNERS_TITLE}
        titleId={TITLE_ID}
        trailing={
          <span className="farm-runners__tools">
            <Button
              aria-pressed={grouping === "status"}
              className="farm-runners__group"
              onClick={() => setGrouping(grouping === "status" ? "pool" : "status")}
              size="sm"
              tone="ghost"
            >
              {GROUP_BY_STATUS}
              {/* The issues filter's `bug ✓` — the mark repeats what `aria-pressed` already says. */}
              {grouping === "status" && <span aria-hidden="true"> ✓</span>}
            </Button>
            <Button reason={HEALTH_HISTORY_SOON} size="sm" tone="ghost">
              {HEALTH_HISTORY} <span className="farm__soon">{SOON_MARK}</span>
            </Button>
          </span>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          fill
          note={page === null ? undefined : NO_RUNNERS_NOTE}
          title={page === null ? RUNNERS_UNREAD_TITLE : NO_RUNNERS_TITLE}
        />
      ) : (
        <Table
          caption={RUNNERS_CAPTION}
          captionHidden
          className="farm-runners"
          columns={columns}
          rowClassName={(row) => row.dim && "farm-runners__row--dim"}
          rowKey={(row) => row.id}
          rows={rows}
          selection={{ selected: selected?.id ?? null, onSelect: setSelectedId, tone: "accent" }}
        />
      )}

      {/*
        Where the current row is said out loud. `role="status"` rather than an alert: moving
        between rows is what the reader asked for — and it is the half of *announced* that focus
        alone does not cover, since a pointer selection moves no focus at all.
      */}
      <p className="sr-only" role="status">
        {selected === null ? "" : rowAnnouncement(selected)}
      </p>

      <JobSheet nowMs={dataAt ?? 0} onClose={closeJob} row={jobRow} />
    </Card>
  );
}

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "runners-card-title";

/**
 * The table's nine columns, in the mockup's order.
 *
 * Every cell hands its component primitives off the flat row, which is what lets the memo in
 * `app/farm/runner-cells.tsx` hold; RAM, queue and uptime are a string each and need no
 * component at all. The widths are placement, declared here the way the mockup declares its
 * own (`<th style="width:110px">`).
 *
 * @param openJob Opens the job sheet for a job, by its id. Identity-stable.
 * @returns The columns.
 */
function runnerColumns(openJob: (jobId: string) => void): readonly Column<RunnerRow>[] {
  return [
    {
      key: "runner",
      header: RUNNER_COLUMNS.runner,
      cell: (row) => <RunnerNameCell arch={row.arch} degraded={row.degraded} name={row.name} />,
    },
    { key: "pool", header: RUNNER_COLUMNS.pool, cell: (row) => <Tag>{row.pool}</Tag> },
    {
      key: "status",
      header: RUNNER_COLUMNS.status,
      cell: (row) => <RunnerStatusCell lastSeen={row.lastSeen} status={row.status} />,
    },
    {
      key: "job",
      header: RUNNER_COLUMNS.job,
      cell: (row) => (
        <RunnerJobCell
          jobId={row.jobId}
          note={row.jobNote}
          number={row.jobNumber}
          onOpen={openJob}
          title={row.jobTitle}
        />
      ),
    },
    {
      key: "cpu",
      header: RUNNER_COLUMNS.cpu,
      className: "farm-runners__col--cpu",
      cell: (row) => <RunnerCpuCell meter={row.cpuMeter} text={row.cpu} tone={row.cpuTone} />,
    },
    { key: "ram", header: RUNNER_COLUMNS.ram, align: "end", mono: true, cell: (row) => row.ram },
    {
      key: "queue",
      header: RUNNER_COLUMNS.queue,
      align: "end",
      cell: (row) => <span className="farm-runners__queue">{row.queue}</span>,
    },
    {
      key: "uptime",
      header: RUNNER_COLUMNS.uptime,
      align: "end",
      mono: true,
      cell: (row) => row.uptime,
    },
    {
      key: "actions",
      // The mockup's last heading is empty; a column with no name is one a reader moving by
      // column header cannot place, so it has one and it is not drawn.
      header: <span className="sr-only">{RUNNER_COLUMNS.actions}</span>,
      cell: (row) => <RunnerActionsCell name={row.name} />,
    },
  ];
}
