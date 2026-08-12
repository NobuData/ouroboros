import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_PATH } from "@/app/paths";
import { NAV_ITEMS } from "@/app/shell/nav";
import { SidebarNav } from "@/app/shell/sidebar-nav";

/**
 * The sidebar. The two properties that matter are the ones the issue's acceptance
 * criteria name: the current route is highlighted, and the whole thing is navigable
 * from the keyboard — which here means that what cannot be activated is not a stop in
 * the tab order and says why.
 */

const { path } = vi.hoisted(() => ({ path: { current: "/dashboard" } }));

vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

// The dashboard is the only built route, so it is the one a case starts on unless it says
// otherwise. Taken from `app/paths.ts` rather than typed out, so a move of the route moves
// this too — the string above is the one place the mock cannot read a constant, because
// `vi.hoisted` runs before any import.
beforeEach(() => {
  path.current = DASHBOARD_PATH;
});

describe("the sidebar", () => {
  it("is a navigation landmark with a name, so it is one of several", () => {
    render(<SidebarNav />);

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("renders every entry in the model", () => {
    render(<SidebarNav />);

    for (const item of NAV_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
  });

  it("puts the inbox and settings in the group at the foot", () => {
    const { container } = render(<SidebarNav />);
    const foot = container.querySelector(".shell-nav__group--foot");

    expect(foot).not.toBeNull();
    expect(within(foot as HTMLElement).getByText("Needs You")).toBeInTheDocument();
    expect(within(foot as HTMLElement).getByText("Settings")).toBeInTheDocument();
  });

  it("links only to routes that exist", () => {
    render(<SidebarNav />);

    // Every other entry is a screen nobody has built: a link to it would be a 404 in
    // the product's primary navigation.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", DASHBOARD_PATH);
    expect(links[0]).toHaveAccessibleName(/Dashboard/);
  });

  it("marks the current route for assistive technology, not only in colour", () => {
    render(<SidebarNav />);

    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("styles the current route with the active treatment", () => {
    const { container } = render(<SidebarNav />);

    const active = container.querySelectorAll(".shell-nav__item--active");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("Dashboard");
  });

  it("drops the highlight when the route belongs to no entry", () => {
    path.current = "/nowhere";
    const { container } = render(<SidebarNav />);

    expect(container.querySelectorAll(".shell-nav__item--active")).toHaveLength(0);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("never highlights an entry whose screen does not exist", () => {
    // /issues is a real path in the model and an unbuilt one in the product. Until #115
    // lands it must not light up, or the shell claims a page that is not there.
    path.current = "/issues";
    const { container } = render(<SidebarNav />);

    expect(container.querySelectorAll(".shell-nav__item--active")).toHaveLength(0);
  });

  it("labels an unbuilt entry rather than leaving it dead", () => {
    const { container } = render(<SidebarNav />);
    const soon = container.querySelectorAll(".shell-nav__item--soon");

    expect(soon).toHaveLength(NAV_ITEMS.length - 1);
    for (const row of soon) {
      // The chip is what a sighted reader sees and a screen reader announces; the
      // tooltip carries the reason, and is the only label left in rail mode.
      expect(row).toHaveTextContent("soon");
      expect(row.getAttribute("title")).toMatch(/arrives? with/);
    }
  });

  it("keeps unbuilt entries out of the tab order", () => {
    const { container } = render(<SidebarNav />);

    // Nothing focusable that cannot be activated: the keyboard walks the sidebar
    // without stopping on rows that do nothing.
    expect(container.querySelectorAll(".shell-nav__item--soon a, [tabindex]")).toHaveLength(0);
  });

  it("names every entry in a tooltip, which is all a rail leaves", () => {
    // Below 1024px the labels are hidden by CSS and the title attribute is the name.
    const { container } = render(<SidebarNav />);
    const rows = container.querySelectorAll(".shell-nav__item");

    expect(rows).toHaveLength(NAV_ITEMS.length);
    for (const [index, row] of rows.entries()) {
      expect(row.getAttribute("title")).toContain(NAV_ITEMS[index].label);
    }
  });

  it("draws an icon for every entry", () => {
    const { container } = render(<SidebarNav />);

    const icons = container.querySelectorAll(".shell-nav__icon");
    expect(icons).toHaveLength(NAV_ITEMS.length);
    // Decorative: the label beside it is the name, so a screen reader must not read
    // the icon as a second one.
    for (const icon of icons) expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
