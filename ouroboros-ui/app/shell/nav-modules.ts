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

import {
  BUILD_FARM_PATH,
  DASHBOARD_PATH,
  INSIGHTS_PATH,
  ISSUES_PATH,
  KNOWLEDGE_PATH,
  MODELS_PATH,
  PLANNING_PATH,
  SETTINGS_PATH,
  WORKFLOWS_PATH,
} from "@/app/paths";

import type { NavEntry } from "./nav";
import { registerNavEntry } from "./nav-registry";

/**
 * The eleven entries the shell specification names, registering themselves at load
 * ([#644](https://github.com/NobuData/ouroboros/issues/644)).
 *
 * This file is the *seed*, not the mechanism: `app/shell/nav-registry.ts` is the registry and
 * `app/shell/sidebar-nav.tsx` renders whatever is in it, so a module arriving later adds its
 * entry by calling `registerNavEntry` from its own directory and touching nothing here. What
 * these eleven have in common is only that they have nowhere else to live yet — eight of the
 * surfaces do not exist, so their registration cannot sit beside them, and a registry seeded
 * from nowhere would leave the sidebar empty until the last module ships.
 *
 * The entries, their icons and their order are `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.2's. The
 * icon set is **lucide** (ISC, tree-shakable), which § 1.2 proposes and this issue records as
 * the decision.
 *
 * Every destination except the dashboard, Issues, Workflows, Models, Build Farm, Knowledge,
 * Planning, Insights and Settings is a screen that does not exist yet: the placeholder routes are #49 and
 * each real screen arrives with its own roadmap issue. Rather than link to a 404, those entries are `"soon"` and render as labelled,
 * non-interactive rows — the design system's honesty rule (§ 3.5): a surface that is not
 * ready is *labelled*, never dead. Each note names the issue that turns the row into a link,
 * so the tooltip is a usable answer to "when?" rather than the word *soon* on its own.
 *
 * **Models was the first of the nine to be answered, Issues the second, Workflows the third,
 * Planning the fourth, Build Farm the fifth, Knowledge the sixth and Insights the seventh.** #200
 * built `/models`, #115 built `/issues`, #147 built `/workflows`, #283 built `/planning`, #256
 * built `/build-farm`, #417 built `/knowledge` and #443 built `/insights`, so each note has become a route — which is exactly the transition each remaining note promises,
 * and the reason the notes name issues rather than saying *soon* and stopping.
 */

/**
 * The name the needs-you count is published under.
 *
 * Exported because two sides have to agree on it: the entry below declares it, and
 * `app/shell/inbox-badge.tsx` ([#461](https://github.com/NobuData/ouroboros/issues/461), BN.1's
 * inbox feed) calls `setNavBadge` with it from `GET /api/v1/inbox/feed`'s `open` count. Until the
 * first answer the source is absent and the badge is **not drawn** — never drawn as `0`, which
 * would be a claim that nothing needs you rather than an admission that nobody has counted.
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
  // Live since #115: the intake route is built (`app/(app)/issues/page.tsx`), so the row that
  // named the issue it was waiting for is a link — the amendment #115 posted on #41, acted on.
  {
    id: "issues",
    label: "Issues",
    route: ISSUES_PATH,
    icon: CircleDot,
    group: "primary",
    sort: 20,
  },
  // Live since #147: the studio route is built (`app/(app)/workflows/page.tsx`), so the row
  // that named the roadmap it was waiting for is a link — the amendment mockup 04's roadmap
  // recorded on #49, acted on. `WORKFLOWS_PATH` rather than a workflow's own URL, so the entry
  // lights on every studio URL (`/workflows/standard-fix` included) and the code and copilot
  // views (#169, #565) change nothing here.
  {
    id: "workflows",
    label: "Workflows",
    route: WORKFLOWS_PATH,
    icon: Workflow,
    group: "primary",
    sort: 30,
  },
  // Live since #200: the routing frame is built (`app/(app)/models/(routing)/page.tsx`), so the row
  // that named the issue it was waiting for is a link. The entry stays seeded here rather
  // than moving into `app/models/` — the sidebar would then have to import the module for
  // its effect, which is a second reason for one screen to be in every bundle.
  {
    id: "models",
    label: "Models",
    route: MODELS_PATH,
    icon: Cpu,
    group: "primary",
    sort: 40,
  },
  // Live since #256: the farm route is built (`app/(app)/build-farm/page.tsx`), so the row that
  // named the roadmap it was waiting for is a link — the amendment the build farm roadmap
  // recorded on #49, acted on. The Build Analyzer (#516, `/analyzer`) mounts under this entry: it
  // has no row of its own and keeps this one lit by publishing it as its origin.
  {
    id: "build-farm",
    label: "Build Farm",
    route: BUILD_FARM_PATH,
    icon: Server,
    group: "primary",
    sort: 50,
  },
  // Live since #417: the knowledge frame is built (`app/(app)/knowledge/page.tsx`), so the row that
  // named the roadmap it was waiting for is a link — the amendment the knowledge roadmap recorded
  // on #49, acted on. The skills table, facts card, playbooks and scope ladder (#418–#421) mount
  // under this entry as they land.
  {
    id: "knowledge",
    label: "Knowledge",
    route: KNOWLEDGE_PATH,
    icon: BookOpen,
    group: "primary",
    sort: 60,
  },
  // Live since #283: the planning frame is built (`app/(app)/planning/page.tsx`), so the row that
  // named the issue it was waiting for is a link — the amendment the planning roadmap recorded on
  // #49, acted on.
  {
    id: "planning",
    label: "Planning",
    route: PLANNING_PATH,
    icon: CalendarRange,
    group: "primary",
    sort: 70,
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
  // Live since #443: the insights frame is built (`app/(app)/insights/page.tsx`), so the row that
  // named the roadmap it was waiting for is a link — the amendment the insights roadmap recorded
  // on #49, acted on. The charts, scoreboard and remaining cards (#444–#447) mount under it.
  {
    id: "insights",
    label: "Insights",
    route: INSIGHTS_PATH,
    icon: ChartLine,
    group: "primary",
    sort: 90,
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
  // Live since #141, when the settings section had one built tab and `/settings` redirected to
  // it; since BS.1 (#491) the route is the administration hub itself
  // (`app/(app)/settings/page.tsx`). The route was always `SETTINGS_PATH` rather than a tab's
  // own, so the entry lights on the hub and on every surface mounted under it, and #491
  // changed nothing here.
  {
    id: "settings",
    label: "Settings",
    route: SETTINGS_PATH,
    icon: Settings,
    group: "secondary",
    sort: 20,
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
