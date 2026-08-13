import { afterEach, describe, expect, it, vi } from "vitest";

import type { NavEntry } from "@/app/shell/nav";
import {
  navRegistry,
  registerNavEntry,
  setNavBadge,
  setNavCapabilities,
  subscribeNavRegistry,
} from "@/app/shell/nav-registry";

import { navEntry } from "../helpers/nav";

/**
 * The registry: what a module may register, what it may not, and how the sidebar hears about
 * it.
 *
 * The suite works against the **real** registry rather than a fresh instance per case, which
 * is the honest thing to test: there is one registry in the product, it is seeded at import,
 * and a module registering into it must not disturb what is already there. Every case cleans
 * up through the handle `registerNavEntry` hands back — which is also the point of that
 * handle existing, since production has no reset and a test-only one would be an API nothing
 * real ever calls.
 */

/** Everything this file has to put back, newest first. */
const undo: (() => void)[] = [];

afterEach(() => {
  // Before the handles run: a case that took `window` away left every publisher below a
  // no-op, and a cleanup that quietly does nothing is a cleanup that leaks into the next file.
  vi.unstubAllGlobals();

  while (undo.length > 0) undo.pop()?.();
  setNavCapabilities([]);
});

/**
 * Register an entry and remember how to remove it again.
 *
 * @param entry The entry to register.
 * @returns The unregister handle, for a case that wants to call it early.
 */
function register(entry: NavEntry): () => void {
  const remove = registerNavEntry(entry);
  undo.push(remove);
  return remove;
}

describe("registering an entry", () => {
  it("puts it in the registry, in its sorted place", () => {
    const entry = navEntry({ id: "fixture-module", sort: 5 });

    register(entry);

    // Sort 5 is ahead of the dashboard's 10, so the fixture leads the primary group — which
    // is the whole promise: a module decides where it sits, not the sidebar.
    expect(navRegistry().entries[0].id).toBe("fixture-module");
  });

  it("hands back the way to remove it", () => {
    const remove = register(navEntry({ id: "temporary" }));

    remove();

    expect(navRegistry().entries.some((entry) => entry.id === "temporary")).toBe(false);
  });

  it("survives its handle being called twice", () => {
    const remove = register(navEntry({ id: "twice" }));

    remove();
    expect(() => remove()).not.toThrow();
  });

  it("does not let a stale handle remove whatever replaced it", () => {
    // Hot reloading re-registers on every save; a cleanup from the previous module instance
    // arriving afterwards must not take the new registration with it.
    const stale = register(navEntry({ id: "replaced", label: "First" }));
    register(navEntry({ id: "replaced", label: "Second" }));

    stale();

    expect(navRegistry().entries.find((entry) => entry.id === "replaced")?.label).toBe(
      "Second",
    );
  });

  it("replaces by id rather than duplicating", () => {
    register(navEntry({ id: "same", label: "Before" }));
    register(navEntry({ id: "same", label: "After" }));

    const matches = navRegistry().entries.filter((entry) => entry.id === "same");
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("After");
  });

  it("keeps a copy, so a later edit of the caller's object changes nothing", () => {
    const entry = navEntry({ id: "copied", label: "Registered" });

    register(entry);
    entry.label = "Edited afterwards";

    expect(navRegistry().entries.find((one) => one.id === "copied")?.label).toBe(
      "Registered",
    );
  });
});

describe("an entry the registry refuses", () => {
  it.each<[string, Partial<NavEntry>]>([
    ["no id", { id: "" }],
    ["no label", { label: "" }],
    ["a route that is not a path", { route: "issues" }],
    ["a protocol-relative route", { route: "//evil.test" }],
    ["a sort that is not a number", { sort: Number.NaN }],
  ])("throws on %s", (_case, overrides) => {
    expect(() => registerNavEntry(navEntry(overrides))).toThrow();
  });

  it("throws when a second entry claims a route already taken", () => {
    register(navEntry({ id: "first", route: "/contested" }));

    expect(() => registerNavEntry(navEntry({ id: "second", route: "/contested" }))).toThrow(
      /already claimed/,
    );
  });

  it("lets an entry re-register its own route", () => {
    register(navEntry({ id: "steady", route: "/steady" }));

    expect(() =>
      register(navEntry({ id: "steady", route: "/steady", label: "Renamed" })),
    ).not.toThrow();
  });

  it("throws when a row that leads nowhere does not say what it awaits", () => {
    // The honesty rule as a precondition: in rail mode that sentence is the only thing left
    // of the row.
    expect(() => registerNavEntry(navEntry({ status: "soon" }))).toThrow(/must say/);
  });

  it("throws when a built row claims to be awaiting something", () => {
    expect(() => registerNavEntry(navEntry({ soonNote: "…for nothing" }))).toThrow(
      /cannot be awaiting/,
    );
  });

  it("registers nothing when it refuses", () => {
    expect(() => registerNavEntry(navEntry({ id: "rejected", route: "nope" }))).toThrow();
    expect(navRegistry().entries.some((entry) => entry.id === "rejected")).toBe(false);
  });
});

