"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useMediaQuery } from "@/app/media-query";
import { Badge } from "@/app/ui/badge";
import { cx } from "@/app/ui/class-names";

import { trapTab } from "./focus-trap";
import {
  type NavEntry,
  isActiveRoute,
  navGroup,
  navStatus,
  permittedNavEntries,
} from "./nav";
import { SIDEBAR_ID } from "./regions";
import {
  DRAWER_MEDIA_QUERY,
  RAIL_MEDIA_QUERY,
  resolveSidebarChoice,
  setDrawerOpen,
  setSidebarChoice,
} from "./sidebar-state";
import { useNavRegistry, useSidebar } from "./use-shell-nav";

// The eleven seeded entries, registering themselves the moment the sidebar is loaded. An
// import for its effect rather than for a value, which is what "modules register themselves"
// means — and the reason nothing below names a single module.
import "./nav-modules";

import "./shell.css";

/**
 * The sidebar: the product's primary navigation, rendered from the module registry
 * ([#644](https://github.com/NobuData/ouroboros/issues/644)).
 *
 * **It names no module.** Everything it draws comes from `app/shell/nav-registry.ts`, so a
 * surface arriving later registers an entry from its own directory and this file does not
 * change — which is the registry's whole justification (decision S1), and is asserted as such
 * in `__tests__/shell/sidebar-nav.test.tsx`.
 *
 * A Client Component for four reasons, each of which is a browser fact: the current path
 * (`usePathname`), the reader's collapse choice, the viewport's two breakpoints, and the
 * keyboard. Threading any of them down from a Server Component would re-render the whole
 * shell on every navigation instead of the one list that changes.
 *
 * ### Three widths, and only one of them is this component's doing
 *
 * The specification (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2) asks for 240px, a 64px icon
 * rail below 1024px, and an overlay drawer below 768px. All three are `shell.css` redefining
 * `--shell-sidebar`, so the layout moves without script and holds before hydration and with
 * JavaScript disabled. What script adds is the parts CSS cannot answer: the *choice* the
 * chevron makes (stamped on `<html>`, remembered per reader — `app/shell/sidebar-state.ts`),
 * and whether the drawer is open.
 *
 * The rail's own treatment — labels becoming tooltips — is a **container query** on the
 * sidebar's measured width rather than a rule per trigger. One question ("is there room for
 * the word?"), asked of the element that would have to answer it anyway, and true however the
 * width was arrived at: the breakpoint, the reader's chevron, or the drawer, which is 240px
 * wide at every viewport and therefore keeps its labels.
 *
 * ### The keyboard
 *
 * The entries are a roving tab stop: one of them is in the tab order and the arrows move
 * between them (§ 1.2's "arrow navigation, Enter, focus ring"). Enter needs no handler — every
 * reachable entry is a real `<a href>`, which is also why the ones that lead nowhere are
 * `<span>`s: the keyboard never stops on a row it cannot activate.
 */

/** The two groups, in the order § 1.2 stacks them: the modules, then the foot. */
const GROUPS: readonly { readonly group: "primary" | "secondary"; readonly foot: boolean }[] =
  [
    { group: "primary", foot: false },
    { group: "secondary", foot: true },
  ];

/**
 * The navigation landmark, its collapse control, and — while it is open below 768px — the
 * ground the drawer sits over.
 *
 * @returns The sidebar.
 */
