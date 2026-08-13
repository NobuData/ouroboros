import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hostileStorage, memoryStorage } from "../helpers/match-media";

/**
 * The sidebar's width choice and its drawer.
 *
 * The module holds one lazily-read value — the stored choice, taken from `localStorage` the
 * first time anything asks — so each case gets a **fresh module instance**. That is not
 * ceremony: without it the second case in this file would be testing the first one's leftover
 * state, and the one property that matters most (a choice made last week is the choice this
 * session boots with) is only observable on a first read.
 */

/** The module under test, re-imported per case. */
let sidebar: typeof import("@/app/shell/sidebar-state");

beforeEach(async () => {
  vi.resetModules();
  window.localStorage.clear();
  sidebar = await import("@/app/shell/sidebar-state");
  document.documentElement.removeAttribute(sidebar.SIDEBAR_ATTRIBUTE);
});

afterEach(() => {
  document.documentElement.removeAttribute(sidebar.SIDEBAR_ATTRIBUTE);
  window.localStorage.clear();
});

describe("parsing a stored choice", () => {
  it("accepts the two words it writes", () => {
    expect(sidebar.parseSidebarChoice("wide")).toBe("wide");
    expect(sidebar.parseSidebarChoice("rail")).toBe("rail");
  });

  it.each([null, undefined, "", "collapsed", "RAIL"])(
    "reads %p as no choice at all",
    (value) => {
      // A key edited by hand, written by an older version, or absent are all the same answer:
      // the viewport decides.
      expect(sidebar.parseSidebarChoice(value)).toBe("default");
    },
  );
});

