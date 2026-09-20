"use client";

import {
  type CSSProperties,
  type UIEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cx } from "@/app/ui/class-names";

import type { LogRow, LogRowKind } from "./log-buffer";

import "./log-pane.css";

/**
 * The log pane — a bounded window onto a build's rows, that follows the tail until the reader
 * scrolls away from it (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * What the rows *are* is `app/farm/log-buffer.ts`'s. What is here is the three things the issue
 * asks of the pane as a piece of glass.
 *
 * ### A bounded DOM
 *
 * Every row is one line high — output does not wrap, it scrolls sideways inside the pane — so
 * which rows are in view is arithmetic: `scrollTop ÷ row height`. Only those rows and a margin
 * either side ({@link OVERSCAN}) are rendered, inside a sizer as tall as all of them, so the
 * scrollbar is honest about a forty-thousand-line log and the DOM holds about a hundred nodes of
 * it. Rows are keyed by the buffer's keys and memoised, so a page that appends forty lines mounts
 * forty nodes and touches no other.
 *
 * **The geometry is the stylesheet's.** The pane publishes three numbers as custom properties —
 * how many rows, which is first, how wide the widest is — and `log-pane.css` turns them into a
 * height, an offset and a minimum width in `rem` and `ch`. The one length read back is the row's
 * rendered height, measured rather than assumed, which is what keeps the arithmetic right at a
 * 125% font size.
 *
 * ### Scroll that does not fight the reader
 *
 * While the reader is at the bottom the pane **follows**: the window is pinned to the last rows
 * and the scroller is put at its end before the browser paints, so new output appears in place
 * with no frame in which it is below the fold. The moment the reader scrolls up, following stops
 * — **locked** — and nothing moves them again: not new output, and not old rows leaving the head
 * of a bounded buffer, which would otherwise slide the text they are reading upwards. (The
 * scroller is moved back by exactly the height that left.) Scrolling back to the bottom resumes.
 * A scroll is honoured **even before the browser has reported it**: the pane remembers where it
 * put the scroller, and one that is no longer there is left alone until its event arrives.
 *
 * ### A cursor that tells the truth
 *
 * The last line of output is drawn in the accent with a cursor after it, and the cursor blinks
 * **only while `live` is true**. A build that has ended keeps its cursor, still — the mockup's
 * block, no longer claiming that anything is happening.
 *
 * @param props.rows The rows, top to bottom.
 * @param props.columns The widest row, in characters.
 * @param props.live Whether the build is running — the log's own flag, never chunk recency.
 * @param props.label The pane's accessible name.
 * @param props.emptyNote What to say when there are no rows. Empty for *nothing yet*.
 * @param props.tall Whether to take the sheet's height rather than the card's.
 * @returns The pane.
 */
export function LogPane({
  rows,
  columns,
  live,
  label,
  emptyNote,
  tall = false,
}: Readonly<{
  rows: readonly LogRow[];
  columns: number;
  live: boolean;
  label: string;
  emptyNote: string;
  tall?: boolean;
}>) {
  const scroller = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);

  /** What was measured: one row's height and how many fit, in whole rows. */
  const [measure, setMeasure] = useState<Measure>(UNMEASURED);
  /** Whether the pane is following the tail. It starts there. */
  const [following, setFollowing] = useState(true);
  /**
   * The first row in view while locked — as a **reading-order coordinate**, not an index, so that
   * rows leaving the head move the window with them in the same render, rather than a frame
   * later when the scroller reports where it was put.
   */
  const [topAt, setTopAt] = useState(0);

  /** The reading-order coordinate of the first row, as of the last commit. */
  const origin = originOf(rows);
  const lastOrigin = useRef(origin);

  /**
   * Where the scroller stood when the pane last put it at the tail, or last heard it was there —
   * `null` before either. What tells **a reader's scroll that has not been reported yet** from the
   * pane's own: a page can land in the instant between a wheel moving the scroller and the
   * browser dispatching the `scroll` event that says so, and pinning to the tail then would yank
   * the reader back mid-gesture — the one thing this pane exists not to do.
   */
  const pinnedTop = useRef<number | null>(null);

  // Measured by the observer's own callback — on observing, and again whenever the pane or the
  // font size changes — rather than read in an effect, so there is no render against a guess
  // that a second render then corrects.
  useEffect(() => {
    const pane = scroller.current;
    const row = probe.current;
    if (pane === null || row === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      setMeasure((held) => measured(held, row.getBoundingClientRect().height, pane.clientHeight));
    });

    observer.observe(pane);
    observer.observe(row);

    return () => observer.disconnect();
  }, []);

  // Before paint: keep the tail in view while following, and keep the reader's lines where they
  // are when rows have left the head.
  useLayoutEffect(() => {
    const pane = scroller.current;
    const left = origin - lastOrigin.current;
    lastOrigin.current = origin;

    if (pane === null) return;

    if (following) {
      const strayed =
        pinnedTop.current !== null &&
        Math.abs(pane.scrollTop - pinnedTop.current) > measure.rowPx / 2;

      // Strayed from where it was put: the reader moved it, and the event that will say whether
      // they left the tail is on its way. It decides; this does not overrule it.
      if (!strayed) {
        pane.scrollTop = pane.scrollHeight;
        // Read back rather than assumed: the browser clamps it to the furthest it can scroll.
        pinnedTop.current = pane.scrollTop;
      }
    } else if (left > 0) {
      pane.scrollTop = Math.max(0, pane.scrollTop - left * measure.rowPx);
    }
  }, [rows, following, origin, measure]);

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const pane = event.currentTarget;
      const below = pane.scrollHeight - pane.scrollTop - pane.clientHeight;

      // Within half a row of the end is the end: a fractional scroll position at a zoomed font
      // size must not read as the reader having left.
      const atTail = below <= measure.rowPx / 2;

      pinnedTop.current = atTail ? pane.scrollTop : null;
      setFollowing(atTail);
      setTopAt(lastOrigin.current + Math.floor(pane.scrollTop / measure.rowPx));
    },
    [measure.rowPx],
  );

  // While following, the window is the last rows whatever the scroller last reported — that is
  // what lets new output be drawn in the same commit that scrolls to it.
  const anchor = following
    ? rows.length - measure.visible
    : Math.min(Math.max(0, topAt - origin), rows.length - 1);
  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(rows.length, Math.max(0, anchor) + measure.visible + OVERSCAN);
  const cursorKey = cursorRow(rows);

  const geometry = {
    "--log-pane-rows": Math.max(rows.length, 1),
    "--log-pane-first": first,
    "--log-pane-cols": columns,
  } as CSSProperties;

  return (
    <div className={cx("log-pane", tall && "log-pane--tall")}>
      {/*
        A scrollable region has to be reachable without a pointer: it is a tab stop, and the
        arrow keys, Page Up/Down, Home and End are then the browser's own.
      */}
      <div
        aria-label={label}
        className="log-pane__scroller"
        onScroll={onScroll}
        ref={scroller}
        role="region"
        style={geometry}
        tabIndex={0}
      >
        <div className="log-pane__sizer">
          <div className="log-pane__window">
            {rows.length === 0 ? (
              <LogLine cursor kind="note" live={live} text={emptyNote} />
            ) : (
              rows
                .slice(first, last)
                .map((row) => (
                  <LogLine
                    cursor={row.key === cursorKey}
                    key={row.key}
                    kind={row.kind}
                    // Only the cursor's row is told, so the flag changing re-renders one row.
                    live={live && row.key === cursorKey}
                    text={row.text}
                  />
                ))
            )}
          </div>
        </div>
      </div>

      {/* One row nobody sees, to measure a row by. */}
      <div aria-hidden="true" className="log-pane__line log-pane__probe" ref={probe}>
        &nbsp;
      </div>
    </div>
  );
}

