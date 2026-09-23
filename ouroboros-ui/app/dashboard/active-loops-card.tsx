import Link from "next/link";

import type { Dashboard, RunStatus } from "@/app/api/dashboard";
import { runPath } from "@/app/paths";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import { RUN_STATUS_LABEL } from "@/app/runs/view";
import {
  Button,
  Card,
  CardHead,
  Chip,
  type ChipTone,
  type Column,
  EmptyState,
  Meter,
  type MeterTone,
  Table,
  Tag,
} from "@/app/ui";

import { Elapsed } from "./elapsed";
import { type ActiveLoop, NO_VALUE, type Reading, activeLoops, moreActiveLoops } from "./view";

/**
 * *Active loops* ([#82](https://github.com/NobuData/ouroboros/issues/82)) — the mockup's `c-8`
 * table, and the card this page is really about.
 *
 * Everything else on the dashboard is a measurement of the last day or the last week. This is
 * the present tense: six columns, two of them moving, over the aggregate's `activeRuns`.
 *
 * ### Every column is a different way of not interpreting the data
 *
 * The run summary is deliberately shallow — a workflow tag is free text, a model identifier is
 * an opaque string (decision F8), a stage label is whatever word the workflow uses — and this
 * card is where that restraint has to hold, because it is the card with the most room to
 * invent. So: the tag is drawn, not looked up; the model is drawn, not parsed into a vendor
 * and a version; the stage caption is the run's own word beside its own count. The only
 * derived figure in the table is the meter's width, and it rounds *down*
 * (`stagePercent`) so the bar can never claim work that has not finished.
 *
 ### Where a row leads
 *
 * **The issue cell links to the run's console** (`/runs/:id`, AQ.1
 * [#309](https://github.com/NobuData/ouroboros/issues/309)), carrying `?from=dashboard` so the
 * sidebar keeps **Dashboard** lit on a surface that has no entry of its own. The *Open run
 * console* head link and the *+N more* footer name the full list of runs rather than one run,
 * and that list is still unbuilt — so they stay inert {@link Button}s with their reason in the
 * tooltip, which keeps the explanation in the tab order where a dropped link would take it out.
 *
 * @param props.aggregate The dashboard aggregate, or why it could not be read.
 * @param props.readAt When the page was read, in milliseconds since the epoch — one instant
 *   for the whole render, so no two rows are measured against two different nows.
 * @returns The card.
 */
