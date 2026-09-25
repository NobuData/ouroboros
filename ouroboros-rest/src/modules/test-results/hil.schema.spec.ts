import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { HIL_RESULTS_SCHEMA } from "./hil.schema";
import { FIXTURE_DIR } from "./test-results.fixture";

/** The repository's published contracts. */
const SCHEMAS = join(__dirname, "..", "..", "..", "..", "schemas", "hil-results");

/**
 * The embedded schema is the published one (#329) — an edit to either alone is red here.
 */
describe("the HIL results schema", () => {
  const published: unknown = JSON.parse(readFileSync(join(SCHEMAS, "v1.json"), "utf8"));

  it("is embedded exactly as published", () => {
    expect(HIL_RESULTS_SCHEMA).toEqual(published);
  });

  it("compiles under strict JSON Schema 2020-12", () => {
    expect(() => new Ajv2020({ strict: true }).compile(HIL_RESULTS_SCHEMA)).not.toThrow();
  });

  it("classifies every published fixture as expected.json records", () => {
    const validate = new Ajv2020({ strict: true }).compile(HIL_RESULTS_SCHEMA);
    const expected = JSON.parse(
      readFileSync(join(SCHEMAS, "fixtures", "expected.json"), "utf8"),
    ) as { cases: { document: string; valid: boolean }[] };
    const onDisk = ["valid", "invalid"].flatMap((dir) =>
      readdirSync(join(SCHEMAS, "fixtures", dir)).map((name) => `${dir}/${name}`),
    );

    expect(expected.cases.map((c) => c.document).sort()).toEqual(onDisk.sort());
    for (const { document, valid } of expected.cases) {
      const doc: unknown = JSON.parse(readFileSync(join(SCHEMAS, "fixtures", document), "utf8"));

      expect({ document, valid: validate(doc) }).toEqual({ document, valid });
    }
  });

  it("accepts the parser's valid fixture and refuses its invalid one", () => {
    const validate = new Ajv2020({ strict: true }).compile(HIL_RESULTS_SCHEMA);
    const read = (name: string): unknown =>
      JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));

    expect(validate(read("hil-valid.json"))).toBe(true);
    expect(validate(read("hil-invalid.json"))).toBe(false);
  });
});