/** How many rows are rendered beyond each edge of what is in view. */
export const OVERSCAN = 30;

/** What the pane measured of itself. */
interface Measure {
  /** One row's height, in pixels. */
  readonly rowPx: number;
  /** How many rows fit in the pane, rounded up. */
  readonly visible: number;
}

/**
 * What is assumed until the pane has measured itself — and for good where nothing can be
 * measured (a test's DOM has no layout): a 20px row and forty of them.
 */
const UNMEASURED: Measure = Object.freeze({ rowPx: 20, visible: 40 });

/**
 * Fold a measurement in.
 *
 * @param held What was measured before.
 * @param rowPx The probe row's height.
 * @param panePx The scroller's inner height.
 * @returns The new measure — `held` itself when nothing moved, or when there is no layout to
 *   measure, so a resize that changed nothing renders nothing.
 */
function measured(held: Measure, rowPx: number, panePx: number): Measure {
  if (!(rowPx > 0) || !(panePx > 0)) return held;

  const visible = Math.ceil(panePx / rowPx);

  return held.rowPx === rowPx && held.visible === visible ? held : { rowPx, visible };
}

/**
 * The reading-order coordinate of the first row — the buffer's keys are consecutive, so a row's
 * coordinate is its key, and the note above the first line sits one before it.
 *
 * @param rows The rows.
 * @returns The coordinate; it grows by exactly the number of rows that have left the head.
 */
export function originOf(rows: readonly LogRow[]): number {
  const line = rows.find((row) => row.kind !== "note");
  if (line === undefined) return 0;

  return rows[0] === line ? line.key : line.key - 1;
}

/**
 * Which row carries the cursor: the last line the build printed.
 *
 * @param rows The rows.
 * @returns Its key, or `null` when no row is output — the markers and notes around the log are
 *   the pane's words, and a cursor after them would attribute them to the build.
 */
export function cursorRow(rows: readonly LogRow[]): number | null {
  for (let at = rows.length - 1; at >= 0; at -= 1) {
    if (rows[at].kind === "text") return rows[at].key;
  }

  return null;
}

/** The class each kind of row takes. Literal, so the style suite can find each one. */
const KIND_CLASS: Readonly<Record<LogRowKind, string>> = {
  text: "",
  gap: "log-pane__line--gap",
  note: "log-pane__line--note",
};

/**
 * One row.
 *
 * Memoised over primitives, so a page that appends rows re-renders none of the rows already
 * drawn — and the one row whose text grew re-renders alone.
 *
 * @param props.kind What kind of row.
 * @param props.text What it says.
 * @param props.cursor Whether the cursor follows it — which also makes it the accent last line.
 * @param props.live Whether the cursor blinks.
 * @returns The row.
 */
const LogLine = memo(function LogLine({
  kind,
  text,
  cursor,
  live,
}: Readonly<{ kind: LogRowKind; text: string; cursor: boolean; live: boolean }>) {
  return (
    <div className={cx("log-pane__line", KIND_CLASS[kind], cursor && "log-pane__line--last")}>
      {kind === "gap" ? <span className="log-pane__gap">{text}</span> : text}
      {cursor && (
        <span
          aria-hidden="true"
          className={cx("log-pane__cursor", live && "log-pane__cursor--live")}
        />
      )}
    </div>
  );
});
