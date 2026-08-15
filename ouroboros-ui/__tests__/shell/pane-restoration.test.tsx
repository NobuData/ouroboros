import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pane's scroll memory (#646) — `app/shell/pane-restoration.tsx` over
 * `app/shell/pane-position.ts`.
 *
 * The property under test is the specification's sentence (§ 1.3): *"Scroll position
 * restored per route on back/forward"* — plus the issue's other half, *a push starts at
 * the top*. jsdom neither navigates nor scrolls, which is exactly why the component reads
 * the world through three seams this suite can drive directly: the URL arrives through
 * `next/navigation`'s hooks (mocked, as `sidebar-nav.test.tsx` mocks them), a traversal
 * announces itself as `popstate`, and the pane is whatever element carries the shell's id.
 * That a browser then fires these in the order assumed is the shell e2e leg's to certify
 * (CP.5's scroll-restoration leg drives it against the workshop fixture).
 */

/** The URL the mocked hooks answer with — the suite's stand-in for the router. */
const route = { pathname: "/workshop/chrome", search: "" };

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));

const { PaneRestoration } = await import("@/app/shell/pane-restoration");
const { resetPanePositions } = await import("@/app/shell/pane-position");
const { CONTENT_ID } = await import("@/app/shell/regions");

/** The pane, as the tests build it: the element the shell's id names. */
let pane: HTMLElement;

beforeEach(() => {
  pane = document.createElement("div");
  pane.id = CONTENT_ID;
  document.body.appendChild(pane);

  route.pathname = "/workshop/chrome";
  route.search = "";
  window.history.replaceState(null, "", route.pathname);
});

afterEach(() => {
  pane.remove();
  resetPanePositions();
  window.history.replaceState(null, "", "/");
});

/**
 * Scroll the pane the way a reader does: the offset lands, and the scroll event follows.
 *
 * @param top Where to.
 */
function readerScrollsTo(top: number): void {
  pane.scrollTop = top;
  fireEvent.scroll(pane);
}

/**
 * Navigate the way the router does on a push: the URL changes, the component re-renders.
 *
 * @param rerender The render handle's rerender.
 * @param pathname Where to.
 * @param hash A fragment, when the push carries one.
 */
function pushed(rerender: (ui: React.ReactElement) => void, pathname: string, hash = ""): void {
  route.pathname = pathname;
  window.history.pushState(null, "", pathname + hash);
  rerender(<PaneRestoration />);
}

/**
 * Navigate the way the browser does on back/forward: the URL is already the destination
 * when `popstate` fires, and the router re-renders after.
 *
 * @param rerender The render handle's rerender.
 * @param pathname Where the traversal landed.
 */
function traversed(rerender: (ui: React.ReactElement) => void, pathname: string): void {
  window.history.replaceState(null, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
  route.pathname = pathname;
  rerender(<PaneRestoration />);
}

describe("a push", () => {
  it("starts at the top, which the browser no longer does for the pane", () => {
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);

    pushed(rerender, "/dashboard");

    expect(pane.scrollTop).toBe(0);
  });

  it("leaves a push carrying a fragment to the router's own scroll", () => {
    // The router scrolls the target into view itself, offset by the pane's
    // scroll-padding-top; a reset here would race it to the same frame.
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);

    pushed(rerender, "/dashboard", "#anchors");

    expect(pane.scrollTop).toBe(800);
  });
});

describe("a traversal", () => {
  it("restores the position the reader left the route at", () => {
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);

    pushed(rerender, "/dashboard");
    traversed(rerender, "/workshop/chrome");

    expect(pane.scrollTop).toBe(800);
  });

  it("goes forward to the top the push left, not the top of the memory", () => {
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);
    pushed(rerender, "/dashboard");
    traversed(rerender, "/workshop/chrome");

    traversed(rerender, "/dashboard");

    expect(pane.scrollTop).toBe(0);
  });

  it("restores the latest position, not the first", () => {
    // The memory is written on scroll rather than at departure, so what comes back is
    // wherever the reader last was — including a position reached after an earlier visit.
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(300);
    readerScrollsTo(900);

    pushed(rerender, "/dashboard");
    traversed(rerender, "/workshop/chrome");

    expect(pane.scrollTop).toBe(900);
  });

  it("keeps two filtered views of one route apart", () => {
    // Restoration is per `pathname?search`: the same screen under a different query is a
    // different reading position.
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(400);

    route.search = "tab=keys";
    route.pathname = "/models";
    window.history.pushState(null, "", "/models?tab=keys");
    rerender(<PaneRestoration />);
    readerScrollsTo(150);

    window.history.replaceState(null, "", "/workshop/chrome");
    window.dispatchEvent(new PopStateEvent("popstate"));
    route.search = "";
    route.pathname = "/workshop/chrome";
    rerender(<PaneRestoration />);

    expect(pane.scrollTop).toBe(400);
  });
});

