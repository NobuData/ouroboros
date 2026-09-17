"use client";

import type { CSSProperties } from "react";

import { useSecondsNow } from "@/app/shell/clock";
import { useClientValue } from "@/app/shell/client-value";

import {
  type MonthSpan,
  TODAY_LABEL,
  percentOf,
  todayDescription,
  todayOutside,
  todayPosition,
} from "./gantt";

import "./planning.css";

/**
 * The gantt's TODAY marker (AM.4, [#286](https://github.com/NobuData/ouroboros/issues/286)) — the
 * mockup's glowing line, placed from the reader's real clock.
 *
 * ### Only in the browser, and always from the clock
 *
 * Where today falls is a question about the *reader's* calendar, which the server does not know: a
 * server in UTC and a reader in Tokyo disagree about the date for nine hours a day. So nothing is
 * rendered on the server or during hydration — a marker that moved after hydrating would be a
 * marker that was wrong first — and once hydrated it reads `app/shell/clock.ts`'s ticking store, so
 * a page left open across midnight moves its marker rather than going stale.
 *
 * The position is `gantt.ts`'s {@link todayPosition}: the month's column and the exact fraction
 * through it. Both travel to the stylesheet as custom properties, the one inline style being the
 * datum — `.planning-gantt__today` owns every property it sets.
 */

/** The custom property carrying the marker's grid column. */
const COLUMN_PROPERTY = "--planning-gantt-today-column";

/** The custom property carrying how far through the month the line is drawn. */
const OFFSET_PROPERTY = "--planning-gantt-today-offset";

/**
 * Where there is no browser clock yet: the server render and the hydration pass. Zero is never
 * drawn, because {@link useHydrated} is false wherever it would be read.
 */
const NO_CLOCK = 0;

/**
 * Whether this render is in a hydrated browser.
 *
 * @returns `false` on the server and during hydration, `true` afterwards.
 */
function useHydrated(): boolean {
  return useClientValue(() => true, false);
}

/**
 * The marker, as a grid item spanning every row of its month's column.
 *
 * @param props.window The gantt's months.
 * @returns The marker, or nothing when today is outside the window or the page has not hydrated.
 */
export function TodayMarker({ window }: Readonly<{ window: MonthSpan }>) {
  const hydrated = useHydrated();
  const seconds = useSecondsNow(NO_CLOCK);

  if (!hydrated) return null;

  const now = new Date(seconds * 1000);
  const position = todayPosition(now, window);

  if (!position.within) return null;

  return (
    <span
      aria-label={todayDescription(now)}
      className="planning-gantt__today"
      data-today-fraction={position.fraction}
      role="img"
      style={
        {
          [COLUMN_PROPERTY]: String(position.column),
          [OFFSET_PROPERTY]: percentOf(position.fraction),
        } as CSSProperties
      }
    >
      <span aria-hidden className="planning-gantt__today-label">
        {TODAY_LABEL}
      </span>
    </span>
  );
}

/**
 * The line under the gantt when today is not on it — so a roadmap entirely in the past or future says
 * so, rather than drawing no marker and leaving the reader to wonder where it went.
 *
 * @param props.window The gantt's months.
 * @returns The note, or nothing when today is inside the window or the page has not hydrated.
 */
export function TodayOutsideNote({ window }: Readonly<{ window: MonthSpan }>) {
  const hydrated = useHydrated();
  const seconds = useSecondsNow(NO_CLOCK);

  if (!hydrated) return null;

  const position = todayPosition(new Date(seconds * 1000), window);

  if (position.within) return null;

  return <p className="planning-gantt__note">{todayOutside(position.side)}</p>;
}
