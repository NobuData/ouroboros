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

import { DASHBOARD_PATH } from "@/app/paths";

import type { NavEntry } from "./nav";
import { registerNavEntry } from "./nav-registry";

/**
 * The eleven entries the shell specification names, registering themselves at load
 * ([#644](https://github.com/NobuData/ouroboros/issues/644)).
 *
 * This file is the *seed*, not the mechanism: `app/shell/nav-registry.ts` is the registry and
 * `app/shell/sidebar-nav.tsx` renders whatever is in it, so a module arriving later adds its
 * entry by calling `registerNavEntry` from its own directory and touching nothing here. What
 * these eleven have in common is only that they have nowhere else to live yet — nine of the
 * surfaces do not exist, so their registration cannot sit beside them, and a registry seeded
 * from nowhere would leave the sidebar empty until the last module ships.
 *
 * The entries, their icons and their order are `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2's. The
 * icon set is **lucide** (ISC, tree-shakable), which § 1.2 proposes and this issue records as
 * the decision.
 *
 * Every destination except the dashboard is a screen that does not exist yet: the placeholder
 * routes are #49 and each real screen arrives with its own roadmap issue. Rather than link to
 * a 404, those entries are `"soon"` and render as labelled, non-interactive rows — the design
 * system's honesty rule (§ 3.5): a surface that is not ready is *labelled*, never dead. Each
 * note names the issue that turns the row into a link, so the tooltip is a usable answer to
 * "when?" rather than the word *soon* on its own.
 */

/**
 * The name the needs-you count is published under.
 *
 * Exported because two sides have to agree on it and only one of them exists today: the entry
 * below declares it, and [#464](https://github.com/NobuData/ouroboros/issues/464) (BN.4, the
 * inbox counts endpoint) is what will call `setNavBadge` with it. Until something does, the
 * source is absent and the badge is **not drawn** — never drawn as `0`, which would be a
 * claim that nothing needs you rather than an admission that nobody has counted.
 */
export const INBOX_BADGE_SOURCE = "inbox";

/** The eleven, in the specification's order. `sort` leaves room between neighbours so a
 *  module can be slotted between two of them without renumbering the list. */
export const SEEDED_NAV_ENTRIES: readonly NavEntry[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    route: DASHBOARD_PATH,
    icon: Gauge,
    group: "primary",
    sort: 10,
  },
  {
    id: "issues",
    label: "Issues",
    route: "/issues",
    icon: CircleDot,
    group: "primary",
    sort: 20,
    status: "soon",
    soonNote: "Issue intake arrives with #115.",
  },
  {
    id: "workflows",
    label: "Workflows",
    route: "/workflows",
    icon: Workflow,
    group: "primary",
    sort: 30,
    status: "soon",
    soonNote: "The workflow builder arrives with its own roadmap (mockup 04).",
  },
  {
    id: "models",
    label: "Models",
    route: "/models",
    icon: Cpu,
    group: "primary",
    sort: 40,
    status: "soon",
    soonNote: "Model routing arrives with #200.",
  },
  {
    id: "build-farm",
    label: "Build Farm",
    route: "/build-farm",
    icon: Server,
    group: "primary",
    sort: 50,
    status: "soon",
    soonNote: "The build farm arrives with its own roadmap (mockup 08).",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    route: "/knowledge",
    icon: BookOpen,
    group: "primary",
    sort: 60,
    status: "soon",
    soonNote: "The knowledge base arrives with its own roadmap (mockup 14).",
  },
  {
    id: "planning",
    label: "Planning",
    route: "/planning",
    icon: CalendarRange,
    group: "primary",
    sort: 70,
    status: "soon",
    soonNote: "Planning arrives with #283.",
  },
  {
    id: "research",
    label: "Research",
    route: "/research",
    icon: Telescope,
    group: "primary",
    sort: 80,
    status: "soon",
    soonNote: "Research arrives with its own roadmap (mockup 22).",
  },
  {
    id: "insights",
    label: "Insights",
    route: "/insights",
    icon: ChartLine,
    group: "primary",
    sort: 90,
    status: "soon",
    soonNote: "Insights arrives with its own roadmap (mockup 15).",
  },
  {
    id: "needs-you",
    label: "Needs You",
    route: "/inbox",
    icon: Inbox,
    group: "secondary",
    sort: 10,
    status: "soon",
    soonNote: "The needs-you inbox arrives with its own roadmap (mockup 16).",
    badgeSource: INBOX_BADGE_SOURCE,
  },
  {
    id: "settings",
    label: "Settings",
    route: "/settings",
    icon: Settings,
    group: "secondary",
    sort: 20,
    status: "soon",
    soonNote: "Workspace settings arrive with #491.",
  },
];

/**
 * The registrations themselves, run once when this module is first imported — which is what
 * "modules register themselves at load" means, and why `sidebar-nav.tsx` imports this file
 * for its effect rather than for a value.
 *
 * Re-running it is harmless: registration replaces by id, so a hot reload re-seeds rather
 * than doubling the sidebar.
 */
for (const entry of SEEDED_NAV_ENTRIES) registerNavEntry(entry);
