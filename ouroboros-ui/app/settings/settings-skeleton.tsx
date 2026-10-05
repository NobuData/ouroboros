import { Card, cx } from "@/app/ui";

import { SettingsFrame } from "./settings-frame";
import {
  SETTINGS_SECTIONS,
  SETTINGS_SUBLINE,
  SETTINGS_TITLE,
  type SectionSpan,
  type SettingsSectionId,
} from "./view";

import "./settings.css";

/**
 * The settings hub's loading state (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496))
 * — the page at its own geometry while its reads are in flight, on the DASH-I.7 pattern.
 *
 * The head and the tab row are **real**: the title, the subline and the ten tabs do not depend
 * on a read, so the skeleton draws them as they will be and a reader can already leave for a
 * mounted tab. Under them, the grid's eight seats at the mockup's spans, each a card holding a
 * heading bar and as many row bars as its card roughly has — so the page does not jump when
 * the cards arrive.
 *
 * The seats carry no ids: a skeleton card is not a section to land on, and the anchors land
 * once the real page has replaced this one. The grid is `aria-hidden`; what a screen reader
 * gets is the `<main>`'s busy state and its name.
 */

/** What the `<main>` is named while it loads. */
export const SETTINGS_LOADING_LABEL = "Loading workspace settings";

/** The class for each width — the seats' own, so the skeleton fills the same grid. */
const SPAN_CLASS: Record<SectionSpan, string> = {
  5: "settings__seat--5",
  7: "settings__seat--7",
  12: "settings__seat--12",
};

/** How many row bars each section's skeleton draws — roughly its card's rows. */
export const SKELETON_ROWS: Readonly<Record<SettingsSectionId, number>> = {
  workspace: 5,
  members: 5,
  appearance: 2,
  policies: 5,
  audit: 5,
  integrations: 4,
  notifications: 4,
  danger: 3,
};

/**
 * The skeleton.
 *
 * @returns The hub's frame, with a placeholder card in every seat.
 */
export function SettingsSkeleton() {
  return (
    <SettingsFrame
      actions={<span aria-hidden className="settings-skeleton__action" />}
      active="hub"
      busy={SETTINGS_LOADING_LABEL}
      subline={SETTINGS_SUBLINE}
      title={SETTINGS_TITLE}
      workspaceName="…"
    >
      <div aria-hidden className="settings__grid">
        {SETTINGS_SECTIONS.map((section) => (
          <div className={cx("settings__seat", SPAN_CLASS[section.span])} key={section.id}>
            <Card className={cx(section.id === "danger" && "settings__card--danger")}>
              <div className="settings-skeleton">
                <span className="settings-skeleton__bar settings-skeleton__bar--head" />
                {Array.from({ length: SKELETON_ROWS[section.id] }, (_, index) => (
                  <span className="settings-skeleton__bar" key={index} />
                ))}
              </div>
            </Card>
          </div>
        ))}
      </div>
    </SettingsFrame>
  );
}
