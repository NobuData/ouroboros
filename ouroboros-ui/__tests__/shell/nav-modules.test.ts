import {
  BookOpen,
  CalendarRange,
  ChartLine,
  CircleDot,
  Cpu,
  Gauge,
  Inbox,
  Server,
  Settings,
  Telescope,
  Workflow,
} from "lucide-react";
import { describe, expect, it } from "vitest";

import { DASHBOARD_PATH } from "@/app/paths";
import { navGroup, navStatus, orderNavEntries } from "@/app/shell/nav";
import { navRegistry } from "@/app/shell/nav-registry";
import { INBOX_BADGE_SOURCE, SEEDED_NAV_ENTRIES } from "@/app/shell/nav-modules";

/**
 * The eleven entries the shell specification names
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2), and the fact that importing them registers them.
 *
 * This is the seed, not the mechanism — what a registry *does* is
 * `__tests__/shell/nav-registry.test.ts`, and what the sidebar makes of it is
 * `__tests__/shell/sidebar-nav.test.tsx`. What is here is the specification's own list, read
 * back: its members, its order, its icons, and the honesty rules the ones that lead nowhere
 * are held to.
 */

/** The seeded entries in the order the sidebar will draw them. */
const ordered = orderNavEntries(SEEDED_NAV_ENTRIES);

describe("the seeded entries", () => {
  it("are the eleven the specification names, in its order", () => {
    expect(ordered.map((entry) => entry.label)).toEqual([
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

  it("wear the icons § 1.2 maps them to", () => {
    // The icon set is lucide, which is this issue's recorded decision. The mapping is
    // asserted against the imported components rather than by name, so a wrong-but-plausible
    // swap (Server for Cpu) is a failure rather than a rename nobody notices.
    expect(ordered.map((entry) => entry.icon)).toEqual([
      Gauge,
      CircleDot,
      Workflow,
      Cpu,
      Server,
      BookOpen,
      CalendarRange,
      Telescope,
      ChartLine,
      Inbox,
      Settings,
    ]);
  });

  it("split into the specification's two groups", () => {
    expect(navGroup("primary", ordered).map((entry) => entry.id)).toEqual([
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
    expect(navGroup("secondary", ordered).map((entry) => entry.id)).toEqual([
      "needs-you",
      "settings",
    ]);
  });

  it("give every entry a unique id and a unique route", () => {
    // Two entries on one route would both highlight; two on one id would collide as React
    // keys — and the registry refuses the second of either.
    const ids = SEEDED_NAV_ENTRIES.map((entry) => entry.id);
    const routes = SEEDED_NAV_ENTRIES.map((entry) => entry.route);

    expect(new Set(ids).size).toBe(SEEDED_NAV_ENTRIES.length);
    expect(new Set(routes).size).toBe(SEEDED_NAV_ENTRIES.length);
  });

  it("leave room between neighbours, so a module can be slotted in without renumbering", () => {
    for (const group of ["primary", "secondary"] as const) {
      const sorts = navGroup(group, ordered).map((entry) => entry.sort);
      for (let index = 1; index < sorts.length; index += 1) {
        expect(sorts[index] - sorts[index - 1]).toBeGreaterThan(1);
      }
    }
  });

  it("root every route at the application, so an entry cannot link off-site", () => {
    for (const entry of SEEDED_NAV_ENTRIES) {
      expect(entry.route.startsWith("/")).toBe(true);
      expect(entry.route.startsWith("//")).toBe(false);
    }
  });

  it("has exactly one built destination today: the dashboard", () => {
    // Until the placeholder routes (#49) land, the dashboard is the only page that exists — a
    // second live entry without a page behind it would ship a 404 in the navigation. Asserted
    // against the constant rather than the string, so the entry and every redirect to it are
    // the same fact (#45 moved it off `/`).
    expect(
      SEEDED_NAV_ENTRIES.filter((entry) => navStatus(entry) === "live").map(
        (entry) => entry.route,
      ),
    ).toEqual([DASHBOARD_PATH]);
  });

  it("explains every unbuilt entry by naming what it waits for", () => {
    // The honesty rule (§ 3.5): a "soon" row carries the reason it shows as its tooltip, and
    // the reason is a usable answer to "when?" rather than the word *soon* on its own.
    for (const entry of SEEDED_NAV_ENTRIES) {
      if (navStatus(entry) === "soon") expect(entry.soonNote).toMatch(/arrives? with/);
      else expect(entry.soonNote).toBeUndefined();
    }
  });

  it("gives the needs-you row a badge slot and nothing else one", () => {
    // § 1.2 draws a live count on exactly one entry, and BN.4 (#464) is what will publish it.
    const withBadges = SEEDED_NAV_ENTRIES.filter((entry) => entry.badgeSource !== undefined);

    expect(withBadges.map((entry) => entry.id)).toEqual(["needs-you"]);
    expect(withBadges[0].badgeSource).toBe(INBOX_BADGE_SOURCE);
  });

  it("gates none of them, so the capability filter is inert until a module opts in", () => {
    expect(SEEDED_NAV_ENTRIES.every((entry) => entry.capability === undefined)).toBe(true);
  });
});

describe("importing the module", () => {
  it("registers all eleven, which is what 'modules register themselves' means", () => {
    const registered = navRegistry().entries.map((entry) => entry.id);

    for (const entry of SEEDED_NAV_ENTRIES) expect(registered).toContain(entry.id);
  });

  it("registers them in the order the registry will hand them out", () => {
    // The seeded entries are the only ones in the registry in this file, so the registry's
    // own order and the seeds' are the same list — which is what proves the sort numbers
    // above are doing the work rather than the array's literal order.
    expect(navRegistry().entries.map((entry) => entry.id)).toEqual(
      ordered.map((entry) => entry.id),
    );
  });
});
