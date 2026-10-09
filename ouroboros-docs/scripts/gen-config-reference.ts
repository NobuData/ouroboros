#!/usr/bin/env node
/**
 * Writes the configuration reference from the root `.env.example`, or checks that it is current
 * (DB.3). The reading and writing is `scripts/config-reference.ts`; this is the command.
 *
 * Usage:
 *   node scripts/gen-config-reference.ts            write docs/administration/configuration/_generated.mdx
 *   node scripts/gen-config-reference.ts --check    exit 1 when that file differs from what would be written
 *
 * `yarn gen:config-reference` and `yarn check:config-reference` run the two; `ci/docs` runs the
 * check, so a variable added to `.env.example` without regenerating fails the build.
 *
 * Exit codes: 0 written (or current), 1 stale under --check, 2 usage error or a template the
 * generator refuses (a duplicate variable, or a comment that still cites an issue).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnvExample, renderReference } from "./config-reference.ts";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The template the reference is generated from: the repository root's `.env.example`. */
export const TEMPLATE = resolve(MODULE_DIR, "..", ".env.example");

/** The generated partial, which `docs/administration/configuration/index.mdx` imports. */
export const OUTPUT = join(MODULE_DIR, "docs", "administration", "configuration", "_generated.mdx");

/**
 * Runs the command.
 *
 * @param args the command-line arguments after the script's name.
 * @returns the process's exit code.
 */
function main(args: readonly string[]): number {
  const check = args.includes("--check");
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    console.error(
      `gen-config-reference: unknown argument ${unknown.join(" ")}; only --check is accepted`,
    );
    return 2;
  }

  let rendered: string;
  try {
    rendered = renderReference(parseEnvExample(readFileSync(TEMPLATE, "utf8")));
  } catch (error) {
    console.error(`gen-config-reference: ${(error as Error).message}`);
    return 2;
  }

  const shown = relative(process.cwd(), OUTPUT);
  if (check) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
    if (current === rendered) {
      console.log(`check:config-reference: ${shown} matches .env.example`);
      return 0;
    }
    console.error(
      `check:config-reference: ${shown} is stale — .env.example changed. ` +
        "Run `yarn gen:config-reference` in ouroboros-docs and commit the result.",
    );
    return 1;
  }

  writeFileSync(OUTPUT, rendered);
  console.log(`gen:config-reference: wrote ${shown}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
