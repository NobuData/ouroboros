"use client";

import { memo } from "react";

import { Chip, Meter, cx } from "@/app/ui";
import type { MeterTone } from "@/app/ui";

import { BEARER_FALLBACK_NOTE, RUNNER_PILLS, type RunnerStatus } from "./runners";
import { NOT_MEASURED } from "./view";

import "./runner-actions.css";

/**
 * The runners table's cells (AI.2, [#257](https://github.com/NobuData/ouroboros/issues/257)).
 *
 * ### Why every one of them is memoised over primitives
 *
 * The table is redrawn from a fresh payload every ten seconds, on a page somebody may leave open
 * on a wall display. React already keeps the DOM still — rows are keyed by the runner's id, so a
 * poll moves text nodes and one custom property and replaces nothing — and these components keep
 * *React* still as well: each takes strings, numbers and booleans from a flat `RunnerRow`
 * (`app/farm/runners.ts`), so a poll that changed one machine's CPU re-renders that one cell.
 * `__tests__/farm/runners-live.test.tsx` holds both halves: the mutations a poll causes, and
 * which cells rendered.
 *
 * None of them decides anything. What a status is called, when a meter warns and when a figure
 * is an em dash are all `runners.ts`'s.
 *
 * The row's `⋯` is a cell of its own, with state of its own — `app/farm/runner-menu.tsx`
 * (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)).
 */

/**
 * The shield that marks a connection which fell back to a bearer token (decision **B3**).
 *
 * Drawn in `currentColor`, so it takes the warning ink of the element around it in both
 * palettes, and hidden from the accessibility tree: the words beside it say what it means.
 *
 * @returns The mark.
 */
function ShieldWarning() {
  return (
    <svg aria-hidden className="farm-runners__shield-icon" viewBox="0 0 16 16">
      <path
        d="M8 1.5 2.75 3.4v4.1c0 3.2 2.1 5.9 5.25 7 3.15-1.1 5.25-3.8 5.25-7V3.4L8 1.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
      <path d="M8 4.75v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
      <circle cx="8" cy="10.9" fill="currentColor" r="0.8" />
    </svg>
  );
}

/**
 * The runner cell — the mono name over its architecture line, and the shield affix on a
 * connection that is less secure than it looks.
 *
 * **A degraded-security state nobody can see is the worst outcome**, so the affix is not only a
 * glyph: its tooltip and its visually hidden text both say *bearer-token fallback* in words, and
 * the row's announcement repeats it (`rowAnnouncement`). It is subtle by being small and by
 * sitting beside the name rather than replacing the status pill — the machine is still up.
 *
 * @param props.name `forge-01`.
 * @param props.arch `linux/arm64`.
 * @param props.degraded Whether the connection is `bearer_fallback`.
 * @returns The cell.
 */
export const RunnerNameCell = memo(function RunnerNameCell({
  name,
  arch,
  degraded,
}: Readonly<{ name: string; arch: string; degraded: boolean }>) {
  return (
    <div className="farm-runners__runner">
      <span className="farm-runners__name">
        {name}
        {degraded && (
          <span className="farm-runners__shield" title={BEARER_FALLBACK_NOTE}>
            <ShieldWarning />
            <span className="sr-only">{BEARER_FALLBACK_NOTE}</span>
          </span>
        )}
      </span>
      <span className="farm-runners__arch">{arch}</span>
    </div>
  );
});

/**
 * The status cell — the pill, `last seen 2h ago` beside an offline one, and `drain requested`
 * beside one that has been drained and has not said so yet.
 *
 * The pill is **what the agent last reported** and is never moved by a click here: a drain
 * writes intent, and the note beside the pill is how that intent is drawn until the machine's
 * own heartbeat agrees (#260, `runners.ts`'s `intentNote`).
 *
 * @param props.status What the fleet last observed.
 * @param props.lastSeen How stale the row is, or `null` for a row that is not offline.
 * @param props.intent What was asked of it and is not yet observed, or `null`.
 * @returns The cell.
 */
