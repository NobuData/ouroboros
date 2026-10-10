/**
 * A telemetry window: which stretch of time a reading is over (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)).
 *
 * A caller may name a window three ways —
 *
 * | written | means |
 * | --- | --- |
 * | `7d`, `36h`, `2w` | that long, ending now |
 * | `2026-08-01..2026-08-08`, with or without times | those days, or those instants |
 * | `baseline:v2.0.4` | the window a release's regression baseline was captured over (V115) |
 *
 * — but **a citation never keeps the first form**. "The last seven days" is a different window
 * tomorrow, so a relative window is resolved against the clock once and written back as the
 * absolute range it was. That is what makes a `telemetry://` locator re-runnable.
 *
 * Two grains, because the planes have two: the insights plane keeps one row per **UTC day**, so
 * its windows are whole days, inclusive at both ends; test results, measurements and runs are
 * timestamped, so theirs are **instants**, `[from, to)`. A date written without a time means the
 * whole day in either grain.
 */

import { ResearchToolError } from "../tools/research-tool.errors";

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/** The longest span a window may cover — a year and a day, for a year-over-year comparison. */
export const MAX_WINDOW_DAYS = 367;

/** The grain a plane keeps its history at. */
export type WindowGrain = "day" | "instant";

/** A stretch of time. */
export interface RangeWindow {
  readonly kind: "range";
  /** The window as a citation writes it: `2026-08-01..2026-08-08` or with times. */
  readonly text: string;
  /** The first instant inside it. */
  readonly from: Date;
  /** The first instant after it. */
  readonly to: Date;
}

/** The window a release's baseline was captured over. */
export interface BaselineWindow {
  readonly kind: "baseline";
  /** `baseline:<release tag>`. */
  readonly text: string;
  /** The release tag. */
  readonly tag: string;
}

/** A window, parsed. */
export type TelemetryWindow = RangeWindow | BaselineWindow;

const RELATIVE = /^([1-9][0-9]{0,3})([hdw])$/;
const DATE_ONLY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DATE_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z$/;
const BASELINE = /^baseline:(\S{1,128})$/;

/** What a window may look like, for a refusal's message. */
const SHAPES =
  "a window is `7d`, `36h`, `2w`, `2026-08-01..2026-08-08` (times allowed, in UTC) or `baseline:<release tag>`";

/**
 * A UTC day as text.
 *
 * @param at - The instant.
 * @returns `YYYY-MM-DD`.
 */
export function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * An instant as a citation writes it.
 *
 * @param at - The instant.
 * @returns `YYYY-MM-DDTHH:MM:SSZ`.
 */
function instantText(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

/**
 * One bound of a written range.
 *
 * @param text - `YYYY-MM-DD`, or the same with `THH:MM[:SS]Z`.
 * @returns The instant, and whether it was written as a whole day; `null` when it is neither
 *   shape, or names a day that does not exist.
 */
function bound(text: string): { readonly at: Date; readonly wholeDay: boolean } | null {
  const wholeDay = DATE_ONLY.test(text);

  if (!wholeDay && !DATE_TIME.test(text)) return null;

  const at = new Date(wholeDay ? `${text}T00:00:00Z` : text);

  // `2026-02-31` parses in some engines by rolling over: only a date that round-trips is real.
  return Number.isNaN(at.getTime()) || dayOf(at) !== text.slice(0, 10) ? null : { at, wholeDay };
}

/**
 * Refuse a window.
 *
 * @param detail - What is wrong with it.
 * @returns Never.
 * @throws {ResearchToolError} `unsupported`, always.
 */
function refuse(detail: string): never {
  throw new ResearchToolError("unsupported", `${detail} — ${SHAPES}`);
}

/**
 * Parse a window and resolve it against the clock.
 *
 * @param input - The window as the caller wrote it.
 * @param now - The instant "ending now" means.
 * @param grain - The plane's grain: `day` for the insights plane, `instant` for the others.
 * @returns The window, absolute — a relative one written back as the range it resolved to.
 * @throws {ResearchToolError} `unsupported` for anything that is not a window, a window that
 *   ends before it starts, one longer than {@link MAX_WINDOW_DAYS}, or — on the day grain —
 *   one written in hours or with times.
 */
export function parseWindow(input: unknown, now: Date, grain: WindowGrain): TelemetryWindow {
  if (typeof input !== "string" || input.length > 200) refuse("a window is a short string");

  const baseline = BASELINE.exec(input);

  if (baseline !== null) return { kind: "baseline", text: input, tag: baseline[1] };

  const relative = RELATIVE.exec(input);

  if (relative !== null) return relativeWindow(Number(relative[1]), relative[2], now, grain);

  const [first, second, ...rest] = input.split("..");
  const from = first === undefined ? null : bound(first);
  const to = second === undefined ? null : bound(second);

  if (from === null || to === null || rest.length > 0) refuse(`"${input}" is not a window`);

  if (grain === "day" && !(from.wholeDay && to.wholeDay)) {
    refuse("this metric is kept per UTC day, so its window is whole days");
  }

  // A whole day as the end of a range runs to the end of that day.
  return checked({
    kind: "range",
    text: input,
    from: from.at,
    to: to.wholeDay ? new Date(to.at.getTime() + DAY_MS) : to.at,
  });
}

/**
 * A window of a length, ending now.
 *
 * @param count - How many units.
 * @param unit - `h`, `d` or `w`.
 * @param now - The clock.
 * @param grain - The plane's grain.
 * @returns The absolute window. On the day grain `7d` is today and the six days before it — the
 *   Insights page's own meaning of "7d".
 * @throws {ResearchToolError} `unsupported` for hours on the day grain, or a window too long.
 */
function relativeWindow(count: number, unit: string, now: Date, grain: WindowGrain): RangeWindow {
  if (grain === "day") {
    if (unit === "h") refuse("this metric is kept per UTC day, so its window is whole days");

    const days = unit === "w" ? count * 7 : count;
    const today = new Date(`${dayOf(now)}T00:00:00Z`);
    const from = new Date(today.getTime() - (days - 1) * DAY_MS);

    return checked({
      kind: "range",
      text: `${dayOf(from)}..${dayOf(today)}`,
      from,
      to: new Date(today.getTime() + DAY_MS),
    });
  }

  const to = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const length =
    unit === "h" ? count * 3_600_000 : unit === "w" ? count * 7 * DAY_MS : count * DAY_MS;
  const from = new Date(to.getTime() - length);

  return checked({ kind: "range", text: `${instantText(from)}..${instantText(to)}`, from, to });
}

/**
 * Hold a range to the two rules every range obeys.
 *
 * @param window - The range.
 * @returns It, unchanged.
 * @throws {ResearchToolError} `unsupported` when it ends before it starts or is too long.
 */
function checked(window: RangeWindow): RangeWindow {
  if (window.to.getTime() <= window.from.getTime())
    refuse(`"${window.text}" ends before it starts`);
  if (window.to.getTime() - window.from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    refuse(`a window covers at most ${String(MAX_WINDOW_DAYS)} days`);
  }

  return window;
}

/**
 * A day-grain range's first and last day.
 *
 * @param window - A range parsed on the `day` grain.
 * @returns The inclusive days, as the insights plane names them.
 */
export function daySpan(window: RangeWindow): { readonly from: string; readonly to: string } {
  return { from: dayOf(window.from), to: dayOf(new Date(window.to.getTime() - DAY_MS)) };
}
