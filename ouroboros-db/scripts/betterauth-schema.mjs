#!/usr/bin/env node
// betterauth-schema.mjs — what BetterAuth expects of the database, rendered and checked
// against what Flyway actually applies.
//
// Decision **A3** makes Flyway the only migration authority: every table the library
// uses is hand-ported into a `V###__*.sql` migration and the library is never allowed to
// change the schema itself. That is the right call, and it is precisely what makes
// **drift** possible — a `better-auth` upgrade can change the schema the library expects
// while our copy stands still, and nothing about that is visible until a query in
// production names a column that does not exist. This is the check that makes it visible
// on the pull request instead (#710).
//
// Two questions, two modes, one function underneath:
//
//   --check    Has the library's expectation changed since we last looked?
//              Renders the schema against an **empty** database and compares it to the
//              snapshot committed beside the migrations. A `better-auth` bump that moves
//              a column fails here, and the diff is the DDL the new migration has to
//              apply. `--write` is the same rendering, saved rather than compared.
//
//   --applied  Does the schema Flyway actually applied satisfy the library **today**?
//              Renders against a **migrated** database, where the library reports only
//              what is still missing. Anything at all is a hand-port that lost something.
//
// Neither mode writes to the database it reads, and neither can: the library's migration
// runner is never invoked, only its planner. What comes back is SQL text.
//
// The rendering comes from `better-auth`'s own planner (`getMigrations`) over this
// service's own auth configuration, which is what makes the answer trustworthy in both
// directions — a plugin added to `ouroboros-rest/src/auth` changes the expectation here
// the same way a library upgrade does, and neither has to be remembered.
//
// It deliberately does **not** shell out to `@better-auth/cli generate`, which the issue
// proposed and which would be one line shorter. `npx @better-auth/cli` installs its own
// copy of `better-auth` — the CLI's latest release carries 1.4.x while this repository
// pins 1.6.26 — so the core tables would be checked against a *different* version of the
// library than the one the service runs, and "bump the version and watch this turn red"
// would quietly stop being true. The two copies already disagree: 1.4.x emits
// `organization_slug_uidx` and 1.6.26 does not. Importing the planner out of the
// installed dependency is the same work against the version that actually ships.
//
// Usage:
//   ouroboros-db/scripts/betterauth-schema.mjs --check     # fail if the snapshot is stale
//   ouroboros-db/scripts/betterauth-schema.mjs --write     # re-render the snapshot
//   ouroboros-db/scripts/betterauth-schema.mjs --applied   # fail if the applied schema lacks something
//   ouroboros-db/scripts/betterauth-schema.mjs --help
//
// `--check` and `--write` need `OURO_DATABASE_URL` pointing at a database whose schema is
// **empty**; `--applied` needs one that has been migrated. Both refuse the other's
// database rather than answering the wrong question — see `describeWrongDatabase`.
//
// Exit status: 0 the check passed / 1 it failed, naming the fix / 2 it could not run.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The module root, resolved from this file so the verb works from any directory. */
const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The committed rendering, beside the migrations it is compared against. */
const SNAPSHOT_FILENAME = "betterauth-schema.sql";
const SNAPSHOT_PATH = join(MODULE_ROOT, SNAPSHOT_FILENAME);

/**
 * The service whose auth configuration decides the schema, and the build of it this
 * reads. Source cannot be loaded directly — it is TypeScript with extensionless
 * imports — so the build is a prerequisite rather than a convenience, and a missing one
 * is reported as the command that produces it.
 */
const REST_MODULE = "ouroboros-rest";
const AUTH_CONFIG = join(MODULE_ROOT, "..", REST_MODULE, "dist", "auth", "auth.config.js");
const BUILD_COMMAND = `yarn workspace ${REST_MODULE} build`;

/** The tables the library owns. Used only to describe what a wrong database looks like. */
const EXPECTED_TABLE_COUNT = 7;

/**
 * The snapshot's header. Static prose — nothing derived from the clock, the machine or
 * the installed version, because the file is committed and diffed and a rendering that
 * changed on its own would make every diff a false positive.
 */
const SNAPSHOT_HEADER = `-- betterauth-schema.sql — the schema BetterAuth expects, as it renders it.
--
-- Generated. Do not edit, and do not apply: Flyway owns every statement that reaches a
-- database (decision A3), and this file is a *description* of what the library wants,
-- not a migration. Re-render it with
--
--   ouroboros-db/scripts/betterauth-schema.mjs --write
--
-- It is committed so that a change in what the library expects is a reviewable diff on
-- the pull request that causes it — a \`better-auth\` upgrade, or a plugin added to
-- ouroboros-rest/src/auth. ci/db fails when this file and the installed library disagree,
-- and the diff is the DDL the new V###__*.sql migration has to apply.
--
-- Table names are unqualified because the library never qualifies them: the \`ouroboros\`
-- schema comes from the connection's search_path, which is where V000 put it.
--
-- Filed as issue #710.
`;

