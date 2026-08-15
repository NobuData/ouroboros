import { afterEach, describe, expect, it, vi } from "vitest";

import { CHROME_BAR_PROPERTY, CHROME_SUBNAV_PROPERTY, chromeScrollContainer, publishChromeExtent } from "@/app/ui";

/**
 * The in-pane chrome contract's mechanism (#646) — `app/ui/chrome.ts`.
 *
 * The stacking rules in `ui.css` and the pane's anchor offset in `shell.css` all read two
 * custom properties from the scroll container, and this module is where they come from.
 * jsdom lays nothing out — every `offsetHeight` is zero unless a test says otherwise, and
 * there is no ResizeObserver at all — which cuts the suite cleanly in two: what is
 * asserted here is the *bookkeeping* (which element is found, what is written where, what
 * a cleanup removes), with the geometry stubbed; that real layout produces real heights is
 * the shell e2e leg's to certify.
 */

/** The elements each test hangs off the document, removed again after it. */
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/**
 * A pane with chrome inside it, in miniature: a scrolling container, an intermediate
 * wrapper (so the walk is a walk), and the chrome element itself.
 *
 * @param overflowY The container's overflow, defaulting to the pane's own `auto`.
 * @returns The container and the chrome.
 */
function fixture(overflowY = "auto"): { container: HTMLElement; chrome: HTMLElement } {
  const container = document.createElement("div");
  container.style.overflowY = overflowY;

  const between = document.createElement("section");
  const chrome = document.createElement("nav");

  between.appendChild(chrome);
  container.appendChild(between);
  document.body.appendChild(container);

  return { container, chrome };
}

/**
 * Give an element the measured height jsdom will not compute.
 *
 * @param element The element to measure.
 * @param height What `offsetHeight` should answer.
 */
function measuring(element: HTMLElement, height: number): void {
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
}

describe("finding the scroll container", () => {
  it("finds the nearest ancestor that scrolls, however deep the chrome sits", () => {
    const { container, chrome } = fixture();

    expect(chromeScrollContainer(chrome)).toBe(container);
  });

  it("accepts an always-on scrollbar as readily as an automatic one", () => {
    const { container, chrome } = fixture("scroll");

    expect(chromeScrollContainer(chrome)).toBe(container);
  });

  it("answers null where nothing scrolls, because sticking is meaningless there", () => {
    // The login screen and the onboarding wizard render outside the shell (§ 5) — a
    // primitive mounted there has no scrollport, and publishing would have no reader.
    const { chrome } = fixture("visible");

    expect(chromeScrollContainer(chrome)).toBeNull();
  });

  it("binds to the nearest scrollport, not the outermost", () => {
    // The workshop's sample well is exactly this: a scrolling box inside the pane, whose
    // own subnav must publish to it rather than over its head to the pane.
    const { container: pane } = fixture();
    const inner = document.createElement("div");
    inner.style.overflowY = "auto";
    const chrome = document.createElement("nav");
    inner.appendChild(chrome);
    pane.appendChild(inner);

    expect(chromeScrollContainer(chrome)).toBe(inner);
  });
});

describe("publishing a height", () => {
  it("writes the measured height on the container, in the unit the rules read", () => {
    const { container, chrome } = fixture();
    measuring(chrome, 42);

    publishChromeExtent(chrome, CHROME_SUBNAV_PROPERTY);

    expect(container.style.getPropertyValue(CHROME_SUBNAV_PROPERTY)).toBe("42px");
  });

  it("keeps the two facts apart, so a subnav and a bar cannot overwrite each other", () => {
    const { container, chrome: subnav } = fixture();
    const bar = document.createElement("div");
    container.appendChild(bar);
    measuring(subnav, 42);
    measuring(bar, 56);

    publishChromeExtent(subnav, CHROME_SUBNAV_PROPERTY);
    publishChromeExtent(bar, CHROME_BAR_PROPERTY);

    expect(container.style.getPropertyValue(CHROME_SUBNAV_PROPERTY)).toBe("42px");
    expect(container.style.getPropertyValue(CHROME_BAR_PROPERTY)).toBe("56px");
  });

  it("republishes when the chrome resizes, so a font-scale change moves the stack", () => {
    // jsdom has no ResizeObserver, so the one observed here is the test's own — which is
    // also the assertion that the module reaches for one when the environment offers it.
    const observed: { callback: ResizeObserverCallback; elements: Element[] }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        elements: Element[] = [];
        constructor(readonly callback: ResizeObserverCallback) {
          observed.push({ callback, elements: this.elements });
        }
        observe(element: Element) {
          this.elements.push(element);
        }
        disconnect() {}
      },
    );

    const { container, chrome } = fixture();
    measuring(chrome, 42);
    publishChromeExtent(chrome, CHROME_SUBNAV_PROPERTY);

    expect(observed[0]?.elements).toEqual([chrome]);

    measuring(chrome, 63); // the 150% font step, to the pixel
    observed[0]?.callback([], {} as ResizeObserver);

    expect(container.style.getPropertyValue(CHROME_SUBNAV_PROPERTY)).toBe("63px");
  });

  it("withdraws the fact when unpublished, so unmounted chrome stops pushing things down", () => {
    const { container, chrome } = fixture();
    measuring(chrome, 42);

    const unpublish = publishChromeExtent(chrome, CHROME_SUBNAV_PROPERTY);
    unpublish();

    expect(container.style.getPropertyValue(CHROME_SUBNAV_PROPERTY)).toBe("");
  });

  it("releases only once, so a re-run effect cleanup cannot erase a successor's fact", () => {
    // The same idempotence `pane-scroll.ts` keeps, for the same Strict Mode reason.
    const { container, chrome } = fixture();
    measuring(chrome, 42);

    const first = publishChromeExtent(chrome, CHROME_SUBNAV_PROPERTY);
    first();
    publishChromeExtent(chrome, CHROME_SUBNAV_PROPERTY);
    first();

    expect(container.style.getPropertyValue(CHROME_SUBNAV_PROPERTY)).toBe("42px");
  });

  it("does nothing, calmly, where there is no container to publish to", () => {
    const { chrome } = fixture("visible");

    const unpublish = publishChromeExtent(chrome, CHROME_SUBNAV_PROPERTY);

    expect(() => unpublish()).not.toThrow();
  });
});
