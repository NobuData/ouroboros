/**
 * The settings hub's copy, its sections and its tab set, as values
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * Mockup 17's page head is *Settings · acme-robotics* over **Workspace settings**, its section
 * nav is six anchors — Workspace · Members · Policies · Integrations · Audit · Danger zone — and
 * its page is eight cards, two of which (Appearance, Notifications) have no anchor of their own.
 * Decision **S2** of the Workspace Settings roadmap mounts the existing admin surfaces beside the
 * anchors as tabs: Sources, Providers, Farm tokens and Knowledge / env. This module is where all
 * of that is written down once, so the hub, the tab row and every mounted page draw one list.
 *
 * ### Two kinds of tab, and the type keeps them apart
 *
 * A **section** is a fragment of the hub — `/settings#policies` — and the tab for it is an
 * anchor: on the hub it moves the pane, from a mounted page it leads back to the hub. A
 * **mounted tab** is a route — a surface that keeps its own implementation and is reached from
 * here. Two of those are drawn inside this section's frame ({@link SettingsSurface}: their pages
 * carry the tab row, so one of them can be the *current* tab); the other two keep the frame they
 * were built with (Providers is a Models page, Knowledge / env a block on the Knowledge page) and
 * the tab is the way to them.
 *
 * ### How a section saves is a fact about the section
 *
 * Decision **S7**: field edits accumulate and are committed by **Save changes**, per section;
 * a control with an immediate consequence acts at once, behind a confirmation, and is never a
 * form field. {@link SettingsSection.saves} says which a section is, and
 * `app/settings/save-model.ts` refuses a section that is not `"batch"` — so the Danger zone is
 * outside the dirty state by construction rather than by every card remembering.
 *
 * Framework-free and pure, the way `app/models/view.ts` is.
 */

import {
  FARM_TOKENS_PATH,
  KNOWLEDGE_ENV_PATH,
  PROVIDERS_PATH,
  SOURCES_PATH,
} from "@/app/paths";

/* ------------------------------------------------------------------ the head */

/** The eyebrow's first word — what every page in the section is filed under. */
export const SETTINGS_EYEBROW = "Settings";

/** The hub's `<h1>` — mockup 17's, verbatim. */
export const SETTINGS_TITLE = "Workspace settings";

/** The sentence under it — mockup 17's, verbatim. */
export const SETTINGS_SUBLINE =
  "Who can do what, what merges on its own, and where the record lives.";

/** The head's ghost action — the shortcut to the audit log's export. */
export const EXPORT_AUDIT_LABEL = "Export audit CSV";

/**
 * The eyebrow for one workspace — mockup 17's `Settings · acme-robotics`.
 *
 * @param workspaceName The workspace's display name, as the service reports it.
 * @returns The eyebrow.
 */
export function settingsEyebrow(workspaceName: string): string {
  return `${SETTINGS_EYEBROW} · ${workspaceName}`;
}

/* ------------------------------------------------------------------ the sections */

/** Every card of mockup 17, by the id its element carries. */
export type SettingsSectionId =
  | "workspace"
  | "members"
  | "appearance"
  | "policies"
  | "audit"
  | "integrations"
  | "notifications"
  | "danger";

/**
 * How a section's controls take effect (decision S7).
 *
 * - `"batch"` — its fields join the page's dirty state and are committed by **Save changes**.
 * - `"immediate"` — its controls act at once, each behind its own confirmation where the
 *   consequence warrants one. Nothing in it can be *unsaved*.
 */
export type SectionSaves = "batch" | "immediate";

/** How many of the grid's twelve columns a section's card takes — the mockup's `c-5`/`c-7`/`c-12`. */
export type SectionSpan = 5 | 7 | 12;

/** One section of the hub. */
export interface SettingsSection {
  /** The id its element carries, and the fragment that addresses it. */
  readonly id: SettingsSectionId;
  /** What its card is called — the heading, and the card's accessible name. */
  readonly title: string;
  /**
   * What its tab in the section nav says, or `null` for a card the mockup's nav does not name.
   * A section with no tab is still scrolled past; the tab of the section above it stays lit.
   */
  readonly tab: string | null;
  /** How wide its card is. */
  readonly span: SectionSpan;
  /** How its controls take effect. */
  readonly saves: SectionSaves;
  /**
   * What its card will hold and the issue that builds it — what the seat says until then.
   * `null` for a section whose card is built.
   */
  readonly arrives: string | null;
}

