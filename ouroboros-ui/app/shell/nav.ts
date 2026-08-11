import {
  BookOpen,
  CalendarRange,
  ChartLine,
  CircleDot,
  Cpu,
  Gauge,
  Inbox,
  type LucideIcon,
  Server,
  Settings,
  Telescope,
  Workflow,
} from "lucide-react";

/**
 * The application's navigation model: what the sidebar offers, and which entry the
 * current URL belongs to.
 *
 * The entries and their icons are the eleven the shell specification names
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2) in the order it lists them. They are a
 * plain exported array rather than a registry modules write into: the registry is
 * CP.2's (#644) deliverable, and inventing half of one here would leave two ways to
 * add a nav entry. The shape below is deliberately the shape a registry entry has, so
 * that issue replaces the source of the list without touching the component that
 * renders it.
 *
 * Every destination except the dashboard is a screen that does not exist yet: the
 * placeholder routes are #49 and each real screen arrives with its own roadmap issue.
 * Rather than link to a 404, those entries carry {@link NavItem.status} `"soon"` and
 * render as labelled, non-interactive rows — the design system's honesty rule (§ 3.5):
 * a surface that is not ready is *labelled*, never dead.
 */

/** Which of the sidebar's two groups an entry belongs to. */
export type NavGroup = "primary" | "secondary";

/** Whether an entry's destination exists yet. */
export type NavStatus = "live" | "soon";

/** One entry in the sidebar. */
export interface NavItem {
  /** Stable identifier — the module this entry belongs to. Unique across the list. */
  id: string;
  /** The name shown beside the icon, and the tooltip when the sidebar is a rail. */
  label: string;
  /** The route it leads to. Unique across the list, and the value matched by
   *  {@link isActiveRoute}. */
  route: string;
  /** The lucide icon drawn at the head of the row. */
  icon: LucideIcon;
  /** Top group (modules) or bottom group (inbox and settings). */
  group: NavGroup;
  /** `"live"` when the route is built and may be linked to. */
  status: NavStatus;
  /** Why the entry is not reachable, shown as its tooltip. Set on every `"soon"` entry
   *  and on no `"live"` one — {@link NAV_ITEMS} is asserted to hold that. */
  soonNote?: string;
}

/**
 * The eleven entries, in the specification's order: nine module surfaces in the primary
 * group, then the inbox and settings in the secondary group at the foot.
 *
 * Each `soon` note names the issue that turns the row into a link, so the tooltip is a
 * usable answer to "when?" rather than the word *soon* on its own.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    route: "/",
    icon: Gauge,
    group: "primary",
    status: "live",
  },
  {
    id: "issues",
    label: "Issues",
    route: "/issues",
    icon: CircleDot,
    group: "primary",
    status: "soon",
    soonNote: "Issue intake arrives with #115.",
  },
  {
    id: "workflows",
    label: "Workflows",
    route: "/workflows",
    icon: Workflow,
    group: "primary",
    status: "soon",
    soonNote: "The workflow builder arrives with its own roadmap (mockup 04).",
  },
  {
    id: "models",
    label: "Models",
    route: "/models",
    icon: Cpu,
    group: "primary",
    status: "soon",
    soonNote: "Model routing arrives with #200.",
  },
  {
    id: "build-farm",
    label: "Build Farm",
    route: "/build-farm",
    icon: Server,
    group: "primary",
    status: "soon",
    soonNote: "The build farm arrives with its own roadmap (mockup 08).",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    route: "/knowledge",
    icon: BookOpen,
    group: "primary",
    status: "soon",
    soonNote: "The knowledge base arrives with its own roadmap (mockup 14).",
  },
  {
    id: "planning",
    label: "Planning",
    route: "/planning",
    icon: CalendarRange,
    group: "primary",
    status: "soon",
    soonNote: "Planning arrives with #283.",
  },
  {
    id: "research",
    label: "Research",
    route: "/research",
    icon: Telescope,
    group: "primary",
    status: "soon",
    soonNote: "Research arrives with its own roadmap (mockup 22).",
  },
  {
    id: "insights",
    label: "Insights",
    route: "/insights",
    icon: ChartLine,
    group: "primary",
    status: "soon",
    soonNote: "Insights arrives with its own roadmap (mockup 15).",
  },
  {
    id: "needs-you",
    label: "Needs You",
    route: "/inbox",
    icon: Inbox,
    group: "secondary",
    status: "soon",
    soonNote: "The needs-you inbox arrives with its own roadmap (mockup 16).",
  },
  {
    id: "settings",
    label: "Settings",
    route: "/settings",
    icon: Settings,
    group: "secondary",
    status: "soon",
    soonNote: "Workspace settings arrive with #491.",
  },
];

/**
 * The entries of one group, in order.
 *
 * @param group Which group to take.
 * @param items List to read. Defaults to {@link NAV_ITEMS}; tests pass fixtures.
 * @returns The group's entries, in the order they are declared.
 */
export function navGroup(
  group: NavGroup,
  items: readonly NavItem[] = NAV_ITEMS,
): readonly NavItem[] {
  return items.filter((item) => item.group === group);
}

/**
 * Does a URL belong to a navigation entry?
 *
 * Two rules, which is what the specification means by "exact-route and section
 * matching" (§ 1.2):
 *
 * - The dashboard is `/`, and only `/`. A prefix rule there would make it the active
 *   entry on every page in the product.
 * - Every other entry owns its route *and everything under it*, so `/models/routing`
 *   keeps **Models** highlighted. The boundary is a `/`: `/model-registry` is not
 *   under `/models`, which a bare `startsWith` would get wrong.
 *
 * A trailing slash is not a different page, so it is trimmed before either rule — and
 * `pathname` alone is compared, which carries no query string or hash for exactly this
 * reason.
 *
 * @param pathname The current path, as `usePathname()` reports it.
 * @param route The entry's {@link NavItem.route}.
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
 * @returns The path without its trailing slashes — `""` for a path that was only
 *   slashes, which both callers above read as the root.
 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
