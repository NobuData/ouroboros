#!/usr/bin/env node
// workflow-dsl-drift.mjs — every seeded workflow definition, validated against the committed
// DSL schema.
//
// The seeds and the schema are two copies of one agreement. `R__dev_seed_workflows.sql`
// (#136) writes P.2 documents into `workflow_versions.definition`, and
// `schemas/workflow-dsl/v1.json` (#133) is the grammar they are written in. A Flyway
// migration cannot read a file, so nothing ties the two together at the moment either of them
// changes: a schema edit that tightens a rule leaves the seeds describing a language that no
// longer exists, and the first thing to notice would be the studio refusing its own fixture.
// This is the check that notices on the pull request instead (#137, P.6).
//
// It validates **stored rows**, not the migration's text. What is asserted is what a database
// actually holds after `migrate --config flyway.seed.toml` — including v2–v13 of
// `standard-fix`, which exist only as the output of a `jsonb_set` and appear in the file as no
// literal at all. `tests/lib/seeded-definitions.sql` is the query that reads them out; this is
// the verdict.
//
// The verdict is ajv's over `v1.json`, compiled exactly as ouroboros-rest's conformance suite
// compiles it: JSON Schema 2020-12, every error, strict mode. It is deliberately the schema and
// nothing more. The structural rules JSON Schema cannot state — one trigger, somewhere to end,
// every node reachable — are `tests/seed.sql`'s, which walks the same rows with a recursive
// CTE, and P.2's full validator runs over the migration's documents in `dsl.seed.spec.ts`. A
// second implementation of the grammar here is the one thing decision P3 forbids.
//
// Usage:
//   ouroboros-db/scripts/workflow-dsl-drift.mjs DOCUMENTS.json
//   ouroboros-db/scripts/workflow-dsl-drift.mjs --schema SCHEMA.json DOCUMENTS.json
//   ouroboros-db/scripts/workflow-dsl-drift.mjs -        # read the documents from stdin
//   ouroboros-db/scripts/workflow-dsl-drift.mjs --help
//
// DOCUMENTS.json is what tests/lib/seeded-definitions.sql prints: a JSON array with one entry
// per stored version, `{"workflow": "acme-robotics/standard-fix", "version": 14,
// "definition": {...}}`, where a null version is the draft. `--schema` validates against
// another copy of the schema instead of the committed one, which is how the module's suite
// proves a drifted schema turns this red without editing the file everything else reads.
//
// Exit status: 0 every document validates / 1 at least one does not, or there were none to
// validate / 2 it could not run.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, resolved from this file so the verb works from any directory. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The committed contract every seeded definition is written against (#133). */
const SCHEMA_PATH = join(REPO_ROOT, "schemas", "workflow-dsl", "v1.json");

/**
 * The workspace whose dependencies this borrows. ouroboros-db declares none of its own — it is
 * SQL and Flyway configuration — and ouroboros-rest is the module that already compiles this
 * schema with ajv, so resolving from its manifest checks with the ajv the service's own
 * conformance suite uses rather than whichever copy happens to be hoisted.
 */
const AJV_HOST = join(REPO_ROOT, "ouroboros-rest", "package.json");

/** The prefix every message carries, so a CI log says which step is talking. */
const NAME = "workflow-dsl-drift";

/**
 * This file's header, as the help text.
 *
 * @returns {string} The leading comment block with its markers removed, stopping at the first
 *   line of code so no comment further down leaks into the help.
 */
function helpText() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const header = [];
  for (const line of lines) {
    if (!line.startsWith("//")) break;
    header.push(line.slice(3));
  }
  return header.join("\n");
}

/**
 * Read the command line.
 *
 * @param {string[]} argv - Command-line arguments, without the interpreter and the script.
 * @returns {{help: true} | {schema: string, input: string} | {error: string}} What to do:
 *   print the help, validate the documents in `input` against `schema`, or refuse with a reason.
 */
function parseArguments(argv) {
  let schema = SCHEMA_PATH;
  const inputs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--schema") {
      if (index + 1 >= argv.length) return { error: "--schema needs a path" };
      index += 1;
      schema = argv[index];
    } else if (argument.startsWith("--schema=")) {
      schema = argument.slice("--schema=".length);
    } else if (argument.startsWith("-") && argument !== "-") {
      return { error: `unknown argument: ${argument}` };
    } else {
      inputs.push(argument);
    }
  }
  if (inputs.length === 0) return { error: "name the documents file to validate, or - for stdin" };
  if (inputs.length > 1) return { error: `one documents file at a time, not ${inputs.length}` };
  return { schema, input: inputs[0] };
}

/**
 * Read and parse a JSON file.
 *
 * @param {string} path - The file, or `-` for standard input.
 * @param {string} what - What the file is, for the message.
 * @returns {unknown} The parsed value.
 * @throws {Error} When the file cannot be read or is not JSON, naming which of the two.
 */
function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path === "-" ? 0 : path, "utf8");
  } catch (cause) {
    throw new Error(`could not read the ${what} at ${path}: ${cause.message}`, { cause });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`the ${what} at ${path} is not JSON: ${cause.message}`, { cause });
  }
}

