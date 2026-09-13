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

import { readFixture } from "./dsl.golden.fixture";
import { SEED_DOCUMENT_TAGS, seededDocuments, seedText } from "./dsl.seed.fixture";
import { validateWorkflowDocument } from "./dsl.validator";

describe("the development seed's workflow definitions", () => {
  it("names the migration this spec reads", () => {
    expect(seedText()).toContain("R__dev_seed_workflows.sql");
  });

  describe.each(SEED_DOCUMENT_TAGS)("%s — %s", (tag) => {
    const documents = seededDocuments(tag);

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
    expect(seededDocuments("standard_fix_v14")[0]).toStrictEqual(
      readFixture("valid/standard-fix.json"),
    );
  });
});
