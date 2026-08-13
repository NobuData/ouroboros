import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_PATH } from "@/app/paths";
import { focusStops } from "@/app/shell/focus-trap";
import type { NavEntry } from "@/app/shell/nav";
import { INBOX_BADGE_SOURCE, SEEDED_NAV_ENTRIES } from "@/app/shell/nav-modules";
import {
  registerNavEntry,
  setNavBadge,
  setNavCapabilities,
} from "@/app/shell/nav-registry";
import { SIDEBAR_ID } from "@/app/shell/regions";
import { SidebarNav } from "@/app/shell/sidebar-nav";
import {
  DRAWER_MEDIA_QUERY,
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_STORAGE_KEY,
  setDrawerOpen,
  setSidebarChoice,
} from "@/app/shell/sidebar-state";

import { type MediaController, installMatchMedia } from "../helpers/match-media";
import { navEntry } from "../helpers/nav";

/**
 * The sidebar: eleven registered entries, the rule that lights one of them, a badge that
 * refuses to invent a number, two widths and a drawer, and a keyboard that can reach all of
 * it.
 *
 * The suite renders against the **real** registry, seeded as production seeds it, because the
 * acceptance criterion that matters most is a statement about that registry: *adding an entry
 * renders a working nav item with zero shell edits*. A fixture registry would prove that a
 * mock works.
 */

const { path } = vi.hoisted(() => ({ path: { current: "/dashboard" } }));

vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

/** Everything a case staged in the registry, put back before the next one. */
const undo: (() => void)[] = [];

/** The controllable `matchMedia` a case installed. */
let media: MediaController | undefined;

beforeEach(() => {
  // Reset here rather than in an afterEach: by the time this runs the previous case has been
  // unmounted, so putting the stores back cannot be a React update outside `act`.
  while (undo.length > 0) undo.pop()?.();
  setNavBadge(INBOX_BADGE_SOURCE, null);
  setNavCapabilities([]);
  setDrawerOpen(false);
  setSidebarChoice("default");
  window.localStorage.clear();

  // The dashboard is the only built route, so it is where a case starts unless it says
  // otherwise. Taken from `app/paths.ts` rather than typed out — the string in `vi.hoisted`
  // above is the one place the mock cannot read a constant, because it runs before any import.
  path.current = DASHBOARD_PATH;
});

afterEach(() => {
  media?.restore();
  media = undefined;
});

/**
 * Put an entry in the registry for the length of one case.
 *
 * Re-registering a **seeded** id is a legitimate fixture — it is how a case asks what the
 * sidebar does with, say, a gated Settings — so the cleanup restores the original entry
 * rather than deleting it, which unregistering would.
 *
 * @param entry The entry to stage.
 * @returns Nothing.
 */
function stage(entry: NavEntry): void {
  const seeded = SEEDED_NAV_ENTRIES.find((one) => one.id === entry.id);
  const remove = registerNavEntry(entry);

  undo.push(
    seeded === undefined
      ? remove
      : () => {
          registerNavEntry(seeded);
        },
  );
}

/**
 * The sidebar's navigation element.
 *
 * @returns The landmark.
 */
