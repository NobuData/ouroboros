/**
 * Which of the settings hub's sections could not be read, and what the page says about it
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)) — the hub's error state, on
 * the DASH-I.7 pattern.
 *
 * Every read behind the hub is a `Reading` (`app/api/reading.ts`), so a failed one already
 * costs its own seat and nothing else its place: the seat prints why. What that leaves unsaid is
 * the page-level fact — *this page is partly out of date, and here is how to try again* — which a
 * reader three cards up from the degraded seat would otherwise never see. This module is that
 * fact as values; `app/settings/read-banner.tsx` draws it as the design system's retry box.
 *
 * **A read that was never made is not a failure.** The audit log is not requested for a reader
 * below `admin` (`audit === null`): their seat says whose log it is, and no retry would change
 * that.
 *
 * Framework-free and pure.
 */

import type { Reading } from "@/app/api/reading";

import { SETTINGS_SECTIONS, type SettingsSectionId } from "./view";

/** A read as the hub holds it: made and answered, made and refused, never made, or not passed. */
type HubRead = Reading<unknown> | null | undefined;

/** The hub's reads, by the name the screen gives each. */
export interface HubReads {
  /** The dry-run policy — the Policies seat. */
  readonly dryRun?: HubRead;
  /** The org policy document — the Policies seat. */
  readonly policy?: HubRead;
  /** The workspace card's payload — the Workspace seat. */
  readonly workspace?: HubRead;
  /** The retention tiers — the Workspace seat. */
  readonly retention?: HubRead;
  /** The members page — the Members seat. */
  readonly members?: HubRead;
  /** The audit card's today view — the Audit seat. `null` when never requested. */
  readonly audit?: HubRead;
  /** The integrations grid — the Integrations seat. */
  readonly integrations?: HubRead;
  /** The org notification routes — the Notifications seat. */
  readonly routes?: HubRead;
  /** The workspace's lifecycle — the Danger zone's seat. */
  readonly lifecycle?: HubRead;
}

/** Which seat each read fills. */
const SEAT_OF: Readonly<Record<keyof HubReads, SettingsSectionId>> = {
  dryRun: "policies",
  policy: "policies",
  workspace: "workspace",
  retention: "workspace",
  members: "members",
  audit: "audit",
  integrations: "integrations",
  routes: "notifications",
  lifecycle: "danger",
};

/**
 * The sections with at least one read that was made and refused.
 *
 * @param reads The hub's reads.
 * @returns Their ids, each once, in the order the page draws them.
 */
export function unreadSections(reads: HubReads): readonly SettingsSectionId[] {
  const failed = new Set<SettingsSectionId>();

  for (const [name, read] of Object.entries(reads) as [keyof HubReads, HubRead][]) {
    if (read !== null && read !== undefined && !read.ok) failed.add(SEAT_OF[name]);
  }

  return SETTINGS_SECTIONS.filter((section) => failed.has(section.id)).map((section) => section.id);
}

/**
 * The retry box's headline — the state, in words.
 *
 * @param count How many sections could not be read. Positive.
 * @returns `1 section could not be read.` / `3 sections could not be read.`
 */
export function unreadHeadline(count: number): string {
  return `${String(count)} ${count === 1 ? "section" : "sections"} could not be read.`;
}

/**
 * The retry box's second sentence: which sections, and that the rest of the page stands.
 *
 * @param sections The unread sections' ids.
 * @returns The sentence, naming each section by its card's title.
 */
export function unreadReason(sections: readonly SettingsSectionId[]): string {
  const titles = SETTINGS_SECTIONS.filter((section) => sections.includes(section.id)).map(
    (section) => section.title,
  );

  return `${titles.join(", ")} — each says why in its own card. The rest of the page is as the service answered.`;
}