/**
 * Load the service's auth configuration.
 *
 * @returns {{options: object, close: () => Promise<void>}} The BetterAuth options the
 *   planner reads, and a function that releases the connection pool they carry.
 * @throws {Error} When the build is absent, carrying the command that produces it.
 */
function loadAuthOptions() {
  const require = createRequire(import.meta.url);
  let auth;
  try {
    ({ auth } = require(AUTH_CONFIG));
  } catch (cause) {
    if (cause?.code === "MODULE_NOT_FOUND" && String(cause.message).includes("auth.config")) {
      throw new Error(`${REST_MODULE} is not built — run \`${BUILD_COMMAND}\``, { cause });
    }
    throw cause;
  }
  const pool = auth.options.database;
  return { options: auth.options, close: () => pool.end() };
}

/**
 * Describe the database a connection string names, without its password.
 *
 * @param {object} options - The BetterAuth options, carrying the `pg` pool.
 * @returns {string} `host:port/database`, or `the configured database` if unparseable.
 */
function describeDatabase(options) {
  try {
    const url = new URL(options.database.options.connectionString);
    return `${url.host}${url.pathname}`;
  } catch {
    return "the configured database";
  }
}

/**
 * Ask the library what is missing from the database it is pointed at.
 *
 * @param {object} options - The BetterAuth options.
 * @returns {Promise<{sql: string, created: string[], added: string[]}>} The DDL that
 *   would close the gap, the tables absent entirely, and the `table.column` pairs absent
 *   from tables that do exist.
 */
async function planSchema(options) {
  const { getMigrations } = await import("better-auth/db/migration");
  const { compileMigrations, toBeCreated, toBeAdded } = await getMigrations(options);
  const sql = (await compileMigrations()).trim();
  return {
    // A plan with nothing in it compiles to a bare `;`, which is not SQL anybody wants
    // to read or diff. Normalise it to the empty string, so "no work" is falsy.
    sql: sql === ";" ? "" : sql,
    created: toBeCreated.map((table) => table.table),
    added: toBeAdded.flatMap((table) => Object.keys(table.fields).map((f) => `${table.table}.${f}`)),
  };
}

/**
 * Explain why a plan came from the wrong database, if it did.
 *
 * The two modes need opposite databases, and pointing either at the other's produces a
 * confident wrong answer rather than an error: `--check` against a migrated database
 * renders an empty schema and reports the snapshot as pure drift, and `--applied`
 * against an empty one reports the entire schema as missing. Both are caught here by the
 * one signal that distinguishes them — how many of the library's tables had to be
 * created.
 *
 * @param {"empty"|"migrated"} wanted - The database state the mode needs.
 * @param {{created: string[]}} plan - The plan just rendered.
 * @param {string} where - The database it came from, for the message.
 * @returns {string|null} The reason, or null when the database is the right one.
 */
function describeWrongDatabase(wanted, plan, where) {
  const isEmpty = plan.created.length === EXPECTED_TABLE_COUNT;
  if (wanted === "empty" && !isEmpty) {
    return `${where} already holds the auth tables, so it describes nothing.
Point OURO_DATABASE_URL at a database whose \`ouroboros\` schema is empty — a scratch
database, or one made with \`createdb\` and \`create schema ouroboros\`.`;
  }
  if (wanted === "migrated" && isEmpty) {
    return `${where} has no auth tables in it at all, so everything reads as missing.
Point OURO_DATABASE_URL at a migrated database — \`ouroboros-db/scripts/migrate\` first.`;
  }
  return null;
}

/**
 * Render the plan as the snapshot file's contents.
 *
 * @param {{sql: string}} plan - A plan taken against an empty database.
 * @returns {string} The file text, ending in a newline.
 */
export function render(plan) {
  return `${SNAPSHOT_HEADER}\n${plan.sql}\n`;
}

/**
 * Split a rendering into the statements it is made of, ignoring comments and layout.
 *
 * Statement-level comparison is what makes a drift report readable: it says "this
 * statement is new" rather than pointing at a line whose neighbours merely moved.
 *
 * @param {string} text - A snapshot rendering.
 * @returns {string[]} One entry per statement, whitespace-collapsed.
 */
