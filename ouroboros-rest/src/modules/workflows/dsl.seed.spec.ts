/**
 * The development seed's workflow definitions, held to this validator
 * ([#136](https://github.com/NobuData/ouroboros/issues/136)).
 *
 * `ouroboros-db/migrations/R__dev_seed_workflows.sql` writes mockup 04's studio into a
 * development database: five workflows, `standard-fix`'s twelve-node canvas at v14, and the
 * six-node predecessor its thirteen earlier versions carry. Those definitions are **rows**
 * once the seed has run, and `workflow_versions.definition` is CHECKed to be a jsonb object
 * and no further — so nothing in the database can tell whether what the studio is about to
 * open is a document this service can read.
 *
 * That is what this file is for. It reads the migration, lifts every definition out of it,
 * and runs the validator over each one. Its acceptance criterion — *"every seeded definition
 * validates against the committed DSL schema"* — is therefore checked against the validator
 * that **implements** that schema rather than against a second copy of it, and the rules JSON
 * Schema cannot state (one trigger, somewhere to end, every stage reachable) are checked with
 * it for free.
 *
 * **No catalogue is supplied**, which is decision **P7** taken at its word: a reference is a
 * validated string, what exists is the caller's to know, and the vocabulary these documents
 * draw on — `pool-a`, the `docs` task kind, `zephyr-conventions` — is the development
 * workspace's rather than this suite's. So the reference stage runs and reports nothing, and
 * the assertion that `warnings` is empty is about the other two stages not quietly warning.
 *
 * **Why it lives here and not in `ouroboros-db`.** That module is SQL and Flyway
 * configuration; it declares no dependencies and has no validator to run. The grammar has one
 * owner and this is it, so the choice is between asserting the seeded documents here or
 * re-implementing the grammar there — and a second implementation of the rules is the thing
 * decision **P3** exists to prevent. `src/testing/migration.fixture.ts` already resolves
 * `ouroboros-db` from `__dirname` for the integration harness; this does the same, and reads
 * one file.
 *
 * The complement is `ouroboros-db/tests/seed.sql`, which asserts what the rows say once a
 * PostgreSQL holds them — the canvas node for node against the mockup, the rail's captions,
 * and a dry run of the seeded `#485`. Nothing here needs a database.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readFixture } from "./dsl.golden.fixture";
import { validateWorkflowDocument } from "./dsl.validator";

/**
 * The seed migration, read from the sibling module.
 *
 * Resolved from `__dirname` rather than from the working directory, for
 * `migration.fixture.ts`' reason: `yarn test` runs from `ouroboros-rest/` and `turbo run test`
 * from the repository root, and a relative path would find the file under exactly one of them.
 */
const SEED_PATH = resolve(
  __dirname,
  "../../../../ouroboros-db/migrations/R__dev_seed_workflows.sql",
);

/**
 * The dollar-quoted tag each document is written under, and what it is.
 *
 * Named rather than discovered, so that a document *removed* from the seed fails here too — a
 * scan for whatever happens to be in the file would quietly assert nothing about it.
 */
const DOCUMENT_TAGS = [
  ["standard_fix_v14", "mockup 04's canvas, and the version standard-fix runs"],
  ["standard_fix_v1", "the six-node predecessor its first thirteen versions carry"],
  ["feature_loop_v1", "feature-loop, the rail's 7 stages"],
  ["deps_refresh_v1", "deps-refresh, the rail's one needs-review loop"],
  ["docs_loop_v1", "docs-loop, the rail's shortest"],
  ["hotfix_p0_v1", "hotfix-p0, the paused loop behind the rail's err-dot"],
] as const;

/** The seed's text, read once. */
const seed = readFileSync(SEED_PATH, "utf8");

/**
 * Every document written under one dollar-quoted tag, parsed.
 *
 * A tag opens and closes each block, so the odd-indexed pieces of a split on it are the
 * bodies. All of them are returned rather than the first: a tag used twice — the canvas was,
 * before the migration factored it into a CTE — must not be able to drift against itself.
 *
 * @param tag - The tag, without its dollar signs.
 * @returns One parsed document per block, in file order.
 * @throws {SyntaxError} When a block is not JSON, which is the failure this spec exists to
 *   catch and is more useful raised at the file than reported as an invalid document.
 */
function documentsFor(tag: string): unknown[] {
  const pieces = seed.split(`$${tag}$`);
  const bodies: string[] = [];
  for (let index = 1; index < pieces.length; index += 2) bodies.push(pieces[index]);

  return bodies.map((body) => JSON.parse(body) as unknown);
}

describe("the development seed's workflow definitions", () => {
  it("names the migration this spec reads", () => {
    expect(seed).toContain("R__dev_seed_workflows.sql");
  });

  describe.each(DOCUMENT_TAGS)("%s — %s", (tag) => {
    const documents = documentsFor(tag);

    it("is written in the seed exactly once, or identically each time", () => {
      expect(documents.length).toBeGreaterThan(0);
      for (const document of documents.slice(1)) {
        expect(document).toStrictEqual(documents[0]);
      }
    });

    it("is a document this service accepts — schema and structure both", () => {
      const verdict = validateWorkflowDocument(documents[0]);

      // The errors before the boolean: a failure that prints `false` is one somebody has to
      // go and reproduce, and a failure that prints the diagnostics says which rule broke.
      expect(verdict.errors).toStrictEqual([]);
      expect(verdict.warnings).toStrictEqual([]);
      expect(verdict.valid).toBe(true);
    });
  });

  it("seeds the committed standard-fix fixture as v14, not a copy that has drifted from it", () => {
    // The migration cannot read a file — Flyway applies SQL — so the canvas is written out in
    // it. This is the other half of that trade: edit either one and this fails naming the
    // other. `schemas/workflow-dsl/fixtures/valid/standard-fix.json` is the canvas mockup 04
    // draws, node for node, and #133 froze it as a parity case.
    expect(documentsFor("standard_fix_v14")[0]).toStrictEqual(
      readFixture("valid/standard-fix.json"),
    );
  });
});
