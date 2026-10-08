import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadContext, Plugin } from "@docusaurus/types";

import {
  loadManifest,
  MANIFEST_PATH,
  OUTPUT_DIR,
  outputPath,
  publicPath,
  THEMES,
  type Manifest,
  type Theme,
} from "../screenshots/lib/manifest.ts";
import { SCREENSHOTS_PLUGIN } from "../site.constants";

/**
 * The build-time half of `<Screenshot>` (CZ.2, #1171): reads the screenshot manifest and
 * the captured images while the site builds, and hands each entry's alt text, caption,
 * files and pixel size to the component as the plugin's global data.
 *
 * This runs in Node.js, so the component never reads files itself. A manifest that fails
 * its schema, or an entry whose image is missing or unreadable, fails `docusaurus build`.
 */

/** What `<Screenshot>` needs about one manifest entry. */
export interface ScreenshotData {
  /** The image's alternative text. */
  alt: string;
  /** The caption shown under the image. */
  caption: string;
  /** Each theme's file, relative to `static/` (pass it through `useBaseUrl`). */
  sources: Record<Theme, string>;
  /** The image's intrinsic width in pixels — the same for both themes. */
  width: number;
  /** The image's intrinsic height in pixels — the same for both themes. */
  height: number;
}

/** The plugin's global data: every manifest entry, by id. */
export interface ScreenshotIndex {
  screenshots: Record<string, ScreenshotData>;
}

/** The eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Reads a PNG's pixel size from its header, without decoding the image.
 *
 * @param png the file's bytes (only the first 24 are read).
 * @returns the width and height from the IHDR chunk.
 * @throws {Error} when the bytes are not a PNG.
 */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG file");
  }
  // The IHDR chunk always comes first: length (4), type (4), then width and height.
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Builds the index `<Screenshot>` reads from the manifest and the captured files.
 *
 * @param manifest the validated manifest.
 * @param outputDir the screenshots root on disk; defaults to `static/img/screenshots`.
 * @returns every entry by id.
 * @throws {Error} naming the entry when a theme's file is missing or not a PNG, or when the
 *   two themes differ in size (one `width`/`height` must fit both, or the swap would shift
 *   the page).
 */
export function buildScreenshotIndex(
  manifest: Manifest,
  outputDir: string = OUTPUT_DIR,
): ScreenshotIndex {
  const screenshots: Record<string, ScreenshotData> = {};
  for (const entry of manifest.entries) {
    const sizes = THEMES.map((theme) => {
      const file = outputPath(entry.id, theme, outputDir);
      try {
        return pngSize(readFileSync(file));
      } catch (error) {
        throw new Error(
          `screenshot ${entry.id} (${theme}): cannot read ${file} — ${(error as Error).message}. ` +
            `Capture it with \`yarn screenshots --only ${entry.id}\`.`,
        );
      }
    });
    const [light, dark] = sizes;
    if (light.width !== dark.width || light.height !== dark.height) {
      throw new Error(
        `screenshot ${entry.id}: the light image is ${light.width}×${light.height} but the dark ` +
          `one is ${dark.width}×${dark.height}; recapture both themes.`,
      );
    }
    screenshots[entry.id] = {
      alt: entry.alt,
      caption: entry.caption,
      sources: { light: publicPath(entry.id, "light"), dark: publicPath(entry.id, "dark") },
      width: light.width,
      height: light.height,
    };
  }
  return { screenshots };
}

/**
 * The Docusaurus plugin: loads the index at build (and on every manifest or image change
 * under `yarn dev`) and publishes it as global data.
 *
 * @param context the site's load context; its `siteDir` locates `static/`.
 * @returns the plugin; its content is a {@link ScreenshotIndex} (typed `unknown`, as the
 *   site config's plugin list requires).
 */
export default function screenshotsPlugin(context: LoadContext): Plugin {
  const outputDir = join(context.siteDir, "static", "img", "screenshots");
  return {
    name: SCREENSHOTS_PLUGIN,
    getPathsToWatch: () => [MANIFEST_PATH, join(outputDir, "**", "*.png")],
    loadContent: async () => buildScreenshotIndex(loadManifest(), outputDir),
    contentLoaded: async ({ content, actions }) => {
      actions.setGlobalData(content);
    },
  };
}
