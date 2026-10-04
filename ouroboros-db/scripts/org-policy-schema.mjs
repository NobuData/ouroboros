#!/usr/bin/env node
// org-policy-schema.mjs — the org-policy document's committed JSON Schema, held to its golden
// fixtures and to every stored policy version (#480, BQ.1).
//
// `schemas/org-policy/v1.json` is the grammar of `org_policy_versions.document` (V092). The
// database holds the envelope — rule ids, the five core rules, `{enabled, conditions}`, spend
// cents — and this schema holds what is inside `conditions`. A Flyway migration cannot read a
// file, so this is where the two meet, the way workflow-dsl-drift.mjs is for the workflow DSL
// (#137): malformed conditions are a red build, not a runtime surprise.
//
// Two modes:
//
//   --fixtures  Every `valid/*.json` under the fixtures directory must validate, and every
//               `invalid/*.json` must be refused. A schema loosened until it accepts an invalid
//               fixture goes red as surely as one tightened past a valid one.
//   DOCUMENTS   A JSON array of stored versions, one `{"organization": "...", "version": 7,
//               "document": {...}}` per row — what tests/lib/stored-policy-documents.sql
//               prints. Every document must validate. An empty array is green: policy versions
//               are published by people, and the dev seed's arrive with BQ.5 (#484).
//
// The schema references the workflow DSL's vocabulary (`effort`, `label`, `path_glob`) by
// `$id`, so the DSL schema is loaded beside it. Both are compiled the way ouroboros-rest's
// conformance suite compiles the DSL: JSON Schema 2020-12, every error, strict mode.
//
// Usage:
//   ouroboros-db/scripts/org-policy-schema.mjs --fixtures
//   ouroboros-db/scripts/org-policy-schema.mjs --fixtures DIR
//   ouroboros-db/scripts/org-policy-schema.mjs DOCUMENTS.json
//   ouroboros-db/scripts/org-policy-schema.mjs -            # read the documents from stdin
//   ouroboros-db/scripts/org-policy-schema.mjs --schema SCHEMA.json ...
//   ouroboros-db/scripts/org-policy-schema.mjs --help
//
// Exit status: 0 every verdict is the expected one / 1 at least one is not / 2 it could not run.

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, resolved from this file so the verb works from any directory. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The committed contract every policy document is written against. */
const SCHEMA_PATH = join(REPO_ROOT, "schemas", "org-policy", "v1.json");

/** The workflow DSL schema whose vocabulary the policy schema references (#133). */
const DSL_SCHEMA_PATH = join(REPO_ROOT, "schemas", "workflow-dsl", "v1.json");

/** The golden cases: `valid/` must validate, `invalid/` must be refused. */
const FIXTURES_PATH = join(REPO_ROOT, "schemas", "org-policy", "fixtures");

/** ouroboros-rest declares ajv; resolving through it uses the copy its suites use. */
const AJV_HOST = join(REPO_ROOT, "ouroboros-rest", "package.json");

/** The prefix every message carries, so a CI log says which step is talking. */
const NAME = "org-policy-schema";

/**
 * This file's header, as the help text.
 *
 * @returns {string} The leading comment block without its markers, stopping at the first line
 *   of code.
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
 * @param {string[]} argv - Arguments, without the interpreter and the script.
 * @returns {{help: true} | {schema: string, fixtures: string} | {schema: string, input: string}
 *   | {error: string}} Print the help, check a fixtures directory, check a documents file, or
 *   refuse with a reason.
 */
function parseArguments(argv) {
  let schema = SCHEMA_PATH;
  let fixtures = null;
  const inputs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--schema") {
      if (index + 1 >= argv.length) return { error: "--schema needs a path" };
      index += 1;
      schema = argv[index];
    } else if (argument === "--fixtures") {
      fixtures = FIXTURES_PATH;
    } else if (argument.startsWith("-") && argument !== "-") {
      return { error: `unknown argument: ${argument}` };
    } else {
      inputs.push(argument);
    }
  }
  if (fixtures !== null) {
    if (inputs.length > 1) return { error: "--fixtures takes at most one directory" };
    return { schema, fixtures: inputs[0] ?? fixtures };
  }
  if (inputs.length === 0) return { error: "name the documents file to validate, or pass --fixtures" };
  if (inputs.length > 1) return { error: `one documents file at a time, not ${inputs.length}` };
  return { schema, input: inputs[0] };
}

/**
 * Read and parse a JSON file.
 *
 * @param {string} path - The file, or `-` for standard input.
 * @param {string} what - What the file is, for the message.
 * @returns {unknown} The parsed value.
 * @throws {Error} When the file cannot be read or is not JSON, naming which.
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
 * Compile the policy schema, with the DSL schema it references registered beside it.
 *
 * @param {object} schema - The parsed policy schema.
 * @returns {Function} ajv's validator: returns whether a document is valid, leaving the reasons
 *   on its `errors` property.
 * @throws {Error} When ajv is not installed, or either schema does not compile.
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
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(readJson(DSL_SCHEMA_PATH, "workflow DSL schema"));
    return ajv.compile(schema);
  } catch (cause) {
    throw new Error(`the schema does not compile: ${cause.message}`, { cause });
  }
}

/**
 * Hold a documents file to the shape stored-policy-documents.sql prints.
 *
 * @param {unknown} value - The parsed file.
 * @returns {{organization: string, version: number, document: unknown}[]} The entries.
 * @throws {Error} Naming the first entry that is not of that shape — a broken extraction, not
 *   a drifted document.
 */
