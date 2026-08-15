/**
 * The in-pane chrome contract ([#646](https://github.com/NobuData/ouroboros/issues/646)) —
 * how sticky chrome tells the things beneath it how tall it is.
 *
 * The shell gives every page one scroll container (`docs/DESIGN_SYSTEM_APP_SHELL.md`
 * § 1.3), and everything that sticks — a page subnav, a dirty-state bar, a table header —
 * sticks against *it*. That makes stacking a shared problem: the bar has to start where the
 * subnav ends, the table header where the bar ends, and an anchor jump has to land its
 * target below all of them. Four consumers, one fact each way: the measured height of the
 * chrome above.
 *
 * The fact travels as two custom properties on the scroll container itself:
 *
 * | property                | set by      | read by                                       |
 * |-------------------------|-------------|-----------------------------------------------|
 * | {@link CHROME_SUBNAV_PROPERTY} | `PageSubnav` | `StickyBar`'s `top`, the table header's `top`, the pane's `scroll-padding-top` |
 * | {@link CHROME_BAR_PROPERTY}    | `StickyBar`  | the table header's `top`, the pane's `scroll-padding-top` |
 *
 * The stacking order itself is fixed rather than configurable — subnav above bar above
 * table header, top to bottom in that order and front to back in the same order — because
 * an order that each page chose would be the race this contract exists to end: the second
 * team to add a sticky element covering the first team's. The order is written into
 * `ui.css` as three `z-index` steps (12, 11, 10) and three `top` rules, and this module is
 * where the heights those rules read come from.
 *
 * ### Why measured, not declared
 *
 * A subnav's height is its type size plus its padding, and the type size follows the
 * reader's font-size preference (§ 4) — five steps, any of which changes the height. A
 * hard-coded offset is correct at exactly one of them. So each piece of chrome measures
 * itself, publishes the measurement, and re-publishes when it changes; nothing downstream
 * ever states a height it does not own.
 *
 * ### Why the properties live on the scroll container
 *
 * The readers are spread across the tree — a `th` deep inside a table, the container's own
 * `scroll-padding-top` — and custom properties reach descendants only. The scroll container
 * is the one element that is an ancestor of everything that sticks against it, and it is
 * also the element the offsets are *about*. In the shell that is the content pane; in a
 * test or the #48 workshop it is whatever the fixture scrolls, which is why the container
 * is found by asking the DOM rather than by importing the shell.
 *
 * **Framework-free and DOM-only**, the way `app/shell/pane-scroll.ts` is: the mechanism is
 * the part with the interesting bugs, so it is testable without React. The React face is
 * `app/ui/use-chrome-extent.ts`, four lines away.
 */

/** The published height of the page subnav, as a px length. `0` when none is mounted. */
export const CHROME_SUBNAV_PROPERTY = "--ou-chrome-subnav";

/** The published height of the sticky bar, as a px length. `0` when none is mounted. */
export const CHROME_BAR_PROPERTY = "--ou-chrome-bar";

/**
 * Find the scroll container a piece of chrome sticks against.
 *
 * The nearest ancestor whose computed `overflow-y` makes it a scrollport — which is what
 * `position: sticky` itself is constrained by, so the element found here is by definition
 * the one the chrome sticks to. In the shell that is `.app-shell__pane`; the walk exists so
 * the primitives also work inside any other scrolling fixture (the #48 workshop, a test)
 * without knowing the shell's name for it.
 *
 * @param from The chrome element about to publish its height.
 * @returns The scroll container, or `null` when no ancestor scrolls — a page rendered
 *   outside any scrollport, where sticking is meaningless and publishing has no reader.
 */
export function chromeScrollContainer(from: HTMLElement): HTMLElement | null {
  for (let node = from.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }

  return null;
}

/**
 * Publish a chrome element's height to its scroll container, and keep it published.
 *
 * The height is written as an inline custom property (`42px`) on the container, which is
 * what the `top`, `z-index` and `scroll-padding-top` rules in `ui.css` and
 * `app/shell/shell.css` read. It tracks the element through resizes — a font-scale change,
 * a viewport change that rewraps the bar — via `ResizeObserver` where the environment has
 * one; where it does not (jsdom), the mount-time measurement stands, which is exactly what
 * a test can assert against.
 *
 * One publisher per property per container: two subnavs in one pane would overwrite each
 * other's fact, and the stacking contract this serves defines one of each anyway.
 *
 * @param chrome The sticky element to measure — its border-box height, which is the height
 *   the next layer down must clear.
 * @param property Which fact this element owns: {@link CHROME_SUBNAV_PROPERTY} or
 *   {@link CHROME_BAR_PROPERTY}.
 * @returns The unpublish function: stops observing and removes the property, so an
 *   unmounted subnav does not leave a stale offset pushing everything down. Idempotent.
 */
export function publishChromeExtent(chrome: HTMLElement, property: string): () => void {
  const container = chromeScrollContainer(chrome);
  if (container === null) return () => {};

  const measure = () => {
    container.style.setProperty(property, `${chrome.offsetHeight}px`);
  };

  measure();

  // Watching the chrome rather than the container: the fact published is the chrome's own
  // height, and the container resizing does not change it (a rewrap that does will fire
  // for the chrome too).
  const observer =
    typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
  observer?.observe(chrome);

  let published = true;

  return () => {
    if (!published) return;
    published = false;

    observer?.disconnect();
    container.style.removeProperty(property);
  };
}
