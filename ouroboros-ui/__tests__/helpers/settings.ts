import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

/**
 * A scrolling pane for the settings scroll-spy to watch
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * jsdom has no layout: every box is at `0,0` with no height, nothing scrolls, and an element
 * has no `scrollIntoView`. The spy is asked three things of the DOM — where each section is
 * against the pane, how far the pane is scrolled, and what its `scroll-padding-top` is — so
 * this stands a pane up and answers exactly those from a table of section offsets, the way
 * `helpers/log-pane.ts` answers a log's geometry from its row count.
 *
 * The pane is a real element with `overflow-y: auto`, so `chromeScrollContainer` finds it by
 * the same walk it uses in the shell; the sections are real elements with real ids, so the
 * spy looks them up as it does in the product. Only the numbers are supplied.
 */

/** Where the fixture's sections sit, in pixels from the top of the pane's content. */
export type SectionLayout = Readonly<Record<string, number>>;

/** What a pane fixture hands back. */
export interface PaneFixture {
  /** The scrolling element — `document.body`'s child, holding the sections. */
  readonly pane: HTMLElement;
  /**
   * Scroll the pane, as a reader would, and let its listeners hear it.
   *
   * @param top The new `scrollTop`. Clamped to what the pane can scroll.
   */
  readonly scrollTo: (top: number) => void;
  /** How far the pane can scroll. */
  readonly max: number;
  /**
   * Shift the page under the reader without their doing: content mounts above the sections —
   * a bar, a banner — pushing every section down, and the browser's scroll anchoring moves
   * `scrollTop` by the same amount so that what is being read stays where it is on screen.
   *
   * @param by How many pixels of content arrived above the sections.
   */
  readonly shiftContent: (by: number) => void;
  /** Take the fixture out of the document and restore what it stubbed. */
  readonly remove: () => void;
}

/**
 * Stand up a pane with sections at known offsets.
 *
 * @param layout Each section's id and its offset from the top of the content.
 * @param options.clientHeight The pane's visible height. Defaults to `500`.
 * @param options.scrollHeight The content's full height. Defaults to `1200`.
 * @param options.padding The pane's `scroll-padding-top` — the height of the chrome stuck at
 *   its top plus the daylight below it. Defaults to `50`.
 * @returns The fixture.
 */
export function mountPane(
  layout: SectionLayout,
  options: { clientHeight?: number; scrollHeight?: number; padding?: number } = {},
): PaneFixture {
  const { clientHeight = 500, scrollHeight = 1200, padding = 50 } = options;
  const max = Math.max(0, scrollHeight - clientHeight);

  const pane = document.createElement("div");
  pane.style.overflowY = "auto";
  Object.defineProperty(pane, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(pane, "scrollHeight", { configurable: true, value: scrollHeight });
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, clientHeight);

  /** The pane's own anchor offset, which jsdom's style engine does not carry. */
  const computed = window.getComputedStyle.bind(window);
  const style = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const real = computed(element, pseudo);
    if (element !== pane) return real;

    return new Proxy(real, {
      get: (target, property) =>
        property === "scrollPaddingTop"
          ? `${String(padding)}px`
          : (Reflect.get(target, property) as unknown),
    });
  });

  const scrollTo = (top: number): void => {
    pane.scrollTop = Math.min(max, Math.max(0, top));
    fireEvent.scroll(pane);
  };

  /** How far content mounted above the sections has pushed them down. */
  let shifted = 0;

  for (const [id, offset] of Object.entries(layout)) {
    const section = document.createElement("div");

    section.id = id;
    section.getBoundingClientRect = () =>
      new DOMRect(0, offset + shifted - pane.scrollTop, 400, 100);
    // The browser's fragment scroll: the section's top to the pane's anchor line, as far as
    // the pane can go. The scroll event it causes is fired by the caller, as the browser
    // fires it — after the script that scrolled has finished.
    section.scrollIntoView = () => {
      pane.scrollTop = Math.min(max + shifted, Math.max(0, offset + shifted - padding));
    };
    pane.append(section);
  }

  document.body.append(pane);

  return {
    pane,
    scrollTo,
    max,
    shiftContent: (by) => {
      shifted += by;
      pane.scrollTop += by;
      fireEvent.scroll(pane);
    },
    remove: () => {
      style.mockRestore();
      pane.remove();
    },
  };
}
