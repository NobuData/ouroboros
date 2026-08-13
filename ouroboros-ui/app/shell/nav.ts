import type { LucideIcon } from "lucide-react";

/**
 * The navigation *model*: what an entry is, how a list of them is ordered, which ones a
 * reader may see, and which one the current URL belongs to.
 *
 * This is the half of CP.2 ([#644](https://github.com/NobuData/ouroboros/issues/644)) that
 * holds no state. `app/shell/nav-registry.ts` is the registry modules write into and
 * `app/shell/nav-modules.ts` seeds it with the eleven entries the shell specification names
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2); everything here is a pure function of a list
 * somebody else owns, which is what lets each rule below be tested without a registry, a DOM
 * or a route.
 *
 * **Framework-free apart from the icon type**, which is `lucide-react`'s and is a type import
 * — it disappears at build time. Nothing here reaches for `next/*` or React.
 */

/** Which of the sidebar's two groups an entry belongs to. */
export type NavGroup = "primary" | "secondary";

/** Whether an entry's destination exists yet. */
export type NavStatus = "live" | "soon";

/**
 * One entry in the sidebar, as a module registers it.
 *
 * The shape is the specification's — `{ id, icon, label, route, sort, group, badgeSource?,
 * capability? }` — plus the honesty pair CP.1 introduced (`status`, `soonNote`), because nine
 * of the eleven seeded destinations are screens nobody has built and a registry that could
 * only describe *built* surfaces would have to link to them anyway.
 */
export interface NavEntry {
  /** Stable identifier — the module this entry belongs to. Unique across the registry. */
  id: string;
  /** The name shown beside the icon, and the tooltip when the sidebar is a rail. */
  label: string;
  /** The route it leads to. Unique across the registry, and what {@link isActiveRoute}
   *  matches a URL against. */
  route: string;
  /** The lucide icon drawn at the head of the row (the icon set is § 1.2's, recorded as
   *  this issue's decision). */
  icon: LucideIcon;
  /** Top group (modules) or bottom group (inbox and settings). */
  group: NavGroup;
  /** Where in its group the entry sits — ascending, ties broken by {@link NavEntry.id} so
   *  the order never depends on which module happened to load first. */
  sort: number;
  /** `"live"` when the route is built and may be linked to. Defaults to `"live"`: a module
   *  registering itself is a module that exists. */
  status?: NavStatus;
  /** Why the entry is not reachable, shown as its tooltip. Required on a `"soon"` entry and
   *  refused on a `"live"` one — `app/shell/nav-registry.ts` enforces both. */
  soonNote?: string;
  /**
   * The name of the count this entry's badge reads, when it has one.
   *
   * A *name*, not a number: the count is published separately (`setNavBadge`), so an entry
   * can declare that it has a badge before anything is able to compute one — and a badge
   * whose source has published nothing is **absent**, which is not the same claim as zero.
   */
  badgeSource?: string;
  /**
   * What a reader must be granted to see this entry at all.
   *
   * Absent means everyone. Present means the entry is hidden — with no gap left behind —
   * until the capability is among the granted set. See {@link permittedNavEntries} for the
   * direction this errs in and why.
   */
  capability?: string;
}

/** The order the two groups are rendered in, which is also the order they are sorted in. */
const GROUP_ORDER: readonly NavGroup[] = ["primary", "secondary"];

/**
 * An entry's status, with the default applied.
 *
 * @param entry The entry.
 * @returns `"live"` unless the entry says otherwise.
 */
export function navStatus(entry: NavEntry): NavStatus {
  return entry.status ?? "live";
}

/**
 * Put a list of entries in the order the sidebar draws them.
 *
 * Primary group first, then secondary; inside a group, ascending {@link NavEntry.sort}; and
 * ties broken by id. That last rule is the one that matters: registration order is the order
 * modules happen to be imported in, which changes with a bundler's whims, so a list that fell
 * back to it would be a list that reorders itself between builds.
 *
 * @param entries The entries, in any order.
 * @returns A new array in render order. The input is not modified — the registry hands out
 *   frozen snapshots, and sorting one in place would throw.
 */
export function orderNavEntries(entries: readonly NavEntry[]): NavEntry[] {
  return [...entries].sort(
    (left, right) =>
      GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group) ||
      left.sort - right.sort ||
      left.id.localeCompare(right.id),
  );
}

/**
 * The entries of one group, in the order they were given.
 *
 * @param group Which group to take.
 * @param entries The list to read, already ordered by {@link orderNavEntries}.
 * @returns That group's entries.
 */
export function navGroup(group: NavGroup, entries: readonly NavEntry[]): NavEntry[] {
  return entries.filter((entry) => entry.group === group);
}

/**
 * The entries a reader holding these capabilities may see.
 *
 * **An ungranted entry is hidden, never disabled**, which is the specification's own wording
 * ("capability-gated entries hidden with no gap"): a greyed row is an advertisement for a
 * screen somebody cannot open, and the honesty rule (§ 3.5) is about explaining what a reader
 * *can* act on rather than cataloguing what they cannot.
 *
 * **The default is to hide.** An entry that names a capability nobody has published is not
 * shown, so the failure mode of a capability system that is late, broken or forgotten is a
 * missing entry rather than a visible link into a screen the service will refuse. Nothing
 * seeded declares a capability today, so nothing is hidden — the gate is inert until the
 * first module opts into it.
 *
 * @param entries The entries to filter.
 * @param capabilities What the reader has been granted. Empty is the honest default: no
 *   claim has been made, so no gated entry is shown.
 * @returns The ungated entries, plus the gated ones whose capability is granted, in the
 *   order they were given.
 */
export function permittedNavEntries(
  entries: readonly NavEntry[],
  capabilities: readonly string[],
): NavEntry[] {
  return entries.filter(
    (entry) => entry.capability === undefined || capabilities.includes(entry.capability),
  );
}

/**
 * Does a URL belong to a navigation entry?
 *
 * Two rules, which is what the specification means by "exact-route and section matching"
 * (§ 1.2):
 *
 * - `/` is itself, and only itself. No entry claims it since #45 moved the dashboard to
 *   `/dashboard` — and the rule stays because a prefix match on the root would make whichever
 *   entry did claim it the active one on every page in the product.
 * - Every other entry owns its route *and everything under it*, so `/models/registry` keeps
 *   **Models** highlighted. The boundary is a `/`: `/model-registry` is not under `/models`,
 *   which a bare `startsWith` would get wrong.
 *
 * A trailing slash is not a different page, so it is trimmed before either rule — and
 * `pathname` alone is compared, which carries no query string or hash for exactly this reason.
 *
 * @param pathname The current path, as `usePathname()` reports it.
 * @param route The entry's {@link NavEntry.route}.
 * @returns True when the entry should be highlighted for that path.
 */
export function isActiveRoute(pathname: string, route: string): boolean {
  const path = trimTrailingSlash(pathname) || "/";
  const target = trimTrailingSlash(route) || "/";

  if (target === "/") return path === "/";
  return path === target || path.startsWith(`${target}/`);
}

/**
 * Drop trailing slashes from a path.
 *
 * @param value The path.
 * @returns The path without its trailing slashes — `""` for a path that was only slashes,
 *   which both callers above read as the root.
 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
