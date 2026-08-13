import { afterEach, describe, expect, it, vi } from "vitest";

import { focusStops, trapTab } from "@/app/shell/focus-trap";

/**
 * The trap the overlay (CP.1) and the sidebar drawer (CP.2) share.
 *
 * Both cover the page, and a surface that covers the page and lets Tab walk out behind it is
 * a surface a keyboard reader cannot use. The cases below are the four states the cycle has —
 * the two edges, the middle, and the surface with nothing in it — plus the two shapes that
 * look focusable and are not.
 */

/** Everything mounted by a case, taken down again afterwards. */
const mounted: HTMLElement[] = [];

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.remove();
});

/**
 * A surface holding the markup given.
 *
 * @param html What is inside it.
 * @returns The surface, attached to the document so focus actually moves.
 */
function surface(html: string): HTMLElement {
  const root = document.createElement("div");
  root.tabIndex = -1;
  root.innerHTML = html;
  document.body.append(root);
  mounted.push(root);

  return root;
}

/**
 * A key press, in the shape the trap reads.
 *
 * @param key Which key.
 * @param shiftKey Whether Shift was held.
 * @returns The event, with a spy for `preventDefault`.
 */
function press(key: string, shiftKey = false) {
  return { key, shiftKey, preventDefault: vi.fn() };
}

describe("focusStops", () => {
  it("finds what Tab can reach, in document order", () => {
    const root = surface('<a href="/a">a</a><button>b</button><input />');

    expect(focusStops(root).map((stop) => stop.tagName)).toEqual([
      "A",
      "BUTTON",
      "INPUT",
    ]);
  });

  it("skips a disabled control, which Tab skips too", () => {
    const root = surface("<button disabled>off</button><button>on</button>");

    expect(focusStops(root)).toHaveLength(1);
  });

  it("keeps one that explains itself instead of being switched off", () => {
    // `aria-disabled` rather than `disabled` is the pattern the header's settings gear keeps:
    // a control removed from the tab order takes its own explanation with it.
    const root = surface('<button aria-disabled="true">why</button>');

    expect(focusStops(root)).toHaveLength(1);
  });

  it("skips an element parked out of the tab order", () => {
    const root = surface('<div tabindex="-1">target, not a stop</div>');

    expect(focusStops(root)).toHaveLength(0);
  });
});

describe("trapTab", () => {
  it("leaves every other key alone", () => {
    const root = surface("<button>a</button>");
    const event = press("Escape");

    trapTab(event, root);

    // Escape belongs to the caller: only it knows what closing means.
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("holds focus on a surface with nothing focusable in it", () => {
    const root = surface("<p>nothing to reach</p>");
    const event = press("Tab");

    trapTab(event, root);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("wraps from the last stop back to the first", () => {
    const root = surface("<button>first</button><button>last</button>");
    const stops = focusStops(root);
    stops[1].focus();
    const event = press("Tab");

    trapTab(event, root);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(stops[0]);
  });

  it("wraps backwards from the first stop to the last", () => {
    const root = surface("<button>first</button><button>last</button>");
    const stops = focusStops(root);
    stops[0].focus();
    const event = press("Tab", true);

    trapTab(event, root);

    expect(document.activeElement).toBe(stops[1]);
  });

  it("wraps backwards from the surface itself, which is where opening put focus", () => {
    const root = surface("<button>first</button><button>last</button>");
    root.focus();
    const event = press("Tab", true);

    trapTab(event, root);

    expect(document.activeElement).toBe(focusStops(root)[1]);
  });

  it("does nothing in the middle of the list, where Tab is already right", () => {
    // A guard on every move would fight the browser; the trap only acts at the two edges.
    const root = surface("<button>a</button><button>b</button><button>c</button>");
    const stops = focusStops(root);
    stops[1].focus();
    const event = press("Tab");

    trapTab(event, root);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(stops[1]);
  });
});
