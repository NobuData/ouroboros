import { SettingsFrame } from "@/app/settings/settings-frame";

import { SOURCES_SUBLINE, SOURCES_TITLE } from "./view";

import "./sources.css";

/**
 * The sources page's loading state ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The frame is real — the eyebrow, the title, the subline and the tab row are known before
 * any read — so the skeleton draws it and reserves the list's geometry beneath: two rows the
 * shape of a source, so the page does not jump when the rows land. The eyebrow's workspace
 * is the one thing the skeleton cannot know, and it is drawn as a bar.
 */

/** What the `<main>` is named while it loads. */
export const LOADING_LABEL = "Loading ticket sources";

/** How many row shapes the skeleton draws. */
export const SKELETON_ROWS = 2;

/**
 * The skeleton.
 *
 * @returns The frame with bars where the rows will be.
 */
export function SourcesSkeleton() {
  return (
    <SettingsFrame
      actions={<span aria-hidden className="sources-skeleton__action" />}
      active="sources"
      busy={LOADING_LABEL}
      subline={SOURCES_SUBLINE}
      title={SOURCES_TITLE}
      workspaceName="…"
    >
      <ul aria-hidden className="sources-list sources-skeleton">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li className="sources-row sources-skeleton__row" key={index}>
            <span className="sources-skeleton__monogram" />
            <span className="sources-row__identity">
              <span className="sources-skeleton__bar sources-skeleton__bar--name" />
              <span className="sources-skeleton__bar" />
              <span className="sources-skeleton__bar sources-skeleton__bar--short" />
            </span>
            <span className="sources-row__actions">
              <span className="sources-skeleton__button" />
              <span className="sources-skeleton__button" />
            </span>
          </li>
        ))}
      </ul>
    </SettingsFrame>
  );
}