export function SidebarNav() {
  const pathname = usePathname();
  const { entries, badges, capabilities } = useNavRegistry();
  const { choice, drawerOpen } = useSidebar();

  /** Whether the viewport puts the sidebar below its two breakpoints. */
  const narrow = useMediaQuery(RAIL_MEDIA_QUERY);
  const isDrawer = useMediaQuery(DRAWER_MEDIA_QUERY);

  /** Which of the two widths the reader is looking at, with *default* resolved. */
  const width = resolveSidebarChoice(choice, narrow);

  const nav = useRef<HTMLElement>(null);

  /**
   * The entry the arrows last moved to, or `null` while the reader has not used them.
   *
   * Held as an id rather than an index because the list can change underneath it — a module
   * registering late, a capability arriving — and an index would then point at a different
   * row than the one that has focus.
   */
  const [roving, setRoving] = useState<string | null>(null);

  const visible = permittedNavEntries(entries, capabilities);
  /** The rows the keyboard can land on: the built ones, in render order. */
  const stops = visible.filter((entry) => navStatus(entry) === "live");

  /**
   * Which row holds the tab stop.
   *
   * The one the arrows moved to; failing that the entry for the current URL, so Tab lands
   * where the reader already is; failing that the first row, so the sidebar is always
   * reachable in one press.
   */
  const tabStop =
    stops.find((entry) => entry.id === roving)?.id ??
    stops.find((entry) => isActiveRoute(pathname, entry.route))?.id ??
    stops[0]?.id;

  /**
   * A drawer that stops being one closes itself.
   *
   * Widening the window past 768px puts the sidebar back in the grid, where "open" means
   * nothing visually — but the focus trap below reads the same flag, and a trap around a
   * sidebar sitting quietly beside the page is a keyboard that cannot leave it.
   */
  useEffect(() => {
    if (drawerOpen && !isDrawer) setDrawerOpen(false);
  }, [drawerOpen, isDrawer]);

  /**
   * Focus into the drawer when it opens, and back to its opener when it closes.
   *
   * The cleanup is the return, which ties it to the drawer's lifetime rather than to any
   * particular way of closing — Escape, the scrim, a link inside it, or the window widening.
   */
  useEffect(() => {
    if (!drawerOpen) return;

    const returnTo = document.activeElement;
    nav.current?.focus();

    return () => {
      // The hamburger is still mounted in every real case; the check is for the one where a
      // route change took the opener with it, and the browser's default (the body) is then
      // the honest answer.
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, [drawerOpen]);

  /**
   * Move the roving tab stop.
   *
   * The ring wraps, which is the behaviour a short vertical list wants: eleven entries make
   * "one press up from the top" a faster way to reach Settings than eleven presses down.
   *
   * @param key The key pressed.
   * @param from The row it was pressed on.
   * @returns The id to move to, or `undefined` when the key is not one of the four.
   */
  function nextStop(key: string, from: string): string | undefined {
    const ids = stops.map((entry) => entry.id);
    const at = ids.indexOf(from);
    if (at < 0) return undefined;

    if (key === "ArrowDown") return ids[(at + 1) % ids.length];
    if (key === "ArrowUp") return ids[(at - 1 + ids.length) % ids.length];
    if (key === "Home") return ids[0];
    if (key === "End") return ids[ids.length - 1];
    return undefined;
  }

  /**
   * The sidebar's keyboard: the drawer's two obligations, then the roving ring.
   *
   * Escape and the Tab cycle are conditional on the drawer being open because that is when
   * the sidebar has covered the page — a trap around a sidebar the reader can simply Tab past
   * would be a cage.
   *
   * @param event The key press, from anywhere in the sidebar.
   * @returns Nothing.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (drawerOpen) {
      if (event.key === "Escape") {
        // Stopped here so an Escape meant for the drawer does not also close something the
        // drawer was opened over.
        event.stopPropagation();
        setDrawerOpen(false);
        return;
      }

      if (event.key === "Tab") {
        if (nav.current !== null) trapTab(event, nav.current);
        return;
      }
    }

    // The arrows belong to the entries, not to the sidebar: pressed on the collapse control
    // at the foot they do nothing, because it is not a member of the ring.
    const target = event.target instanceof HTMLElement ? event.target : null;
    const id = target?.closest<HTMLElement>("[data-nav-id]")?.dataset.navId;
    if (id === undefined) return;

    const next = nextStop(event.key, id);
    if (next === undefined) return;

    event.preventDefault();
    setRoving(next);
    // Read out of the DOM rather than through a ref per row: the rows are this component's
    // own markup and the id is on each of them already, so a second bookkeeping structure
    // would only be a second thing that can disagree with what was rendered.
    const rows = nav.current?.querySelectorAll<HTMLElement>("[data-nav-id]") ?? [];
    for (const row of rows) if (row.dataset.navId === next) row.focus();
  }

  return (
    <>
      {/*
        The ground the drawer sits over, and the second way to dismiss it. It is a sibling of
        the sidebar rather than a child, which is load-bearing: the sidebar is a container
        query container, and container-type applies layout containment — which would make it
        the containing block for a `position: fixed` descendant and leave the scrim covering
        the sidebar instead of the page.

        `mousedown` rather than `click`, for the reason `app/shell/overlay.tsx` gives: a click
        fires where the press *ended*, so a drag out of the drawer would dismiss it.
      */}
      {drawerOpen && (
        <div
          className="shell-nav__scrim"
          role="presentation"
          onMouseDown={() => setDrawerOpen(false)}
        />
      )}

      <nav
        className={cx("shell-nav", drawerOpen && "shell-nav--open")}
        id={SIDEBAR_ID}
        aria-label="Primary"
        // A target for the focus effect above, not a tab stop: -1 is what lets the drawer
        // take focus on open without adding a stop to every reader's Tab order.
        tabIndex={-1}
        ref={nav}
        onKeyDown={onKeyDown}
      >
        {GROUPS.map(({ group, foot }) => {
          const rows = navGroup(group, visible);

          // A group nobody may see renders nothing at all — not an empty list with the foot
          // group's rule above it, which is the "no gap" half of capability gating.
          if (rows.length === 0) return null;

          return (
            <ul
              key={group}
              className={cx("shell-nav__group", foot && "shell-nav__group--foot")}
            >
              {rows.map((entry) => (
                <li key={entry.id}>
                  <NavRow
                    entry={entry}
                    pathname={pathname}
                    badge={
                      entry.badgeSource === undefined
                        ? null
                        : (badges[entry.badgeSource] ?? null)
                    }
                    tabStop={entry.id === tabStop}
                    onNavigate={() => setDrawerOpen(false)}
                  />
                </li>
              ))}
            </ul>
          );
        })}

        {/*
          The collapse control § 1.2 puts at the sidebar's foot, below the secondary group.
          Hidden below 768px by the stylesheet: there is no rail down there, only the drawer,
          and a control that collapses something already out of flow is a control that does
          nothing.
        */}
        <button
          type="button"
          className="shell-nav__collapse"
          onClick={() => setSidebarChoice(width === "rail" ? "wide" : "rail")}
          // The name says what pressing it does rather than what state it is in: "Collapse
          // sidebar, button" is a sentence a reader can act on, where a pressed state on a
          // control whose label never changes is a fact they have to hold in their head.
          aria-label={width === "rail" ? "Expand sidebar" : "Collapse sidebar"}
          title={width === "rail" ? "Expand sidebar" : "Collapse sidebar"}
        >
          {width === "rail" ? (
            <ChevronsRight size={16} aria-hidden />
          ) : (
            <ChevronsLeft size={16} aria-hidden />
          )}
        </button>
      </nav>
    </>
  );
}

