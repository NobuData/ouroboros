import React, { useRef, type ReactNode } from "react";
import { usePluginData } from "@docusaurus/useGlobalData";
import useBaseUrl from "@docusaurus/useBaseUrl";
import ThemedImage from "@theme/ThemedImage";

import type { ScreenshotData, ScreenshotIndex } from "../../../plugins/screenshots";
import { SCREENSHOTS_PLUGIN } from "../../../site.constants";
import styles from "./styles.module.css";

/** Props of {@link Screenshot}. */
export interface ScreenshotProps {
  /** The manifest entry's id, `<section>.<slug>`: `"user-guide.inbox"`. */
  id: string;
  /** Alternative text for this page, in place of the manifest's. Must not be blank. */
  alt?: string;
  /** A caption for this page, in place of the manifest's. */
  caption?: string;
}

/**
 * Finds a screenshot in the build-time index and applies the page's overrides.
 *
 * @param index the screenshots plugin's global data; absent when the plugin is not loaded.
 * @param id the manifest entry's id.
 * @param overrides the page's own `alt` and `caption`, each optional.
 * @returns the entry with the overrides applied.
 * @throws {Error} when the id is not in the manifest, or the alt text ends up blank — both
 *   fail `yarn build` rather than publish a broken or inaccessible image.
 */
export function resolveScreenshot(
  index: ScreenshotIndex | undefined,
  id: string,
  overrides: Pick<ScreenshotProps, "alt" | "caption"> = {},
): ScreenshotData {
  const known = index?.screenshots ?? {};
  const entry = Object.hasOwn(known, id) ? known[id] : undefined;
  if (!entry) {
    const ids = Object.keys(known).join(", ") || "none";
    throw new Error(
      `<Screenshot id="${id}"> is not in screenshots/screenshots.manifest.json (known: ${ids})`,
    );
  }
  const alt = (overrides.alt ?? entry.alt).trim();
  if (!alt) throw new Error(`<Screenshot id="${id}"> needs alt text; it cannot be blank`);
  return { ...entry, alt, caption: overrides.caption ?? entry.caption };
}

/**
 * A screenshot of the app from the manifest, in the reader's theme: the light or dark
 * capture through `ThemedImage`, framed, captioned, lazily loaded at its intrinsic size (so
 * the page does not shift when it arrives), and enlarged in a dialog when clicked.
 *
 * @param props.id the manifest entry's id.
 * @param props.alt alternative text overriding the manifest's (optional).
 * @param props.caption a caption overriding the manifest's (optional).
 * @returns the figure.
 * @throws {Error} on an unknown id or blank alt text (see {@link resolveScreenshot}).
 */
export default function Screenshot({ id, alt, caption }: ScreenshotProps): ReactNode {
  const shot = resolveScreenshot(
    usePluginData(SCREENSHOTS_PLUGIN) as ScreenshotIndex | undefined,
    id,
    { alt, caption },
  );
  const sources = {
    light: useBaseUrl(shot.sources.light),
    dark: useBaseUrl(shot.sources.dark),
  };
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <figure className={styles.screenshot}>
      <button
        type="button"
        className={styles.zoom}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <ThemedImage
          className={styles.image}
          sources={sources}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          loading="lazy"
          decoding="async"
        />
      </button>
      {shot.caption && <figcaption className={styles.caption}>{shot.caption}</figcaption>}
      {/* Escape closes a modal dialog natively; so does any click inside this one. */}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-label={shot.alt}
        onClick={() => dialog.current?.close()}
      >
        <button type="button" className={styles.close}>
          Close
        </button>
        <ThemedImage
          className={styles.zoomed}
          sources={sources}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          loading="lazy"
          decoding="async"
        />
      </dialog>
    </figure>
  );
}
