import { readFileSync, writeFileSync } from "node:fs";

import { MANIFEST_PATH, type Manifest } from "./manifest.ts";

/**
 * Recording what a capture was taken from (CZ.1, #1170): when, against which UI version,
 * from which commit's seed. `yarn screenshots` writes these after a run, for the entries it
 * captured in every theme it was asked for.
 */

/** What a capture was taken from. */
export interface Stamp {
  /** When the run captured it (ISO 8601). */
  capturedAt: string;
  /** `ouroboros-ui/package.json`'s version. */
  uiVersion: string;
  /** The commit the seeded stack was built from. */
  seedRef: string;
}

/**
 * Returns the manifest with the given entries stamped; every other entry is untouched.
 *
 * @param manifest the manifest.
 * @param ids the entries captured in full.
 * @param stamp what to record.
 * @returns a new manifest object.
 */
export function stampEntries(manifest: Manifest, ids: Iterable<string>, stamp: Stamp): Manifest {
  const captured = new Set(ids);
  return {
    ...manifest,
    entries: manifest.entries.map((entry) =>
      captured.has(entry.id) ? { ...entry, ...stamp } : entry,
    ),
  };
}

/**
 * Writes the manifest back in the committed format: two-space JSON and a final newline, so
 * a run's diff is only the stamps it changed.
 *
 * @param manifest the manifest.
 * @param path the file; defaults to the committed manifest.
 */
export function writeManifest(manifest: Manifest, path: string = MANIFEST_PATH): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Reads `ouroboros-ui`'s version.
 *
 * @param packageJsonPath the UI's manifest.
 * @returns its `version`.
 */
export function readUiVersion(packageJsonPath: string): string {
  return (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string }).version;
}

/**
 * The entries captured in every requested theme, from the run's results log — one
 * `{"id","theme"}` JSON object per line, written by the capture spec as each file lands.
 *
 * @param log the results log's text.
 * @param themes the themes the run was asked for.
 * @returns the ids captured in all of them.
 */
export function fullyCaptured(log: string, themes: readonly string[]): string[] {
  const seen = new Map<string, Set<string>>();
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    const { id, theme } = JSON.parse(line) as { id: string; theme: string };
    seen.set(id, (seen.get(id) ?? new Set()).add(theme));
  }
  return [...seen].filter(([, got]) => themes.every((theme) => got.has(theme))).map(([id]) => id);
}
