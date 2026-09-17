/**
 * Every decision the roadmap gantt makes, and every sentence it says
 * (AM.4, [#286](https://github.com/NobuData/ouroboros/issues/286)).
 *
 * Mockup 09's `c-12` card is a CSS grid — a label column, then one column per month — and that is
 * the whole geometry (decision **option 3-A**: no gantt library). What is interesting is which
 * months, where a bar starts and ends, where *today* is, and what a drag of so many pixels means;
 * each of those is a function of plain values here, so its acceptance criterion is a unit test.
 *
 * **Framework-free and pure**, like `app/planning/view.ts`: nothing here imports React, `next/*` or
 * the server-only client. The drawing is `app/planning/roadmap-gantt.tsx`'s.
 *
 * ### Months travel as `YYYY-MM`, and arithmetic is on an index
 *
 * The contract spells a month `2026-07`. Every calculation turns it into one integer —
 * `year × 12 + month − 1` — so a range across a year boundary is subtraction rather than a special
 * case, and no `Date` is ever built for a month: a `Date` carries a time zone the axis does not have.
 *
 * ### The window is the label, widened to fit every lane
 *
 * `roadmapWindow` is a phrase a person wrote (`Q3–Q4 2026`), so where it reads as quarters, halves or
 * months it sets the columns — the seed's `Q3–Q4 2026` is the mockup's Jul–Dec. It is then widened to
 * cover every scheduled lane, because a bar clipped by its own roadmap's columns would misstate the
 * plan. A label that says nothing parseable leaves the lanes' span; a roadmap with neither is six
 * months from the month the page was read.
 *
 * ### Today is a fraction of a month, computed from the clock
 *
 * The marker is the element that tells a reader a bar is behind, so it is placed from the real
 * instant — how far through its month, to the millisecond, in the reader's own calendar — never at a
 * fixed offset. {@link todayPosition} is that calculation; a today outside the window says so rather
 * than pinning the marker to an edge.
 */

import type { PlanningEpic, PlanningRoadmap } from "@/app/api/planning";

/* ------------------------------------------------------------------ months */

/** A month as the contract spells it: `2026-07`. */
export const MONTH_TEXT = /^([0-9]{4})-(0[1-9]|1[0-2])$/;

/** Short month names, January first — the gantt's column labels. */
export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * A `YYYY-MM` month as one integer, so ranges are subtraction.
 *
 * @param month `2026-07`.
 * @returns `2026 × 12 + 6`, or `null` when the text is not a month.
 */
