import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from "kysely";

import type { Database } from "../db/schema";
import { scoreStatement } from "./flakes.repository";

/**
 * **No code path writes `quarantined` in the MVP** (AT.3, #331). `quarantined` is storable and
 * inert: activation is AV.3's (#345), with V054's soft-signal semantics. Held three ways — the one
 * statement that writes `flake_scores` is this module's, that statement takes its state from V054's
 * `flake_state_next()` (which keeps a quarantined case quarantined and moves nothing else there) and
 * names no state itself, and no source file assigns the word to a state. `flakes.integration-spec.ts`
 * asserts the behaviour against a real database.
 */

const SRC = join(__dirname, "..", "..");

/**
 * Every non-test TypeScript file under `src/`.
 *
 * @param directory - Where to start.
 * @returns Absolute paths.
 */
function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return sources(path);
    }

    return /\.ts$/.test(entry) && !/\.(spec|integration-spec|fixture)\.ts$/.test(entry)
      ? [path]
      : [];
  });
}

/** A Kysely that compiles and never connects. */
const compiler = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

describe("no code path writes quarantined (#331)", () => {
  it("has exactly one writer of flake_scores, and it is the scorer's repository", () => {
    const writes =
      /insertInto\(\s*"flake_scores"|updateTable\(\s*"flake_scores"|(insert\s+into|update)\s+ouroboros\.flake_scores\b/i;
    const writers = sources(SRC)
      .filter((path) => writes.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(writers).toEqual(["modules/flakes/flakes.repository.ts"]);
  });

  it("takes every state it writes from flake_state_next() and names none itself", () => {
    const { sql: text } = scoreStatement(
      "org",
      1,
      sql`select 'k' as case_key, 'r' as github_repo_id`,
    ).compile(compiler);

    expect(text).toMatch(/ouroboros\.flake_state_next\(/);
    expect(text).toMatch(/\bstate\s*=\s*s\.state\b/);
    // `'healthy'` appears once, as the prior state of a new case when counting changes; no state
    // the statement could write is spelled in it.
    expect(text).not.toMatch(/'(quarantined|watching)'/);
  });

  it("assigns the word to a state nowhere in the service", () => {
    const assigns = /\bstate\b["']?\s*(:|=(?!=))\s*["'`]quarantined/;
    const offenders = sources(SRC)
      .filter((path) => assigns.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });
});
