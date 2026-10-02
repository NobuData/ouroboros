import { join } from "node:path";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";

import {
  fixtureCases,
  readFixture,
  readSchema,
  resolveRef,
  schemaFields,
} from "../../../testing/schema.fixture";
import { compose } from "./composer";
import { SEEDED_CONTEXT, SEEDED_FINDINGS } from "./composer.seed.fixture";
import {
  SYNTHESIS_CONTRACT,
  SYNTHESIZE_FINDINGS_V0_FIELDS,
  synthesisRequest,
  UNAVAILABLE_SYNTHESIS,
  UnavailableSynthesizer,
} from "./synthesis.contract";

/** The published contract. */
const CONTRACT = join(__dirname, "..", "..", "..", "..", "..", "schemas", "synthesize-findings");

const document = readSchema(join(CONTRACT, "v0.json"));

/** The contract compiled, with its request half addressable. */
function compile(): { response: ValidateFunction; request: ValidateFunction } {
  const ajv = new Ajv2020({ strict: true });

  ajv.addSchema(document);

  const response = ajv.getSchema(SYNTHESIS_CONTRACT);
  const request = ajv.getSchema(`${SYNTHESIS_CONTRACT}#/$defs/synthesis_request`);

  if (response === undefined || request === undefined) throw new Error("v0.json did not compile");

  return { response, request };
}

/**
 * `/v0/synthesize-findings` is committed and drift-checked (#513): the TypeScript pin is the
 * document's shape, the fixtures are classified as recorded, and what this service builds and its
 * stub answers validate.
 */
describe("the synthesize-findings contract", () => {
  it("publishes the $id this service names", () => {
    expect(document.$id).toBe(SYNTHESIS_CONTRACT);
  });

  it("pins every field of v0.json with its type — a shape change without this file is red", () => {
    const published = [
      ...schemaFields(document, document, "response"),
      ...schemaFields(
        document,
        resolveRef(document, { $ref: "#/$defs/synthesis_request" }),
        "request",
      ),
    ];

    expect([...SYNTHESIZE_FINDINGS_V0_FIELDS].sort()).toEqual(published.sort());
  });

  it("compiles under strict JSON Schema 2020-12", () => {
    expect(() => compile()).not.toThrow();
  });

  it("classifies every published fixture as expected.json records", () => {
    const validators = compile();
    const { cases, onDisk } = fixtureCases(CONTRACT);

    expect(cases.map((entry) => entry.document).sort()).toEqual(onDisk.sort());

    for (const { document: name, def, valid } of cases) {
      const validate = def === "request" ? validators.request : validators.response;

      expect({ name, valid: validate(readFixture(CONTRACT, name)) }).toEqual({ name, valid });
    }
  });
});

describe("what this service builds", () => {
  it("is a valid request for the seeded run's findings and composed suggestions", () => {
    const { request } = compile();
    const { suggestions } = compose(SEEDED_FINDINGS, SEEDED_CONTEXT);
    const body = synthesisRequest(
      { id: "5eed0065-0000-4000-8000-000000000002", repo_ref: "acme-robotics/helios-firmware" },
      SEEDED_CONTEXT.window,
      SEEDED_FINDINGS,
      suggestions.map((suggestion, index) => ({
        ...suggestion,
        identityKey: `${suggestion.kind}:${index.toString(16).padStart(64, "0")}`,
      })),
    );

    expect(request(body)).toBe(true);
    expect(request.errors ?? null).toBeNull();
  });

  it("answers the contract's empty shape until BX.1 — by design", async () => {
    const { response } = compile();
    const answer = await new UnavailableSynthesizer().synthesize();

    expect(answer).toEqual(UNAVAILABLE_SYNTHESIS);
    expect(response(answer)).toBe(true);
  });
});
