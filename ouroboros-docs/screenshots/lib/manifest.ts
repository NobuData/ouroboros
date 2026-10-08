import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/**
 * The screenshot manifest (CZ.1, #1170): reading it, checking it against its schema,
 * choosing entries, and naming the files they become.
 *
 * Pure apart from reading files, so the capture spec and `yarn screenshots` share one
 * definition of every rule and the unit tests can hold each one.
 */

/** The `ouroboros-docs/screenshots/` directory. */
export const SCREENSHOTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** The `ouroboros-docs/` module directory. */
export const MODULE_DIR = dirname(SCREENSHOTS_DIR);

/** The manifest every capture is driven by. */
export const MANIFEST_PATH = join(SCREENSHOTS_DIR, "screenshots.manifest.json");

/** The manifest's JSON Schema. */
export const SCHEMA_PATH = join(SCREENSHOTS_DIR, "screenshots.manifest.schema.json");

/** Where captured images are written: `static/img/screenshots/<section>/<slug>.<theme>.png`. */
export const OUTPUT_DIR = join(MODULE_DIR, "static", "img", "screenshots");

/** The same directory as the site serves it: a path relative to `static/`. */
export const PUBLIC_DIR = "img/screenshots";

/** The two palettes every entry is captured in — one Playwright project each. */
export const THEMES = ["light", "dark"] as const;

/** A palette. */
export type Theme = (typeof THEMES)[number];

/** One declarative step before a capture. */
export type Action =
  | { click: string }
  | { hover: string }
  | { fill: string; value: string }
  | { press: string; on?: string };

/** One screenshot: where it is taken, what it waits for, what it hides, how it reads. */
export interface Entry {
  /** `<section>.<slug>`. */
  id: string;
  /** The app route, from the UI's root. */
  route: string;
  /** The seeded workspace's slug. */
  workspace: string;
  /** A Playwright selector that must match before the capture. */
  ready: string;
  /** `page`, `fullPage`, or a selector. */
  clip: string;
  /** Selectors painted over in the capture. */
  masks?: string[];
  /** Steps run before waiting for `ready`. */
  actions?: Action[];
  /** The caption shown under the image. */
  caption: string;
  /** The image's alternative text. */
  alt: string;
  /** Written by `yarn screenshots`. */
  capturedAt?: string;
  /** Written by `yarn screenshots`. */
  uiVersion?: string;
  /** Written by `yarn screenshots`. */
  seedRef?: string;
}

/** The whole manifest. */
export interface Manifest {
  /** The schema reference, kept so editors validate the file. */
  $schema?: string;
  /** The instant the browser clock is frozen to (ISO 8601), if pinned. */
  clock?: string;
  /** Every screenshot. */
  entries: Entry[];
}

/**
 * Checks a parsed manifest against the schema, and that no two entries share an id (which
 * a schema cannot say).
 *
 * @param value the parsed JSON.
 * @param schema the parsed schema; defaults to the committed one.
 * @returns the manifest, typed.
 * @throws {Error} listing every problem, each with the JSON path it is at.
 */
export function validateManifest(
  value: unknown,
  schema: object = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")),
): Manifest {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    const problems = (validate.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message}`,
    );
    throw new Error(`the screenshot manifest is invalid:\n  ${problems.join("\n  ")}`);
  }
  const manifest = value as Manifest;
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (seen.has(entry.id)) throw new Error(`the screenshot manifest lists ${entry.id} twice`);
    seen.add(entry.id);
  }
  return manifest;
}

/**
 * Reads and validates the manifest.
 *
 * @param path the manifest file; defaults to the committed one.
 * @returns the manifest.
 * @throws {Error} when the file is missing, not JSON, or invalid.
 */
export function loadManifest(path: string = MANIFEST_PATH): Manifest {
  return validateManifest(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Turns an `--only` pattern into a test for ids. `*` matches any run of characters,
 * including dots, so `home.*` is every home entry and `*.wizard.*` every wizard step.
 *
 * @param pattern an exact id or a glob.
 * @returns a predicate over ids.
 */
export function idMatcher(pattern: string): (id: string) => boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return (id) => regex.test(id);
}

/**
 * The entries a run captures.
 *
 * @param manifest the manifest.
 * @param only an exact id or a glob; every entry when absent.
 * @returns the matching entries, in manifest order.
 * @throws {Error} when a pattern matches nothing — a typo should not look like a quiet,
 *   successful run.
 */
export function selectEntries(manifest: Manifest, only?: string): Entry[] {
  if (!only) return manifest.entries;
  const matches = manifest.entries.filter((entry) => idMatcher(only)(entry.id));
  if (matches.length === 0) {
    const known = manifest.entries.map((entry) => entry.id).join(", ") || "none";
    throw new Error(`--only ${only} matches no manifest entry (known: ${known})`);
  }
  return matches;
}

/**
 * Where an entry's image for one theme is written.
 *
 * @param id the entry's `<section>.<slug>`; the slug may itself contain dots.
 * @param theme the palette.
 * @param outputDir the screenshots root; defaults to `static/img/screenshots`.
 * @returns e.g. `…/static/img/screenshots/home/dashboard.light.png`.
 */
export function outputPath(id: string, theme: Theme, outputDir: string = OUTPUT_DIR): string {
  const [section, ...slug] = id.split(".");
  return join(outputDir, section, `${slug.join(".")}.${theme}.png`);
}

/**
 * Where the site serves an entry's image for one theme — {@link outputPath} as a URL path.
 *
 * @param id the entry's `<section>.<slug>`.
 * @param theme the palette.
 * @returns e.g. `img/screenshots/home/dashboard.light.png`, relative to `static/` (pass it
 *   through `useBaseUrl`).
 */
export function publicPath(id: string, theme: Theme): string {
  const [section, ...slug] = id.split(".");
  return posix.join(PUBLIC_DIR, section, `${slug.join(".")}.${theme}.png`);
}

/**
 * The instant the browser's clock is frozen to.
 *
 * @param manifest the manifest; its `clock` wins when set.
 * @param now the current time, for the fallback.
 * @returns the manifest's clock, or the start of the current hour (UTC) — two runs in the
 *   same hour then render identical client-side times.
 */
export function captureInstant(manifest: Manifest, now: Date = new Date()): Date {
  if (manifest.clock) return new Date(manifest.clock);
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

/**
 * The message an entry fails with when its `ready` selector never matches — the route and
 * the selector, so the reader knows which page and which promise broke.
 *
 * @param entry the entry.
 * @param theme the palette being captured.
 * @param timeoutMs how long it waited.
 * @returns the message.
 */
export function readyTimeoutMessage(entry: Entry, theme: Theme, timeoutMs: number): string {
  return (
    `${entry.id} (${theme}): ready selector ${JSON.stringify(entry.ready)} did not appear ` +
    `on ${entry.route} within ${timeoutMs} ms`
  );
}