export function ActiveLoopsCard({
  aggregate,
  readAt,
}: Readonly<{ aggregate: Reading<Dashboard>; readAt: number }>) {
  const rows = aggregate.ok ? activeLoops(aggregate.value.activeRuns, readAt) : [];
  const more = aggregate.ok
    ? moreActiveLoops(aggregate.value.stats.loopsLive.total, rows.length)
    : 0;

  return (
    <Card as="section" fill className="dash-col--8" aria-labelledby={TITLE_ID}>
      <CardHead
        title={TITLE}
        titleId={TITLE_ID}
        // Only when something is actually running. A *live* pill over an empty table would be
        // the card's one-word summary contradicting the six columns underneath it.
        beside={
          rows.length > 0 ? (
            <Chip tone="accent" dot="pulse">
              live
            </Chip>
          ) : undefined
        }
        trailing={
          <Button size="sm" tone="ghost" reason={RUN_CONSOLE_SOON}>
            Open run console →
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState fill {...emptyPanel(aggregate)} />
      ) : (
        <>
          <Table
            caption={CAPTION}
            captionHidden
            className="dash-runs"
            columns={COLUMNS}
            rows={rows}
            rowKey={(run) => run.id}
          />
          {more > 0 && (
            <p className="dash-runs__more">
              <Button size="sm" tone="ghost" reason={ALL_RUNS_SOON}>
                {`+${more} more running →`}
              </Button>
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** What the card is called, as the mockup titles it. */
const TITLE = "Active loops";

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "dash-active-loops-title";

/**
 * The table's own name, for a reader moving between the page's tables by landmark.
 *
 * Hidden, because the card's heading is directly above it and a visible second title would
 * say the same thing twice — but present, because a heading outside a table is not the
 * table's accessible name.
 */
const CAPTION = "Loops running right now";

/** Why *Open run console* cannot act yet — it names the list of runs, not one run. */
const RUN_CONSOLE_SOON =
  "The list of every run is not built yet — #71 serves it and #49 holds its route. Open a " +
  "loop's issue to see its run console.";

/** Why *+N more* cannot act yet. */
const ALL_RUNS_SOON =
  "The full list of runs is not built yet — #71 answers it and #49 holds the route it will " +
  "be drawn on.";

/** What the card says when the workspace has nothing running. */
const NOTHING_RUNNING = "Nothing is running right now";

/**
 * The note under {@link NOTHING_RUNNING} — what would put a row here.
 *
 * It says what starts a loop rather than apologising for the emptiness, because this state is
 * the ordinary one for a workspace between runs rather than a failure or a surface that is
 * not ready. [#86](https://github.com/NobuData/ouroboros/issues/86) is where every card's
 * empty and failed states are designed together.
 */
const NOTHING_RUNNING_NOTE =
  "Loops appear here the moment Ouroboros picks an issue up, and stay until they merge or " +
  "stop for a person.";

/**
 * What the card says when the aggregate was refused.
 *
 * It names *what* could not be read and stops there. **Why** is the page banner's, once
 * (`app/dashboard/stale-banner.tsx`) — before
 * [#86](https://github.com/NobuData/ouroboros/issues/86) the service's sentence was repeated
 * here and in eight other places on one page, which reads as nine problems rather than one
 * and buries the single retry that would fix them.
 */
const LOOPS_NOT_READ = "The loops could not be read";

/**
 * What to draw in place of the table.
 *
 * The two reasons a table has no rows are not the same fact and must not read alike: a
 * workspace with nothing running has been asked and answered, and an aggregate that was
 * refused has not been asked at all. That is the same rule the stat row's em dash is written
 * under.
 *
 * @param aggregate The dashboard aggregate, or why it could not be read.
 * @returns The empty state's heading and note.
 */
function emptyPanel(
  aggregate: Reading<Dashboard>,
): Readonly<{ title: string; note?: string }> {
  return aggregate.ok
    ? { title: NOTHING_RUNNING, note: NOTHING_RUNNING_NOTE }
    : { title: LOOPS_NOT_READ };
}

/**
 * The hue each status takes in the *Status* column — the mockup's `pill run`, `pill warn` and
 * `pill ok`, in that order.
 *
 * The four terminal statuses are here as well although this table cannot show one — a
 * terminal run has a `finishedAt` and is in the *Recently closed* card by definition — so
 * that a run arriving in the wrong slice is drawn in a hue that suits it rather than as an
 * accented "live" pill saying `failed`.
 */
const STATUS_TONE: Record<RunStatus, ChipTone> = {
  coding: "accent",
  building: "warn",
  review: "ok",
  merged: "ok",
  needs_human: "warn",
  failed: "err",
  canceled: "neutral",
};

/**
 * The hue a run's stage meter takes.
 *
 * *ok* for a run in review, which is the mockup's own `meter ok` on its third row: a run that
 * has reached its own review is a run whose work is done, and the bar turning green as it
 * fills is the card's one piece of colour that reports an outcome rather than a state.
 * Everything earlier is the accent, which is what this product uses for something in
 * progress.
 *
 * @param status What the run is doing.
 * @returns Which tone the meter takes.
 */
function meterTone(status: RunStatus): MeterTone {
  return status === "review" || status === "merged" ? "ok" : "accent";
}

/**
 * The six columns, in the mockup's order.
 *
 * Declared once at module scope rather than rebuilt per render: the descriptions do not
 * depend on the data, and a fresh array each render would be a new identity for every cell
 * renderer in it.
 */
const COLUMNS: readonly Column<ActiveLoop>[] = [
  {
    key: "issue",
    header: "Issue",
    cell: (run) => (
      // The whole cell is the link, so the number and the title lead to the same console.
      <Link className="dash-run__issue" href={runPath(run.id, DASHBOARD_ORIGIN.id)}>
        <span className="dash-run__number">{`#${run.issueNumber}`}</span>
        {/*
          A real space between the two, which the flex gap does not supply: a whitespace-only
          text node is not laid out as a flex item, so this changes nothing on screen and
          keeps a screen reader from reading "#482Fix flaky…" as one word. It is the mockup's
          own `&nbsp;`, in the one form that survives both layouts.
        */}{" "}
        <span className="dash-run__title">{run.issueTitle}</span>
      </Link>
    ),
  },
  {
    key: "workflow",
    header: "Workflow",
    cell: (run) => <Tag>{run.workflowTag}</Tag>,
  },
  {
    key: "stage",
    header: "Stage",
    className: "dash-runs__stage",
    cell: (run) => (
      <div className="dash-run__stage">
        <span className="dash-run__stage-label">{run.stageCaption}</span>
        {/*
          No label on the meter, so it is not announced: the caption above it is the same
          fact in words, and a screen reader that read both would hear the run's position
          twice. The bar is the sighted reader's version of that line.
        */}
        <Meter value={run.stagePercent / 100} tone={meterTone(run.status)} />
      </div>
    ),
  },
  {
    key: "model",
    header: "Model",
    cell: (run) => (
      <Chip tone="model" mono>
        {run.model}
      </Chip>
    ),
  },
  {
    key: "elapsed",
    header: "Elapsed",
    align: "end",
    mono: true,
    cell: (run) =>
      run.startedAtSeconds === null || run.elapsedSeconds === null ? (
        NO_VALUE
      ) : (
        <Elapsed
          startedAtSeconds={run.startedAtSeconds}
          serverSeconds={run.elapsedSeconds}
        />
      ),
  },
  {
    key: "status",
    header: "Status",
    cell: (run) => <Chip tone={STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Chip>,
  },
];
