import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

import { OUTPUT_DIR, THEMES, outputPath, type Manifest, type Theme } from "./manifest.ts";

/**
 * The screenshot integrity and budget checks (CZ.3, #1172): the manifest, the committed
 * images and the pages that show them must agree, and the images must stay within D6's
 * budgets. CI cannot capture, but it can check.
 *
 * Every function here is pure over its inputs apart from the two that read the disk
 * ({@link listImages}, {@link findUsages}), so the unit tests hold each rule on its own.
 */

/** D6's per-image budget: 350 KiB. */
export const MAX_IMAGE_BYTES = 350 * 1024;

/** D6's budget for every file under `static/img/screenshots/` together: 40 MiB. */
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

/** The page files a `<Screenshot>` can appear in. */
export const PAGE_EXTENSIONS = [".md", ".mdx", ".tsx"] as const;

/** The name of each way the check can fail — printed in front of every problem. */
export type ProblemCode =
  | "missing-image"
  | "unknown-screenshot-id"
  | "orphan-image"
  | "image-over-budget"
  | "total-over-budget";

/** One failed rule. */
export interface Problem {
  /** Which rule failed. */
  code: ProblemCode;
  /** What failed, naming the entry, file or page. */
  message: string;
}

/** A file under `static/img/screenshots/`. */
export interface ImageFile {
  /** Its path relative to the screenshots root, with `/` separators: `home/dashboard.light.png`. */
  path: string;
  /** Its size in bytes. */
  bytes: number;
}

/** One `<Screenshot id>` on a page. */
export interface Usage {
  /** The id it asks for. */
  id: string;
  /** The page, relative to the module directory. */
  file: string;
  /** The 1-based line it is on. */
  line: number;
}

/** One entry captured from an older `ouroboros-ui`. */
export interface StaleEntry {
  /** The entry's id. */
  id: string;
  /** The version it was captured from, or `unstamped` when the manifest records none. */
  uiVersion: string;
  /** Its `capturedAt`, or `—`. */
  capturedAt: string;
}

/**
 * Lists every file under the screenshots root, recursively.
 *
 * @param root the screenshots root; defaults to `static/img/screenshots`.
 * @returns each file with its size, sorted by path; empty when the root does not exist.
 */
export function listImages(root: string = OUTPUT_DIR): ImageFile[] {
  let names: string[];
  try {
    names = readdirSync(root, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, stats: statSync(join(root, name)) }))
    .filter(({ stats }) => stats.isFile())
    .map(({ name, stats }) => ({ path: name.split(sep).join("/"), bytes: stats.size }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Blanks out code — fenced blocks and inline spans — keeping every newline, so a page that
 * *documents* `<Screenshot id="…">` is not read as using it and line numbers still hold.
 * A backtick template-literal id (``id={`…`}``) is blanked too, so Markdown pages write ids
 * as plain strings; `.tsx` pages are not stripped and may use either.
 *
 * @param text a Markdown or MDX page.
 * @returns the page with code replaced by spaces.
 */
export function stripCode(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank).replace(/`[^`\n]*`/g, blank);
}

/** A `<Screenshot …>` tag's `id`, as a string attribute or a string literal expression. */
const USAGE_PATTERN =
  /<Screenshot\b[^>]*?\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(["'`])((?:(?!\3).)*)\3\s*\})/g;

/**
 * Finds every `<Screenshot id>` in one page's text.
 *
 * @param text the page.
 * @param file the page's path, for the report.
 * @param markdown whether the page is Markdown/MDX, whose code samples are skipped.
 * @returns the usages in order.
 */
export function usagesIn(text: string, file: string, markdown: boolean): Usage[] {
  const source = markdown ? stripCode(text) : text;
  return [...source.matchAll(USAGE_PATTERN)].map((match) => ({
    id: match[1] ?? match[2] ?? match[4],
    file,
    line: source.slice(0, match.index).split("\n").length,
  }));
}

/**
 * Finds every `<Screenshot id>` in the given page directories.
 *
 * @param moduleDir the module directory the paths are reported relative to.
 * @param dirs the directories to search, relative to `moduleDir` — `docs` and `src/pages`.
 * @returns the usages, in path order.
 */
