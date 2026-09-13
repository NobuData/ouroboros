/**
 * The development seed's workflows, printed — U.1
 * ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * The issue's third acceptance criterion is that all five seeded workflows print, and re-parse
 * cleanly — the full parse is #166's, verified jointly — so this reads every definition out of
 * `R__dev_seed_workflows.sql` (through `dsl.seed.fixture.ts`, which `dsl.seed.spec.ts` shares)
 * and holds each print to what the compiler reads back: no syntax error, byte-identical on
 * every print, and the same graph — positions, edge kinds, labels and order — as the document.
 *
 * `standard-fix` v14 is also the draft the code view opens (the seed copies it), so its print
 * is held to the committed golden file as well.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { printWorkflowCode } from "./code.printer";
import {
  graphOf,
  recoverGraph,
  recoverWorkflowCode,
  syntaxErrors,
  validDocument,
} from "./code.recover.fixture";
import { FIXTURES_DIR } from "./dsl.golden.fixture";
import { SEED_DOCUMENT_TAGS, seededDocuments } from "./dsl.seed.fixture";

describe.each(SEED_DOCUMENT_TAGS)("%s — %s", (tag, _about, slug) => {
  const document = validDocument(seededDocuments(tag)[0]);
  const printed = printWorkflowCode(slug, document);

  it("prints as TypeScript the compiler reads without a syntax error", () => {
    expect(syntaxErrors(printed.text)).toEqual([]);
  });

  it("prints byte-identical output every time", () => {
    expect(printWorkflowCode(slug, document)).toStrictEqual(printed);
  });

  it("carries its positions and its edges' kinds, conditions, labels and order", () => {
    expect(recoverGraph(printed.text)).toStrictEqual(graphOf(document));
  });

  it("names its workflow and carries its trigger", () => {
    const recovered = recoverWorkflowCode(printed.text);

    expect(recovered.slug).toBe(slug);
    expect(recovered.trigger).toStrictEqual(document.trigger);
  });
});

it("prints every one of the five workflows the seed creates", () => {
  expect(new Set(SEED_DOCUMENT_TAGS.map(([, , slug]) => slug))).toEqual(
    new Set(["standard-fix", "feature-loop", "deps-refresh", "docs-loop", "hotfix-p0"]),
  );
});

it("prints standard-fix v14 — the draft the code view opens — as the committed golden", () => {
  const golden = readFileSync(join(FIXTURES_DIR, "code", "standard-fix.loop.ts"), "utf8");
  const document = validDocument(seededDocuments("standard_fix_v14")[0]);

  expect(printWorkflowCode("standard-fix", document).text).toBe(golden);
});
