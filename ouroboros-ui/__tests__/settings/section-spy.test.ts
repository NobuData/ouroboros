import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  pinHolds,
  scrolledToEnd,
  sectionAtLine,
  sectionFromHash,
  watchSections,
} from "@/app/settings/section-spy";

import { type PaneFixture, mountPane } from "../helpers/settings";

/**
 * The section nav's scroll-spy (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)): which section is current,
 * measured against the **pane's** scroll — the hazard the issue names — and which section a
 * press or a deep link holds.
 */

/** The six anchors. */
const IDS = ["workspace", "members", "policies", "integrations", "audit", "danger"] as const;

/**
 * Mockup 17's rows at desktop width: Workspace beside Members, Policies beside Audit,
 * Integrations (beside Notifications), the Danger zone last.
 */
const LAYOUT = {
  workspace: 180,
  members: 180,
  policies: 480,
  audit: 480,
  integrations: 760,
  danger: 900,
};

let fixture: PaneFixture | undefined;

/**
 * Press a link without letting jsdom try to follow it: the default is prevented at the far end
 * of the event's path, after every listener under test has heard the press.
 *
 * @param element What to press.
 * @param init The click's modifiers.
 */
function press(element: Element, init: MouseEventInit = {}): void {
  const swallow = (event: Event): void => {
    event.preventDefault();
  };

  window.addEventListener("click", swallow);
  fireEvent.click(element, init);
  window.removeEventListener("click", swallow);
}

afterEach(() => {
  fixture?.remove();
  fixture = undefined;
  window.history.replaceState(null, "", "/");
});

describe("the section at the reading line", () => {
  /** Positions against the pane's top edge, with the pane scrolled by `top`. */
  const at = (top: number) => IDS.map((id) => ({ id, top: LAYOUT[id] - top }));

  it("is the first section while the page is at its head", () => {
    expect(sectionAtLine(at(0), 50)).toBe("workspace");
  });

  it("is the section whose top most recently reached the line", () => {
    expect(sectionAtLine(at(130), 50)).toBe("workspace");
    // Two pixels short of the line is short of it; one is sub-pixel layout.
    expect(sectionAtLine(at(428), 50)).toBe("workspace");
    expect(sectionAtLine(at(430), 50)).toBe("policies");
    expect(sectionAtLine(at(710), 50)).toBe("integrations");
    expect(sectionAtLine(at(850), 50)).toBe("danger");
  });

  it("is the left-hand section of a row two share — the first in the nav's order", () => {
    // Workspace and Members share a top, and so do Policies and Audit.
    expect(sectionAtLine(at(200), 50)).toBe("workspace");
    expect(sectionAtLine(at(500), 50)).toBe("policies");
  });

  it("follows the line: a taller stack of chrome moves it down", () => {
    expect(sectionAtLine(at(400), 50)).toBe("workspace");
    expect(sectionAtLine(at(400), 80)).toBe("policies");
  });

  it("forgives a pixel of sub-pixel layout either way", () => {
    expect(sectionAtLine([{ id: "a", top: 0 }, { id: "b", top: 50.6 }], 50)).toBe("b");
    expect(sectionAtLine([{ id: "a", top: 0 }, { id: "b", top: 51.5 }], 50)).toBe("a");
  });

  it("is the last section at the end of the page, whatever is on the line", () => {
    // The Danger zone is shorter than the pane: the page ends before it reaches the line.
    expect(sectionAtLine(at(700), 50)).toBe("policies");
    expect(sectionAtLine(at(700), 50, true)).toBe("danger");
  });

  it("is nothing when there are no sections", () => {
    expect(sectionAtLine([], 50)).toBeNull();
  });
});

describe("the end of the page", () => {
  it("is a pane scrolled as far as it goes", () => {
    expect(scrolledToEnd({ scrollTop: 700, clientHeight: 500, scrollHeight: 1200 })).toBe(true);
    expect(scrolledToEnd({ scrollTop: 699.5, clientHeight: 500, scrollHeight: 1200 })).toBe(true);
    expect(scrolledToEnd({ scrollTop: 600, clientHeight: 500, scrollHeight: 1200 })).toBe(false);
  });

  it("is not a page short enough to fit — that one is at its start", () => {
    // Reading it as the end would light the last tab on arrival.
    expect(scrolledToEnd({ scrollTop: 0, clientHeight: 900, scrollHeight: 800 })).toBe(false);
    expect(scrolledToEnd({ scrollTop: 0, clientHeight: 900, scrollHeight: 900 })).toBe(false);
  });
});

