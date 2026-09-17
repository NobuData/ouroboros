/**
 * Every decision the **Backlog Health** card makes, and every sentence it says
 * (AM.3, [#285](https://github.com/NobuData/ouroboros/issues/285)).
 *
 * Mockup 09's second side card is three meters and a footnote, and AL.5
 * ([#281](https://github.com/NobuData/ouroboros/issues/281)) computes every figure in them on
 * every read — `GET /api/v1/planning/health`. So this module invents no number: it decides which
 * hue each meter takes, what fraction of its track it fills, and how each figure is announced.
 *
 * **Framework-free and pure**, the shape `app/dashboard/view.ts`'s `pulseMeters` established for
 * exactly this problem — a card of captioned meters whose arithmetic is worth holding still in a
 * suite.
 *
 * ### The footnote is a checkable claim
 *
 * *"Estimator re-runs nightly on unsized issues"* describes AL.5's scheduled job, and that job
 * records its runs. {@link lastRunNote} turns the sentence into something a reader can verify —
 * when it last ran, whether it succeeded, and how many of *this workspace's* tickets it found and
 * queued. Before the first run there is nothing to report, so the note says what is scheduled
 * instead of implying a run that never happened.
 *
 * ### The meters do not link yet, and say so
 *
 * The ticket asks each meter to drill through to a filtered intake view. AL.5 ships the filter
 * descriptors for it (`state`, `sizing`, `blocked`, `staleDays`), but there is no surface to spend
 * them on: these counts are over the **canonical `tickets`** table, and today's intake listing
 * (`/issues`, [#115](https://github.com/NobuData/ouroboros/issues/115)) is over the
 * `github_issues` mirror — a different set of rows on purpose. A link into it would land a reader
 * on tickets that are not the ones counted here, which is worse than no link. So the card names
 * the issue that will build the view, the way every other unbuilt control on this page does.
 */

import type { PlanningBacklogHealth, PlanningReestimationRun } from "@/app/api/planning";
import { relativeAgo } from "@/app/format";
import type { MeterTone } from "@/app/ui";

/* ------------------------------------------------------------------ the card */

/** The card's heading id — its region's `aria-labelledby` target. */
export const HEALTH_TITLE_ID = "planning-health-title";

/** The card's title, as the mockup names it (the card head upper-cases it). */
export const HEALTH_TITLE = "Backlog health";

/** What the card says when the health read failed. */
export const HEALTH_UNREAD = "Backlog health could not be read.";

/**
 * The card head's tag — the mockup's `42 open`.
 *
 * @param open How many open tickets the workspace has.
 * @returns The tag's text.
 */
export function openTag(open: number): string {
  return `${String(open)} open`;
}

/* ------------------------------------------------------------------ the meters */

/** One captioned meter of the card. */
export interface HealthMeter {
  /** A stable React key, and what a suite finds the row by. */
  readonly id: string;
  /** The caption's label — `Sized`, `Blocked`, `Stale > 30d`. */
  readonly label: string;
  /** The figure on the trailing edge — `38/42`, `4`. */
  readonly value: string;
  /** How full the bar is, `0`–`1`. */
  readonly fill: number;
  /** Which hue, which is what says whether the figure is good news. */
  readonly tone: MeterTone;
  /** What the bar announces, since the caption beside it is hidden from the tree. */
  readonly valueText: string;
}

/**
 * How full a bar is, clamped to its own track.
 *
 * `app/dashboard/view.ts`'s `barFill`, and for its reasons: a denominator of zero is *nothing to
 * measure* rather than a division, and no figure may draw a bar past its own end.
 *
 * @param part The numerator.
 * @param whole The denominator. Zero or negative reads as an empty bar.
 * @returns The fraction, to a whole percent.
 */
function barFill(part: number, whole: number): number {
  if (!(whole > 0)) return 0;

  return Math.min(1, Math.max(0, Math.round((part / whole) * 100) / 100));
}

/**
 * The label the stale meter carries — the mockup's `Stale > 30d`, with the real threshold.
 *
 * The threshold is `OURO_BACKLOG_STALE_DAYS` and arrives on the payload, so a deployment that
 * counts staleness at a fortnight says `Stale > 14d` rather than repeating the mockup's number.
 *
 * @param thresholdDays The payload's `stale.thresholdDays`.
 * @returns The label.
 */
export function staleLabel(thresholdDays: number): string {
  return `Stale > ${String(thresholdDays)}d`;
}

/**
 * The card's three meters, in the mockup's order.
 *
 * **Sized is a proportion of the sized-out-of-open pair the service hands over; blocked and stale
 * are proportions of the open backlog.** That is what the mockup's own widths say — 4 of 42 drawn
 * at 10%, 6 of 42 at 14% — and it is the reading that makes the three bars comparable: each is
 * *how much of the open backlog is in this state*.
 *
 * The hues are the mockup's and are fixed rather than derived from a threshold: `Sized` is the one
 * meter where more is better, so it is `ok`; anything blocked wants attention (`warn`); anything
 * stale has gone wrong (`err`). A zero in a `warn` or `err` meter is still drawn — an empty bar in
 * its own hue — because *four blocked* and *none blocked* are the same question answered
 * differently, and a row that vanished would make the good answer invisible.
 *
 * @param health The payload.
 * @returns The meters.
 */
