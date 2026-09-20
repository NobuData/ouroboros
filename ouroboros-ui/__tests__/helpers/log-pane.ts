import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

/**
 * A geometry for the log pane (#261), which jsdom cannot give it.
 *
 * jsdom lays nothing out: every `clientHeight` and `scrollHeight` is `0`, so a pane can never be
 * anywhere but *at the bottom* and no suite could scroll one. These supply the two numbers from
 * what the component itself publishes — a row is {@link ROW_PX} high, a pane {@link PANE_PX}, and
 * the content is as tall as the row count in `--log-pane-rows` says.
 */

/** One row's height. The pane's own assumption where it cannot measure. */
export const ROW_PX = 20;

/** The scroller's inner height — ten rows. */
export const PANE_PX = 200;

/**
 * Give every log pane's scroller a geometry, from before its first layout effect — which is when
 * a pane that starts at the tail puts itself there. Undone by `vi.restoreAllMocks()`.
 *
 * @returns Nothing.
 */
export function layOutLogPanes(): void {
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("log-pane__scroller") ? PANE_PX : 0;
  });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return this instanceof HTMLElement
      ? Number(this.style.getPropertyValue("--log-pane-rows")) * ROW_PX
      : 0;
  });
}

/**
 * Scroll a pane, as a reader would.
 *
 * @param pane The scroller.
 * @param top Where to.
 * @returns Nothing.
 */
export function scrollPane(pane: HTMLElement, top: number): void {
  pane.scrollTop = top;
  fireEvent.scroll(pane);
}
