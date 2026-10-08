import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkIntegrity,
  findUsages,
  formatStaleTable,
  listImages,
  staleEntries,
} from "./lib/integrity.ts";
import { MODULE_DIR, OUTPUT_DIR, loadManifest, type Manifest } from "./lib/manifest.ts";
import { readUiVersion } from "./lib/stamp.ts";

/**
 * `yarn check:screenshots` (CZ.3, #1172) — run by `ci/docs`.
 *
 * Fails (exit 1) when the manifest, the committed images and the pages disagree, or the
 * images break D6's budgets; every problem is printed with its rule's name. Then prints the
 * staleness report — entries captured from an older `ouroboros-ui` minor — which never fails.
 *
 * Runs under Node's own TypeScript support (`node screenshots/check.ts`); nothing is compiled.
 */

/** Where the check looks; every path is overridable so the tests can point it at fixtures. */
export interface CheckPaths {
  /** The module directory, which `pageDirs` are relative to. */
  moduleDir: string;
  /** The manifest file. */
  manifestPath?: string;
  /** The screenshots root. */
  imagesDir: string;
  /** The directories whose pages may use `<Screenshot>`. */
  pageDirs: readonly string[];
  /** `ouroboros-ui/package.json`, for the staleness report. */
  uiPackageJson: string;
}

/** The committed layout. */
export const DEFAULT_PATHS: CheckPaths = {
  moduleDir: MODULE_DIR,
  imagesDir: OUTPUT_DIR,
  pageDirs: ["docs", "src/pages"],
  uiPackageJson: resolve(MODULE_DIR, "../ouroboros-ui/package.json"),
};

/** Where the check writes; the tests capture both. */
export interface Output {
  /** Normal output — the staleness report and the summary. */
  log: (line: string) => void;
  /** Problems. */
  error: (line: string) => void;
}

/**
 * Runs the check.
 *
 * @param paths where to look; defaults to the committed layout.
 * @param out where to write; defaults to the console.
 * @returns the exit code: 0 when every rule holds (stale entries included), 1 otherwise.
 */
export function main(paths: CheckPaths = DEFAULT_PATHS, out: Output = console): number {
  let manifest: Manifest;
  try {
    manifest = loadManifest(paths.manifestPath);
  } catch (error) {
    out.error(`yarn check:screenshots: invalid-manifest: ${(error as Error).message}`);
    return 1;
  }

  const problems = checkIntegrity(
    manifest,
    listImages(paths.imagesDir),
    findUsages(paths.moduleDir, paths.pageDirs),
  );
  for (const problem of problems) {
    out.error(`yarn check:screenshots: ${problem.code}: ${problem.message}`);
  }

  // Outside the repository (the module copied on its own) there is no UI to compare with.
  // Staleness is a warning: even an unreadable UI version only skips the report.
  if (existsSync(paths.uiPackageJson)) {
    try {
      const uiVersion = readUiVersion(paths.uiPackageJson);
      out.log(formatStaleTable(staleEntries(manifest, uiVersion), uiVersion));
    } catch (error) {
      out.log(`Staleness report skipped: ${(error as Error).message}`);
    }
  } else {
    out.log(`Staleness report skipped: ${paths.uiPackageJson} not found.`);
  }

  if (problems.length > 0) {
    out.error(`yarn check:screenshots: ${problems.length} problem(s) found`);
    return 1;
  }
  out.log(`yarn check:screenshots: ${manifest.entries.length} entries, all images accounted for`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
