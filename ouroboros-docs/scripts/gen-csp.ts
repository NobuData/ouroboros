#!/usr/bin/env node
/**
 * Writes the documentation image's Content-Security-Policy include from the built site (DD.1).
 * The reading and the policy are `scripts/csp.ts`; this is the command the Dockerfile's `build`
 * stage runs after `yarn build`.
 *
 * Usage:
 *   node scripts/gen-csp.ts OUT_FILE
 *
 * It reads every `.html` page under `build/`, hashes the one inline script D8 allows (the
 * theme script), and writes the nginx include to OUT_FILE.
 *
 * Exit codes: 0 written, 1 the build breaks D8 (no inline script, or more than one distinct
 * one) or has no pages, 2 usage error.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { contentSecurityPolicy, nginxInclude, themeScriptHashes } from "./csp.ts";

/** The built site (`ouroboros-docs/build/`). */
export const BUILD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "build");

/**
 * Lists every `.html` file under a directory, recursively.
 *
 * @param dir the directory to walk.
 * @returns absolute paths.
 */
function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

/**
 * Runs the command.
 *
 * @param args the command-line arguments after the script's name.
 * @returns the process's exit code.
 */
function main(args: readonly string[]): number {
  if (args.length !== 1 || args[0].startsWith("-")) {
    console.error("gen-csp: usage: node scripts/gen-csp.ts OUT_FILE");
    return 2;
  }

  let pages: string[];
  try {
    pages = htmlFiles(BUILD_DIR).map((path) => readFileSync(path, "utf8"));
  } catch (error) {
    console.error(
      `gen-csp: cannot read ${BUILD_DIR}: ${(error as Error).message}. Run yarn build.`,
    );
    return 1;
  }
  if (pages.length === 0) {
    console.error(`gen-csp: ${BUILD_DIR} has no pages. Run yarn build.`);
    return 1;
  }

  let include: string;
  try {
    include = nginxInclude(contentSecurityPolicy(themeScriptHashes(pages)));
  } catch (error) {
    console.error(`gen-csp: ${(error as Error).message}`);
    return 1;
  }
  writeFileSync(args[0], include);
  console.log(`gen-csp: wrote ${args[0]} from ${pages.length} pages`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
