"use client";

import Link from "next/link";

import { settingsSectionPath } from "@/app/paths";
import { PageSubnav } from "@/app/ui";

import { useSectionSpy } from "./use-section-spy";
import {
  MOUNTED_TABS,
  SECTION_TABS,
  type SettingsPage,
  type SettingsSectionId,
} from "./view";

import "./settings.css";

/**
 * The settings section's tab row — mockup 17's section nav, on the CP.4 primitive
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * Workspace · Members · Policies · Integrations · Audit · Danger zone, a rule, then the mounted
 * admin surfaces: Sources · Providers · Farm tokens · Knowledge / env. One list
 * (`app/settings/view.ts`), drawn by the hub and by every mounted page, so no page of the
 * section can disagree with another about what the section contains.
 *
 * ### The six are anchors, and what an anchor does depends on where it is drawn
 *
 * **On the hub** each is a fragment of the page being read — `#policies` — as a **router**
 * link rather than a bare `<a>`. The difference is the history entry: a native fragment jump
 * leaves one the router does not recognise, and Back onto it from another page changes the
 * address and nothing else. The router's own hash navigation moves the pane, updates the
 * address and leaves an entry Back can return to. The tab of the section being read carries
 * `aria-current="location"` — the attribute's value for *the current place within a page* —
 * and which one that is comes from the scroll-spy (`app/settings/section-spy.ts`), which
 * watches the **pane's** scroll, not the window's, and hears the press itself — so the pressed
 * tab lights even when its section shares a row with another or cannot be scrolled to the top.
 *
 * **On a mounted page** the same six lead back to the hub's sections, as route links, and none
 * is current: the current tab there is the page's own.
 *
 * ### The mounted tabs are routes
 *
 * Each keeps its implementation and its address (decision S2). The two drawn in this frame —
 * Sources and Farm tokens — carry `aria-current="page"` on their own pages; Providers and
 * Knowledge / env live in other sections' frames, and their tabs are the way there.
 *
 * `PageSubnav` owns the sticking and the stacking; this owns the links.
 */

/** The six anchors' ids, in the nav's order — a stable list for the spy to watch. */
const SECTION_IDS: readonly SettingsSectionId[] = SECTION_TABS.map((tab) => tab.id);

/** What the row takes. */
export interface SettingsSubnavProps {
  /** Which page of the section is drawing it. */
  readonly page: SettingsPage;
}

/**
 * The row.
 *
 * @param props See {@link SettingsSubnavProps}.
 * @returns The tab set, with the current tab marked.
 */
export function SettingsSubnav({ page }: SettingsSubnavProps) {
  const onHub = page === "hub";
  const active = useSectionSpy(SECTION_IDS, onHub);

  return (
    <PageSubnav className="settings__subnav" label="Settings">
      {SECTION_TABS.map((tab) => (
        <Link
          aria-current={onHub && tab.id === active ? "location" : undefined}
          // A fragment of this page on the hub; the hub's section from a mounted page.
          href={onHub ? `#${tab.id}` : settingsSectionPath(tab.id)}
          key={tab.id}
        >
          {tab.label}
        </Link>
      ))}

      <span aria-hidden className="settings__subnav-rule" />

      {MOUNTED_TABS.map((tab) => (
        <Link aria-current={tab.id === page ? "page" : undefined} href={tab.href} key={tab.id}>
          {tab.label}
        </Link>
      ))}
    </PageSubnav>
  );
}
