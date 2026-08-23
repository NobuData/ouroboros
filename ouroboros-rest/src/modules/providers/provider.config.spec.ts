import { CARD_SHAPES } from "./card.shapes.fixture";
import {
  BASE_URL_FIELD,
  PLACEHOLDER_ANNOTATION,
  PROVIDER_CONFIG_DIALECT,
  SECRET_ANNOTATION,
  configSchemaViolations,
  type ProviderConfigSchema,
} from "./provider.config";

/**
 * The dialect, as the gate every adapter's schema passes through.
 *
 * The suite is mostly negative, and that is the point: `configSchemaViolations` exists so that
 * `provider.forms.ts` can be a total function, which is only true if every shape the renderer
 * cannot draw is refused *here*. So each rule gets a schema that breaks exactly it.
 *
 * The positive case is not a hand-written schema but mockup 07's five, from
 * `card.shapes.fixture.ts` — the dialect is only worth having if the page's own cards fit in it.
 */

/** A schema that is correct in every way, to be broken one field at a time. */
function wellFormed(): ProviderConfigSchema {
  return {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect a provider",
    properties: {
      [BASE_URL_FIELD]: { type: "string", title: "Base URL", format: "uri", minLength: 1 },
      apiKey: { type: "string", title: "API key", [SECRET_ANNOTATION]: true },
    },
    required: [BASE_URL_FIELD],
    additionalProperties: false,
  };
}

/**
 * The same schema with one part replaced.
 *
 * Typed loosely on purpose: every case below is a schema somebody wrote *wrong*, which by
 * definition is a value the interface would have refused.
 *
 * @param overrides - What to change.
 * @returns The broken schema.
 */
function broken(overrides: Record<string, unknown>): unknown {
  return { ...wellFormed(), ...overrides };
}

describe("configSchemaViolations", () => {
  it("accepts a well-formed schema", () => {
    expect(configSchemaViolations(wellFormed())).toEqual([]);
  });

  it.each(CARD_SHAPES.map((shape) => [shape.kind, shape.schema] as const))(
    "accepts the %s card's schema",
    (_kind, schema) => {
      // The dialect has to be able to express mockup 07's page. If one of the five cards did not
      // fit, the dialect would be the thing that was wrong.
      expect(configSchemaViolations(schema)).toEqual([]);
    },
  );

  it.each<[string, unknown]>([
    ["null", null],
    ["an array", []],
    ["a string", "not a schema"],
  ])("refuses %s outright", (_description, candidate) => {
    expect(configSchemaViolations(candidate)).toEqual(["schema must be an object"]);
  });

  it("requires the dialect to be declared", () => {
    expect(
      configSchemaViolations(broken({ $schema: "http://json-schema.org/draft-07/schema#" })),
    ).toContain(`$schema must be "${PROVIDER_CONFIG_DIALECT}"`);
  });

  it("requires an object type and a title", () => {
    const violations = configSchemaViolations(broken({ type: "array", title: "" }));

    expect(violations).toContain('type must be "object"');
    expect(violations).toContain("title must be a non-empty string");
  });

  it("requires additionalProperties to be closed", () => {
    // An undeclared field is one nothing validates and nothing renders. Refusing it is what
    // lets AE.5 run a submitted form back through the schema and be told about a typo.
    expect(configSchemaViolations(broken({ additionalProperties: true }))).toContain(
      "additionalProperties must be false",
    );
  });

  it("requires at least one field", () => {
    expect(configSchemaViolations(broken({ properties: {}, required: [] }))).toContain(
      "properties must declare at least one field",
    );
  });

  it("stops at a properties that is not an object", () => {
    // Everything after this reads the properties' own structure, so continuing would report a
    // cascade of consequences instead of the cause.
    expect(configSchemaViolations(broken({ properties: null }))).toEqual([
      "properties must be an object",
    ]);
  });

  it("requires every required name to be a declared field", () => {
    expect(configSchemaViolations(broken({ required: ["baseUrl", "region"] }))).toContain(
      "required names region, which is not a declared property",
    );
  });

  it("requires required to be an array", () => {
    expect(configSchemaViolations(broken({ required: "baseUrl" }))).toContain(
      "required must be an array",
    );
  });

  it("allows at most one field routed to the vault", () => {
    const violations = configSchemaViolations(
      broken({
        properties: {
          apiKey: { type: "string", title: "API key", [SECRET_ANNOTATION]: true },
          token: { type: "string", title: "Token", [SECRET_ANNOTATION]: true },
        },
        required: [],
      }),
    );

    expect(violations).toContain(
      `at most one field may be marked ${SECRET_ANNOTATION}; found apiKey, token`,
    );
  });

  it("refuses a default on the field routed to the vault", () => {
    // A default is what the form starts the input at. A default credential is a credential
    // written into a schema every client of the add-form can read.
    const violations = configSchemaViolations(
      broken({
        properties: {
          apiKey: {
            type: "string",
            title: "API key",
            [SECRET_ANNOTATION]: true,
            default: "sk-ant-api03-real",
          },
        },
        required: [],
      }),
    );

    expect(violations).toContain(
      `field "apiKey": a ${SECRET_ANNOTATION} field must not declare a default`,
    );
  });
});

