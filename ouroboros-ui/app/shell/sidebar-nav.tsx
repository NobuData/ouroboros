"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { type NavItem, isActiveRoute, navGroup } from "./nav";

/**
 * The sidebar: the product's primary navigation.
 *
 * A Client Component for one reason — `usePathname()`. Highlighting the current entry
 * is the whole of what this needs from the browser, and the alternative (threading the
 * path down from a Server Component) would re-render the entire shell on every
 * navigation instead of the one list that changes.
 *
 * Collapse is CSS, not state: below 1024px the rail rule in `shell.css` hides the
 * labels and the sidebar becomes an icon rail. That keeps the responsive behaviour
 * working before hydration and with JavaScript disabled. The *user-controlled* collapse
 * — a chevron whose state persists per account — is CP.2 (#644), which also replaces
 * the imported list with a registry modules write into.
 *
 * @returns The navigation landmark, with both groups of entries.
 */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="shell-nav" aria-label="Primary">
      <ul className="shell-nav__group">
        {navGroup("primary").map((item) => (
          <li key={item.id}>
            <NavEntry item={item} pathname={pathname} />
          </li>
        ))}
      </ul>
      <ul className="shell-nav__group shell-nav__group--foot">
        {navGroup("secondary").map((item) => (
          <li key={item.id}>
            <NavEntry item={item} pathname={pathname} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * One row of the sidebar.
 *
 * A built route renders as a link and takes `aria-current="page"` when the URL is under
 * it; an unbuilt one renders as plain text carrying a *soon* chip and its reason. The
 * difference is deliberate and not only visual: a `<span>` is not in the tab order, so
 * the keyboard never stops on a row that cannot be activated, and a screen reader
 * announces "Issues, soon" rather than offering a link to nowhere.
 *
 * The label is repeated in `title` so it survives rail mode, where the text is hidden
 * and the tooltip is all there is.
 *
 * @param item The entry to render.
 * @param pathname The current path, used to decide the active entry.
 * @returns The row.
 */
function NavEntry({ item, pathname }: Readonly<{ item: NavItem; pathname: string }>) {
  const Icon = item.icon;
  const icon = <Icon className="shell-nav__icon" size={18} aria-hidden />;
  const label = <span className="shell-nav__label">{item.label}</span>;

  if (item.status === "soon") {
    return (
      <span
        className="shell-nav__item shell-nav__item--soon"
        title={`${item.label} — ${item.soonNote}`}
      >
        {icon}
        {label}
        <span className="shell-nav__soon">soon</span>
      </span>
    );
  }

  const active = isActiveRoute(pathname, item.route);

  return (
    <Link
      className={`shell-nav__item${active ? " shell-nav__item--active" : ""}`}
      href={item.route}
      title={item.label}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      {label}
    </Link>
  );
}
