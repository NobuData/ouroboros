"use client";

import { useEffect, useState } from "react";

import type { FarmPage } from "@/app/api/farm";
import { onSummaryRefresh } from "@/app/dashboard/summary-refresh";
import { useSecondsNow } from "@/app/shell/clock";
import { Button, Card, CardHead, Chip, EmptyState } from "@/app/ui";

import { useFarm } from "./farm-store";
import {
  FULL_LOG,
  LIVE_CARD_TITLE_ID,
  LIVE_UNREAD,
  LOG_LABEL,
  type LiveJob,
  NO_BUILDS_RUNNING,
  bindJob,
  emptyLogNote,
  liveElapsed,
  livePill,
  liveTitle,
  newestJob,
  selectedJob,
} from "./live";
import { LogPane } from "./log-pane";
import { LogSheet } from "./log-sheet";
import type { LogStreamOptions } from "./log-stream";
import { useFarmSelection } from "./selection-store";
import { useLogStream } from "./use-log-stream";

/**
 * The live log card — mockup 08's `c-12`, live
 * (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * Which build it is about, and what its header may claim, are `app/farm/live.ts`'s; how the log
 * arrives is `app/farm/log-stream.ts`'s; how it scrolls is `app/farm/log-pane.tsx`'s. This
 * assembles them, and holds the two pieces of state that are the card's own: the build it was
 * about a moment ago — a finished build stays on the card, which only works if something
 * remembers it — and whether the full-log sheet is open.
 *
 * ### Two loops, two cadences
 *
 * The farm's page says *which* build (`app/farm/farm-store.tsx`, ten seconds); the build's log
 * says *what it printed and whether it is over* (two seconds while live). The cursor, the pill
 * and the elapsed time are all bound to the log's `live` flag, never to the page's — a page up
 * to ten seconds old still naming a build as running is not evidence that it is.
 *
 * ### `Full log ↗` opens a sheet
 *
 * Its honest destination is mockup 10's run console, which does not exist (#309, linked by
 * #265). Until it does, the control opens `app/farm/log-sheet.tsx`: the whole log, from its
 * first byte. It is a button, not a link, for the reason the runners table's job cell is.
 *
 * @param props.log Test seams for the log streams; the screen passes none.
 * @returns The card, as a direct child of the farm's grid.
 */
export function LiveCard({ log }: Readonly<{ log?: LogStreamOptions }>) {
  const { page, dataAt } = useFarm();
  const { runnerId } = useFarmSelection();
  const job = useBoundJob(page, runnerId);
  const [sheetJob, setSheetJob] = useState<LiveJob | null>(null);

  return (
    <Card aria-labelledby={TITLE_ID} as="section" className="farm-col--12">
      {job === null ? (
        <>
          <CardHead title={liveTitle(null)} titleId={TITLE_ID} />
          <EmptyState title={page === null ? LIVE_UNREAD : NO_BUILDS_RUNNING} variant="flush" />
        </>
      ) : (
        // Keyed by the build: a stream accumulates one build's output, so another build is
        // another stream — and another pane, which starts at its own tail.
        <LiveBuild
          job={job}
          key={job.id}
          log={log}
          onFullLog={setSheetJob}
          readAtSeconds={Math.floor((dataAt ?? 0) / MS_PER_SECOND)}
        />
      )}

      <LogSheet job={sheetJob} log={log} onClose={() => setSheetJob(null)} />
    </Card>
  );
}

/** The id the card's `aria-labelledby` points at — shared with the submit toast (#260). */
const TITLE_ID = LIVE_CARD_TITLE_ID;

/** Milliseconds in a second. */
const MS_PER_SECOND = 1000;

/**
 * Which build the card is about, render over render — `bindJob`, with the memory it needs.
 *
 * The held build is state that is **derived while rendering** (React's *storing information from
 * previous renders*): what the card shows now depends on what it showed last, and an effect
 * would draw one frame of the wrong build first.
 *
 * **A workspace switch lets go of it.** The farm is scoped by the session's active organization;
 * the shell publishes the switch (`app/dashboard/summary-refresh.ts`) and the page on screen is
 * then another workspace's until the read made after it lands. So the page that was showing at
 * that moment is marked, nothing is re-bound from it, and the first page after it starts the
 * card from nothing — a finished build from the workspace the reader left is not held over.
 *
 * @param page The farm's page.
 * @param runnerId The reader's selected runner.
 * @returns The build, or `null` for the empty state.
 */
function useBoundJob(page: FarmPage | null, runnerId: string | null): LiveJob | null {
  const [held, setHeld] = useState<LiveJob | null>(null);
  /** The page on screen when the workspace changed, or `undefined` when none is marked. */
  const [left, setLeft] = useState<FarmPage | null | undefined>(undefined);

  useEffect(() => onSummaryRefresh(() => setLeft(page)), [page]);

  // Still the page from before the switch: hold still.
  if (left !== undefined && page === left) return held;

  const bound = bindJob(
    left === undefined ? held : null,
    newestJob(page),
    selectedJob(page, runnerId),
  );

  if (bound !== held) setHeld(bound);
  if (left !== undefined) setLeft(undefined);

  return bound;
}

/**
 * The card's content for one build: the header over the pane.
 *
 * @param props.job The build.
 * @param props.readAtSeconds The farm page's own clock, for the server render's elapsed time.
 * @param props.log Test seams for the stream.
 * @param props.onFullLog Opens the full-log sheet for a build.
 * @returns The header, the pane, and the stream's failure when it has one.
 */
function LiveBuild({
  job,
  readAtSeconds,
  log,
  onFullLog,
}: Readonly<{
  job: LiveJob;
  readAtSeconds: number;
  log?: LogStreamOptions;
  onFullLog: (job: LiveJob) => void;
}>) {
  const view = useLogStream(job.id, { ...log, mode: "tail" });
  const pill = livePill(view.live);

  return (
    <>
      <CardHead
        beside={
          <>
            <Chip dot={pill.dot} tone={pill.tone}>
              {pill.label}
            </Chip>
            <span className="farm-live__elapsed">
              {view.live === false ? (
                liveElapsed(job, false, view.endedAt, 0)
              ) : (
                <RunningFor job={job} readAtSeconds={readAtSeconds} />
              )}
            </span>
          </>
        }
        title={liveTitle(job)}
        titleId={TITLE_ID}
        trailing={
          <Button onClick={() => onFullLog(job)} size="sm" tone="ghost">
            {FULL_LOG}
          </Button>
        }
      />

      <LogPane
        columns={view.columns}
        emptyNote={emptyLogNote(view.live, view.retained)}
        label={LOG_LABEL}
        // Strictly the flag: before the first page has answered nothing has said `live: true`.
        live={view.live === true}
        rows={view.rows}
      />

      {view.error !== null && (
        <p className="farm-live__error" role="status">
          {view.error}
        </p>
      )}
    </>
  );
}

/**
 * The elapsed time of a build that is running, ticking.
 *
 * A component of its own so that **only a running build watches the clock**
 * (`app/shell/clock.ts` runs one interval while anybody does): a finished build's time is a
 * string, and a card that kept a timer for it would be re-rendering once a second to draw the
 * same thing.
 *
 * @param props.job The build.
 * @param props.readAtSeconds What the server render and the hydration pass use for *now*.
 * @returns The time, as text.
 */
function RunningFor({ job, readAtSeconds }: Readonly<{ job: LiveJob; readAtSeconds: number }>) {
  const nowSeconds = useSecondsNow(readAtSeconds);

  return liveElapsed(job, true, null, nowSeconds * MS_PER_SECOND);
}