/**
 * The eight sections, in the order the page draws them.
 *
 * The order is the mockup's rows — Workspace beside Members, Policies beside Audit, Integrations
 * beside Notifications, the Danger zone last — with Appearance (the App Shell roadmap's
 * amendment, CQ.2) on a row of its own under the first, where a full-width card leaves no hole
 * in the grid. The **tab row's** order is the mockup's own and is not this one: see
 * {@link SECTION_TABS}.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "workspace",
    title: "Workspace",
    tab: "Workspace",
    span: 5,
    saves: "batch",
    // Built: `app/settings/workspace-card.tsx` (#492).
    arrives: null,
  },
  {
    id: "members",
    title: "Members & roles",
    tab: "Members",
    span: 7,
    // Every control acts at once — the capability box, an invitation, a role change, a token.
    saves: "immediate",
    // Built: `app/members/members-card.tsx` (#493).
    arrives: null,
  },
  {
    id: "appearance",
    title: "Appearance",
    tab: null,
    span: 12,
    saves: "immediate",
    // Built: `app/settings/appearance-card.tsx`.
    arrives: null,
  },
  {
    id: "policies",
    title: "Autonomy policies",
    tab: "Policies",
    span: 7,
    saves: "batch",
    arrives:
      "Auto-merge, human review, protected paths and the spend guard arrive here with #494.",
  },
  {
    id: "audit",
    title: "Audit log",
    tab: "Audit",
    span: 5,
    saves: "batch",
    arrives: "The audit log, its CSV export and SIEM streaming arrive with #495.",
  },
  {
    id: "integrations",
    title: "Integrations",
    tab: "Integrations",
    span: 7,
    saves: "batch",
    arrives: "Connection status for GitHub, Slack, Jira and the rest arrives with #495.",
  },
  {
    id: "notifications",
    title: "Notifications",
    tab: null,
    span: 5,
    saves: "batch",
    arrives: "Workspace-wide notification routes arrive with #495.",
  },
  {
    id: "danger",
    title: "Danger zone",
    tab: "Danger zone",
    span: 12,
    saves: "immediate",
    arrives: "Pause all loops, disconnect GitHub and delete workspace arrive with #496.",
  },
];

/** A section the nav names: its id and what its tab says. */
export interface SectionTab {
  readonly id: SettingsSectionId;
  /** What the tab says. */
  readonly label: string;
}

/** The order mockup 17's section nav lists its anchors in. */
const TAB_ORDER: readonly SettingsSectionId[] = [
  "workspace",
  "members",
  "policies",
  "integrations",
  "audit",
  "danger",
];

/**
 * The six anchors, in the mockup's order: Workspace · Members · Policies · Integrations · Audit ·
 * Danger zone.
 *
 * Derived from {@link SETTINGS_SECTIONS} rather than written beside it, so a tab cannot name a
 * section the page does not draw.
 */
export const SECTION_TABS: readonly SectionTab[] = TAB_ORDER.flatMap((id) => {
  const section = SETTINGS_SECTIONS.find((one) => one.id === id);

  return section === undefined || section.tab === null ? [] : [{ id, label: section.tab }];
});

/**
 * One section, by id.
 *
 * @param id The section's id.
 * @returns The section.
 * @throws {Error} For an id that names no section — a caller reaching past the type.
 */
export function settingsSection(id: SettingsSectionId): SettingsSection {
  const section = SETTINGS_SECTIONS.find((one) => one.id === id);
  if (section === undefined) throw new Error(`"${String(id)}" is not a settings section.`);

  return section;
}

/**
 * Whether a string is a section the nav names — what a URL's fragment is checked against before
 * anything scrolls to it.
 *
 * @param value Any string: a fragment without its `#`.
 * @returns `true` for one of the six anchors, narrowing the type.
 */
export function isSectionTab(value: string): value is SettingsSectionId {
  return SECTION_TABS.some((tab) => tab.id === value);
}

/** The id a section's heading carries — its card's `aria-labelledby` target. */
export function sectionTitleId(id: SettingsSectionId): string {
  return `settings-${id}-title`;
}

/* ------------------------------------------------------------------ how a section saves */

/** The marker on a section whose controls act at once — the word mockup 17's own tag uses. */
export const IMMEDIATE_MARK = "applies instantly";

/**
 * The marker on a batch section holding edits — `2 unsaved`.
 *
 * @param count How many of the section's fields differ from what is saved. Positive.
 * @returns The marker.
 */
export function unsavedMark(count: number): string {
  return `${String(count)} unsaved`;
}

/* ------------------------------------------------------------------ the mounted tabs */

/**
 * The mounted surfaces drawn inside this section's frame — the pages that carry the tab row,
 * and so the only tabs that can be `aria-current="page"`.
 */
export type SettingsSurface = "sources" | "farm-tokens";

/** Which page of the section is drawing the frame: the hub, or one of the mounted surfaces. */
export type SettingsPage = "hub" | SettingsSurface;

/** A mounted admin surface, as a tab. */
export interface MountedTab {
  readonly id: SettingsSurface | "providers" | "knowledge-env";
  /** What the tab says. */
  readonly label: string;
  /** Where the surface lives. */
  readonly href: string;
}

/**
 * The mounted tabs (decision S2), in the issue's order: Sources · Providers · Farm tokens ·
 * Knowledge / env.
 *
 * Each keeps its implementation and its address. **Providers** is the Models section's page
 * and stays in that section's tab set as well — mockups 06, 07 and 21 draw it there — so this
 * tab is a second way in rather than a move. **Knowledge / env** leads to the repo profile card
 * on the Knowledge page, where a repository's environment recipe is edited; Knowledge keeps its
 * sidebar entry.
 */
export const MOUNTED_TABS: readonly MountedTab[] = [
  { id: "sources", label: "Sources", href: SOURCES_PATH },
  { id: "providers", label: "Providers", href: PROVIDERS_PATH },
  { id: "farm-tokens", label: "Farm tokens", href: FARM_TOKENS_PATH },
  { id: "knowledge-env", label: "Knowledge / env", href: KNOWLEDGE_ENV_PATH },
];
