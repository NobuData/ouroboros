/**
 * The development seed's workflow documents, lifted out of the migration — test support shared
 * by `dsl.seed.spec.ts` ([#136](https://github.com/NobuData/ouroboros/issues/136)) and
 * `code.seed.spec.ts` ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * `ouroboros-db/migrations/R__dev_seed_workflows.sql` writes five workflows' definitions into a
 * development database as dollar-quoted JSON. Two suites need those documents as values — the
 * validator's, which checks every one of them is a workflow this service accepts, and the code
 * view's, which prints every one of them — so the reading lives here once rather than twice.
 *
 * **Why it reads the migration rather than a copy.** That module is SQL and Flyway
 * configuration; it declares no dependencies and has no validator to run. Resolving it from
 * `__dirname` is what `src/testing/migration.fixture.ts` already does for the integration
 * harness, for the same reason: `yarn test` runs from `ouroboros-rest/` and `turbo run test`
 * from the repository root, and a relative path would find the file under exactly one of them.
 *
 * **The routing seed's task kinds are read here too** (W.3,
 * [#179](https://github.com/NobuData/ouroboros/issues/179)): the code view checks a workflow's
 * `route.task` names against them, so the suites that pin what a development workspace shows need
 * the matrix `R__dev_seed_routing.sql` writes, not a copy of it.
 *
 * `*.fixture.ts` is left out of the build, so none of this ships.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The seed migration, resolved from this file rather than from the working directory. */
export const SEED_PATH = resolve(
  __dirname,
  "../../../../ouroboros-db/migrations/R__dev_seed_workflows.sql",
);

/** The routing seed migration, which writes the development workspace's task kinds. */
export const ROUTING_SEED_PATH = resolve(
  __dirname,
  "../../../../ouroboros-db/migrations/R__dev_seed_routing.sql",
);

/**
 * The dollar-quoted tag each document is written under, what it is, and the workflow slug it
 * belongs to.
 *
 * Named rather than discovered, so that a document *removed* from the seed fails too — a scan
 * for whatever happens to be in the file would quietly assert nothing about it.
 */
export const SEED_DOCUMENT_TAGS = [
  ["standard_fix_v14", "mockup 04's canvas, and the version standard-fix runs", "standard-fix"],
  ["standard_fix_v1", "the six-node predecessor its first thirteen versions carry", "standard-fix"],
  ["feature_loop_v1", "feature-loop, the rail's 7 stages", "feature-loop"],
  ["deps_refresh_v1", "deps-refresh, the rail's one needs-review loop", "deps-refresh"],
  ["docs_loop_v1", "docs-loop, the rail's shortest", "docs-loop"],
  ["hotfix_p0_v1", "hotfix-p0, the paused loop behind the rail's err-dot", "hotfix-p0"],
] as const;

/** The seed's text, once read. */
let seed: string | undefined;

/**
 * The seed migration's text.
 *
 * @returns The file, read on first use and reused after.
 */
export function seedText(): string {
  seed ??= readFileSync(SEED_PATH, "utf8");
  return seed;
}

/**
 * Every document written under one dollar-quoted tag, parsed.
 *
 * A tag opens and closes each block, so the odd-indexed pieces of a split on it are the
 * bodies. All of them are returned rather than the first: a tag used twice — the canvas was,
 * before the migration factored it into a CTE — must not be able to drift against itself.
 *
 * @param tag - The tag, without its dollar signs.
 * @returns One parsed document per block, in file order.
 * @throws {SyntaxError} When a block is not JSON, which is the failure the seed suites exist to
 *   catch and is more useful raised at the file than reported as an invalid document.
 */
export function seededDocuments(tag: string): unknown[] {
  const pieces = seedText().split(`$${tag}$`);
  const bodies: string[] = [];
  for (let index = 1; index < pieces.length; index += 2) bodies.push(pieces[index]);

  return bodies.map((body) => JSON.parse(body) as unknown);
}

/**
 * The development workspace's task kinds, in routing-matrix order.
 *
 * Read out of the `values` list of `R__dev_seed_routing.sql`'s `insert into ouroboros.task_kinds`,
 * whose rows are `(sort_order, 'name', 'description')`, so a kind added to the seed changes what
 * the suites reading this expect.
 *
 * @returns The names, by `sort_order`.
 * @throws {Error} When the statement, or any row of it, cannot be found — a reshaped seed, which is
 *   more useful raised here than read as a matrix with no kinds.
 */
export function seededTaskKinds(): string[] {
  const sql = readFileSync(ROUTING_SEED_PATH, "utf8");
  const statement =
    /insert into ouroboros\.task_kinds\b[\s\S]*?\) as seed \(sort_order, name, description\)/.exec(
      sql,
    );
  const rows = [...(statement?.[0] ?? "").matchAll(/^\s*\((\d+),\s*'([^']+)',/gm)];

  if (rows.length === 0) {
    throw new Error(
      `No task_kinds rows found in ${ROUTING_SEED_PATH}; has the seed been reshaped?`,
    );
  }

  return rows
    .map((row) => ({ order: Number(row[1]), name: row[2] }))
    .sort((a, b) => a.order - b.order)
    .map((row) => row.name);
}
