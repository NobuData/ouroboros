// `yarn openapi` — re-render openapi.json from the authoritative openapi.yaml.
//
// The specification is spec-first (see openapi.yaml, and src/openapi/specification.ts
// for the loader): the YAML is what a human edits and the JSON is what the process reads
// and what a JSON-only tool wants. This is the one thing that turns the first into the
// second.
//
// It is plain ESM JavaScript rather than TypeScript for one reason: it is a development
// verb, and `yarn openapi` has to run from a checkout without a build step or a
// TypeScript runtime in front of it. That also keeps `yaml` a devDependency — the served
// application parses JSON with what Node already has and never imports a YAML parser.
//
// Nothing keeps the two files in step by itself; `yarn test` does. It runs the `--check`
// below in a subprocess, so the verb documented in the README is exercised rather than
// trusted (src/openapi/openapi.spec.ts).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/** The authoritative document, and the rendering of it that is read at runtime. */
const YAML_FILENAME = "openapi.yaml";
const JSON_FILENAME = "openapi.json";

/**
 * The module root, resolved from this file rather than from the working directory — so
 * `yarn openapi` renders the same pair whether it is run from here, from the repository
 * root or by Turborepo.
 */
const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Two-space indent and a trailing newline: the file is committed and diffed, so how it
 * is rendered is part of what has to be reproducible.
 */
const JSON_INDENT = 2;

/**
 * Render the authoritative YAML document as the JSON committed beside it.
 *
 * Key order is the YAML's own — nothing is sorted — so the two files read the same way
 * top to bottom and a diff of the rendered one shows only what was actually edited.
 *
 * @param {string} yamlText - The contents of `openapi.yaml`.
 * @returns {string} The JSON text, ending in a newline.
 */
export function render(yamlText) {
  return `${JSON.stringify(parse(yamlText), undefined, JSON_INDENT)}\n`;
}

/**
 * Re-render `openapi.json`, or report that it has drifted.
 *
 * @param {string[]} argv - Command-line arguments. `--check` writes nothing.
 * @returns {number} The process exit code: `0` when the JSON was written or already
 *   current, `1` under `--check` when it had drifted from the YAML, `2` when the
 *   specification could not be read.
 */
export function main(argv) {
  const check = argv.includes("--check");
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length > 0) {
    console.error(`openapi: unrecognised argument ${unknown[0]} — usage: openapi [--check]`);
    return 2;
  }

  const source = join(MODULE_ROOT, YAML_FILENAME);
  const target = join(MODULE_ROOT, JSON_FILENAME);

  let rendered;
  try {
    rendered = render(readFileSync(source, "utf8"));
  } catch (error) {
    // A missing or malformed openapi.yaml is not a rendering failure to recover from:
    // it is the specification, and there is nothing to write without it.
    console.error(`openapi: ${source} could not be read as YAML — ${String(error)}`);
    return 2;
  }

  let current;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // Not an error: the JSON is an output, and it has to be writable before it exists.
    current = undefined;
  }

  if (check) {
    if (current === rendered) {
      console.log(`${target} is current`);
      return 0;
    }
    console.error(`${target} has drifted from ${YAML_FILENAME} — run \`yarn openapi\``);
    return 1;
  }

  if (current === rendered) {
    console.log(`${target} is already current`);
    return 0;
  }

  writeFileSync(target, rendered, "utf8");
  console.log(`wrote ${target}`);
  return 0;
}

// Only when this file is the process entry point. The spec beside it runs it as a
// subprocess and imports `render` directly; neither must trigger a write.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Set rather than passed to `process.exit()`, which would discard the buffered line
  // naming what drifted — the same rule main.ts follows.
  process.exitCode = main(process.argv.slice(2));
}