/** What one row needs to be told. */
interface NavRowProps {
  /** The entry to draw. */
  readonly entry: NavEntry;
  /** The current path, used to decide the active row. */
  readonly pathname: string;
  /** The count its badge shows, or `null` when no source has published one. */
  readonly badge: number | null;
  /** Whether this row is the one in the tab order — see the roving stop above. */
  readonly tabStop: boolean;
  /** Called when the row is followed, so the drawer closes behind it. */
  readonly onNavigate: () => void;
}

/**
 * One row of the sidebar.
 *
 * A built route renders as a link and takes `aria-current="page"` when the URL is under it; an
 * unbuilt one renders as plain text carrying a *soon* chip and its reason. The difference is
 * deliberate and not only visual: a `<span>` is not in the tab order, so the keyboard never
 * stops on a row that cannot be activated, and a screen reader announces "Issues, soon" rather
 * than offering a link to nowhere.
 *
 * The label is a real element in both modes rather than an `aria-label` swapped in when the
 * sidebar narrows: in rail mode the stylesheet hides it *visually* and leaves it in the
 * accessibility tree, so the row is announced identically at every width and the badge's count
 * is announced with it. The `title` is what a sighted reader gets instead — the tooltip § 1.2
 * asks for.
 *
 * @param props See {@link NavRowProps}.
 * @returns The row.
 */
function NavRow({ entry, pathname, badge, tabStop, onNavigate }: NavRowProps) {
  const Icon = entry.icon;
  const icon = <Icon className="shell-nav__icon" size={18} aria-hidden />;
  const label = <span className="shell-nav__label">{entry.label}</span>;

  /*
   * The badge slot. `Badge` (#46) already holds the rule this needs — it renders nothing for
   * `0`, for a negative count and for the `null` that means nobody has counted — which is the
   * honesty rule § 3.5 states and BN.4 restates for this exact row: a zero here would claim
   * that nothing needs you, which is a different thing from not knowing.
   */
  const count =
    entry.badgeSource === undefined ? null : (
      <Badge
        className="shell-nav__badge"
        count={badge}
        label={`waiting in ${entry.label}`}
        tone="warn"
      />
    );

  if (navStatus(entry) === "soon") {
    return (
      <span
        className="shell-nav__item shell-nav__item--soon"
        title={`${entry.label} — ${entry.soonNote}`}
      >
        {icon}
        {label}
        <span className="shell-nav__soon">soon</span>
        {count}
      </span>
    );
  }

  const active = isActiveRoute(pathname, entry.route);

  return (
    <Link
      className={cx("shell-nav__item", active && "shell-nav__item--active")}
      href={entry.route}
      title={entry.label}
      aria-current={active ? "page" : undefined}
      // The ring's membership and its one tab stop. The attribute is what the key handler
      // reads back, so what the keyboard walks and what was rendered cannot come apart.
      data-nav-id={entry.id}
      tabIndex={tabStop ? 0 : -1}
      onClick={onNavigate}
    >
      {icon}
      {label}
      {count}
    </Link>
  );
}