function sidebar(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

/**
 * Press a link, and stop the browser acting on it.
 *
 * jsdom cannot navigate and says so on the console when an anchor's default is allowed to
 * run. What a case here is about is everything that happens *before* the navigation — the
 * component's own handler — so the default is cancelled after React has had the event. The
 * listener is on the document, which is outside the root React attaches its own to, so it
 * runs second.
 *
 * @param link The link to press.
 * @returns Nothing.
 */
function follow(link: HTMLElement): void {
  const cancel = (event: Event): void => event.preventDefault();
  document.addEventListener("click", cancel);

  try {
    fireEvent.click(link);
  } finally {
    document.removeEventListener("click", cancel);
  }
}

describe("the sidebar", () => {
  it("is a navigation landmark with a name, and an id the header can point at", () => {
    render(<SidebarNav />);

    expect(sidebar()).toHaveAttribute("id", SIDEBAR_ID);
  });

  it("renders every registered entry", () => {
    render(<SidebarNav />);

    for (const entry of SEEDED_NAV_ENTRIES) {
      expect(screen.getByText(entry.label)).toBeInTheDocument();
    }
  });

  it("puts the inbox and settings in the group at the foot", () => {
    const { container } = render(<SidebarNav />);
    const foot = container.querySelector(".shell-nav__group--foot");

    expect(foot).not.toBeNull();
    expect(within(foot as HTMLElement).getByText("Needs You")).toBeInTheDocument();
    expect(within(foot as HTMLElement).getByText("Settings")).toBeInTheDocument();
  });

  it("draws an icon for every entry", () => {
    const { container } = render(<SidebarNav />);

    const icons = container.querySelectorAll(".shell-nav__icon");
    expect(icons).toHaveLength(SEEDED_NAV_ENTRIES.length);
    // Decorative: the label beside it is the name, so a screen reader must not read the icon
    // as a second one.
    for (const icon of icons) expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("names every entry in a tooltip, which is all a rail leaves a sighted reader", () => {
    const { container } = render(<SidebarNav />);
    const rows = container.querySelectorAll(".shell-nav__item");

    expect(rows).toHaveLength(SEEDED_NAV_ENTRIES.length);
    for (const row of rows) {
      const label = row.querySelector(".shell-nav__label")?.textContent ?? "";
      expect(label).not.toBe("");
      expect(row.getAttribute("title")).toContain(label);
    }
  });

  it("keeps the label in the accessibility tree at every width", () => {
    // In rail mode the stylesheet hides the label *visually* and leaves it readable, rather
    // than swapping in an `aria-label` — so the row is announced identically at both widths
    // and the badge's count is announced with it. The markup is what makes that possible.
    render(<SidebarNav />);

    expect(screen.getByRole("link", { name: /Dashboard/ })).toContainElement(
      screen.getByText("Dashboard"),
    );
  });
});

describe("what the sidebar links to", () => {
  it("links only to routes that exist", () => {
    render(<SidebarNav />);

    // Every other entry is a screen nobody has built: a link to it would be a 404 in the
    // product's primary navigation.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", DASHBOARD_PATH);
  });

  it("labels an unbuilt entry rather than leaving it dead", () => {
    const { container } = render(<SidebarNav />);
    const soon = container.querySelectorAll(".shell-nav__item--soon");

    expect(soon).toHaveLength(SEEDED_NAV_ENTRIES.length - 1);
    for (const row of soon) {
      // The chip is what a sighted reader sees and a screen reader announces; the tooltip
      // carries the reason.
      expect(row).toHaveTextContent("soon");
      expect(row.getAttribute("title")).toMatch(/arrives? with/);
    }
  });

  it("keeps unbuilt entries out of the tab order and out of the arrow ring", () => {
    const { container } = render(<SidebarNav />);

    for (const row of container.querySelectorAll(".shell-nav__item--soon")) {
      // Not a link, not a tab stop, and carrying no id for the arrow keys to land on: the
      // keyboard never stops on a row that does nothing.
      expect(row.tagName).toBe("SPAN");
      expect(row.hasAttribute("tabindex")).toBe(false);
      expect(row.hasAttribute("data-nav-id")).toBe(false);
    }
  });
});

describe("the active entry", () => {
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

  it("stays lit on a sub-route of the section", () => {
    // § 1.2's own example, through the component: /models/registry keeps Models active — and
    // a staged entry is how that is asserted while the real Models screen is still #200.
    stage(navEntry({ id: "models-fixture", label: "Models fixture", route: "/models-live" }));
    path.current = "/models-live/registry";
    const { container } = render(<SidebarNav />);

    expect(container.querySelectorAll(".shell-nav__item--active")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Models fixture" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("drops the highlight when the route belongs to no entry", () => {
    path.current = "/nowhere";
    const { container } = render(<SidebarNav />);

    expect(container.querySelectorAll(".shell-nav__item--active")).toHaveLength(0);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("never highlights an entry whose screen does not exist", () => {
    // /issues is a real path in the registry and an unbuilt one in the product. Until #115
    // lands it must not light up, or the shell claims a page that is not there.
    path.current = "/issues";
    const { container } = render(<SidebarNav />);

    expect(container.querySelectorAll(".shell-nav__item--active")).toHaveLength(0);
  });
});

describe("the registry behind it", () => {
  it("renders a working nav item for an entry registered with zero shell edits", () => {
    // The registry's whole justification (decision S1), as an assertion: nothing in
    // `sidebar-nav.tsx` names this module, and nothing had to.
    stage(
      navEntry({ id: "telescope", label: "Research fixture", route: "/research-live", sort: 5 }),
    );

    render(<SidebarNav />);

    const link = screen.getByRole("link", { name: "Research fixture" });
    expect(link).toHaveAttribute("href", "/research-live");
    // Sort 5 puts it ahead of the dashboard's 10 — the module decided where it sits.
    expect(screen.getAllByRole("link")[0]).toBe(link);
  });

  it("hides an entry the reader has not been granted", () => {
    stage(navEntry({ id: "gated", label: "Gated", capability: "gated.read" }));

    render(<SidebarNav />);

    expect(screen.queryByText("Gated")).toBeNull();
  });

  it("shows it the moment the capability is published", () => {
    stage(navEntry({ id: "gated", label: "Gated", capability: "gated.read" }));
    setNavCapabilities(["gated.read"]);

    render(<SidebarNav />);

    expect(screen.getByText("Gated")).toBeInTheDocument();
  });

  it("leaves no gap where a hidden entry was", () => {
    stage(navEntry({ id: "gated", label: "Gated", capability: "gated.read" }));

    const { container } = render(<SidebarNav />);

    // No empty row, and no row for the entry: the list is one shorter, not one blank longer.
    expect(container.querySelectorAll("li")).toHaveLength(SEEDED_NAV_ENTRIES.length);
    for (const row of container.querySelectorAll("li")) {
      expect(row.textContent).not.toBe("");
    }
  });

  it("drops a whole group nobody may see, hairline and all", () => {
    // The foot group draws a rule above itself. An empty list would leave that rule floating
    // over nothing, which is the gap this criterion is about.
    for (const seed of SEEDED_NAV_ENTRIES) {
      if (seed.group === "secondary") stage({ ...seed, capability: "admin" });
    }

    const { container } = render(<SidebarNav />);

    expect(container.querySelector(".shell-nav__group--foot")).toBeNull();
  });
});

describe("the badge slot", () => {
  it("draws nothing at all while no source has published a count", () => {
    // The honesty rule (§ 3.5): "we have not counted" is not the same claim as "nothing needs
    // you", and only one of them may be spelled 0.
    const { container } = render(<SidebarNav />);

    expect(container.querySelector(".shell-nav__badge")).toBeNull();
  });

  it("draws the count the inbox publishes", () => {
    setNavBadge(INBOX_BADGE_SOURCE, 3);

    render(<SidebarNav />);

    const row = screen.getByText("Needs You").closest(".shell-nav__item");
    expect(within(row as HTMLElement).getByText("3")).toBeInTheDocument();
  });

  it("says what the count is of, so it is not a bare figure to a screen reader", () => {
    setNavBadge(INBOX_BADGE_SOURCE, 3);

    render(<SidebarNav />);

    const row = screen.getByText("Needs You").closest(".shell-nav__item");
    expect(row?.textContent).toContain("waiting in Needs You");
  });

  it("draws nothing for a count of zero", () => {
    setNavBadge(INBOX_BADGE_SOURCE, 0);

    const { container } = render(<SidebarNav />);

    expect(container.querySelector(".shell-nav__badge")).toBeNull();
  });

  it("appears and disappears as the count is published and withdrawn", () => {
    const { container } = render(<SidebarNav />);

    act(() => setNavBadge(INBOX_BADGE_SOURCE, 2));
    expect(container.querySelector(".shell-nav__badge")?.textContent).toContain("2");

    act(() => setNavBadge(INBOX_BADGE_SOURCE, null));
    expect(container.querySelector(".shell-nav__badge")).toBeNull();
  });
});

describe("the keyboard", () => {
  /**
   * Three built entries, so the ring has somewhere to go.
   *
   * @returns Nothing.
   */
  function stageRing(): void {
    stage(navEntry({ id: "ring-b", label: "Ring B", route: "/ring-b", sort: 200 }));
    stage(navEntry({ id: "ring-c", label: "Ring C", route: "/ring-c", sort: 210 }));
  }

  it("puts exactly one entry in the tab order", () => {
    stageRing();
    const { container } = render(<SidebarNav />);

    // A roving tab stop: one press of Tab reaches the sidebar, and the arrows move inside it.
    expect(container.querySelectorAll('[data-nav-id][tabindex="0"]')).toHaveLength(1);
  });

  it("puts it on the entry the reader is already standing in", () => {
    stageRing();
    path.current = "/ring-c";
    render(<SidebarNav />);

    expect(screen.getByRole("link", { name: "Ring C" })).toHaveAttribute("tabindex", "0");
  });

  it("falls back to the first entry when the route belongs to none of them", () => {
    stageRing();
    path.current = "/nowhere";
    render(<SidebarNav />);

    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("tabindex", "0");
  });

  it("moves down and up with the arrows", () => {
    stageRing();
    render(<SidebarNav />);
    const links = screen.getAllByRole("link");
    links[0].focus();

    fireEvent.keyDown(links[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
    expect(links[1]).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(links[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(links[0]);
  });

  it("wraps at both ends", () => {
    stageRing();
    render(<SidebarNav />);
    const links = screen.getAllByRole("link");

    links[0].focus();
    fireEvent.keyDown(links[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(links[links.length - 1]);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[0]);
  });

  it("jumps to the ends with Home and End", () => {
    stageRing();
    render(<SidebarNav />);
    const links = screen.getAllByRole("link");
    links[1].focus();

    fireEvent.keyDown(links[1], { key: "End" });
    expect(document.activeElement).toBe(links[links.length - 1]);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(links[0]);
  });

  it("leaves the arrows alone on the collapse control, which is not in the ring", () => {
    stageRing();
    render(<SidebarNav />);
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    collapse.focus();

    fireEvent.keyDown(collapse, { key: "ArrowDown" });

    expect(document.activeElement).toBe(collapse);
  });

  it("activates an entry with Enter, because it is a real link", () => {
    // Nothing to handle and nothing to test beyond the shape: a `<a href>` is what makes
    // Enter, middle-click and "open in new tab" all work without a line of script.
    render(<SidebarNav />);

    expect(screen.getByRole("link", { name: /Dashboard/ }).tagName).toBe("A");
  });
});

describe("the collapse control", () => {
  it("sits at the foot and says what pressing it does", () => {
    render(<SidebarNav />);

    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("collapses to the rail, and remembers it for the next visit", () => {
    render(<SidebarNav />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    // The attribute is what the stylesheet reads; the key is what the boot script reads back
    // before the first paint on the next load. Both, from one press.
    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("rail");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("rail");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("expands again from the rail", () => {
    render(<SidebarNav />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("wide");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("offers to expand when the viewport has collapsed the sidebar for the reader", () => {
    // Below 1024px the rail is the default, so the control's job there is the opposite one —
    // and a control labelled "Collapse" that expands is a control nobody presses twice.
    media = installMatchMedia(true, "(max-width: 64rem)");

    render(<SidebarNav />);

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });
});

describe("the drawer, below 768px", () => {
  /**
   * Render with the viewport inside the drawer breakpoint, and open it.
   *
   * @returns What `render` returned.
   */
  function openDrawer() {
    media = installMatchMedia(true, DRAWER_MEDIA_QUERY);
    const result = render(<SidebarNav />);
    act(() => setDrawerOpen(true));

    return result;
  }

  it("is closed until something opens it", () => {
    media = installMatchMedia(true, DRAWER_MEDIA_QUERY);
    const { container } = render(<SidebarNav />);

    expect(sidebar().className).not.toContain("shell-nav--open");
    expect(container.querySelector(".shell-nav__scrim")).toBeNull();
  });

  it("opens over the pane, with ground behind it", () => {
    const { container } = openDrawer();

    expect(sidebar().className).toContain("shell-nav--open");
    const scrim = container.querySelector(".shell-nav__scrim");
    expect(scrim).not.toBeNull();
    // Outside the sidebar, not inside it: the sidebar is a container query container, and
    // containment would make it the containing block for a fixed-position child — leaving the
    // scrim over the navigation instead of over the page.
    expect(sidebar()).not.toContainElement(scrim as HTMLElement);
  });

  it("takes focus when it opens and gives it back when it closes", () => {
    media = installMatchMedia(true, DRAWER_MEDIA_QUERY);
    render(
      <>
        <button type="button">opener</button>
        <SidebarNav />
      </>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    act(() => setDrawerOpen(true));
    expect(document.activeElement).toBe(sidebar());

    act(() => setDrawerOpen(false));
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside itself while it is open", () => {
    openDrawer();
    const nav = sidebar();
    const stops = focusStops(nav);
    stops[stops.length - 1].focus();

    fireEvent.keyDown(nav, { key: "Tab" });

    expect(document.activeElement).toBe(stops[0]);
  });

  it("closes on Escape", () => {
    openDrawer();

    fireEvent.keyDown(sidebar(), { key: "Escape" });

    expect(sidebar().className).not.toContain("shell-nav--open");
  });

  it("closes when the ground behind it is pressed", () => {
    const { container } = openDrawer();

    fireEvent.mouseDown(container.querySelector(".shell-nav__scrim") as HTMLElement);

    expect(sidebar().className).not.toContain("shell-nav--open");
  });

  it("closes behind a link the reader follows", () => {
    // A drawer left open over the page the reader just asked for is a page they have to
    // dismiss the navigation to read.
    openDrawer();

    follow(screen.getByRole("link", { name: /Dashboard/ }));

    expect(sidebar().className).not.toContain("shell-nav--open");
  });

  it("closes itself when the window grows past the breakpoint", () => {
    openDrawer();

    act(() => media?.set(false));

    // Not cosmetic: the focus trap reads the same flag, and a trap around a sidebar sitting
    // quietly beside the page is a keyboard that cannot leave it.
    expect(sidebar().className).not.toContain("shell-nav--open");
  });

  it("does not trap Tab when the sidebar is a column rather than a drawer", () => {
    render(<SidebarNav />);
    const nav = sidebar();
    const stops = focusStops(nav);
    stops[stops.length - 1].focus();

    fireEvent.keyDown(nav, { key: "Tab" });

    // Focus is left exactly where it was, for the browser to move out of the sidebar.
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });
});