export function healthMeters(health: PlanningBacklogHealth): readonly HealthMeter[] {
  const { open, sized, blocked, stale } = health;

  return [
    {
      id: "sized",
      label: "Sized",
      value: `${String(sized.count)}/${String(sized.total)}`,
      fill: barFill(sized.count, sized.total),
      tone: "ok",
      valueText: `${String(sized.count)} of ${String(sized.total)} open tickets have an estimate`,
    },
    {
      id: "blocked",
      label: "Blocked",
      value: String(blocked.count),
      fill: barFill(blocked.count, open),
      tone: "warn",
      valueText: `${String(blocked.count)} of ${String(open)} open tickets are waiting on an unresolved blocker`,
    },
    {
      id: "stale",
      label: staleLabel(stale.thresholdDays),
      value: String(stale.count),
      fill: barFill(stale.count, open),
      tone: "err",
      valueText:
        `${String(stale.count)} of ${String(open)} open tickets have not moved in ` +
        `${String(stale.thresholdDays)} days`,
    },
  ];
}

/* ------------------------------------------------------------------ the footnote */

/** The footnote, verbatim from the mockup. */
export const ESTIMATOR_FOOTNOTE = "Estimator re-runs nightly on unsized issues.";

/** The accessible name of the control the footnote's last-run detail hangs off. */
export const LAST_RUN_LABEL = "Nightly re-estimation";

/**
 * The visible last-run phrase — the mockup's `last run 02:14 ✓`, as a relative time.
 *
 * Relative rather than a clock time, because a clock time is only unambiguous with a zone beside
 * it and the product already spells *ago* one way (`app/format.ts`'s `relativeAgo`, which the
 * provider cards and the source rows both use). The tooltip carries the exact instant.
 *
 * @param run The latest run, or `null` before the first one.
 * @param now The instant the page was read.
 * @returns The phrase.
 */
export function lastRunPhrase(run: PlanningReestimationRun | null, now: Date): string {
  if (run === null) return "not run yet";

  return `last run ${relativeAgo(run.startedAt, now)}${RUN_MARK[run.status]}`;
}

/** The mark each outcome carries after the time — the mockup's `✓`. */
const RUN_MARK: Record<PlanningReestimationRun["status"], string> = {
  succeeded: " ✓",
  failed: " ✗",
  // A run still going has no outcome to mark, and an ellipsis says so without claiming one.
  running: " …",
};

/**
 * The tooltip behind the footnote — what the job actually did, or what it is scheduled to do.
 *
 * This is the sentence that makes the footnote checkable: the exact instant, the outcome, and how
 * many of *this workspace's* tickets the run found and queued. AL.5 keeps the per-workspace counts
 * separate precisely so this can be said without leaking another workspace's backlog.
 *
 * @param health The payload, for both the schedule and the run.
 * @returns The tooltip.
 */
export function lastRunNote(health: PlanningBacklogHealth): string {
  const { schedule, lastRun } = health.reestimation;
  const scheduled =
    `Scheduled nightly at ${String(schedule.hourUtc).padStart(2, "0")}:00 UTC, ` +
    `within ${String(schedule.jitterMinutes)} minutes, up to ${String(schedule.batchLimit)} tickets.`;

  if (lastRun === null) {
    return `${scheduled} It has not run yet, so nothing has been re-estimated.`;
  }

  const found = `${String(lastRun.found)} unsized ${lastRun.found === 1 ? "ticket" : "tickets"}`;

  return (
    `${scheduled} Last run started ${lastRun.startedAt} and ${OUTCOME_PHRASE[lastRun.status]} — ` +
    `${found} found here, ${String(lastRun.queued)} queued, ${String(lastRun.inFlight)} still in flight.`
  );
}

/** How each outcome is said in the tooltip's sentence. */
const OUTCOME_PHRASE: Record<PlanningReestimationRun["status"], string> = {
  succeeded: "succeeded",
  failed: "failed",
  running: "is still running",
};

/* ------------------------------------------------------------------ the drill-through */

/**
 * The issue that will build the filtered intake view the meters are meant to link into —
 * AM.3a ([#968](https://github.com/NobuData/ouroboros/issues/968)).
 *
 * Left as one constant so the note, the tooltip and the roadmap entry cannot come to name
 * different issues — the shape `view.ts`'s `IMPORT_JIRA_SOON_NOTE` already takes.
 */
export const DRILL_THROUGH_ISSUE = 968;

/** Why a meter is a figure rather than a link — see the module note for the whole argument. */
export const DRILL_THROUGH_NOTE =
  `Filtering the backlog to these tickets arrives with #${String(DRILL_THROUGH_ISSUE)}: ` +
  "these counts are over the canonical tickets, and today's intake list shows the GitHub mirror.";
