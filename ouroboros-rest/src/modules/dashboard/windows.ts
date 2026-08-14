/**
 * The instants every number on the dashboard is measured between.
 *
 * The payload is six cards' worth of aggregates and four of them are *windowed* — merged
 * this week against last, the pulse meters, the day's token spend, and the page head's
 * *since this morning*. A window is two instants, and the whole class of bug this file
 * exists to prevent is those instants being computed twice: once in the SQL for the count
 * and once again in the SQL for the average, a few milliseconds apart, so that a run which
 * finished on the boundary is inside one number and outside the next.
 *
 * So they are computed **once per request**, here, from one `now`, and handed to every
 * statement as parameters. One request sees one set of boundaries, and a payload's numbers
 * are consistent with each other whatever happened while it was being assembled.
 *
 * ## Two kinds of boundary, and only one of them has a calendar
 *
 *   * **The rolling windows** — seven days and fourteen — are *durations subtracted from the
 *     request instant*, not calendar weeks. `now - 7 × 24h`. That is what "trailing seven
 *     days" means, it needs no timezone to be well defined, and it is immune to daylight
 *     saving by construction: a duration in milliseconds does not know what a clock did.
 *   * **The day boundary** — what *Token spend · today* and *merged since this morning* are
 *     measured from — is a *calendar* fact, and a calendar needs a zone. It is **UTC**, and
 *     {@link DASHBOARD_TIME_ZONE} is where that is written down.
 *
 * ## Why UTC, and what would change it
 *
 * `token_usage_daily` (V010) fixes its `day` to UTC deliberately, "so that the same ledger
 * yields the same days to every caller". The dashboard's two day-boundary numbers have to
 * agree with each other — a card reading *4.2M today* beside a subline reading *6 merged
 * since this morning* must be talking about one morning — so the subline follows the view
 * rather than the view following the subline.
 *
 * There is no per-workspace timezone to prefer instead: `workspace_settings` (V011) holds
 * one column and it is the auto-merge switch. When a workspace can state its zone, this is
 * the file that changes and {@link startOfDay} is the function that takes it — which is why
 * the day boundary is computed through a zone-aware helper rather than by truncating
 * milliseconds, even though the only zone it is ever passed today has no offset to apply.
 */

/**
 * The zone the dashboard's *calendar* boundaries are taken in.
 *
 * Stated as a value rather than assumed, because it is published: the OpenAPI description of
 * `GET /api/v1/dashboard` names it, and a client rendering "since this morning" beside a
 * user's own clock has to know which morning is meant.
 */
export const DASHBOARD_TIME_ZONE = "UTC";

/** How many days the pulse meters and the *PRs merged* stat look back over. */
export const PULSE_WINDOW_DAYS = 7;

/**
 * How many days the autonomous merge rate looks back over.
 *
 * **Twice the others, and deliberately.** The reasoning is mockup 02's own arithmetic and is
 * set out in `resources.ts` beside the field it produces; what belongs here is only that the
 * longer window is not an extra reach into history — it is exactly the span the *merged
 * delta* already covers, this week plus the week it is compared against, so no number on the
 * page is measured over rows another number on the page does not already touch.
 */
export const MERGE_RATE_WINDOW_DAYS = 14;

/** Milliseconds in a day. A duration, not a calendar day — see this file's header. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The boundaries one request's numbers are measured between.
 *
 * Every field is an instant except {@link DashboardWindows.day}, which is the calendar day
 * `token_usage_daily` is keyed by.
 */
export interface DashboardWindows {
  /** The request instant. Every other field below is derived from it. */
  readonly now: Date;
  /** Seven days before {@link DashboardWindows.now} — the start of *this* week. */
  readonly weekStart: Date;
  /**
   * Fourteen days before now: the start of the week the delta compares against, and the
   * start of the merge rate's own window. One instant serving two purposes because they are
   * the same instant, not because either was made to fit the other.
   */
  readonly priorWeekStart: Date;
  /** Midnight in {@link DASHBOARD_TIME_ZONE} on the day `now` falls in — *this morning*. */
  readonly dayStart: Date;
  /** That same day as `YYYY-MM-DD`, which is how `token_usage_daily.day` is addressed. */
  readonly day: string;
}

