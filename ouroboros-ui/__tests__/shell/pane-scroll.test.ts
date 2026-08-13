import { afterEach, describe, expect, it } from "vitest";

import {
  PANE_GUTTER_PROPERTY,
  PANE_LOCKED_CLASS,
  isPaneLocked,
  lockPaneScroll,
} from "@/app/shell/pane-scroll";

/**
 * The pane lock ([#643](https://github.com/NobuData/ouroboros/issues/643)) — the mechanism
 * behind the acceptance criterion *"opening an overlay locks pane scroll; closing it restores
 * the previous position"*.
 *
 * It is tested here as a mechanism rather than through the dialog that calls it, because the
 * interesting failures are not visual: a gutter measured after the class lands is a gutter of
 * zero, a count that unlocks on the first of two closes leaves the page scrolling under a
 * dialog that is still open, and a cleanup that runs twice under React's Strict Mode
 * double-invoke would unlock a pane somebody else is holding. None of those look wrong in a
 * rendered snapshot; all of them are one assertion each here.
 *
 * ### Why the element is hand-built
 *
 * jsdom does no layout, so a rendered pane reports `offsetWidth`, `clientWidth` and
 * `scrollTop` as zero and never changes them. {@link pane} defines the three properties the
 * module actually reads, which turns "what does it do with a 15px gutter" into a case a test
 * can state — and makes the module's contract with the DOM explicit rather than implied.
 */

/** Panes built by {@link pane}, removed after each case. */
const built: HTMLElement[] = [];

afterEach(() => {
  for (const element of built.splice(0)) element.remove();
});

/**
 * A stand-in for the content pane, with the three properties the lock reads.
 *
 * @param gutter Width of the reserved scrollbar gutter, in pixels. Zero is a platform with
 *   overlay scrollbars, which is the case where the lock must change no widths at all.
 * @param scrollTop Where it is scrolled to.
 * @returns The element, attached to the document.
 */
function pane(gutter = 15, scrollTop = 0): HTMLElement {
  const element = document.createElement("div");
  let top = scrollTop;

  Object.defineProperty(element, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(element, "offsetWidth", { value: 800 + gutter, configurable: true });
  Object.defineProperty(element, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
    configurable: true,
  });

  document.body.append(element);
  built.push(element);

  return element;
}

describe("locking the pane", () => {
  it("puts it into its locked state", () => {
    const element = pane();

    lockPaneScroll(element);

    expect(element).toHaveClass(PANE_LOCKED_CLASS);
    expect(isPaneLocked(element)).toBe(true);
  });

  it("hands back the gutter it is about to take away", () => {
    // The measurement the whole rule exists for: `overflow: hidden` un-reserves the gutter
    // `scrollbar-gutter: stable` was holding, so without this the pane's content box grows by
    // 15px and every line in it reflows under the dialog.
    const element = pane(15);

    lockPaneScroll(element);

    expect(element.style.getPropertyValue(PANE_GUTTER_PROPERTY)).toBe("15px");
  });

  it("takes nothing away where there was no gutter to take", () => {
    // Overlay scrollbars — macOS, most touch platforms. The compensation must be zero rather
    // than a guess at a scrollbar width, or the dialog shifts the page it is covering.
    const element = pane(0);

    lockPaneScroll(element);

    expect(element.style.getPropertyValue(PANE_GUTTER_PROPERTY)).toBe("0px");
  });
});

describe("releasing it", () => {
  it("restores the scroll position the reader was at", () => {
    const element = pane(15, 1_200);

    const release = lockPaneScroll(element);
    release();

    expect(element.scrollTop).toBe(1_200);
  });

  it("leaves nothing of the lock behind", () => {
    const element = pane();

    lockPaneScroll(element)();

    expect(element).not.toHaveClass(PANE_LOCKED_CLASS);
    expect(element.style.getPropertyValue(PANE_GUTTER_PROPERTY)).toBe("");
    expect(isPaneLocked(element)).toBe(false);
  });

  it("releases once however many times it is called", () => {
    // React's Strict Mode double-invokes an effect's cleanup in development. A release that
    // decremented twice would unlock a pane the second overlay is still holding.
    const element = pane(15, 300);
    const first = lockPaneScroll(element);
    lockPaneScroll(element);

    first();
    first();

    expect(isPaneLocked(element)).toBe(true);
    expect(element).toHaveClass(PANE_LOCKED_CLASS);
  });
});

describe("two overlays at once", () => {
  it("stays locked until the last of them closes", () => {
    // A dialog that opens a confirmation. The first to close must not unlock the pane.
    const element = pane(15, 900);
    const outer = lockPaneScroll(element);
    const inner = lockPaneScroll(element);

    inner();
    expect(element).toHaveClass(PANE_LOCKED_CLASS);

    outer();
    expect(element).not.toHaveClass(PANE_LOCKED_CLASS);
    expect(element.scrollTop).toBe(900);
  });

  it("remembers where the first of them found it", () => {
    // Not where the second did: by then the pane is already held and cannot have moved, and a
    // second reading would only be a chance to record a zero.
    const element = pane(15, 640);
    const outer = lockPaneScroll(element);

    element.scrollTop = 0;
    const inner = lockPaneScroll(element);

    inner();
    outer();

    expect(element.scrollTop).toBe(640);
  });
});

describe("two panes", () => {
  it("count separately, so one cannot hold the other", () => {
    // The count is kept per element rather than in a module-level counter — which is also
    // what stops a suite that renders a fresh shell from inheriting the last one's lock.
    const first = pane();
    const second = pane();

    lockPaneScroll(first);

    expect(isPaneLocked(first)).toBe(true);
    expect(isPaneLocked(second)).toBe(false);
  });
});
