import { describe, expect, it } from "vitest";

import { DASHBOARD_PATH } from "@/app/paths";
import {
  isActiveRoute,
  navGroup,
  navStatus,
  orderNavEntries,
  permittedNavEntries,
} from "@/app/shell/nav";

import { navEntry } from "../helpers/nav";

/**
 * The navigation model: how a list of registry entries is ordered, which of them a reader may
 * see, and which one a URL belongs to.
 *
 * Every rule here is a pure function of a list somebody else owns, which is why they are
 * tested without a registry and without a DOM — the interesting edges (the root, sub-routes,
 * the sibling route a naive prefix match gets wrong, the entry nobody may see) need neither.
 */

describe("navStatus", () => {
  it("takes a module at its word that its own surface exists", () => {
    // The default is what makes registration cheap: a module registering itself is a module
    // that is there, and only the ones that are *not* have anything to declare.
    expect(navStatus(navEntry())).toBe("live");
    expect(navStatus(navEntry({ status: "soon", soonNote: "later" }))).toBe("soon");
  });
});

describe("orderNavEntries", () => {
  it("puts the primary group above the secondary one", () => {
    const order = orderNavEntries([
      navEntry({ id: "foot", group: "secondary", sort: 10 }),
      navEntry({ id: "head", group: "primary", sort: 90 }),
    ]);

    expect(order.map((entry) => entry.id)).toEqual(["head", "foot"]);
  });

  it("sorts within a group by the entry's own number", () => {
    const order = orderNavEntries([
      navEntry({ id: "third", sort: 30 }),
      navEntry({ id: "first", sort: 10 }),
      navEntry({ id: "second", sort: 20 }),
    ]);

    expect(order.map((entry) => entry.id)).toEqual(["first", "second", "third"]);
  });

  it("breaks a tie by id rather than by who registered first", () => {
    // Registration order is import order, which is a bundler's business and changes between
    // builds. A sidebar that reordered itself on a rebuild would be one nobody could learn.
    const order = orderNavEntries([
      navEntry({ id: "zulu", sort: 50 }),
      navEntry({ id: "alpha", sort: 50 }),
    ]);

    expect(order.map((entry) => entry.id)).toEqual(["alpha", "zulu"]);
  });

  it("leaves the list it was given alone", () => {
    // The registry hands out frozen snapshots; sorting one in place would throw.
    const entries = Object.freeze([
      navEntry({ id: "b", sort: 20 }),
      navEntry({ id: "a", sort: 10 }),
    ]);

    expect(orderNavEntries(entries).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(entries.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("navGroup", () => {
  it("takes one group, keeping the order it was given", () => {
    const entries = [
      navEntry({ id: "one", group: "primary" }),
      navEntry({ id: "foot", group: "secondary" }),
      navEntry({ id: "two", group: "primary" }),
    ];

    expect(navGroup("primary", entries).map((entry) => entry.id)).toEqual(["one", "two"]);
    expect(navGroup("secondary", entries).map((entry) => entry.id)).toEqual(["foot"]);
  });
});

describe("permittedNavEntries", () => {
  it("shows an entry that asks for nothing", () => {
    const entries = [navEntry({ id: "open" })];

    expect(permittedNavEntries(entries, []).map((entry) => entry.id)).toEqual(["open"]);
  });

  it("hides an entry whose capability nobody has been granted", () => {
    const entries = [navEntry({ id: "gated", capability: "models.read" })];

    expect(permittedNavEntries(entries, ["issues.read"])).toEqual([]);
  });

  it("shows it once the capability is granted", () => {
    const gated = navEntry({ id: "gated", capability: "models.read" });

    expect(permittedNavEntries([gated], ["models.read", "issues.read"])).toEqual([gated]);
  });

  it("hides a gated entry when nothing has published a set at all", () => {
    // The direction this errs in, and the reason: a capability system that is late, broken or
    // forgotten leaves a missing entry rather than a visible link into a screen the service
    // will refuse.
    expect(permittedNavEntries([navEntry({ capability: "anything" })], [])).toEqual([]);
  });

  it("leaves no gap where a hidden entry was", () => {
    // The specification's own wording. Filtering rather than blanking is what makes that
    // true of the rendered list as well: there is no entry left to draw.
    const entries = [
      navEntry({ id: "before" }),
      navEntry({ id: "gated", capability: "secret" }),
      navEntry({ id: "after" }),
    ];

    expect(permittedNavEntries(entries, []).map((entry) => entry.id)).toEqual([
      "before",
      "after",
    ]);
  });
});

describe("isActiveRoute", () => {
  it("matches the root on the root and nowhere else", () => {
    // No entry claims "/" since #45 moved the dashboard to its own segment, but the rule
    // stays: a prefix match on the root would make whichever entry claimed it the active
    // one on every page in the product.
    expect(isActiveRoute("/", "/")).toBe(true);
    expect(isActiveRoute("/issues", "/")).toBe(false);
    expect(isActiveRoute("/models/routing", "/")).toBe(false);
  });

  it("keeps the dashboard highlighted on its own route and under it", () => {
    // Where the entry actually points, and the reason it is a segment rather than "/":
    // an entry owns everything below it, which the root could never do.
    expect(isActiveRoute(DASHBOARD_PATH, DASHBOARD_PATH)).toBe(true);
    expect(isActiveRoute(`${DASHBOARD_PATH}/anything`, DASHBOARD_PATH)).toBe(true);
    expect(isActiveRoute("/", DASHBOARD_PATH)).toBe(false);
  });

  it("matches an entry on its own route", () => {
    expect(isActiveRoute("/models", "/models")).toBe(true);
  });

  it("keeps the section active on a sub-route", () => {
    // The specification's example: /models/* keeps Models highlighted.
    expect(isActiveRoute("/models/routing", "/models")).toBe(true);
    expect(isActiveRoute("/models/registry/gpt", "/models")).toBe(true);
  });

  it("does not match a route that merely starts with the same letters", () => {
    // The bug a bare startsWith would have: /model-registry is not under /models.
    expect(isActiveRoute("/model-registry", "/models")).toBe(false);
    expect(isActiveRoute("/modelsx", "/models")).toBe(false);
  });

  it("treats a trailing slash as the same page", () => {
    expect(isActiveRoute("/models/", "/models")).toBe(true);
    expect(isActiveRoute("//", "/")).toBe(true);
    expect(isActiveRoute("/", "/issues")).toBe(false);
  });
});