/**
 * A zone's offset from UTC at one instant, in milliseconds.
 *
 * Asked of `Intl` rather than computed, because the offset in force is a fact about the
 * zone's rules on that date — which is the whole of what makes the day boundary below
 * correct on the two days a year those rules change.
 *
 * @param at - The instant.
 * @param timeZone - An IANA zone name.
 * @returns How far ahead of UTC the zone is; negative for the Americas.
 * @throws {RangeError} If the zone is not one the runtime knows.
 */
function offsetAt(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  // The zone's wall clock read as though it were UTC, less the instant it actually is. Whole
  // seconds on both sides: no zone has ever had a sub-second offset, and the milliseconds
  // would otherwise be subtracted out of the answer.
  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );

  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Midnight at the start of the calendar day an instant falls in, in a named zone.
 *
 * The obvious implementation — ask the zone how far into its day the instant is, and subtract
 * that — is wrong by an hour on the days a zone changes its offset, because the elapsed *wall
 * clock* since midnight is not the elapsed *time* since midnight when an hour was skipped or
 * repeated in between. So the day is found instead: the zone's calendar date is read, and the
 * instant at which that date's midnight occurred *there* is solved for.
 *
 * Solved rather than computed, in two passes, because the offset that converts local midnight
 * to an instant is the offset in force *at that instant* — which is what is being looked for.
 * The first pass uses the offset at UTC midnight of the same date and lands within a day of
 * the answer; the second uses the offset in force there, and is exact wherever local midnight
 * exists at all.
 *
 * Where it does not — a zone that springs forward *at* midnight, as Santiago and Havana do —
 * the second pass lands on 23:00 of the day before, and the first pass is then the right
 * answer: the transition itself, which is the first instant of that date in that zone. The
 * two candidates are checked rather than assumed, so the correct one is chosen by what it is
 * rather than by which zone this happens to be.
 *
 * @param at - The instant to find the day of.
 * @param timeZone - An IANA zone name. `"UTC"` in this service today, which has no offset to
 *   apply and no transitions — all of the above is what makes a per-workspace zone a
 *   parameter later rather than a rewrite.
 * @returns The instant at which that day began in that zone.
 * @throws {RangeError} If the zone is not one the runtime knows — thrown by `Intl`, and
 *   deliberately not caught: a misconfigured zone is a boundary nobody can compute, and
 *   guessing UTC in its place would silently mis-date a workspace's whole day.
 */
export function startOfDay(at: Date, timeZone: string = DASHBOARD_TIME_ZONE): Date {
  const date = dayOf(at, timeZone);
  const localMidnight = Date.parse(`${date}T00:00:00.000Z`);

  const first = new Date(localMidnight - offsetAt(new Date(localMidnight), timeZone));
  const second = new Date(localMidnight - offsetAt(first, timeZone));

  return dayOf(second, timeZone) === date ? second : first;
}

/**
 * The calendar day an instant falls in, as `token_usage_daily.day` spells one.
 *
 * `YYYY-MM-DD`, and a string rather than a `Date` on purpose: `pg` parses a `date` column
 * into a `Date` at the *process's* local midnight, so comparing that column against a `Date`
 * this service computed is a query whose answer depends on the container's `TZ`. A string
 * cast to `date` in the statement has no such opinion.
 *
 * @param at - The instant to name the day of.
 * @param timeZone - The zone whose calendar is meant.
 * @returns The day, zero-padded.
 */
export function dayOf(at: Date, timeZone: string = DASHBOARD_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  const field = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${field("year")}-${field("month")}-${field("day")}`;
}

/**
 * Every boundary one dashboard payload is measured between.
 *
 * @param now - The request instant. Passed in rather than read from the clock, so that a
 *   test can state the moment it is asking about and so that every statement in one request
 *   is answered about the same one.
 * @param timeZone - The zone the calendar boundaries are taken in.
 * @returns The windows.
 */
export function dashboardWindows(
  now: Date,
  timeZone: string = DASHBOARD_TIME_ZONE,
): DashboardWindows {
  return {
    now,
    weekStart: new Date(now.getTime() - PULSE_WINDOW_DAYS * DAY_MS),
    priorWeekStart: new Date(now.getTime() - MERGE_RATE_WINDOW_DAYS * DAY_MS),
    dayStart: startOfDay(now, timeZone),
    day: dayOf(now, timeZone),
  };
}
