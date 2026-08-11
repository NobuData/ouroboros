// `yarn api:sync` — regenerate app/api/schema.d.ts from ouroboros-rest's committed
// OpenAPI document, and `yarn api:check` — fail when the generated file has drifted.
//
// The API contract is written first and served verbatim (docs/ARCHITECTURE.md § 5.1):
// `ouroboros-rest/openapi.yaml` is authoritative, `ouroboros-rest/openapi.json` is what
// `yarn openapi` renders from it, and this is what turns the second into the types the
// UI's client is built on. Generation lives at the *consuming* end so that renaming a
// field in the specification breaks this module's typecheck rather than being discovered
// by a browser at runtime.
//
// The output is **committed**, which is what makes staleness reviewable: a pull request
// that changes the contract carries the regenerated types beside it, and `ci/ui` fails
// when it does not (`__tests__/api/sync.test.ts` runs the `--check` below in a
// subprocess, so the verb documented in the README is exercised rather than trusted).
// `.github/workflows/ui.yml` therefore also watches `ouroboros-rest/openapi.json` — a
// change to the contract alone must be able to fail this module's checks.
//
// It is plain ESM JavaScript rather than TypeScript for the same reason
// `ouroboros-rest/scripts/openapi.mjs` is: it is a development verb, and it has to run
// from a checkout with no build step or TypeScript runtime in front of it.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

/**
 * The module root, resolved from this file rather than from the working directory — so
 * `yarn api:sync` writes the same file whether it is run from here, from the repository
 * root or by Turborepo.
 */
export const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The contract this module generates against: the JSON `yarn openapi` renders. */
export const SPEC_PATH = join(MODULE_ROOT, "..", "ouroboros-rest", "openapi.json");

/** Where the generated types are committed. */
export const SCHEMA_PATH = join(MODULE_ROOT, "app", "api", "schema.d.ts");

/** The command that rewrites {@link SCHEMA_PATH}, named in every message below. */
const SYNC_COMMAND = "yarn api:sync";

/**
 * The banner prepended to the generated file.
 *
 * `openapi-typescript` writes its own "do not edit" line; this adds the two facts that
 * one cannot know — which document these types came from, and the verb that rewrites
 * them — so a reader who opens the file by accident is told where to go instead.
 */
const HEADER = [
  "// Generated from ouroboros-rest/openapi.json — do not edit.",
  `// Run \`${SYNC_COMMAND}\` after the contract changes; \`yarn test\` fails while this`,
  "// file and that document disagree. See scripts/api-sync.mjs.",
  "",
].join("\n");

/**
 * Generate the TypeScript declarations for a specification.
 *
 * @param {string} specPath - Absolute path to the OpenAPI JSON document.
 * @returns {Promise<string>} The contents of the generated file, ending in a newline.
 */
export async function render(specPath) {
  // A file URL rather than the parsed object: it is how `$ref`s resolve relative to the
  // document, and it is what the CLI itself passes.
  const ast = await openapiTS(pathToFileURL(specPath));
  return `${HEADER}${astToString(ast)}`;
}

/**
 * Regenerate the committed types, or report that they have drifted.
 *
 * @param {string[]} argv - Command-line arguments. `--check` writes nothing.
 * @returns {Promise<number>} The process exit code: `0` when the file was written or was
 *   already current, `1` under `--check` when it had drifted from the specification, `2`
 *   when the specification could not be read or an argument was not understood.
 */
export async function main(argv) {
  const check = argv.includes("--check");
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length > 0) {
    console.error(`api-sync: unrecognised argument ${unknown[0]} — usage: api-sync [--check]`);
    return 2;
  }

  let rendered;
  try {
    rendered = await render(SPEC_PATH);
  } catch (error) {
    // A missing or malformed openapi.json is not a generation failure to recover from:
    // it is the contract, and there is nothing to generate without it. Regenerate it in
    // ouroboros-rest with `yarn openapi`.
    console.error(`api-sync: ${SPEC_PATH} could not be read as OpenAPI — ${String(error)}`);
    return 2;
  }

  const target = relative(MODULE_ROOT, SCHEMA_PATH);

  let current;
  try {
    current = readFileSync(SCHEMA_PATH, "utf8");
  } catch {
    // Not an error: the file is an output, and it has to be writable before it exists.
    current = undefined;
  }

  if (current === rendered) {
    console.log(`${target} is ${check ? "current" : "already current"}`);
    return 0;
  }

  if (check) {
    console.error(
      `${target} has drifted from ouroboros-rest/openapi.json — run \`${SYNC_COMMAND}\``,
    );
    return 1;
  }

  writeFileSync(SCHEMA_PATH, rendered, "utf8");
  console.log(`wrote ${target}`);
  return 0;
}

// Only when this file is the process entry point. The suite beside it runs it as a
// subprocess and imports `render` directly; neither must trigger a write.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Set rather than passed to `process.exit()`, which would discard the buffered line
  // naming what drifted — the same rule ouroboros-rest's scripts follow.
  process.exitCode = await main(process.argv.slice(2));
}