describe("field rules", () => {
  /**
   * The well-formed schema with one field replaced.
   *
   * @param field - Whatever the case wants to declare for `probe`.
   * @returns The violations reported for it.
   */
  function violationsFor(field: unknown): string[] {
    return configSchemaViolations({
      ...wellFormed(),
      properties: { probe: field },
      required: [],
    });
  }

  it("names the field in every sentence", () => {
    // A report saying "format must be uri" with no field name is a report somebody has to go
    // looking with.
    for (const violation of violationsFor({ type: "number" })) {
      expect(violation.startsWith('field "probe":')).toBe(true);
    }
  });

  it.each<[string, unknown, string]>([
    ["a field that is not an object", "String!", 'field "probe": must be an object'],
    // `properties: { probe: null }` is a shape the compiler never stopped anybody writing, and
    // reading an annotation off it would crash the check that exists to report it.
    ["a null field", null, 'field "probe": must be an object'],
    [
      "a non-string type",
      { type: "number", title: "Probe" },
      'field "probe": type must be "string"',
    ],
    ["a missing title", { type: "string" }, 'field "probe": title must be a non-empty string'],
    [
      "an unknown format",
      { type: "string", title: "Probe", format: "email" },
      'field "probe": format, when present, must be "uri"',
    ],
    [
      "an empty enum",
      { type: "string", title: "Probe", enum: [] },
      'field "probe": enum, when present, must be a non-empty array',
    ],
    [
      "a secret annotation that is not true",
      { type: "string", title: "Probe", [SECRET_ANNOTATION]: "yes" },
      `field "probe": ${SECRET_ANNOTATION}, when present, must be true`,
    ],
  ])("refuses %s", (_description, field, expected) => {
    expect(violationsFor(field)).toContain(expected);
  });

  it.each(["$ref", "oneOf", "anyOf", "allOf", "not", "if", "properties", "items"])(
    "refuses the composition keyword %s",
    (keyword) => {
      // Every one of these is a shape the renderer would need a case for, which is how a
      // "no special-casing" renderer acquires special cases one keyword at a time.
      expect(violationsFor({ type: "string", title: "Probe", [keyword]: {} })).toContain(
        `field "probe": the dialect has no ${keyword} — see provider.config.ts`,
      );
    },
  );

  it("accepts every keyword the dialect does define", () => {
    expect(
      violationsFor({
        type: "string",
        title: "Region",
        description: "Which regional endpoint to use.",
        format: "uri",
        default: "https://api.example/v1",
        enum: ["https://api.example/v1", "https://eu.api.example/v1"],
        minLength: 1,
        maxLength: 200,
        pattern: "^https://",
        [PLACEHOLDER_ANNOTATION]: "https://api.example/v1",
      }),
    ).toEqual([]);
  });

  it("reports every problem in one pass", () => {
    // Five things wrong is five sentences, not five edit-and-rerun cycles.
    expect(violationsFor({ type: "number", format: "email", enum: [], $ref: "#/x" }).length).toBe(
      5,
    );
  });
});
