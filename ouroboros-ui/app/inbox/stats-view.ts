/**
 * The week's stat card's words and pure rules (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470),
 * mockup 16): **This week · 11 decisions · median answer time 41s · loops never waited longer
 * than 6m**.
 *
 * **No figure is composed here.** All three are falsifiable claims, and BN.4 (#464) computes them
 * from BM.2's weekly view and prints each one in `display` — `11`, `41s`, `6m`. The card renders
 * those strings verbatim, so the claim on screen is the service's arithmetic and never a second
 * rounding of it. A workspace that answered nothing this week is sent an em dash for every
 * figure, and the card draws `— decisions` rather than a `0s` median that would read as a boast
 * about a system nobody has asked anything.
 *
 * The two durations are **different measures**, which is the point of the tooltip: answer
 * latency is how long a person took (asked → answered, the median), loop wait is how long a run
 * sat blocked (the longest this week). BM.2 stores them apart so the second claim means what it
 * says.
 */

import type { InboxStats } from "@/app/api/inbox";

/** The card's caption, and its accessible name. */
export const STATS_TITLE = "This week";

/** What the figure says when there is nothing to show — the service's own em dash. */
export const STATS_NONE = "—";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_STATS = "This week's figures could not be reached.";

/** What is said when something answered and this client could not read it. */
export const UNREADABLE_STATS = "This week's figures could not be read.";

/** The two leads of the line under the figure, verbatim from the mockup. */
export const MEDIAN_LEAD = "median answer time";
export const WAIT_LEAD = "loops never waited longer than";

/** What joins them. */
export const STATS_JOIN = " · ";

/** The methodology control's accessible name. */
export const STATS_METHOD_LABEL = "How these figures are measured";

/**
 * The noun after the figure, spaced so the figure and the noun read as `11 decisions`.
 *
 * The figure is the service's `display.decisions`, which is an em dash on a cold workspace — so
 * the card reads `— decisions` there, the same em dash as the two durations, and never a `0`.
 * The singular follows the count the service sent, never the printed string.
 *
 * @param stats The week, as served.
 * @returns ` decision` for exactly one, ` decisions` otherwise.
 */
export function decisionsSuffix(stats: Pick<InboxStats, "decisions">): string {
  return stats.decisions === 1 ? " decision" : " decisions";
}

/**
 * The line under the figure, as one sentence — what a test, a screen reader and the card's own
 * composition all agree on.
 *
 * @param display The service's printing of the week.
 * @returns `median answer time 41s · loops never waited longer than 6m`.
 */
export function statsSentence(display: InboxStats["display"]): string {
  return `${MEDIAN_LEAD} ${display.medianAnswer}${STATS_JOIN}${WAIT_LEAD} ${display.maxLoopWait}`;
}

/**
 * The methodology, as the tooltip says it — the two durations are named apart so nobody reads
 * the median answer time as how long the loops waited.
 *
 * @param week The week the figures cover, as the service names it — `2026-W40`.
 * @returns The note's sentences.
 */
export function statsMethod(week: string): string[] {
  return [
    `Week ${week}, in UTC. Decisions counts every decision answered this week, by a person or a policy.`,
    "Median answer time is answer latency: for each decision answered this week, the time from when it was asked to when it was answered — the middle one of those.",
    "Loop wait is a different measure: the longest span any run sat blocked on a decision this week, from when the run stopped to ask until it could go on.",
    "Snoozed time counts toward both: a snooze hides a decision, it never stops its clock.",
  ];
}
