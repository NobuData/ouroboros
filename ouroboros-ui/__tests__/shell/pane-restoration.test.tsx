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

describe("outside the shell", () => {
  it("mounts without a pane without complaint", () => {
    // The § 5 screens render outside the shell; a shell-less mount has nothing to restore
    // and nothing to listen to, and that is a case rather than an error.
    pane.remove();

    expect(() => render(<PaneRestoration />)).not.toThrow();
  });
});
