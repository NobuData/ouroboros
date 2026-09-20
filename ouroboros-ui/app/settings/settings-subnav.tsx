import Link from "next/link";

import { PageSubnav, SubnavSoon } from "@/app/ui";

import { SETTINGS_TABS, type SettingsSurface, isLiveTab } from "./view";

import "./settings.css";

/**
 * The settings section's tab row — mockup 17's section nav, on the CP.4 primitive
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The same row `app/models/models-subnav.tsx` draws for its section, over
 * `app/settings/view.ts`'s list: the mounted live tabs, and six `soon` ones that name BS.1
 * ([#491](https://github.com/NobuData/ouroboros/issues/491)) as where they come from. One
 * list, so no page of the section can disagree with another about which tabs are built.
 */

/** What the row takes. */
export interface SettingsSubnavProps {
  /** Which built surface this page is — the tab that carries `aria-current="page"`. */
  readonly active: SettingsSurface;
}

/**
 * The row.
 *
 * @param props See {@link SettingsSubnavProps}.
 * @returns The tab set, with the active tab marked.
 */
export function SettingsSubnav({ active }: SettingsSubnavProps) {
  return (
    <PageSubnav className="settings__subnav" label="Settings">
      {SETTINGS_TABS.map((tab) =>
        isLiveTab(tab) ? (
          <Link
            aria-current={tab.id === active ? "page" : undefined}
            href={tab.href}
            key={tab.id}
          >
            {tab.label}
          </Link>
        ) : (
          <SubnavSoon key={tab.id} label={tab.label} note={tab.note} />
        ),
      )}
    </PageSubnav>
  );
}
