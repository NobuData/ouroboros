/**
 * The window every figure on mockup 06 is measured over, computed once per read.
 *
 * Z.5 ([#198](https://github.com/NobuData/ouroboros/issues/198)). The routing page draws four
 * numbers that are all claims about the same thirty days — the matrix's `$/run avg` and `p50
 * latency`, the **Spend by provider · 30d** card, and the *"Local models served 31% of all
 * tokens"* footnote — and the class of bug this file exists to prevent is those thirty days
 * being computed twice: once in the statement behind the matrix and once again, a few
 * milliseconds later, in the statement behind the card. A call that occurred on the boundary
 * would then be inside one figure and outside the next, and the footnote's percentage would
 * be over a denominator the meters above it never saw.
 *
 * So the boundary is computed **once**, here, from one `now`, and handed to both statements as
 * a parameter. `dashboard/windows.ts` makes the same argument for mockup 02 and this is
 * deliberately not that file: the dashboard's windows are five instants including a *calendar*
 * day in a named zone, and routing's is one duration subtracted from the request instant.
 *
 * **A rolling duration, and never a calendar month.** *30d* means `now − 30 × 24h`, which needs
 * no timezone to be well defined and is immune to daylight saving by construction — a duration
 * in milliseconds does not know what a clock did. It is also the acceptance criterion
 * *"window arithmetic is relative to `now()`, matching the seeded windows"*: Y.4
 * ([#192](https://github.com/NobuData/ouroboros/issues/192)) places its 370 calls inside a
 * window measured back from the moment the seed runs, so a card measured from the first of the
 * month would read differently on the 1st than on the 28th against rows that had not moved.
 *
 * The instant is a JavaScript `Date` handed to the statement as a parameter rather than
 * `now() - interval '30 days'` written into the SQL, for the reason the boundary is computed
 * once at all: two statements evaluating `now()` for themselves is exactly the pair of
 * nearly-agreeing windows described above.
 */

/**
 * How far back the routing page looks — thirty days.
 *
 * The mockup says so on the card (*Spend by provider · **30d***) and decision **M7** says the
 * figures are aggregates over that span. A constant rather than a literal at the two call
 * sites, because the matrix and the card must look back over the same rows or the footnote's
 * share is a fraction of a different population than the meters above it.
 */
export const STATS_WINDOW_DAYS = 30;

/** Milliseconds in a day. A duration, not a calendar day — see this file's header. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The two instants one read's figures are measured between. */
export interface StatsWindow {
  /** How many days wide the window is — {@link STATS_WINDOW_DAYS}. */
  readonly days: number;
  /** The oldest instant a row may carry and still be counted. Inclusive. */
  readonly since: Date;
  /**
   * The request instant — the moment the aggregation was measured at.
   *
   * Carried rather than left implicit because a cached answer is served after the instant it
   * was computed at, and a client that renders *"as of"* should render the truth. It is also
   * what makes {@link StatsWindow.since} checkable: the two together say exactly which rows
   * were in scope.
   */
  readonly until: Date;
}

/**
 * The window a read at this instant measures over.
 *
 * @param now - The request instant. Injected rather than taken from the clock here, so a suite
 *   can assert the arithmetic without owning time and so one read's statements share one
 *   boundary.
 * @param days - How far back to look. Defaults to {@link STATS_WINDOW_DAYS}; the parameter
 *   exists for AB.4 ([#210](https://github.com/NobuData/ouroboros/issues/210)), whose report
 *   drills into the same aggregation over a span the operator picks.
 * @returns The window. `since` is `now` less `days` whole days.
 */
export function statsWindow(now: Date, days: number = STATS_WINDOW_DAYS): StatsWindow {
  return { days, since: new Date(now.getTime() - days * DAY_MS), until: now };
}