describe("a held section", () => {
  it("holds while the section is where the jump put it on screen", () => {
    expect(pinHolds({ id: "audit", top: 50 }, 50)).toBe(true);
    expect(pinHolds({ id: "audit", top: 50 }, 50.8)).toBe(true);
  });

  it("is released the moment the reader scrolls it somewhere else", () => {
    expect(pinHolds({ id: "audit", top: 50 }, 20)).toBe(false);
    expect(pinHolds({ id: "audit", top: 50 }, 80)).toBe(false);
  });

  it("does not hold a section that is gone, or nothing at all", () => {
    expect(pinHolds({ id: "audit", top: 50 }, null)).toBe(false);
    expect(pinHolds(null, 50)).toBe(false);
  });
});

describe("a fragment", () => {
  it("names a section, with or without its #", () => {
    expect(sectionFromHash(IDS, "#policies")).toBe("policies");
    expect(sectionFromHash(IDS, "danger")).toBe("danger");
  });

  it("names nothing when it is empty, unknown, or not validly encoded", () => {
    expect(sectionFromHash(IDS, "")).toBeNull();
    expect(sectionFromHash(IDS, "#appearance")).toBeNull();
    expect(sectionFromHash(IDS, "#%E0%A4%A")).toBeNull();
  });
});

describe("watching the pane", () => {
  it("reports the first section on a page at its head", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();

    watchSections(IDS, onActive).stop();

    expect(onActive).toHaveBeenCalledExactlyOnceWith("workspace");
  });

  it("follows the pane's own scroll — not the window's, which never moves here", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    fixture.scrollTo(430);
    expect(onActive).toHaveBeenLastCalledWith("policies");

    // A scroll of the window is not a scroll of the page.
    fireEvent.scroll(window);
    expect(onActive).toHaveBeenCalledTimes(2);

    fixture.scrollTo(100);
    expect(onActive).toHaveBeenLastCalledWith("workspace");

    watch.stop();
  });

  it("reports a section once per change, however many scroll events arrive", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    fixture.scrollTo(20);
    fixture.scrollTo(40);
    fixture.scrollTo(60);

    expect(onActive).toHaveBeenCalledExactlyOnceWith("workspace");

    watch.stop();
  });

  it("lights the last section at the end of the page", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    fixture.scrollTo(fixture.max);

    expect(fixture.pane.scrollTop).toBe(700);
    expect(onActive).toHaveBeenLastCalledWith("danger");

    watch.stop();
  });

  it("reads the line from the pane's scroll-padding-top, so taller chrome moves it", () => {
    fixture = mountPane(LAYOUT, { padding: 120 });
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    // Policies' top is 100px below the pane's edge: past a 50px line, on a 120px one.
    fixture.scrollTo(380);

    expect(onActive).toHaveBeenLastCalledWith("policies");

    watch.stop();
  });

  it("lands a pressed section on the line and holds it, though it shares its row", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    watch.land("audit");
    // The scroll event the jump causes arrives after it, and must not undo the answer.
    fireEvent.scroll(fixture.pane);

    expect(fixture.pane.scrollTop).toBe(430);
    expect(onActive).toHaveBeenLastCalledWith("audit");

    watch.stop();
  });

  it("holds a section the page cannot scroll to the line", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    watch.land("integrations");
    fireEvent.scroll(fixture.pane);

    // 760 − 50 is past the 700 the pane can scroll: it stops at the end, one row short.
    expect(fixture.pane.scrollTop).toBe(700);
    expect(onActive).toHaveBeenLastCalledWith("integrations");

    watch.stop();
  });

  it("releases the held section when the reader scrolls, and reads the line again", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    watch.land("audit");
    fixture.scrollTo(460);

    expect(onActive).toHaveBeenLastCalledWith("policies");

    watch.stop();
  });

  it("keeps holding when the page shifts under the reader without their scrolling", () => {
    // The dirty bar mounting on the first keystroke pushes every card down, and the browser's
    // scroll anchoring moves `scrollTop` to keep what is being read still. The pane's offset
    // changed; the section did not go anywhere.
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);
    watch.land("audit");

    fixture.shiftContent(48);

    expect(fixture.pane.scrollTop).toBe(478);
    expect(onActive).toHaveBeenLastCalledWith("audit");

    watch.stop();
  });

  it("hears a press on any link to a section of this page, not only a tab", () => {
    window.history.replaceState(null, "", "/settings");
    fixture = mountPane(LAYOUT);
    const shortcut = document.createElement("a");
    shortcut.href = "#audit";
    const inner = shortcut.appendChild(document.createElement("span"));
    document.body.append(shortcut);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    press(inner);
    fireEvent.scroll(fixture.pane);

    expect(fixture.pane.scrollTop).toBe(430);
    expect(onActive).toHaveBeenLastCalledWith("audit");

    watch.stop();
    shortcut.remove();
  });

  it.each([
    ["a press that opens the link in another tab", "#audit", { metaKey: true }, ""],
    ["a link with a target", "#audit", {}, "_blank"],
    ["a link to another page's fragment", "/dashboard#audit", {}, ""],
    ["a link under another query", "/settings?x=1#audit", {}, ""],
    ["a fragment that names no section", "#appearance", {}, ""],
  ])("does not treat %s as naming a section here", (_name, href, init, target) => {
    window.history.replaceState(null, "", "/settings");
    fixture = mountPane(LAYOUT);
    const link = document.createElement("a");
    link.href = href;
    link.target = target;
    document.body.append(link);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    press(link, init);

    expect(fixture.pane.scrollTop).toBe(0);
    expect(onActive).toHaveBeenCalledExactlyOnceWith("workspace");

    watch.stop();
    link.remove();
  });

  it("lands on the section a deep link names, on start", () => {
    window.history.replaceState(null, "", "/settings#policies");
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();

    const watch = watchSections(IDS, onActive);

    // The correction a first load needs: the browser's own jump ran before the chrome had
    // published its height, and this one lands against the padding as it now stands.
    expect(fixture.pane.scrollTop).toBe(430);
    expect(onActive).toHaveBeenCalledExactlyOnceWith("policies");

    watch.stop();
  });

  it("ignores a fragment that names no section", () => {
    window.history.replaceState(null, "", "/settings#appearance");
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();

    watchSections(IDS, onActive).stop();

    expect(fixture.pane.scrollTop).toBe(0);
    expect(onActive).toHaveBeenCalledExactlyOnceWith("workspace");
  });

  it("follows the fragment when it changes by another road — back, forward, a link", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    window.history.replaceState(null, "", "/settings#danger");
    fireEvent(window, new HashChangeEvent("hashchange"));

    expect(onActive).toHaveBeenLastCalledWith("danger");
    expect(fixture.pane.scrollTop).toBe(700);

    watch.stop();
  });

  it("stops listening when stopped, and stopping twice is harmless", () => {
    fixture = mountPane(LAYOUT);
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    const link = document.createElement("a");
    link.href = "#audit";
    document.body.append(link);

    watch.stop();
    watch.stop();
    fixture.scrollTo(430);
    window.history.replaceState(null, "", "/settings#danger");
    fireEvent(window, new HashChangeEvent("hashchange"));
    press(link);

    expect(onActive).toHaveBeenCalledExactlyOnceWith("workspace");
    link.remove();
  });

  it("has nothing to spy on outside a scrolling container, and only reports what it is given", () => {
    const loose = document.createElement("div");
    loose.id = "workspace";
    document.body.append(loose);
    const onActive = vi.fn();

    const watch = watchSections(IDS, onActive);
    watch.land("audit");

    expect(onActive).toHaveBeenCalledExactlyOnceWith("audit");

    watch.stop();
    loose.remove();
  });

  it("does nothing for a section that is not on the page", () => {
    fixture = mountPane({ workspace: 180 });
    const onActive = vi.fn();
    const watch = watchSections(IDS, onActive);

    watch.land("danger");

    expect(onActive).toHaveBeenCalledExactlyOnceWith("workspace");

    watch.stop();
  });
});