export function monthIndex(month: string): number | null {
  const match = MONTH_TEXT.exec(month);

  if (match === null) return null;

  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

/**
 * The month an index names.
 *
 * @param index {@link monthIndex}'s integer.
 * @returns `YYYY-MM`.
 */
export function monthText(index: number): string {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/**
 * The month an instant falls in, in the reader's own calendar.
 *
 * @param at The instant.
 * @returns Its month's index.
 */
export function monthOf(at: Date): number {
  return at.getFullYear() * 12 + at.getMonth();
}

/**
 * The month it is now, by this process's clock — what the page is read in.
 *
 * @returns The month's index.
 */
export function currentMonth(): number {
  return monthOf(new Date());
}

/* ------------------------------------------------------------------ the window */

/** A run of months, both ends included, as indices. */
export interface MonthSpan {
  /** The first month's index. */
  readonly first: number;
  /** The last month's index — never before {@link first}. */
  readonly last: number;
}

/** How many months a roadmap with nothing to go on draws. */
export const DEFAULT_WINDOW_MONTHS = 6;

/** A quarter or half and an optional year: `Q3`, `Q3 2026`, `H2 2026`. */
const PERIOD = /^([QH])([1-4])(?:\s+([0-9]{4}))?$/i;

/** A short month name and an optional year: `Jul`, `Jul 2026`. */
const NAMED_MONTH = /^([A-Za-z]{3})[a-z]*(?:\s+([0-9]{4}))?$/;

/** What separates a label's two ends — an en or em dash, a hyphen, or `to`. */
const RANGE_SEPARATOR = /\s*(?:–|—|-|\bto\b)\s*/;

/** One end of a window label, before a missing year is borrowed from the other end. */
interface LabelEnd {
  /** The month the end starts at, counted from January = 0. */
  readonly firstMonth: number;
  /** The month the end finishes at, counted from January = 0. */
  readonly lastMonth: number;
  /** The year it named, if it named one. */
  readonly year: number | null;
}

/**
 * One end of a window label.
 *
 * @param text `Q3`, `H2 2026`, `Jul 2026`.
 * @returns The months it covers and the year it named, or `null` when it is none of those.
 */
function labelEnd(text: string): LabelEnd | null {
  const period = PERIOD.exec(text);

  if (period !== null) {
    const ordinal = Number(period[2]);
    const year = period[3] === undefined ? null : Number(period[3]);

    if (period[1]!.toUpperCase() === "Q") {
      return { firstMonth: (ordinal - 1) * 3, lastMonth: ordinal * 3 - 1, year };
    }

    if (ordinal > 2) return null;

    return { firstMonth: (ordinal - 1) * 6, lastMonth: ordinal * 6 - 1, year };
  }

  const named = NAMED_MONTH.exec(text);

  if (named === null) return null;

  const month = MONTH_NAMES.findIndex((name) => name.toLowerCase() === named[1]!.toLowerCase());

  if (month < 0) return null;

  return { firstMonth: month, lastMonth: month, year: named[2] === undefined ? null : Number(named[2]) };
}

/**
 * The months a roadmap window label names.
 *
 * Reads quarters, halves and months, alone or as a range, with the year written once at the end or
 * on both ends: `Q3–Q4 2026`, `Q4 2026–Q1 2027`, `H2 2026`, `Jul–Dec 2026`, `Sep 2026 to Feb 2027`.
 *
 * @param label The window, as a person wrote it, or `null`.
 * @returns The span, or `null` when the label names no year or no reading of it runs forwards.
 */
export function windowFromLabel(label: string | null): MonthSpan | null {
  if (label === null) return null;

  const parts = label.trim().split(RANGE_SEPARATOR);

  if (parts.length > 2) return null;

  const start = labelEnd(parts[0]!);
  const end = parts.length === 2 ? labelEnd(parts[1]!) : start;

  if (start === null || end === null) return null;

  const endYear = end.year ?? start.year;
  const startYear = start.year ?? endYear;

  if (startYear === null || endYear === null) return null;

  const span = { first: startYear * 12 + start.firstMonth, last: endYear * 12 + end.lastMonth };

  return span.last >= span.first ? span : null;
}

/**
 * The months a lane runs, when it is scheduled.
 *
 * @param lane The lane.
 * @returns Its span, or `null` for an unscoped lane (or one whose months do not parse).
 */
export function laneSpan(lane: Pick<PlanningEpic, "startMonth" | "endMonth">): MonthSpan | null {
  if (lane.startMonth === null || lane.endMonth === null) return null;

  const first = monthIndex(lane.startMonth);
  const last = monthIndex(lane.endMonth);

  if (first === null || last === null || last < first) return null;

  return { first, last };
}

/**
 * The gantt's columns — see the module note.
 *
 * @param roadmap The roadmap's window label and lanes.
 * @param readMonth The month the page was read in, for a roadmap with nothing else to go on. Read
 *   once on the server and handed down, so the server's and the browser's renders agree.
 * @returns The span the columns cover.
 */
export function ganttWindow(
  roadmap: Pick<PlanningRoadmap, "window" | "lanes">,
  readMonth: number,
): MonthSpan {
  const spans = [
    windowFromLabel(roadmap.window),
    ...roadmap.lanes.map((lane) => laneSpan(lane)),
  ].filter((span): span is MonthSpan => span !== null);

  if (spans.length === 0) {
    return { first: readMonth, last: readMonth + DEFAULT_WINDOW_MONTHS - 1 };
  }

  return {
    first: Math.min(...spans.map((span) => span.first)),
    last: Math.max(...spans.map((span) => span.last)),
  };
}

/**
 * How many months a span covers.
 *
 * @param span The span.
 * @returns At least one.
 */
export function spanLength(span: MonthSpan): number {
  return span.last - span.first + 1;
}

/** One month column. */
export interface GanttColumn {
  /** `2026-07`. */
  readonly month: string;
  /** What its head says — `Jul 2026` for the first column and every January, `Aug` otherwise. */
  readonly label: string;
  /** Its grid column — the label column is `1`, so the first month is `2`. */
  readonly column: number;
}

/** The grid column the first month takes: the lane labels are column 1. */
export const FIRST_MONTH_COLUMN = 2;

/**
 * The month columns, left to right — the mockup's `Jul 2026 · Aug · Sep …`.
 *
 * @param window The span.
 * @returns One column per month.
 */
export function ganttColumns(window: MonthSpan): GanttColumn[] {
  return Array.from({ length: spanLength(window) }, (_, offset) => {
    const index = window.first + offset;
    const name = MONTH_NAMES[index % 12]!;
    const withYear = offset === 0 || index % 12 === 0;

    return {
      month: monthText(index),
      label: withYear ? `${name} ${String(Math.floor(index / 12))}` : name,
      column: FIRST_MONTH_COLUMN + offset,
    };
  });
}

/* ------------------------------------------------------------------ bars */

/** Where a bar sits in the grid. */
export interface BarPlacement {
  /** The grid column it starts at. */
  readonly columnStart: number;
  /** The grid line it ends before — CSS grid's exclusive end. */
  readonly columnEnd: number;
  /**
   * Whether the lane has months. An unscoped lane is drawn across the window's last two columns,
   * dashed, where the mockup draws *Zephyr 4.2 migration* — a placeholder, not a schedule.
   */
  readonly scheduled: boolean;
}

/** How many columns an unscoped lane's placeholder bar spans, at most. */
export const UNSCOPED_SPAN = 2;

/**
 * Where a lane's bar goes.
 *
 * @param lane The lane's months.
 * @param window The gantt's span, which covers every scheduled lane by construction.
 * @returns The grid placement.
 */
export function barPlacement(
  lane: Pick<PlanningEpic, "startMonth" | "endMonth">,
  window: MonthSpan,
): BarPlacement {
  const span = laneSpan(lane);
  const end = FIRST_MONTH_COLUMN + spanLength(window);

  if (span === null) {
    return { columnStart: Math.max(FIRST_MONTH_COLUMN, end - UNSCOPED_SPAN), columnEnd: end, scheduled: false };
  }

  // Clamped anyway, so a lane edited elsewhere since the window was computed still draws inside it.
  const first = Math.max(span.first, window.first);
  const last = Math.min(span.last, window.last);

  return {
    columnStart: FIRST_MONTH_COLUMN + first - window.first,
    columnEnd: FIRST_MONTH_COLUMN + last - window.first + 1,
    scheduled: true,
  };
}

/**
 * How much of a bar is done — the progress fill.
 *
 * @param chips The lane's computed chip.
 * @returns A whole percentage, `0`–`100`, or `null` when the lane has no tickets to be done.
 */
export function progressPercent(chips: PlanningEpic["chips"]): number | null {
  if (chips.issues <= 0) return null;

  return Math.round((Math.min(chips.done, chips.issues) / chips.issues) * 100);
}

/** The chip an unscoped lane carries. */
export const UNSCOPED_CHIP = "unscoped";

/**
 * A bar's chip — `12 issues · 8 done`, or `unscoped` for a lane with no months.
 *
 * @param lane The lane.
 * @returns The chip's text.
 */
export function chipText(lane: Pick<PlanningEpic, "startMonth" | "endMonth" | "chips">): string {
  if (laneSpan(lane) === null) return UNSCOPED_CHIP;

  const { issues, done } = lane.chips;

  return `${String(issues)} ${issues === 1 ? "issue" : "issues"} · ${String(done)} done`;
}

/**
 * The affix beside a lane's label — the mockup's faint `proposed`.
 *
 * `active` is the ordinary state and says nothing; `unscoped` is already the chip.
 *
 * @param status The lane's status.
 * @returns `proposed` or `done`, or `null`.
 */
export function statusAffix(status: PlanningEpic["status"]): string | null {
  return status === "proposed" || status === "done" ? status : null;
}

/* ------------------------------------------------------------------ today */

/** Where today is on the gantt. */
export type TodayPosition =
  /** Inside the window: the month's column, and how far through it, `0` ≤ fraction < `1`. */
  | { readonly within: true; readonly column: number; readonly fraction: number }
  /** Outside it, and on which side. */
  | { readonly within: false; readonly side: "before" | "after" };

/**
 * Where an instant falls on the gantt — the TODAY marker.
 *
 * The fraction is exact: the milliseconds since the first of the month, in the reader's calendar,
 * over the milliseconds in that month. So Aug 8 at midnight is `7 / 31` through August, and noon on
 * Aug 8 is `7.5 / 31` — a daylight-saving month is measured in its own real length.
 *
 * @param at The instant — the reader's clock.
 * @param window The gantt's span.
 * @returns Its column and fraction, or which side of the window it is on.
 */
export function todayPosition(at: Date, window: MonthSpan): TodayPosition {
  const month = monthOf(at);

  if (month < window.first) return { within: false, side: "before" };
  if (month > window.last) return { within: false, side: "after" };

  const start = new Date(at.getFullYear(), at.getMonth(), 1).getTime();
  const next = new Date(at.getFullYear(), at.getMonth() + 1, 1).getTime();

  return {
    within: true,
    column: FIRST_MONTH_COLUMN + month - window.first,
    fraction: (at.getTime() - start) / (next - start),
  };
}

/**
 * A fraction as the CSS length the marker is offset by.
 *
 * @param fraction `0` ≤ fraction ≤ `1`.
 * @returns `25.806%`, to three decimals — finer than a pixel on any screen.
 */
export function percentOf(fraction: number): string {
  return `${String(Math.round(fraction * 100_000) / 1000)}%`;
}

/** The marker's label, verbatim from the mockup. */
export const TODAY_LABEL = "TODAY";

/**
 * What the card says when today is not on the gantt.
 *
 * @param side Which side of the window today is on.
 * @returns The sentence.
 */
export function todayOutside(side: "before" | "after"): string {
  return side === "before"
    ? "Today is before this roadmap's first month."
    : "Today is after this roadmap's last month.";
}

/**
 * The marker's accessible description.
 *
 * @param at The instant.
 * @returns `Today, 17 September 2026`.
 */
export function todayDescription(at: Date): string {
  return `Today, ${String(at.getDate())} ${MONTH_LONG[at.getMonth()]!} ${String(at.getFullYear())}`;
}

/** Long month names, for sentences. */
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/* ------------------------------------------------------------------ editing a range */

/** What a drag, an edge drag or a stepper changes. */
export type RangeEdit =
  /** Both ends together — drag the bar, or the move steppers. */
  | "move"
  /** The first month — the left edge, or the start steppers. */
  | "start"
  /** The last month — the right edge, or the end steppers. */
  | "end";

/**
 * How many whole months a drag of so many pixels is — the month snap.
 *
 * @param pixels How far the pointer moved, right positive.
 * @param monthWidth How wide one month column is, in the same pixels.
 * @returns The nearest whole number of months; `0` for a column with no width.
 */
export function monthsFromPixels(pixels: number, monthWidth: number): number {
  if (!(monthWidth > 0)) return 0;

  const months = Math.round(pixels / monthWidth);

  // `Math.round(-0.2)` is `-0`, which is `0` to arithmetic and not to `Object.is`.
  return months === 0 ? 0 : months;
}

/**
 * A span after an edit, held to the window and to running forwards.
 *
 * A move keeps the bar's length and stops at either edge of the window; an edge stops at the window
 * and at the other edge, so a bar is never shorter than one month.
 *
 * @param span The lane's current span.
 * @param edit What changes.
 * @param months How many months, later positive.
 * @param window The gantt's span.
 * @returns The new span — the same span when nothing could move.
 */
export function editSpan(span: MonthSpan, edit: RangeEdit, months: number, window: MonthSpan): MonthSpan {
  if (edit === "move") {
    const shift = Math.min(Math.max(months, window.first - span.first), window.last - span.last);

    return shift === 0 ? span : { first: span.first + shift, last: span.last + shift };
  }

  if (edit === "start") {
    const first = Math.min(Math.max(span.first + months, window.first), span.last);

    return first === span.first ? span : { first, last: span.last };
  }

  const last = Math.max(Math.min(span.last + months, window.last), span.first);

  return last === span.last ? span : { first: span.first, last };
}

/**
 * Whether two spans are the same months.
 *
 * @param a One span.
 * @param b The other.
 * @returns Whether both ends agree.
 */
export function sameSpan(a: MonthSpan, b: MonthSpan): boolean {
  return a.first === b.first && a.last === b.last;
}

/**
 * The months a span is sent as.
 *
 * @param span The span.
 * @returns `{ startMonth, endMonth }` as `YYYY-MM`.
 */
export function spanMonths(span: MonthSpan): { startMonth: string; endMonth: string } {
  return { startMonth: monthText(span.first), endMonth: monthText(span.last) };
}

/**
 * A lane with a new span — the optimistic lane a drag draws before the service answers.
 *
 * @param lane The lane.
 * @param span Its new months.
 * @returns The lane, moved.
 */
export function withSpan(lane: PlanningEpic, span: MonthSpan): PlanningEpic {
  return { ...lane, ...spanMonths(span) };
}

/* ------------------------------------------------------------------ the steppers */

/** One month stepper: which edit, which way, and what it is called. */
export interface Stepper {
  readonly edit: RangeEdit;
  /** `-1` earlier, `1` later. */
  readonly months: -1 | 1;
  /** Its visible glyph. */
  readonly glyph: string;
  /** The verb its accessible name is built from — see {@link stepperLabel}. */
  readonly verb: string;
}

/** The three edits, in the order the steppers draw them — the bar's left edge first. */
export const RANGE_EDITS: readonly RangeEdit[] = ["start", "move", "end"];

/** The steppers a focused lane offers, as the keyboard's path to every drag. */
export const STEPPERS: readonly Stepper[] = [
  { edit: "start", months: -1, glyph: "‹", verb: "Start a month earlier" },
  { edit: "start", months: 1, glyph: "›", verb: "Start a month later" },
  { edit: "move", months: -1, glyph: "‹", verb: "Move a month earlier" },
  { edit: "move", months: 1, glyph: "›", verb: "Move a month later" },
  { edit: "end", months: -1, glyph: "‹", verb: "End a month earlier" },
  { edit: "end", months: 1, glyph: "›", verb: "End a month later" },
];

/** The group headings the steppers sit under, per edit. */
export const STEPPER_GROUP: Record<RangeEdit, string> = {
  start: "start",
  move: "move",
  end: "end",
};

/**
 * A stepper's accessible name.
 *
 * @param stepper The stepper.
 * @param laneName The lane it moves.
 * @returns `Move OTA hardening a month later`.
 */
export function stepperLabel(stepper: Stepper, laneName: string): string {
  const [verb, ...rest] = stepper.verb.split(" ");

  return `${verb!} ${laneName} ${rest.join(" ")}`;
}

/** Why a stepper cannot act on an unscoped lane. */
export const UNSCOPED_STEP_REASON = "Give this epic months in its editor first.";

/** Why a stepper cannot act for a reader who may not change the roadmap. */
export const READ_ONLY_STEP_REASON = "Changing the roadmap is for workspace owners and admins.";

/**
 * Why a stepper cannot act, if it cannot.
 *
 * @param stepper The stepper.
 * @param lane The lane, as drawn.
 * @param window The gantt's span.
 * @param mayEdit Whether this reader may change the roadmap.
 * @returns The sentence, or `undefined` when the stepper may act.
 */
export function stepperReason(
  stepper: Stepper,
  lane: Pick<PlanningEpic, "startMonth" | "endMonth">,
  window: MonthSpan,
  mayEdit: boolean,
): string | undefined {
  if (!mayEdit) return READ_ONLY_STEP_REASON;

  const span = laneSpan(lane);

  if (span === null) return UNSCOPED_STEP_REASON;
  if (!sameSpan(editSpan(span, stepper.edit, stepper.months, window), span)) return undefined;

  if (stepper.edit === "move") {
    return stepper.months < 0 ? "Already at the roadmap's first month." : "Already at the roadmap's last month.";
  }

  const atWindow =
    (stepper.edit === "start" && stepper.months < 0) || (stepper.edit === "end" && stepper.months > 0);

  return atWindow ? "Already at the edge of the roadmap." : "An epic runs at least one month.";
}

/**
 * The edit a key press on a focused bar asks for.
 *
 * `←` / `→` move the bar; with **Shift** they move its end, with **Alt** its start — the same edits
 * as the steppers, for a reader who would rather not leave the bar.
 *
 * @param key `KeyboardEvent.key`.
 * @param modifiers Which modifiers were held.
 * @returns The edit and the direction, or `null` for any other key.
 */
export function keyEdit(
  key: string,
  modifiers: { readonly shiftKey: boolean; readonly altKey: boolean },
): { readonly edit: RangeEdit; readonly months: -1 | 1 } | null {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;

  const months = key === "ArrowLeft" ? -1 : 1;

  if (modifiers.shiftKey) return { edit: "end", months };
  if (modifiers.altKey) return { edit: "start", months };

  return { edit: "move", months };
}

/** The line under the gantt telling a keyboard reader what a focused bar does. */
export const KEYBOARD_HINT =
  "Focus a bar: ← → move it a month, Shift + ← → move its end, Alt + ← → move its start, Enter opens it.";

/* ------------------------------------------------------------------ an edit in flight */

/**
 * One lane's change the service has not answered yet — what the bar draws meanwhile, and what it
 * goes back to if the change is refused.
 */
export interface PendingEdit {
  /** The lane as the reader asked for it. */
  readonly shown: PlanningEpic;
  /** The lane as the service last confirmed it — where a refusal rolls back to. */
  readonly confirmed: PlanningEpic;
  /** Which request is latest; an answer to an older one is ignored. */
  readonly sequence: number;
}

/** Every lane with a change in flight, by id. */
export type PendingEdits = ReadonlyMap<string, PendingEdit>;

/**
 * Begin an optimistic change.
 *
 * @param pending What is in flight.
 * @param current The lane as drawn now — a second change stacks on the first, keeping its rollback.
 * @param next The lane as the reader asked for it.
 * @param sequence This request's number, higher than any before it.
 * @returns What is in flight afterwards.
 */
export function beginEdit(
  pending: PendingEdits,
  current: PlanningEpic,
  next: PlanningEpic,
  sequence: number,
): PendingEdits {
  const confirmed = pending.get(current.id)?.confirmed ?? current;

  return new Map(pending).set(current.id, { shown: next, confirmed, sequence });
}

/**
 * Settle a change the service answered.
 *
 * An answer to anything but the latest request draws nothing — the latest one's answer is still
 * coming — though a stored one becomes the rollback point. The latest request's stored lane replaces
 * what was drawn; its refusal rolls the bar back to the last confirmed lane.
 *
 * @param pending What is in flight.
 * @param id The lane.
 * @param sequence The answered request's number.
 * @param stored The lane as the service stored it, or `null` when it refused.
 * @returns What is in flight afterwards, the lane to keep drawing (until the page re-reads), and
 *   whether this answer rolled a change back.
 */
export function settleEdit(
  pending: PendingEdits,
  id: string,
  sequence: number,
  stored: PlanningEpic | null,
): { readonly pending: PendingEdits; readonly settled: PlanningEpic | null; readonly rolledBack: boolean } {
  const edit = pending.get(id);

  if (edit === undefined) return { pending, settled: null, rolledBack: false };

  if (edit.sequence !== sequence) {
    // A newer request is still coming. A stored answer to an older one is still the latest thing the
    // service confirmed, so a refusal of the newer one rolls back to it rather than past it.
    if (stored === null) return { pending, settled: null, rolledBack: false };

    return { pending: new Map(pending).set(id, { ...edit, confirmed: stored }), settled: null, rolledBack: false };
  }

  const rest = new Map(pending);

  rest.delete(id);

  return { pending: rest, settled: stored ?? edit.confirmed, rolledBack: stored === null };
}

/**
 * The lanes as drawn: the read, with every settled lane and every change in flight laid over it.
 *
 * @param lanes The lanes the page read.
 * @param settled Lanes the service has answered since that read.
 * @param pending Changes still in flight.
 * @returns The lanes, in the read's order.
 */
export function drawnLanes(
  lanes: readonly PlanningEpic[],
  settled: ReadonlyMap<string, PlanningEpic>,
  pending: PendingEdits,
): PlanningEpic[] {
  return lanes.map((lane) => pending.get(lane.id)?.shown ?? settled.get(lane.id) ?? lane);
}

/** The sentence a refused move ends with. */
export const MOVE_ROLLED_BACK = "It is back where it was.";

/**
 * Why a lane's move was refused, in a sentence.
 *
 * @param laneName The lane.
 * @param code The service's error code.
 * @returns The sentence the card announces.
 */
export function moveFailure(laneName: string, code: string): string {
  const why =
    code === "forbidden"
      ? READ_ONLY_STEP_REASON
      : code === "epic_month_range_invalid"
        ? "Those months do not run forwards."
        : code === "planning_epic_not_found"
          ? "The epic no longer exists."
          : "The change could not be saved.";

  return `${laneName} could not be moved. ${why} ${MOVE_ROLLED_BACK}`;
}

/* ------------------------------------------------------------------ the card */

/** **Share ↗**, verbatim from the mockup. */
export const SHARE_LABEL = "Share ↗";

/**
 * Why **Share ↗** is inert — AN.4 ([#292](https://github.com/NobuData/ouroboros/issues/292)) builds
 * roadmap sharing, and a live button would open a route that does not exist.
 */
export const SHARE_SOON_NOTE = "Sharing a roadmap arrives with #292.";

/**
 * The card's footnote, softened to what is true today. The mockup adds *"and re-plans when reality
 * drifts"* — that is AN.5 ([#293](https://github.com/NobuData/ouroboros/issues/293)), which restores
 * the clause when it earns it.
 */
export const GANTT_FOOTNOTE = "Bars are epics; Ouroboros keeps them in sync with the trackers.";

/** **Add epic** — a lane at the bottom of the roadmap. */
export const ADD_EPIC_LABEL = "Add epic";

/** The gantt's accessible name. */
export const GANTT_LABEL = "Roadmap timeline";

/**
 * A bar's accessible name — its label, chip, months and status, since a screen reader cannot see
 * where it sits.
 *
 * @param lane The lane.
 * @returns `OTA hardening — Jul 2026 to Sep 2026 — 12 issues · 8 done`.
 */
export function barLabel(lane: PlanningEpic): string {
  const span = laneSpan(lane);
  const months =
    span === null ? "no months yet" : `${monthName(span.first)} to ${monthName(span.last)}`;
  const affix = statusAffix(lane.status);

  return [lane.name, months, chipText(lane), affix].filter((part) => part !== null).join(" — ");
}

/**
 * A month for a sentence.
 *
 * @param index The month's index.
 * @returns `Jul 2026`.
 */
export function monthName(index: number): string {
  return `${MONTH_NAMES[index % 12]!} ${String(Math.floor(index / 12))}`;
}
