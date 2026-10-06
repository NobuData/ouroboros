#!/usr/bin/env node
// draft-ops-parity.mjs — every stored draft operation, validated against the DSL it edits.
//
// `ouroboros.draft_operations.op` (#556, CC.2) records each typed operation applied to a
// workflow's shared draft as `{kind, params}`, and `params` carries the DSL's own objects — a
// node, an edge, a trigger. V110's CHECK holds the envelope (the kind, the exact keys, the
// slugs); whether the node inside is a node `schemas/workflow-dsl/v1.json` (#133) accepts is a
// question a Flyway migration cannot ask, because it cannot read the file. This verb asks it.
//
// The verdict is ajv's over `schemas/workflow-dsl/operations-v1.json`, which `$ref`s v1.json's
// `$defs` rather than restating them — so the day a DSL change would reject recorded history,
// this check goes red on the pull request that made the change, instead of the history quietly
// becoming unreplayable. Compiled as workflow-dsl-drift.mjs and ouroboros-rest's conformance
// suite compile the DSL: JSON Schema 2020-12, every error, strict mode.
//
// An empty log is green. Until CC.4 (#558) seeds mockup 20's draft, a seeded database stores no
// operations, and "nothing recorded" is a true answer rather than a misconfiguration.
//
// Usage:
//   ouroboros-db/scripts/draft-ops-parity.mjs OPERATIONS.json
//   ouroboros-db/scripts/draft-ops-parity.mjs --dsl DSL.json OPERATIONS.json
//   ouroboros-db/scripts/draft-ops-parity.mjs -        # read the operations from stdin
//   ouroboros-db/scripts/draft-ops-parity.mjs --help
//
// OPERATIONS.json is what tests/lib/draft-operations.sql prints: a JSON array with one entry per
// stored operation, `{"workflow": "acme-robotics/security-patch", "base_version": null,
// "draft_rev": 2, "seq": 1, "op": {...}}`. `--dsl` validates against another copy of the DSL
// schema instead of the committed one, which is how the module's suite proves a tightened DSL
// turns recorded history red without editing the file everything else reads.
//
// Exit status: 0 every operation validates (or there are none) / 1 at least one does not /
// 2 it could not run.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, from this file's location. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The committed DSL schema the operations reference. */
const DSL_PATH = join(REPO_ROOT, "schemas", "workflow-dsl", "v1.json");

/** The committed operation schema. */
const OPERATIONS_PATH = join(
  REPO_ROOT,
  "schemas",
  "workflow-dsl",
  "operations-v1.json",
);

/** Where ajv is installed — ouroboros-rest's dependency, as the drift check resolves it. */
const AJV_HOST = join(REPO_ROOT, "ouroboros-rest", "package.json");

const NAME = "draft-ops-parity";

/**
 * The header comment above, as the `--help` text.
 * @returns {string} The usage text.
 */
function helpText() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("\n")
    .slice(1);
  const header = [];
  for (const line of lines) {
    if (!line.startsWith("//")) break;
    header.push(line.slice(3));
  }
  return header.join("\n");
}

/**
 * Reads the command line.
 * @param {string[]} argv - The arguments after the script.
 * @returns {{help: true} | {error: string} | {dsl: string, input: string}} What to do.
 */
function parseArguments(argv) {
  let dsl = DSL_PATH;
  const inputs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--dsl") {
      if (index + 1 >= argv.length) return { error: "--dsl needs a path" };
      index += 1;
      dsl = argv[index];
    } else if (argument.startsWith("--dsl=")) {
      dsl = argument.slice("--dsl=".length);
    } else if (argument.startsWith("-") && argument !== "-") {
      return { error: `unknown argument: ${argument}` };
    } else {
      inputs.push(argument);
    }
  }
  if (inputs.length === 0)
    return { error: "name the operations file to validate, or - for stdin" };
  if (inputs.length > 1)
    return { error: `one operations file at a time, not ${inputs.length}` };
  return { dsl, input: inputs[0] };
}

/**
 * Reads and parses a JSON file (or stdin for `-`).
 * @param {string} path - The file, or `-`.
 * @param {string} what - What it is, for the error message.
 * @returns {unknown} The parsed value.
 * @throws {Error} When it cannot be read or is not JSON.
 */
function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path === "-" ? 0 : path, "utf8");
  } catch (cause) {
    throw new Error(`could not read the ${what} at ${path}: ${cause.message}`, {
      cause,
    });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`the ${what} at ${path} is not JSON: ${cause.message}`, {
      cause,
    });
  }
}