describe("persistence", () => {
  it("stores a choice and reads it back", () => {
    const storage = memoryStorage();

    sidebar.storeSidebarChoice("rail", storage);

    expect(storage.getItem(sidebar.SIDEBAR_STORAGE_KEY)).toBe("rail");
    expect(sidebar.readStoredSidebarChoice(storage)).toBe("rail");
  });

  it("stores the default as the absence of the key", () => {
    // One representation of "no choice", in storage and on the element alike, so the two
    // cannot drift apart.
    const storage = memoryStorage({ [sidebar.SIDEBAR_STORAGE_KEY]: "rail" });

    sidebar.storeSidebarChoice("default", storage);

    expect(storage.getItem(sidebar.SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  it("survives a storage that refuses every operation", () => {
    // Safari's private mode throws on access rather than returning null, and a visitor there
    // should still get a working sidebar — one that applies for the session and is not
    // remembered.
    const storage = hostileStorage();

    expect(sidebar.readStoredSidebarChoice(storage)).toBe("default");
    expect(() => sidebar.storeSidebarChoice("rail", storage)).not.toThrow();
  });
});

describe("stamping the document", () => {
  it("puts an explicit choice on the element", () => {
    sidebar.stampSidebarChoice("rail");

    expect(document.documentElement.getAttribute(sidebar.SIDEBAR_ATTRIBUTE)).toBe("rail");
  });

  it("takes the attribute off for the default, leaving the breakpoint to decide", () => {
    sidebar.stampSidebarChoice("wide");
    sidebar.stampSidebarChoice("default");

    expect(document.documentElement.hasAttribute(sidebar.SIDEBAR_ATTRIBUTE)).toBe(false);
  });
});

describe("resolving a choice against the viewport", () => {
  it("takes an explicit choice at every width", () => {
    // Below 1024px the rail is the *default*, not the rule: a reader who has said what they
    // want has said it everywhere.
    expect(sidebar.resolveSidebarChoice("wide", true)).toBe("wide");
    expect(sidebar.resolveSidebarChoice("rail", false)).toBe("rail");
  });

  it("lets the viewport answer when nothing has been chosen", () => {
    expect(sidebar.resolveSidebarChoice("default", true)).toBe("rail");
    expect(sidebar.resolveSidebarChoice("default", false)).toBe("wide");
  });
});

describe("the store", () => {
  it("starts from what was stored last time", () => {
    window.localStorage.setItem(sidebar.SIDEBAR_STORAGE_KEY, "rail");

    expect(sidebar.sidebarState().choice).toBe("rail");
  });

  it("starts with the drawer closed, whatever was stored", () => {
    // A drawer is a thing you opened a moment ago, not a preference: restoring one would hand
    // a reader a covered screen to dismiss before they could read anything.
    window.localStorage.setItem(sidebar.SIDEBAR_STORAGE_KEY, "rail");

    expect(sidebar.sidebarState().drawerOpen).toBe(false);
  });

  it("keeps its snapshot's identity while nothing changes", () => {
    expect(sidebar.sidebarState()).toBe(sidebar.sidebarState());
  });

  it("persists and stamps a new choice in the same call", () => {
    sidebar.setSidebarChoice("rail");

    expect(sidebar.sidebarState().choice).toBe("rail");
    expect(window.localStorage.getItem(sidebar.SIDEBAR_STORAGE_KEY)).toBe("rail");
    expect(document.documentElement.getAttribute(sidebar.SIDEBAR_ATTRIBUTE)).toBe("rail");
  });

  it("opens and closes the drawer without touching storage", () => {
    sidebar.setDrawerOpen(true);

    expect(sidebar.sidebarState().drawerOpen).toBe(true);
    expect(window.localStorage.getItem(sidebar.SIDEBAR_STORAGE_KEY)).toBeNull();

    sidebar.setDrawerOpen(false);
    expect(sidebar.sidebarState().drawerOpen).toBe(false);
  });

  it("tells subscribers when something moves", () => {
    const heard = vi.fn();
    sidebar.subscribeSidebar(heard);

    sidebar.setDrawerOpen(true);

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("says nothing when a setter is handed the value already in force", () => {
    const heard = vi.fn();
    sidebar.subscribeSidebar(heard);

    sidebar.setSidebarChoice("default");
    sidebar.setDrawerOpen(false);

    expect(heard).not.toHaveBeenCalled();
  });

  it("stops telling a subscriber that has unsubscribed", () => {
    const heard = vi.fn();
    sidebar.subscribeSidebar(heard)();

    sidebar.setDrawerOpen(true);

    expect(heard).not.toHaveBeenCalled();
  });
});

describe("the boot script", () => {
  /**
   * Run the script the way the browser does — as source, in the document it stamps.
   *
   * @returns Nothing.
   */
  const boot = (): void => {
    new Function(sidebar.SIDEBAR_BOOTSTRAP)();
  };

  it("is built from the constants the rest of the module uses", () => {
    // The reason it is generated rather than written out: a key or an attribute renamed in
    // one place and not the other is a bug that only shows up on a return visit.
    expect(sidebar.SIDEBAR_BOOTSTRAP).toContain(
      JSON.stringify(sidebar.SIDEBAR_STORAGE_KEY),
    );
    expect(sidebar.SIDEBAR_BOOTSTRAP).toContain(JSON.stringify(sidebar.SIDEBAR_ATTRIBUTE));
  });

  it("cannot break out of the script element it is inlined into", () => {
    expect(sidebar.SIDEBAR_BOOTSTRAP).not.toMatch(/<\/script/i);
  });

  it.each(["wide", "rail"] as const)("stamps a stored %s choice before React exists", (choice) => {
    window.localStorage.setItem(sidebar.SIDEBAR_STORAGE_KEY, choice);

    boot();

    expect(document.documentElement.getAttribute(sidebar.SIDEBAR_ATTRIBUTE)).toBe(choice);
  });

  it("stamps nothing when there is no stored choice, leaving the breakpoint to CSS", () => {
    boot();

    expect(document.documentElement.hasAttribute(sidebar.SIDEBAR_ATTRIBUTE)).toBe(false);
  });

  it("stamps nothing for a value it does not recognise", () => {
    window.localStorage.setItem(sidebar.SIDEBAR_STORAGE_KEY, "collapsed");

    boot();

    expect(document.documentElement.hasAttribute(sidebar.SIDEBAR_ATTRIBUTE)).toBe(false);
  });

  it("never writes, so a boot script cannot corrupt what it reads", () => {
    window.localStorage.setItem(sidebar.SIDEBAR_STORAGE_KEY, "rail");

    boot();

    expect(window.localStorage.getItem(sidebar.SIDEBAR_STORAGE_KEY)).toBe("rail");
    expect(window.localStorage.length).toBe(1);
  });
});
