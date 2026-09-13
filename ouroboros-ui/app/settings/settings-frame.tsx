import type { ReactNode } from "react";

import { Eyebrow } from "@/app/ui";

import { SettingsSubnav } from "./settings-subnav";
import { type SettingsSurface, settingsEyebrow } from "./view";

import "./settings.css";

/**
 * The settings section's page frame — mockup 17's chrome, as the shell wants it
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The same shape as `app/models/models-frame.tsx`, for the same reason: a section's pages
 * should start on the same line, carry the same eyebrow, and draw the same tab row with the
 * underline moved. The eyebrow is the mockup's `Settings · acme-robotics` — the workspace is
 * named rather than implied, because this is the page where somebody changes what a
 * workspace is, and the one place a mistake about *which* workspace costs the most.
 *
 * It renders **inside the app shell**: a `main` landmark starting at its page head, with no
 * chrome of its own. The mockup's `.topbar`/`.nav` markup is superseded by the shell.
 *
 * **BS.1 ([#491](https://github.com/NobuData/ouroboros/issues/491)) owns this frame.** The
 * page head's *Save changes* and *Export audit CSV*, the scroll-spy and the per-section save
 * model are its; what is here is the least a mounted tab needs to sit where the hub will put
 * it. The day the hub lands, its frame replaces this one and the sources page changes the
 * import.
 */

/** What the frame takes. */
export interface SettingsFrameProps {
  /** Which built surface this page is — the tab that carries `aria-current`. */
  readonly active: SettingsSurface;
  /** The active workspace's display name, for the eyebrow's slot. */
  readonly workspaceName: string;
  /** The `<h1>` — the page's one title in the outline. */
  readonly title: string;
  /**
   * The sentence under the title: the promise the page makes. A node rather than a string
   * only so a skeleton can draw the sentence around a bar.
   */
  readonly subline: ReactNode;
  /** The head's actions, drawn to the right of the headings and under them when narrow. */
  readonly actions: ReactNode;
  /** The page's own content, below the tab set. */
  readonly children: ReactNode;
  /**
   * What the page is doing while it has nothing to show yet — the skeleton's label. When set,
   * the `<main>` is `aria-busy` and named with it.
   */
  readonly busy?: string;
}

/**
 * The frame.
 *
 * @param props See {@link SettingsFrameProps}.
 * @returns The page head, the tab row, and the content.
 */
export function SettingsFrame({
  active,
  workspaceName,
  title,
  subline,
  actions,
  children,
  busy,
}: SettingsFrameProps) {
  return (
    <main aria-busy={busy === undefined ? undefined : true} aria-label={busy} className="settings">
      <div className="settings__head">
        <div className="settings__headings">
          <Eyebrow>{settingsEyebrow(workspaceName)}</Eyebrow>
          <h1 className="settings__title">{title}</h1>
          <p className="settings__sub">{subline}</p>
        </div>
        <div className="settings__actions">{actions}</div>
      </div>

      <SettingsSubnav active={active} />

      {children}
    </main>
  );
}