/**
 * Checks the operations file's shape.
 * @param {unknown} value - The parsed file.
 * @returns {Array<{workflow: string, base_version: number|null, draft_rev: number, seq: number, op: unknown}>}
 *   The entries.
 * @throws {Error} When an entry is not in the query's shape.
 */
function readOperations(value) {
  if (!Array.isArray(value)) {
    throw new Error(
      "the operations file must be a JSON array, one entry per stored operation",
    );
  }
  value.forEach((entry, index) => {
    const shaped =
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.workflow === "string" &&
      entry.workflow !== "" &&
      (entry.base_version === null || Number.isInteger(entry.base_version)) &&
      Number.isInteger(entry.draft_rev) &&
      Number.isInteger(entry.seq) &&
      Object.hasOwn(entry, "op");
    if (!shaped) {
      throw new Error(
        `entry ${index} is not {"workflow": string, "base_version": integer or null, ` +
          `"draft_rev": integer, "seq": integer, "op": ...}`,
      );
    }
  });
  return value;
}

/**
 * Compiles the operation schema with the DSL schema registered for its `$ref`s.
 * @param {object} dsl - The DSL schema.
 * @param {object} operations - The operation schema.
 * @returns {Function} ajv's validator.
 * @throws {Error} When ajv is missing or either schema does not compile.
 */
function compileSchemas(dsl, operations) {
  let ajvModule;
  try {
    ajvModule = createRequire(AJV_HOST)("ajv/dist/2020");
  } catch (cause) {
    throw new Error(
      "ajv is not installed — run `yarn install` at the repository root",
      { cause },
    );
  }
  const Ajv2020 = ajvModule.default ?? ajvModule;
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(dsl);
    return ajv.compile(operations);
  } catch (cause) {
    throw new Error(`the schemas do not compile: ${cause.message}`, { cause });
  }
}

/**
 * How an operation is named in the report — `acme-robotics/security-patch v0.2 #1 add_stage`.
 * @param {{workflow: string, base_version: number|null, draft_rev: number, seq: number, op: any}} entry
 * @returns {string} The label.
 */
function label(entry) {
  const kind =
    entry.op && typeof entry.op.kind === "string" ? ` ${entry.op.kind}` : "";
  return `${entry.workflow} v${entry.base_version ?? 0}.${entry.draft_rev} #${entry.seq}${kind}`;
}

/**
 * One ajv error as a line.
 * @param {{instancePath: string, message?: string, params?: object}} error
 * @returns {string} The line.
 */
function describeError(error) {
  const pointer = error.instancePath === "" ? "/" : error.instancePath;
  const params =
    error.params && Object.keys(error.params).length > 0
      ? ` ${JSON.stringify(error.params)}`
      : "";
  return `${pointer} ${error.message ?? "is invalid"}${params}`;
}

/**
 * Runs the check.
 * @param {string[]} argv - The arguments.
 * @returns {number} The exit status.
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
  let operations;
  try {
    validate = compileSchemas(
      readJson(parsed.dsl, "DSL schema"),
      readJson(OPERATIONS_PATH, "operation schema"),
    );
    operations = readOperations(readJson(parsed.input, "operations file"));
  } catch (error) {
    console.error(`${NAME}: ${error.message}`);
    return 2;
  }

  if (operations.length === 0) {
    console.log(
      `${NAME}: no draft operations are stored — nothing recorded, nothing to check`,
    );
    return 0;
  }

  let invalid = 0;
  for (const entry of operations) {
    if (validate(entry.op)) {
      console.log(`  ok    ${label(entry)}`);
      continue;
    }
    invalid += 1;
    console.log(`  FAIL  ${label(entry)}`);
    for (const error of validate.errors ?? []) {
      console.log(`          ${describeError(error)}`);
    }
  }

  if (invalid === 0) {
    console.log(
      `${NAME}: all ${operations.length} stored draft operations validate against the DSL`,
    );
    return 0;
  }

  console.error(`
${NAME}: ${invalid} of ${operations.length} stored draft operations no longer validate against the DSL.

Recorded history and the DSL have drifted apart: replaying these operations would build a draft
the studio refuses. Either the DSL change is wrong, or it needs a migration of the recorded
operations (and of schemas/workflow-dsl/operations-v1.json) that keeps the history replayable.`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