export const RunnerStatusCell = memo(function RunnerStatusCell({
  status,
  lastSeen,
  intent,
}: Readonly<{ status: RunnerStatus; lastSeen: string | null; intent: string | null }>) {
  const pill = RUNNER_PILLS[status];

  return (
    <span className="farm-runners__status">
      <Chip dot={pill.dot} tone={pill.tone}>
        {pill.label}
      </Chip>
      {intent !== null && <span className="farm-runners__intent">{intent}</span>}
      {lastSeen !== null && <span className="farm-runners__seen">{lastSeen}</span>}
    </span>
  );
});

/**
 * The current-job cell — `#479 zephyr build`, opening the job sheet.
 *
 * **It is a button, not a link**, because it does not navigate: the run console it will link to
 * is #309 and is not built, so it opens a sheet over what the page already knows
 * (`app/farm/job-sheet.tsx`, and `JOB_SHEET_NOTE` for the whole argument). It stays in the tab
 * order — unlike the row's inert `⋯` — because it is the one thing in the row that acts, and a
 * reader on a keyboard has no other way to it.
 *
 * @param props.jobId The job's id — what `onOpen` is called with — or `null` for a machine
 *   running nothing.
 * @param props.number `#479`, or `null` for a machine running nothing.
 * @param props.note `zephyr build`, or `null`.
 * @param props.title The job's full title — the tooltip.
 * @param props.onOpen Opens the sheet for a job. Identity-stable, or the memo is for nothing.
 * @returns The cell: an em dash for a machine running nothing.
 */
export const RunnerJobCell = memo(function RunnerJobCell({
  jobId,
  number,
  note,
  title,
  onOpen,
}: Readonly<{
  jobId: string | null;
  number: string | null;
  note: string | null;
  title: string | null;
  onOpen: (jobId: string) => void;
}>) {
  if (jobId === null || number === null || note === null) {
    return <span className="farm-runners__none">{NOT_MEASURED}</span>;
  }

  return (
    <button
      className="farm-runners__job"
      onClick={() => onOpen(jobId)}
      title={title ?? undefined}
      type="button"
    >
      <span className="farm-runners__job-number">{number}</span>{" "}
      <span className="farm-runners__job-note">{note}</span>
    </button>
  );
});

/**
 * The CPU cell — the meter and the percentage beside it, or one em dash.
 *
 * The meter takes no label and is hidden from the accessibility tree: `82%` is said in words
 * right beside it, and a `progressbar` would say it twice (`app/ui/meter.tsx`). With nothing
 * measured there is **no meter at all** — an empty bar is a picture of `0%`.
 *
 * @param props.text `82%`, or an em dash.
 * @param props.meter How full, `0`–`1`, or `null` for no meter.
 * @param props.tone The meter's hue — `warn` from 80% up.
 * @returns The cell.
 */
export const RunnerCpuCell = memo(function RunnerCpuCell({
  text,
  meter,
  tone,
}: Readonly<{ text: string; meter: number | null; tone: MeterTone }>) {
  if (meter === null) return <span className="farm-runners__none">{text}</span>;

  return (
    <div className="farm-runners__cpu">
      <Meter className="farm-runners__cpu-meter" tone={tone} value={meter} />
      <span className="farm-runners__cpu-pct">{text}</span>
    </div>
  );
});

/**
 * The queue cell — `q:2`, marked while it has just moved (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * *Submitting updates the affected runner rows' queue depth visibly.* The figure follows the
 * page by itself; `moved` is what makes the change **seen**: the chip takes the accent for as
 * long as the page that moved it is on screen, and — for a reader who has not asked for less
 * motion — pulses once as it arrives (`app/farm/runner-actions.css`). It is an attribute on an
 * element that stays put, not a remount, so a poll still replaces nothing in the row.
 *
 * What moved is `app/farm/queue-moves.ts`'s, and it is said out loud by the card's status
 * region — the tint alone would be a signal only a sighted reader gets.
 *
 * @param props.text `q:2`.
 * @param props.moved Whether the depth differs from the page before this one.
 * @returns The cell.
 */
export const RunnerQueueCell = memo(function RunnerQueueCell({
  text,
  moved,
}: Readonly<{ text: string; moved: boolean }>) {
  return (
    // Two literals rather than one string: the farm's style suite reads this file for the
    // `farm…` classes it renders, and only sees a literal made of nothing else.
    <span className={cx("farm-runners__queue", "queue-move")} data-moved={moved || undefined}>
      {text}
    </span>
  );
});
