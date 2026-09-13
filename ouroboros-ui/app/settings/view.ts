/**
 * The settings section's copy and its tab set, as values
 * ([#141](https://github.com/NobuData/ouroboros/issues/141), ahead of BS.1
 * [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * Mockup 17's page head is *Settings · acme-robotics* over **Workspace settings**, and its
 * section nav is six anchors — Workspace · Members · Policies · Integrations · Audit · Danger
 * zone. Decision **S2** of the Workspace Settings roadmap mounts the existing admin surfaces
 * beside them as tabs, and Ticket sources is the first of those to exist. So this is the
 * section's tab set with one live tab and six honest `soon` ones, each naming BS.1 as where
 * it comes from — the same honesty pair `app/models/view.ts` keeps for the Models section:
 * a live tab carries an `href` and a soon one carries a `note`, and the type makes it
 * impossible to have both or neither.
 *
 * **BS.1 owns the frame.** When it lands, the six `soon` tabs become anchors into the hub's
 * sections and this list is where that happens; the Sources tab, the surface behind it and
 * the route it links to move nowhere.
 *
 * Framework-free and pure, the way `app/models/view.ts` is.
 */

import { SOURCES_PATH } from "@/app/paths";

/** The eyebrow's first word — what every page in the section is filed under. */
export const SETTINGS_EYEBROW = "Settings";

/** The built surfaces of the section — the tabs that carry an `href`. */
export type SettingsSurface = "sources";

/** Every tab the section's row draws, built or not. */
export type SettingsTabId =
  | SettingsSurface
  | "workspace"
  | "members"
  | "policies"
  | "integrations"
  | "audit"
  | "danger";

interface SettingsTabBase {
  readonly id: SettingsTabId;
  /** What the tab says. */
  readonly label: string;
}

/** A tab that leads somewhere. */
export interface LiveSettingsTab extends SettingsTabBase {
  readonly id: SettingsSurface;
  /** Where. */
  readonly href: string;
}

/**
 * A tab that does not lead anywhere yet.
 *
 * `note` is required here and impossible on a live tab, which is the honesty pair `NavEntry`
 * keeps: a surface that is not ready is labelled with what it is waiting for, never dead.
 */
export interface SoonSettingsTab extends SettingsTabBase {
  readonly id: Exclude<SettingsTabId, SettingsSurface>;
  /** Why it is not reachable — the tooltip. */
  readonly note: string;
}

/** One tab in the section's row. */
export type SettingsTab = LiveSettingsTab | SoonSettingsTab;

/**
 * Whether a tab is built.
 *
 * @param tab Any tab.
 * @returns `true` for a built surface, narrowing the type to the one that carries an `href`.
 */
export function isLiveTab(tab: SettingsTab): tab is LiveSettingsTab {
  return "href" in tab;
}

/** What every unbuilt section says it is waiting for. */
export const HUB_NOTE = "Arrives with #491.";

/**
 * The tabs, in mockup 17's order with the mounted surface slotted where S2 puts it: among
 * the sections, after the governance ones, before the integrations it is a kind of.
 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { id: "workspace", label: "Workspace", note: HUB_NOTE },
  { id: "members", label: "Members", note: HUB_NOTE },
  { id: "policies", label: "Policies", note: HUB_NOTE },
  { id: "sources", label: "Sources", href: SOURCES_PATH },
  { id: "integrations", label: "Integrations", note: HUB_NOTE },
  { id: "audit", label: "Audit", note: HUB_NOTE },
  { id: "danger", label: "Danger zone", note: HUB_NOTE },
];

/**
 * The eyebrow for one workspace — mockup 17's `Settings · acme-robotics`.
 *
 * @param workspaceName The workspace's display name, as the service reports it.
 * @returns The eyebrow.
 */
export function settingsEyebrow(workspaceName: string): string {
  return `${SETTINGS_EYEBROW} · ${workspaceName}`;
}
