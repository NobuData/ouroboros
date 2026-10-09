#!/usr/bin/env node
/**
 * Checks that the CLI reference pages document every flag the tools accept (DC.3). The reading
 * and comparing is `scripts/cli-flags.ts`; this is the command.
 *
 * Usage:
 *   node scripts/check-cli-flags.ts
 *
 * `yarn check:cli-flags` runs it, and `ci/docs` runs that — so a flag added to the runner's
 * usage text in `cmd/ouroboros-runner/main.go`, or to `install.sh`'s, without adding it to its
 * page's `flags:` front matter fails the build, naming the page and the flag.
 *
 * Exit codes: 0 every page agrees with its tool, 1 a page disagrees, 2 a source could not be
 * read (a missing file, or a usage text in a shape the reader does not know).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkFlags, expectations } from "./cli-flags.ts";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The runner agent's entry point, which holds its usage text. */
export const RUNNER_MAIN = resolve(
  MODULE_DIR,
  "..",
  "ouroboros-runner",
  "cmd",
  "ouroboros-runner",
  "main.go",
);

/** The runner installer. */
export const INSTALL_SCRIPT = resolve(MODULE_DIR, "..", "ouroboros-runner", "install.sh");

/** The pages directory the expectations' paths are relative to. */
export const DOCS_DIR = join(MODULE_DIR, "docs");

/**
 * Runs the command.
 *
 * @param args the command-line arguments after the script's name; none are accepted.
 * @returns the process's exit code.
 */
function main(args: readonly string[]): number {
  if (args.length > 0) {
    console.error(`check:cli-flags: unknown argument ${args.join(" ")}; it takes none`);
    return 2;
  }

  let wanted;
  try {
    wanted = expectations(readFileSync(RUNNER_MAIN, "utf8"), readFileSync(INSTALL_SCRIPT, "utf8"));
  } catch (error) {
    console.error(`check:cli-flags: ${(error as Error).message}`);
    return 2;
  }

  const pages = new Map<string, string>();
  for (const { page } of wanted) {
    const path = join(DOCS_DIR, page);
    if (existsSync(path)) pages.set(page, readFileSync(path, "utf8"));
  }

  const problems = checkFlags(wanted, pages);
  if (problems.length === 0) {
    const total = new Set(wanted.flatMap(({ required }) => required)).size;
    console.log(`check:cli-flags: ${wanted.length} pages document all ${total} flags`);
    return 0;
  }
  for (const { page, message } of problems) console.error(`docs/${page}: ${message}`);
  console.error(
    `check:cli-flags: ${problems.length} problem(s). Add each flag to its page's flags: front ` +
      "matter, and document it on the page.",
  );
  return 1;
}

process.exitCode = main(process.argv.slice(2));
