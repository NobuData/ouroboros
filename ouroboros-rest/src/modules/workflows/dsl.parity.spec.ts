/**
 * The parity suite — this service's half of the issue's *CI parity test*
 * ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * `schemas/workflow-dsl/fixtures/expected.json` records one case per rule and the verdict
 * every validator of this language has to produce for it. This file asserts that the zod
 * validator produces it; `ouroboros-engine/tests/test_workflows_parity.py` asserts the same
 * of the pydantic one, against the same file. Neither module imports the other and no third
 * process compares two outputs — a rule added to one and forgotten in the other is simply a
 * red check in the half that forgot it.
 *
 * The recording is the contract, so this suite also asserts things *about the recording*:
 * that every fixture on disk is in it, that every code the validator can emit is exercised
 * by it, and that it holds no case naming a file that is not there. A golden file that has
 * quietly stopped covering a rule is a golden file that passes everything.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { DslDiagnostic } from "./dsl.errors";
import { DslErrorCode, DslWarningCode } from "./dsl.errors";
import type { ExpectedCase, ExpectedDiagnostic } from "./dsl.golden.fixture";
import { FIXTURES_DIR, readExpectedCases, readFixture } from "./dsl.golden.fixture";
import type { DslCatalogue } from "./dsl.references";
import { validateWorkflowDocument } from "./dsl.validator";

const CASES = readExpectedCases();

/** A diagnostic reduced to the part the two validators contract over. */
const recorded = (diagnostic: DslDiagnostic): ExpectedDiagnostic => ({
  code: diagnostic.code,
  path: diagnostic.path,
  ...(diagnostic.node === undefined ? {} : { node: diagnostic.node }),
  ...(diagnostic.edge === undefined ? {} : { edge: diagnostic.edge }),
});

/** Run one recorded case through the validator. */
function run(entry: ExpectedCase) {
  const document = readFixture(entry.document);
  const catalogue = entry.catalogue ? (readFixture(entry.catalogue) as DslCatalogue) : undefined;
  return validateWorkflowDocument(document, { catalogue });
}

describe("the golden fixture set", () => {
  it("names every case exactly once", () => {
    const names = CASES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers every fixture document on disk", () => {
    // A fixture nobody asserts against is a fixture that proves nothing, and the way one
    // gets there is being added in the same change as the rule it was written for and
    // forgotten in expected.json.
    const onDisk = ["valid", "invalid"].flatMap((dir) =>
      readdirSync(join(FIXTURES_DIR, dir)).map((file) => `${dir}/${file}`),
    );
    const recordedDocuments = new Set(CASES.map((entry) => entry.document));
    expect([...onDisk].sort()).toEqual([...recordedDocuments].sort());
  });

  it("exercises every code the validator can emit", () => {
    // The other direction of the same argument: a code with no case behind it is a rule
    // whose anchoring nobody has ever looked at.
    const exercised = new Set(
      CASES.flatMap((entry) => [...entry.errors, ...entry.warnings]).map((d) => d.code),
    );
    const declared = [...Object.values(DslErrorCode), ...Object.values(DslWarningCode)];
    expect([...declared].filter((code) => !exercised.has(code))).toEqual([]);
  });

  it("gives every case a sentence saying why it is in the set", () => {
    for (const entry of CASES) {
      expect(entry.about.length).toBeGreaterThan(0);
    }
  });
});

describe.each(CASES.map((entry) => [entry.name, entry] as const))(
  "%s",
  (_name, entry: ExpectedCase) => {
    it(entry.about, () => {
      const verdict = run(entry);
      expect({
        valid: verdict.valid,
        errors: verdict.errors.map(recorded),
        warnings: verdict.warnings.map(recorded),
      }).toEqual({
        valid: entry.valid,
        errors: entry.errors,
        warnings: entry.warnings,
      });
    });

    it("renders a sentence for every diagnostic", () => {
      // The message is not part of the parity contract — each validator writes its own — so
      // this is the assertion that keeps the exemption from becoming an excuse for none.
      const verdict = run(entry);
      for (const diagnostic of [...verdict.errors, ...verdict.warnings]) {
        expect(diagnostic.message.trim().length).toBeGreaterThan(0);
      }
    });
  },
);
