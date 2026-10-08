import { loadManifest } from "../../screenshots/lib/manifest.ts";
import { buildScreenshotIndex } from "../../plugins/screenshots";
import { SCREENSHOTS_PLUGIN } from "../../site.constants";

/**
 * A stand-in for `@docusaurus/useGlobalData` in tests. By default the screenshots plugin's
 * data is what it would publish at build time — built from the committed manifest and
 * images — so a page using a real screenshot id renders as it would on the site. A test
 * can substitute its own data with {@link setPluginData}.
 */

/** Data a test substituted, by plugin name; cleared by `setPluginData(name, undefined)`. */
const overrides = new Map<string, unknown>();

/**
 * Replaces a plugin's global data until it is cleared.
 *
 * @param name the plugin's name.
 * @param data the data `usePluginData(name)` returns; `undefined` restores the default.
 */
export function setPluginData(name: string, data: unknown): void {
  if (data === undefined) overrides.delete(name);
  else overrides.set(name, data);
}

/**
 * A plugin's global data.
 *
 * @param name the plugin's name.
 * @returns the substituted data, the screenshots index, or `undefined` for any other plugin.
 */
export function usePluginData(name: string): unknown {
  if (overrides.has(name)) return overrides.get(name);
  if (name === SCREENSHOTS_PLUGIN) return buildScreenshotIndex(loadManifest());
  return undefined;
}
