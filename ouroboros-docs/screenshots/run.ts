import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MODULE_DIR, THEMES, loadManifest, selectEntries, type Theme } from "./lib/manifest.ts";
import { fullyCaptured, readUiVersion, stampEntries, writeManifest } from "./lib/stamp.ts";
import { ONLY_ENV, RESULTS_ENV } from "./settings.ts";

/**
 * `yarn screenshots [--only <id|glob>] [--theme light|dark]` (CZ.1, #1170).
 *
 * Checks the manifest and the selection first — a typo fails before a browser starts — then
 * runs the Playwright capture project, and finally stamps the entries captured in every
 * requested theme with `capturedAt`, `uiVersion` and `seedRef`. Exits with Playwright's
 * status, so one failed entry makes the run fail after the others are captured.
 *
 * Runs under Node's own TypeScript support (`node screenshots/run.ts`); nothing is compiled.
 */

/** What the command line asked for. */
export interface Options {
  /** An entry id or glob; every entry when absent. */
  only?: string;
  /** One theme; both when absent. */
  theme?: Theme;
  /** Print usage and stop. */
  help: boolean;
}

/** The usage text. */
export const USAGE = `Usage: yarn screenshots [--only <id|glob>] [--theme light|dark]

Captures the manifest's screenshots from the seeded app at OURO_DOCS_CAPTURE_BASE_URL
(default http://localhost:3000) into static/img/screenshots/, in both themes.

  --only <id|glob>   capture matching entries only, e.g. home.dashboard or 'home.*'
  --theme <theme>    capture one theme only: light or dark
  -h, --help         show this help`;

/**
 * Parses the arguments.
 *
 * @param args the arguments after the script name.
 * @returns the options.
 * @throws {Error} on an unknown argument, a missing value, or a theme that is not one.
 */
export function parseArgs(args: readonly string[]): Options {
  const options: Options = { help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--only" || arg === "--theme") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`${arg} needs a value`);
      index += 1;
      if (arg === "--only") options.only = value;
      else if ((THEMES as readonly string[]).includes(value)) options.theme = value as Theme;
      else throw new Error(`--theme must be ${THEMES.join(" or ")}, got ${value}`);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/**
 * The commit the seeded stack is built from — this checkout's HEAD.
 *
 * @returns the full sha, or `unknown` outside a git checkout.
 */
function seedRef(): string {
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: MODULE_DIR, encoding: "utf8" });
  return git.status === 0 ? git.stdout.trim() : "unknown";
}

/**
 * Runs the command.
 *
 * @param args the arguments after the script name.
 * @returns the process exit code.
 */
export function main(args: readonly string[]): number {
  let options: Options;
  try {
    options = parseArgs(args);
    if (options.help) {
      console.log(USAGE);
      return 0;
    }
    selectEntries(loadManifest(), options.only);
  } catch (error) {
    console.error(`yarn screenshots: ${(error as Error).message}`);
    return 2;
  }

  const scratch = mkdtempSync(join(tmpdir(), "docs-screenshots-"));
  const results = join(scratch, "results.jsonl");
  try {
    const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
    const playwrightArgs = [
      cli,
      "test",
      "--config",
      join(MODULE_DIR, "screenshots/playwright.config.ts"),
    ];
    if (options.theme) playwrightArgs.push("--project", options.theme);
    const run = spawnSync(process.execPath, playwrightArgs, {
      cwd: MODULE_DIR,
      stdio: "inherit",
      env: { ...process.env, [ONLY_ENV]: options.only ?? "", [RESULTS_ENV]: results },
    });

    const log = existsSync(results) ? readFileSync(results, "utf8") : "";
    const captured = fullyCaptured(log, options.theme ? [options.theme] : THEMES);
    if (captured.length > 0) {
      const stamp = {
        capturedAt: new Date().toISOString(),
        uiVersion: readUiVersion(resolve(MODULE_DIR, "../ouroboros-ui/package.json")),
        seedRef: seedRef(),
      };
      writeManifest(stampEntries(loadManifest(), captured, stamp));
      console.log(`yarn screenshots: stamped ${captured.join(", ")}`);
    }
    return run.status ?? 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
