/**
 * `parse(print(doc))` is `doc`, over generated documents — U.4
 * ([#168](https://github.com/NobuData/ouroboros/issues/168)).
 *
 * *"Every graph compiles to this typed DSL and back, losslessly"* is mockup 05's headline, and a
 * golden file can only show that for a document someone wrote down. A printer and a parser can
 * agree on the nine stages of `standard-fix` and still disagree on a predicate with three names or
 * a loop edge two stages upstream. So this suite puts the question to a thousand documents that
 * `code.arbitrary.fixture.ts` generates, each one valid and each one different:
 *
 * * **The parser reads every print back as its document**, under its slug, with no error.
 * * **The compiler agrees.** The graph `code.recover.fixture.ts` recovers from the print with
 *   `ts.createSourceFile` is the document's. That reader shares no code with the parser, so the
 *   two can't agree by accident.
 * * **Printing is deterministic**, and the order a document's keys arrived in doesn't change it.
 * * **The run spans the grammar.** Every feature in `GRAMMAR_FEATURES` is reached: each stage
 *   callee, predicate form, edge spelling, position oddity and hostile string. A generator that
 *   quietly stopped producing one fails the suite, rather than leaving a thinner proof.
 *
 * **The seed is fixed**, so a failure in CI is the same failure on a laptop. fast-check's report
 * names the seed and the shrunk counterexample's path, and passing both back replays it:
 *
 * ```ts
 * fc.assert(property, { seed: 168, path: "412:3:1", endOnFailure: true });
 * ```
 *
 * To look beyond the committed run, change {@link SEED} locally. A counterexample worth keeping
 * belongs among `code.printer.spec.ts`'s constructed documents, where it stays after the seed moves.
 */

import fc from "fast-check";

import { GRAMMAR_FEATURES, grammarFeatures, WORKFLOW_CASE } from "./code.arbitrary.fixture";
import { parseWorkflowCode } from "./code.parser";
import { printWorkflowCode } from "./code.printer";
import { graphOf, recoverGraph, reversedKeys } from "./code.recover.fixture";
import type { WorkflowDocument } from "./dsl.schema";
import { validateWorkflowDocument } from "./dsl.validator";

/** The committed seed: every run checks the same documents. */
const SEED = 168;

/** How many documents each property is held over — the issue's floor. */
const RUNS = 1000;

/** A thousand prints and parses take seconds, which Jest's default five-second timeout isn't for. */
const TIMEOUT_MS = 60_000;

/** The parameters every property here runs under. */
const PARAMETERS = { seed: SEED, numRuns: RUNS } as const;

describe("parse ∘ print over generated documents", () => {
  it(
    `reads each of ${RUNS} prints back as the document it was printed from, across the whole grammar`,
    () => {
      const reached = new Set<string>();

      fc.assert(
        fc.property(WORKFLOW_CASE, ({ slug, document }) => {
          // The generator's promise, checked: the printer's input is a document validation accepts.
          expect(validateWorkflowDocument(document).errors).toEqual([]);

          const { text } = printWorkflowCode(slug, document);

          expect(parseWorkflowCode(text)).toStrictEqual({ slug, document, errors: [] });
          expect(recoverGraph(text)).toStrictEqual(graphOf(document));

          for (const feature of grammarFeatures(document)) reached.add(feature);
        }),
        PARAMETERS,
      );

      expect(GRAMMAR_FEATURES.filter((feature) => !reached.has(feature))).toEqual([]);
      // …and the two vocabularies are one: a feature the run reached that the list doesn't name is a
      // misspelling on one side, which would otherwise pass as coverage.
      expect([...reached].filter((feature) => !GRAMMAR_FEATURES.includes(feature))).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    `prints each of ${RUNS} documents to the same bytes every time, whatever order its keys arrived in`,
    () => {
      fc.assert(
        fc.property(WORKFLOW_CASE, ({ slug, document }) => {
          const printed = printWorkflowCode(slug, document);

          expect(printWorkflowCode(slug, document)).toStrictEqual(printed);
          expect(printWorkflowCode(slug, reversedKeys(document) as WorkflowDocument).text).toBe(
            printed.text,
          );
        }),
        PARAMETERS,
      );
    },
    TIMEOUT_MS,
  );
});
