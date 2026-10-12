// `yarn chat-grammar` — re-render chat-grammar.json from the `/ouro` grammar registry.
//
// The registry (src/modules/chatops/grammar.registry.ts) is the one place a command is defined
// (#537, BZ.3). chat-grammar.json is that registry as a document: what the docs site generates
// the `/ouro` reference page from, and what `GET /api/v1/chat/grammar` serves. It is committed,
// like openapi.json, so a reader — and the docs build — needs neither a build of this module
// nor a TypeScript runtime.
//
// Rendering is `renderReferenceText()` in src/modules/chatops/grammar.help.ts, the same
// function the route and the spec call; this file only loads it. The registry is TypeScript and
// this verb has to run from a bare checkout, so the three files it needs are transpiled in
// memory by the `typescript` package (already a runtime dependency of this module) — no type
// check, no output on disk. They are written to load that way: they import each other and
// types, and nothing from NestJS.
//
// Nothing keeps the file in step by itself; `yarn test` does — `grammar.help.spec.ts` compares
// the committed file with the rendered grammar and runs the `--check` below as a subprocess.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The module root, resolved from this file rather than from the working directory. */
const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The rendered document, committed beside openapi.json. */
const TARGET = join(MODULE_ROOT, "chat-grammar.json");

/** The grammar's source directory — the only TypeScript this verb loads. */
const SOURCE = join(MODULE_ROOT, "src", "modules", "chatops");

const require = createRequire(import.meta.url);

/**
 * Load the grammar's renderer from source.
 *
 * @returns {{ text: string }} The rendered document.
 */
function rendered() {
  const ts = require("typescript");
  const previous = require.extensions[".ts"];

  // CommonJS output, one file at a time: imports of types vanish, and the files' imports of
  // each other resolve through this same hook.
  require.extensions[".ts"] = (module, filename) => {
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
      },
    });

    module._compile(outputText, filename);
  };

  try {
    const help = require(join(SOURCE, "grammar.help.ts"));
    const registry = require(join(SOURCE, "grammar.registry.ts"));

    return { text: help.renderReferenceText(registry.GRAMMAR) };
  } finally {
    if (previous === undefined) {
      delete require.extensions[".ts"];
    } else {
      require.extensions[".ts"] = previous;
    }
  }
}

/**
 * Re-render chat-grammar.json, or report that it has drifted.
 *
 * @param {string[]} argv - Command-line arguments. `--check` writes nothing.
 * @returns {number} `0` when the file was written or already current, `1` under `--check` when
 *   it had drifted, `2` when the grammar could not be loaded or an argument was not recognised.
 */
export function main(argv) {
  const check = argv.includes("--check");
  const unknown = argv.filter((argument) => argument !== "--check");

  if (unknown.length > 0) {
    console.error(
      `chat-grammar: unrecognised argument ${unknown[0]} — usage: chat-grammar [--check]`,
    );
    return 2;
  }

  let text;
  try {
    ({ text } = rendered());
  } catch (error) {
    console.error(`chat-grammar: the grammar could not be loaded — ${String(error)}`);
    return 2;
  }

  let current;
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    // Not an error: the JSON is an output, and it has to be writable before it exists.
    current = undefined;
  }

  if (current === text) {
    console.log(`${TARGET} is ${check ? "current" : "already current"}`);
    return 0;
  }

  if (check) {
    console.error(`${TARGET} has drifted from the grammar registry — run \`yarn chat-grammar\``);
    return 1;
  }

  writeFileSync(TARGET, text, "utf8");
  console.log(`wrote ${TARGET}`);
  return 0;
}

// Only when this file is the process entry point: the spec runs it as a subprocess.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Set rather than passed to `process.exit()`, which would discard the buffered line.
  process.exitCode = main(process.argv.slice(2));
}