describe("badge counts", () => {
  it("are absent until something publishes one", () => {
    expect(navRegistry().badges["never-published"]).toBeUndefined();
  });

  it("are published under the name an entry declares", () => {
    setNavBadge("fixture-count", 3);
    undo.push(() => setNavBadge("fixture-count", null));

    expect(navRegistry().badges["fixture-count"]).toBe(3);
  });

  it("are withdrawn by publishing null, leaving no zero behind", () => {
    // One representation of "nobody has counted", which is the whole reason the withdrawal is
    // a removal: a stored null beside an absent key would be two states meaning one thing.
    setNavBadge("fixture-count", 3);
    setNavBadge("fixture-count", null);

    expect("fixture-count" in navRegistry().badges).toBe(false);
  });

  it("keep zero, which is a count somebody took", () => {
    // Zero is a real answer and the registry stores it; what refuses to draw it is the badge
    // (`app/ui/badge.tsx`), because a zero *badge* is a claim that something is waiting.
    setNavBadge("fixture-count", 0);
    undo.push(() => setNavBadge("fixture-count", null));

    expect(navRegistry().badges["fixture-count"]).toBe(0);
  });

  it("are refused outside the browser", () => {
    // A module singleton on the server is shared by every request the process handles, so a
    // count published there would be one reader's inbox in front of the next visitor.
    vi.stubGlobal("window", undefined);

    setNavBadge("server-side", 9);

    expect("server-side" in navRegistry().badges).toBe(false);
  });
});

describe("granted capabilities", () => {
  it("start empty, so nothing gated is shown before an answer arrives", () => {
    expect(navRegistry().capabilities).toEqual([]);
  });

  it("are published as a whole set", () => {
    setNavCapabilities(["models.read", "issues.read"]);

    expect([...navRegistry().capabilities].sort()).toEqual(["issues.read", "models.read"]);
  });

  it("drop duplicates", () => {
    setNavCapabilities(["models.read", "models.read"]);

    expect(navRegistry().capabilities).toEqual(["models.read"]);
  });

  it("are refused outside the browser, for the reason counts are", () => {
    vi.stubGlobal("window", undefined);

    setNavCapabilities(["models.read"]);

    expect(navRegistry().capabilities).toEqual([]);
  });
});

describe("the snapshot", () => {
  it("keeps its identity while nothing changes", () => {
    // `useSyncExternalStore` re-renders whenever this identity moves, so a freshly built
    // object per read would re-render the sidebar forever.
    expect(navRegistry()).toBe(navRegistry());
  });

  it("is replaced when an entry, a count or a capability changes", () => {
    const before = navRegistry();
    register(navEntry({ id: "moves-the-snapshot" }));

    expect(navRegistry()).not.toBe(before);
  });

  it("is frozen, so a consumer cannot edit the registry by accident", () => {
    expect(Object.isFrozen(navRegistry())).toBe(true);
    expect(Object.isFrozen(navRegistry().entries)).toBe(true);
  });
});

describe("subscribers", () => {
  it("hear about a registration", () => {
    const heard = vi.fn();
    undo.push(subscribeNavRegistry(heard));

    register(navEntry({ id: "announced" }));

    expect(heard).toHaveBeenCalled();
  });

  it("hear nothing when a published count does not move", () => {
    setNavBadge("steady", 2);
    const heard = vi.fn();
    undo.push(subscribeNavRegistry(heard));
    undo.push(() => setNavBadge("steady", null));

    setNavBadge("steady", 2);

    // A poll that keeps returning the same answer must not re-render the sidebar.
    expect(heard).not.toHaveBeenCalled();
  });

  it("hear nothing when a published capability set does not move", () => {
    setNavCapabilities(["models.read"]);
    const heard = vi.fn();
    undo.push(subscribeNavRegistry(heard));

    setNavCapabilities(["models.read"]);

    expect(heard).not.toHaveBeenCalled();
  });

  it("stop hearing once they unsubscribe", () => {
    const heard = vi.fn();
    subscribeNavRegistry(heard)();

    register(navEntry({ id: "unheard" }));

    expect(heard).not.toHaveBeenCalled();
  });
});
