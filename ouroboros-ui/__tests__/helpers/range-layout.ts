/**
 * jsdom lays nothing out, and its `Range` has no `getClientRects` or `getBoundingClientRect` at all.
 * CodeMirror measures a range when it scrolls one into view — the code editor's jump to a diagnostic
 * (V.4, #172) — and a missing method there is an uncaught error in a suite that asserted nothing about
 * layout. This gives every range the empty box a browser gives a range that is not rendered.
 *
 * Only what is missing is defined, so a jsdom that learns layout keeps its own.
 */

/** A box with no size, at the origin. */
const EMPTY_RECT = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
} as DOMRect;

/** Give `Range` the two measuring methods jsdom leaves out. Safe to call more than once. */
export function stubRangeLayout(): void {
  const prototype = Range.prototype as Partial<Pick<Range, "getClientRects" | "getBoundingClientRect">>;

  if (typeof prototype.getClientRects !== "function") {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    });
  }
  if (typeof prototype.getBoundingClientRect !== "function") {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => EMPTY_RECT });
  }
}