function statements(text) {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Report how a fresh rendering differs from the committed one.
 *
 * @param {string} committed - The snapshot as committed.
 * @param {string} fresh - The snapshot as it renders now.
 * @returns {string} The report, or the empty string when the two agree.
 */
function describeDrift(committed, fresh) {
  if (committed === fresh) return "";

  const before = statements(committed);
  const after = statements(fresh);
  const gained = after.filter((statement) => !before.includes(statement));
  const lost = before.filter((statement) => !after.includes(statement));

  if (gained.length === 0 && lost.length === 0) {
    return "  the statements are unchanged; only the rendering around them moved.";
  }
  return [
    ...lost.map((statement) => `  - ${statement};`),
    ...gained.map((statement) => `  + ${statement};`),
  ].join("\n");
}

/**
 * Compare the committed snapshot against a fresh rendering, or write it.
 *
 * @param {{sql: string}} plan - A plan taken against an empty database.
 * @param {boolean} write - Whether to save the rendering rather than compare it.
 * @returns {number} The exit code.
 */
function checkSnapshot(plan, write) {
  const fresh = render(plan);
  if (write) {
    writeFileSync(SNAPSHOT_PATH, fresh);
    console.log(`${SNAPSHOT_FILENAME} written`);
    return 0;
  }

  let committed;
  try {
    committed = readFileSync(SNAPSHOT_PATH, "utf8");
  } catch {
    console.error(`${SNAPSHOT_FILENAME} is missing — run this with --write to create it.`);
    return 1;
  }

  const drift = describeDrift(committed, fresh);
  if (!drift) {
    console.log(`${SNAPSHOT_FILENAME} is current`);
    return 0;
  }

  console.error(`${SNAPSHOT_FILENAME} no longer describes what the installed BetterAuth expects:

${drift}

Regenerate the snapshot and write a new Flyway migration applying the difference:

  ouroboros-db/scripts/betterauth-schema.mjs --write
  # then add ouroboros-db/migrations/V###__<what_changed>.sql

Flyway owns every statement that reaches a database (decision A3), so the migration is
the fix — the snapshot alone changes nothing and the library must never apply it itself.`);
  return 1;
}

/**
 * Assert the applied schema holds everything the library expects.
 *
 * @param {{sql: string, created: string[], added: string[]}} plan - A plan taken against
 *   a migrated database.
 * @returns {number} The exit code.
 */
function checkApplied(plan) {
  if (!plan.sql) {
    console.log("the applied schema holds everything BetterAuth expects");
    return 0;
  }

  const missing = [...plan.created.map((t) => `table ${t}`), ...plan.added].join(", ");
  console.error(`the applied schema is missing what the installed BetterAuth expects: ${missing}

${plan.sql}

Write a new Flyway migration in ouroboros-db/migrations/ applying that DDL, adapted to
this project's conventions — the statements above are the library's own spelling and name
no schema. Flyway owns every statement that reaches a database (decision A3), so the
library must never be allowed to apply this itself.`);
  return 1;
}

/**
 * Run the verb.
 *
 * @param {string[]} argv - Command-line arguments.
 * @returns {Promise<number>} The exit code: `0` the check passed, `1` it failed naming
 *   the fix, `2` it could not run.
 */
export async function main(argv) {
  const mode = argv.find((argument) => argument.startsWith("--"));
  if (!mode || mode === "--help" || mode === "-h") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("//"))
      .map((line) => line.slice(3))
      .join("\n"));
    return mode ? 0 : 2;
  }
  if (!["--check", "--write", "--applied"].includes(mode)) {
    console.error(`betterauth-schema: unknown argument: ${mode}`);
    return 2;
  }

  let auth;
  try {
    auth = loadAuthOptions();
  } catch (error) {
    console.error(`betterauth-schema: ${error.message}`);
    return 2;
  }

  try {
    const where = describeDatabase(auth.options);
    const plan = await planSchema(auth.options);
    const wanted = mode === "--applied" ? "migrated" : "empty";
    const wrong = describeWrongDatabase(wanted, plan, where);
    if (wrong) {
      console.error(`betterauth-schema: ${wrong}`);
      return 2;
    }
    console.log(`betterauth-schema: read ${where}`);
    return mode === "--applied" ? checkApplied(plan) : checkSnapshot(plan, mode === "--write");
  } catch (error) {
    console.error(`betterauth-schema: could not read the schema: ${error.message}`);
    return 2;
  } finally {
    await auth.close();
  }
}

// The pool keeps the event loop alive even once it is ended, so the exit is explicit.
process.exit(await main(process.argv.slice(2)));