function readDocuments(value) {
  if (!Array.isArray(value)) {
    throw new Error("the documents file must be a JSON array, one entry per stored version");
  }
  value.forEach((entry, index) => {
    const shaped =
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.organization === "string" &&
      entry.organization !== "" &&
      Number.isInteger(entry.version) &&
      Object.hasOwn(entry, "document");
    if (!shaped) {
      throw new Error(`entry ${index} is not {"organization": string, "version": integer, "document": ...}`);
    }
  });
  return value;
}

/**
 * The JSON files of one fixtures subdirectory.
 *
 * @param {string} directory - The fixtures directory.
 * @param {"valid"|"invalid"} kind - Which subdirectory.
 * @returns {{name: string, document: unknown}[]} Each file's name and parsed content, sorted.
 * @throws {Error} When the subdirectory cannot be read or a file is not JSON.
 */
function readFixtures(directory, kind) {
  const folder = join(directory, kind);
  let names;
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();
  } catch (cause) {
    throw new Error(`could not read the ${kind} fixtures at ${folder}: ${cause.message}`, { cause });
  }
  return names.map((name) => ({
    name: `${kind}/${basename(name, ".json")}`,
    document: readJson(join(folder, name), `${kind} fixture`),
  }));
}

/**
 * Render one ajv error as a line a person can act on.
 *
 * @param {{instancePath: string, message?: string, params?: object}} error - One ajv error.
 * @returns {string} The pointer, what is wrong, and ajv's parameters when there are any.
 */
function describeError(error) {
  const pointer = error.instancePath === "" ? "/" : error.instancePath;
  const params =
    error.params && Object.keys(error.params).length > 0 ? ` ${JSON.stringify(error.params)}` : "";
  return `${pointer} ${error.message ?? "is invalid"}${params}`;
}

/**
 * A path as a reader of the log would want it.
 *
 * @param {string} path - The path as given.
 * @returns {string} Relative to the repository root when inside it, otherwise unchanged.
 */
function displayPath(path) {
  const fromRoot = relative(REPO_ROOT, resolve(path));
  return fromRoot.startsWith("..") ? path : fromRoot;
}

/**
 * Validate one document and print its line.
 *
 * @param {Function} validate - The compiled validator.
 * @param {string} name - What the document is called in the log.
 * @param {unknown} document - The document.
 * @param {boolean} expected - Whether it should validate.
 * @returns {boolean} Whether the verdict was the expected one.
 */
function judge(validate, name, document, expected) {
  const valid = validate(document);
  const errors = validate.errors ?? [];
  if (valid === expected) {
    const reason = valid ? "" : `  (${describeError(errors[0])})`;
    console.log(`  ok    ${name}${reason}`);
    return true;
  }
  console.log(`  FAIL  ${name} — ${expected ? "refused, but should validate" : "accepted, but should be refused"}`);
  for (const error of errors) console.log(`          ${describeError(error)}`);
  return false;
}

/**
 * Run the verb.
 *
 * @param {string[]} argv - Command-line arguments.
 * @returns {number} `0` every verdict expected, `1` at least one not, `2` could not run.
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
  let cases;
  try {
    validate = compileSchema(readJson(parsed.schema, "schema"));
    if (parsed.fixtures !== undefined) {
      const valid = readFixtures(parsed.fixtures, "valid");
      const invalid = readFixtures(parsed.fixtures, "invalid");
      if (valid.length === 0 || invalid.length === 0) {
        throw new Error(`${displayPath(parsed.fixtures)} needs at least one valid and one invalid fixture`);
      }
      cases = [
        ...valid.map((fixture) => ({ ...fixture, expected: true })),
        ...invalid.map((fixture) => ({ ...fixture, expected: false })),
      ];
    } else {
      cases = readDocuments(readJson(parsed.input, "documents file")).map((entry) => ({
        name: `${entry.organization} policy v${entry.version}`,
        document: entry.document,
        expected: true,
      }));
    }
  } catch (error) {
    console.error(`${NAME}: ${error.message}`);
    return 2;
  }

  const schemaName = displayPath(parsed.schema);

  if (cases.length === 0) {
    console.log(`${NAME}: no stored policy versions to validate against ${schemaName}`);
    return 0;
  }

  const wrong = cases.filter((entry) => !judge(validate, entry.name, entry.document, entry.expected));

  if (wrong.length === 0) {
    console.log(`${NAME}: all ${cases.length} verdicts as expected against ${schemaName}`);
    return 0;
  }

  console.error(`
${NAME}: ${wrong.length} of ${cases.length} documents got the wrong verdict from ${schemaName}.

Either the schema change is wrong, or the documents have to move with it: a stored version is
immutable, so a schema that refuses one already published needs a new major (v2.json) rather
than an edit.`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