describe("a departure the router scrolled through", () => {
  it("remembers where the reader pressed, not where the transition landed", () => {
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);

    // The reader presses a link: the capture-phase snapshot hears the pointer go down
    // before anything else…
    fireEvent.pointerDown(document.body);
    // …then the router commits the destination and walks it into view — a pane scroll
    // under the departed route's key, because the URL only moves later still…
    readerScrollsTo(2449);
    // …and finally the URL moves and the component re-renders, which is where the
    // departed route's memory is reconciled back to the press.
    pushed(rerender, "/dashboard");
    traversed(rerender, "/workshop/chrome");

    expect(pane.scrollTop).toBe(800);
  });

  it("lets a press that started no navigation expire with the next one", () => {
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(200);

    // A press that navigates nowhere, then honest scrolling: the stale snapshot must
    // not drag the memory back to 200 when a later navigation really departs.
    fireEvent.pointerDown(document.body);
    readerScrollsTo(800);
    fireEvent.pointerDown(document.body);

    pushed(rerender, "/dashboard");
    traversed(rerender, "/workshop/chrome");

    expect(pane.scrollTop).toBe(800);
  });
});

describe("a traversal the router rendered first", () => {
  it("restores anyway, from the popstate listener", () => {
    // This Next flushes a traversal's render inside its own popstate handler, which was
    // bound at hydration — before the component's listener — so the component re-renders
    // (and its push-reset runs) before `popstate` ever reaches it. The listener finds the
    // destination already current and restores on the spot.
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);
    pushed(rerender, "/dashboard");

    route.pathname = "/workshop/chrome";
    window.history.replaceState(null, "", "/workshop/chrome");
    rerender(<PaneRestoration />);
    expect(pane.scrollTop).toBe(0);

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(pane.scrollTop).toBe(800);
  });

  it("leaves a hash-only traversal to the browser's own fragment walk", () => {
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);
    readerScrollsTo(300);

    // Back across #a → #b: the key never changes, the destination is already current,
    // and the pane's offset belongs to the fragment being walked to — not to the memory.
    window.history.replaceState(null, "", "/workshop/chrome#stacking");
    window.dispatchEvent(new PopStateEvent("popstate"));
    rerender(<PaneRestoration />);

    expect(pane.scrollTop).toBe(300);
  });
});

describe("a hash-only traversal", () => {
  it("does not arm restoration against the push that follows", () => {
    // Back across #a → #b keeps the route, so the route effect never runs to consume a
    // mark — one left standing would misfile the next push as a traversal and carry an
    // old offset onto a fresh page.
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);

    // The traversal lands on the same route, hash aside.
    window.history.replaceState(null, "", "/workshop/chrome#stacking");
    window.dispatchEvent(new PopStateEvent("popstate"));

    pushed(rerender, "/dashboard");

    expect(pane.scrollTop).toBe(0);
  });
});

describe("a traversal into a destination still streaming", () => {
  /** The queued animation frames, run by hand — jsdom schedules but never paints. */
  let frames: FrameRequestCallback[];

  /** What the pane can currently scroll to — the stand-in for how much has arrived. */
  let maxScroll: number;

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number): void => {
      frames[handle - 1] = () => undefined;
    });

    // A pane that clamps like a real one: jsdom's own scrollTop accepts any value, which
    // is exactly the browser behaviour difference that let the clamp bug pass every unit
    // test and fail the e2e leg (#647). The setter clamps to what has "arrived".
    maxScroll = 10_000;
    let top = 0;
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, maxScroll));
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Run one queued frame, the way a paint would. */
  function nextFrame(): void {
    const queued = frames.splice(0);
    for (const frame of queued) frame(performance.now());
  }

  it("keeps re-applying the offset until the pane is tall enough to take it", () => {
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);
    pushed(rerender, "/dashboard");

    // The router refetched the destination: at effect time only a short fallback is on
    // the page, and the first write clamps to it.
    maxScroll = 0;
    traversed(rerender, "/workshop/chrome");
    expect(pane.scrollTop).toBe(0);

    // The content arrives; the next frame's write lands the remembered offset.
    maxScroll = 10_000;
    nextFrame();

    expect(pane.scrollTop).toBe(800);
  });

  it("stops deciding the moment the reader scrolls on their own", () => {
    const { rerender } = render(<PaneRestoration />);
    readerScrollsTo(800);
    pushed(rerender, "/dashboard");

    maxScroll = 0;
    traversed(rerender, "/workshop/chrome");

    // The reader reaches for the wheel while the destination is still streaming — the
    // loop must let go rather than yank them to a position they have abandoned.
    fireEvent.wheel(window);
    maxScroll = 10_000;
    nextFrame();

    expect(pane.scrollTop).toBe(0);
  });
});

describe("outside the shell", () => {
  it("mounts without a pane without complaint", () => {
    // The § 5 screens render outside the shell; a shell-less mount has nothing to restore
    // and nothing to listen to, and that is a case rather than an error.
    pane.remove();

    expect(() => render(<PaneRestoration />)).not.toThrow();
  });
});
