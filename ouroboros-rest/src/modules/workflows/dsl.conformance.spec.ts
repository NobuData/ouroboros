/**
 * The conformance suite — *one schema*, the other half of the issue's headline
 * ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * `dsl.parity.spec.ts` holds the two validators to one recorded verdict. This file holds
 * *this* validator to the published contract: it compiles
 * [`schemas/workflow-dsl/v1.json`](../../../../schemas/workflow-dsl/v1.json) with ajv and
 * asserts that ajv and zod classify every golden document the same way. `ouroboros-engine`
 * runs the same comparison with `jsonschema` against its pydantic models, so the schema an
 * outside reader is handed is the schema both services actually enforce.
 *
 * **What is compared, and what is deliberately not.** The verdict compared is the schema
 * stage's: valid or invalid against `v1.json`. The structural rules are *not* in the schema
 * and are not meant to be — JSON Schema describes values, and "every node is reachable from
 * the trigger" is not a property of a value — so a document that is schema-clean and
 * structurally broken is *expected* to be ajv-valid, and the fixture set holds several. The
 * second assertion is about anchoring: every pointer zod reports has to be one ajv reports
 * an error at or under, which catches the drift that matters — a constraint one of them has
 * and the other does not.
 *
 * ajv is asked for *all* errors and is not asked to agree on their number. A conditional
 * schema reports the `if` it failed as well as the failure inside it, and a `oneOf` reports
 * every branch it tried; those are artefacts of how a keyword vocabulary composes, not
 * differences of opinion about the document. ajv and `jsonschema` differ in how much of that
 * they surface — ajv flattens a `oneOf`'s branch failures into the error list and `jsonschema`
 * nests them — so the comparison is written to be indifferent to it.
 */

import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020";

import { SCHEMA_STAGE_CODES } from "./dsl.errors";
import { readExpectedCases, readFixture, readSchema } from "./dsl.golden.fixture";
import { validateWorkflowDocument } from "./dsl.validator";

/**
 * Keywords whose errors restate the dispatch rather than describe the value.
 *
 * `if` and `allOf` are the scaffolding the per-type and per-kind config schemas are selected
 * with, so their failures say *this branch was chosen and it did not hold* — which the failure
 * inside the branch already says, at the value. `oneOf` is deliberately **not** here: the DSL
 * uses it once, for a model stage's routing, and there the failure genuinely is about the
 * object — *exactly one of these two* is a property of `routing` and of nothing inside it.
 */
const COMPOSITION_KEYWORDS = new Set(["if", "allOf"]);

/**
 * An ajv error's location as an RFC 6901 pointer to the *value* it is about.
 *
 * ajv anchors `required` and `additionalProperties` at the parent and names the property in
 * `params`; the DSL's diagnostics anchor at the property itself, because that is what a
 * canvas selects. Normalising here is what lets the two be compared at all.
 *
 * @param error - One ajv error.
 * @returns The pointer.
 */
function normalise(error: ErrorObject): string {
  if (error.keyword === "required") {
    return `${error.instancePath}/${String(error.params.missingProperty)}`;
  }
  if (error.keyword === "additionalProperties" || error.keyword === "unevaluatedProperties") {
    return `${error.instancePath}/${String(
      error.params.additionalProperty ?? error.params.unevaluatedProperty,
    )}`;
  }
  return error.instancePath;
}

let validate: ValidateFunction;

beforeAll(() => {
  // `strict: true` is the point of compiling it here at all: ajv's strict mode refuses a
  // schema with an unknown keyword, an ignored one, or a `$ref` that resolves to nothing —
  // the three ways a hand-written schema is subtly not the document its author read.
  // No `ajv-formats`: the DSL uses no `format` keyword. Every constraint it has is one
  // ajv implements itself, so a format vocabulary would be a dependency proving nothing.
  validate = new Ajv2020({ allErrors: true, strict: true }).compile(readSchema());
});

describe("the published JSON Schema", () => {
  it("is a JSON Schema 2020-12 document ajv compiles in strict mode", () => {
    expect(typeof validate).toBe("function");
  });

  it("carries the `$id` the DSL is published under", () => {
    // The `$id` is the name every consumer quotes; changing it is changing the contract's
    // identity, which is a new file rather than an edit to this one.
    expect(readSchema().$id).toBe("https://ouroboros.build/schemas/workflow-dsl/v1.json");
    expect(readSchema().$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });
});

describe.each(readExpectedCases().map((entry) => [entry.name, entry] as const))(
  "%s",
  (_name, entry) => {
    it("is classified the same way by ajv and by zod", () => {
      const document = readFixture(entry.document);
      const verdict = validateWorkflowDocument(document);

      // The schema stage's verdict, isolated from the structural one: a document whose only
      // failures are structural is schema-clean, and the schema does not claim otherwise.
      const schemaClean = verdict.errors.every((error) => !SCHEMA_STAGE_CODES.has(error.code));

      expect(validate(document)).toBe(schemaClean);
    });

    it("anchors what zod reports where ajv reports it too", () => {
      const document = readFixture(entry.document);
      if (validate(document)) return;

      const ajvPointers = (validate.errors ?? [])
        .filter((error) => !COMPOSITION_KEYWORDS.has(error.keyword))
        .map(normalise);
      const zodPointers = validateWorkflowDocument(document)
        .errors.filter((error) => SCHEMA_STAGE_CODES.has(error.code))
        .map((error) => error.path);

      for (const pointer of zodPointers) {
        expect(
          ajvPointers.some(
            (candidate) =>
              candidate === pointer ||
              candidate.startsWith(`${pointer}/`) ||
              pointer.startsWith(`${candidate}/`),
          ),
        ).toBe(true);
      }
    });
  },
);