export function findUsages(moduleDir: string, dirs: readonly string[]): Usage[] {
  const usages: Usage[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(join(moduleDir, dir), { recursive: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      const ext = extname(name);
      if (!(PAGE_EXTENSIONS as readonly string[]).includes(ext)) continue;
      const path = join(moduleDir, dir, name);
      const file = relative(moduleDir, path).split(sep).join("/");
      usages.push(...usagesIn(readFileSync(path, "utf8"), file, ext !== ".tsx"));
    }
  }
  return usages;
}

/**
 * The image paths the manifest accounts for — both themes of every entry.
 *
 * @param manifest the manifest.
 * @returns paths relative to the screenshots root, with `/` separators.
 */
export function expectedImages(manifest: Manifest): string[] {
  return manifest.entries.flatMap((entry) => THEMES.map((theme) => imagePath(entry.id, theme)));
}

/**
 * Where an entry's image for one theme sits under the screenshots root.
 *
 * @param id the entry's id.
 * @param theme the palette.
 * @returns e.g. `home/dashboard.light.png`, with `/` separators on every platform.
 */
export function imagePath(id: string, theme: Theme): string {
  return outputPath(id, theme, "").split(sep).join("/");
}

/**
 * Formats a byte count for a message: `352.1 KiB`, `40.0 MiB`.
 *
 * @param bytes the count.
 * @returns the count in KiB below 1 MiB, in MiB from there.
 */
export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * Runs every integrity and budget rule.
 *
 * @param manifest the (already validated) manifest.
 * @param images every file under the screenshots root.
 * @param usages every `<Screenshot id>` on a page.
 * @returns every problem found, grouped by rule; empty when all hold.
 */
export function checkIntegrity(
  manifest: Manifest,
  images: readonly ImageFile[],
  usages: readonly Usage[],
): Problem[] {
  const problems: Problem[] = [];
  const present = new Set(images.map((image) => image.path));
  const expected = new Set(expectedImages(manifest));
  const ids = new Set(manifest.entries.map((entry) => entry.id));

  for (const entry of manifest.entries) {
    for (const theme of THEMES) {
      const path = imagePath(entry.id, theme);
      if (!present.has(path)) {
        problems.push({
          code: "missing-image",
          message: `${entry.id} has no ${theme} capture at static/img/screenshots/${path} — run yarn screenshots --only ${entry.id}`,
        });
      }
    }
  }

  for (const usage of usages) {
    if (!ids.has(usage.id)) {
      problems.push({
        code: "unknown-screenshot-id",
        message: `${usage.file}:${usage.line} uses <Screenshot id="${usage.id}">, which screenshots/screenshots.manifest.json does not list`,
      });
    }
  }

  for (const image of images) {
    if (!expected.has(image.path)) {
      problems.push({
        code: "orphan-image",
        message: `static/img/screenshots/${image.path} belongs to no manifest entry — delete it or add its entry`,
      });
    }
  }

  for (const image of images) {
    if (image.bytes > MAX_IMAGE_BYTES) {
      problems.push({
        code: "image-over-budget",
        message: `static/img/screenshots/${image.path} is ${formatBytes(image.bytes)}, over the ${formatBytes(MAX_IMAGE_BYTES)} per-image budget (D6)`,
      });
    }
  }

  const total = images.reduce((sum, image) => sum + image.bytes, 0);
  if (total > MAX_TOTAL_BYTES) {
    problems.push({
      code: "total-over-budget",
      message: `static/img/screenshots/ holds ${formatBytes(total)}, over the ${formatBytes(MAX_TOTAL_BYTES)} total budget (D6)`,
    });
  }

  return problems;
}

/**
 * Parses the `major.minor` of a semver version.
 *
 * @param version e.g. `0.144.1`.
 * @returns `[major, minor]`, or `undefined` when the text is not a version.
 */
export function majorMinor(version: string): [number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)(?:\.\d+)?(?:[-+].*)?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

/**
 * The entries captured from an `ouroboros-ui` whose minor version is behind the current one
 * (a major behind counts too; patch releases do not). An entry with no readable `uiVersion`
 * is listed as `unstamped`.
 *
 * @param manifest the manifest.
 * @param currentUiVersion `ouroboros-ui/package.json`'s version.
 * @returns the stale entries, in manifest order.
 * @throws {Error} when `currentUiVersion` is not a version.
 */
export function staleEntries(manifest: Manifest, currentUiVersion: string): StaleEntry[] {
  const current = majorMinor(currentUiVersion);
  if (!current) throw new Error(`ouroboros-ui's version ${currentUiVersion} is not semver`);
  const [major, minor] = current;
  return manifest.entries
    .filter((entry) => {
      const captured = entry.uiVersion ? majorMinor(entry.uiVersion) : undefined;
      if (!captured) return true;
      return captured[0] < major || (captured[0] === major && captured[1] < minor);
    })
    .map((entry) => ({
      id: entry.id,
      uiVersion: entry.uiVersion ?? "unstamped",
      capturedAt: entry.capturedAt ?? "—",
    }));
}

/**
 * Renders the staleness report as a plain-text table.
 *
 * @param stale the stale entries.
 * @param currentUiVersion the version they are behind.
 * @returns the table, or a one-line all-clear when nothing is stale.
 */
export function formatStaleTable(stale: readonly StaleEntry[], currentUiVersion: string): string {
  if (stale.length === 0)
    return `No stale screenshots: every entry was captured from ouroboros-ui ${majorMinorText(currentUiVersion)}.x.`;
  const rows = [
    ["id", "uiVersion", "capturedAt"],
    ...stale.map((entry) => [entry.id, entry.uiVersion, entry.capturedAt]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const line = (row: string[]) =>
    row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join("  ")
      .trimEnd();
  return [
    `${stale.length} screenshot(s) captured before ouroboros-ui ${majorMinorText(currentUiVersion)} — recapture when convenient:`,
    "",
    line(rows[0]),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.slice(1).map(line),
  ].join("\n");
}

/**
 * `major.minor` of a version, for messages.
 *
 * @param version e.g. `0.144.1`.
 * @returns e.g. `0.144`, or the text itself when it is not a version.
 */
function majorMinorText(version: string): string {
  const parsed = majorMinor(version);
  return parsed ? parsed.join(".") : version;
}