/**
 * Hold the documents file to the shape `seeded-definitions.sql` prints.
 *
 * A malformed entry is a broken query or a hand-written file rather than a drifted definition,
 * so it is refused as "could not run" instead of reported as invalid: a check that called a
 * missing `definition` a validation failure would be describing the extraction, not the seed.
 *
 * @param {unknown} value - The parsed documents file.
 * @returns {{workflow: string, version: number|null, definition: unknown}[]} The entries.
 * @throws {Error} Naming the first entry that is not of that shape.
 */
function readDocuments(value) {
  if (!Array.isArray(value)) {
    throw new Error("the documents file must be a JSON array, one entry per stored version");
  }
  value.forEach((entry, index) => {
    const shaped =
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.workflow === "string" &&
      entry.workflow !== "" &&
      (entry.version === null || Number.isInteger(entry.version)) &&
      Object.hasOwn(entry, "definition");
    if (!shaped) {
      throw new Error(
        `entry ${index} is not {"workflow": string, "version": integer or null, "definition": ...}`,
      );
    }
  });
  return value;
}

/**
 * Compile the schema with the options ouroboros-rest's conformance suite uses.
 *
 * `strict: true` refuses a schema with an unknown keyword, an ignored one, or a `$ref` that
 * resolves to nothing, so a broken schema is reported as broken rather than as every
 * definition suddenly passing.
 *
 * @param {object} schema - The parsed JSON Schema.
 * @returns {Function} ajv's compiled validator: called with a document, it returns whether the
 *   document is valid and leaves the reasons on its own `errors` property.
 * @throws {Error} When ajv is not installed, carrying the command that installs it, or when the
 *   schema does not compile.
 */
function compileSchema(schema) {
  let ajvModule;
  try {
    ajvModule = createRequire(AJV_HOST)("ajv/dist/2020");
  } catch (cause) {
    throw new Error("ajv is not installed — run `yarn install` at the repository root", { cause });
  }
  const Ajv2020 = ajvModule.default ?? ajvModule;
  try {
    return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  } catch (cause) {
    throw new Error(`the schema does not compile: ${cause.message}`, { cause });
  }
}

/**
 * Name one stored version the way the studio's page head does.
 *
 * @param {{workflow: string, version: number|null}} document - One entry of the documents file.
 * @returns {string} `acme-robotics/standard-fix v14`, or `... draft` for the unnumbered row.
 */
function label(document) {
  return `${document.workflow} ${document.version === null ? "draft" : `v${document.version}`}`;
}

/**
 * Render one ajv error as a line a person can act on.
 *
 * @param {{instancePath: string, message?: string, params?: object}} error - One ajv error.
 * @returns {string} The pointer to the value, what is wrong with it, and ajv's parameters when
 *   there are any — the property missing or undeclared, the values allowed.
 */
function describeError(error) {
  const pointer = error.instancePath === "" ? "/" : error.instancePath;
  const params = error.params && Object.keys(error.params).length > 0
    ? ` ${JSON.stringify(error.params)}`
    : "";
  return `${pointer} ${error.message ?? "is invalid"}${params}`;
}

/**
 * A path as a reader of the log would want it.
 *
 * @param {string} path - The path as given on the command line, or the default.
 * @returns {string} The path relative to the repository root when it is inside it, otherwise
 *   the path unchanged.
 */
function displayPath(path) {
  const fromRoot = relative(REPO_ROOT, resolve(path));
  return fromRoot.startsWith("..") ? path : fromRoot;
}

/**
 * Run the verb.
 *
 * @param {string[]} argv - Command-line arguments.
 * @returns {number} The exit code: `0` every document validates, `1` at least one does not or
 *   there were none to validate, `2` it could not run.
 */
function main(argv) {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    console.log(helpText());
    return 0;
  }
  if (parsed.error) {
    console.error(`${NAME}: ${parsed.error} — see --help`);
    return 2;
  }

  let validate;
  let documents;
  try {
    validate = compileSchema(readJson(parsed.schema, "schema"));
    documents = readDocuments(readJson(parsed.input, "documents file"));
  } catch (error) {
    console.error(`${NAME}: ${error.message}`);
    return 2;
  }

  const schemaName = displayPath(parsed.schema);

  // A drift check over no documents is green whatever the schema says, which is the one answer
  // it must never give — the usual cause is a database migrated without the seed overlay.
  if (documents.length === 0) {
    console.error(`${NAME}: there are no definitions to validate, and a drift check over nothing proves nothing.
Was the database migrated with --config flyway.seed.toml? Without that overlay the seeds write no rows.`);
    return 1;
  }

  let invalid = 0;
  for (const document of documents) {
    if (validate(document.definition)) {
      console.log(`  ok    ${label(document)}`);
      continue;
    }
    invalid += 1;
    console.log(`  FAIL  ${label(document)}`);
    for (const error of validate.errors ?? []) {
      console.log(`          ${describeError(error)}`);
    }
  }

  if (invalid === 0) {
    console.log(`${NAME}: all ${documents.length} seeded definitions validate against ${schemaName}`);
    return 0;
  }

  console.error(`
${NAME}: ${invalid} of ${documents.length} seeded definitions no longer validate against ${schemaName}.

The schema and the seeds have drifted apart. Either the schema change is wrong, or the seeds
have to move with it: edit ouroboros-db/migrations/R__dev_seed_workflows.sql until every
document it writes validates again — and if standard-fix v14 changed, change
schemas/workflow-dsl/fixtures/valid/standard-fix.json with it, since the seed is a copy of it.`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
