import { describe, expect, it } from "vitest";

import { NAV_ITEMS, type NavItem, isActiveRoute, navGroup } from "@/app/shell/nav";

/**
 * The navigation model: the list the sidebar renders, and the rule that decides which
 * entry a URL belongs to.
 *
 * The rule is tested here rather than through the component because it is the part with
 * the interesting edges — the root, sub-routes, and the sibling route that a naive
 * prefix match gets wrong — and none of them need a DOM.
 */

describe("the navigation list", () => {
  it("holds the eleven entries the shell specification names, in its order", () => {
    // docs/DESIGN_SYSTEM_APP_SHELL.md § 1.2. Order is asserted, not just membership:
    // the sidebar renders the array as it stands.
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Dashboard",
      "Issues",
      "Workflows",
      "Models",
      "Build Farm",
      "Knowledge",
      "Planning",
      "Research",
      "Insights",
      "Needs You",
      "Settings",
    ]);
  });

  it("gives every entry a unique id and a unique route", () => {
    // Two entries on one route would both highlight; two on one id would collide as
    // React keys.
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((item) => item.route)).size).toBe(NAV_ITEMS.length);
  });

  it("roots every route at the application, so an entry cannot link off-site", () => {
    for (const item of NAV_ITEMS) {
      expect(item.route.startsWith("/")).toBe(true);
      expect(item.route.startsWith("//")).toBe(false);
    }
  });

  it("explains every unbuilt entry, and only those", () => {
    // The honesty rule (§ 3.5) as an assertion: a "soon" row must carry the reason it
    // shows as its tooltip, and a live one must not claim to be waiting on anything.
    for (const item of NAV_ITEMS) {
      if (item.status === "soon") expect(item.soonNote).toBeTruthy();
      else expect(item.soonNote).toBeUndefined();
    }
  });

  it("has exactly one built destination today: the dashboard", () => {
    // The list of live routes is what the sidebar turns into links. Until the
    // placeholder routes (#49) land, `/` is the only page that exists — a second live
    // entry here without a page behind it would ship a 404 in the navigation.
    expect(NAV_ITEMS.filter((item) => item.status === "live").map((item) => item.route)).toEqual(
      ["/"],
    );
  });

  it("splits into the specification's two groups", () => {
    expect(navGroup("primary").map((item) => item.id)).toEqual([
      "dashboard",
      "issues",
      "workflows",
      "models",
      "build-farm",
      "knowledge",
      "planning",
      "research",
      "insights",
    ]);
    expect(navGroup("secondary").map((item) => item.id)).toEqual(["needs-you", "settings"]);
  });

  it("filters the list it is given, so a registry (CP.2) can replace the default", () => {
    const fixture = [
      { id: "a", label: "A", route: "/a", icon: NAV_ITEMS[0].icon, group: "secondary", status: "live" },
      { id: "b", label: "B", route: "/b", icon: NAV_ITEMS[0].icon, group: "primary", status: "live" },
    ] satisfies NavItem[];

    expect(navGroup("primary", fixture).map((item) => item.id)).toEqual(["b"]);
  });
});

describe("isActiveRoute", () => {
  it("matches the dashboard on the root and nowhere else", () => {
    // A prefix rule on "/" would make the dashboard active on every page in the product.
    expect(isActiveRoute("/", "/")).toBe(true);
    expect(isActiveRoute("/issues", "/")).toBe(false);
    expect(isActiveRoute("/models/routing", "/")).toBe(false);
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

  it("matches nothing when the path belongs to no entry", () => {
    // A screen outside the navigation highlights nothing rather than guessing.
    expect(NAV_ITEMS.some((item) => isActiveRoute("/nowhere", item.route))).toBe(false);
  });

  it("highlights at most one entry for any route an entry owns", () => {
    for (const item of NAV_ITEMS) {
      const matches = NAV_ITEMS.filter((other) => isActiveRoute(item.route, other.route));
      expect(matches).toEqual([item]);
    }
  });
});
