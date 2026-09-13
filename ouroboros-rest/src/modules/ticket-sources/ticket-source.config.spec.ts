import { PROVIDER_CONFIG_DIALECT, SECRET_ANNOTATION } from "../providers/provider.config";
import { GITHUB_SOURCE_SCHEMA } from "./providers/github.config";
import {
  isListField,
  partitionSourceSubmission,
  sourceConfigViolations,
  sourceSchemaViolations,
  sourceSecretField,
  storedSourceSchema,
  toSourceFormFields,
  type TicketSourceConfigSchema,
} from "./ticket-source.config";
import { FIXTURE_SCHEMA } from "./ticket-source.fixture";

/**
 * The ticket-source config dialect ([#141](https://github.com/NobuData/ouroboros/issues/141)):
 * the model-provider dialect's rules, delegated, plus the list field this module adds.
 *
 * Three things are held here. The **gate** admits the two schemas that exist — the GitHub
 * provider's and the fixture's, which between them use every widget — and refuses a list field
 * that is wrong in each of the ways a list can be. The **derivation** turns a schema into the
 * ordered field list the settings form draws, with a list's item rules where the form looks for
 * them. The **submission rules** judge what a form sent, one entry of a list at a time through
 * the same string rules the model-provider dialect uses, and split the credential off before
 * anything is stored.
 */

/** A schema with one list field and one string field, to vary. */
function schemaWith(
  properties: TicketSourceConfigSchema["properties"],
  required: readonly string[] = Object.keys(properties),
): TicketSourceConfigSchema {
  return {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect a test tracker",
    properties,
    required,
    additionalProperties: false,
  };
}

describe("the gate", () => {
  it("admits the fixture schema, which uses every widget the dialect has", () => {
    expect(sourceSchemaViolations(FIXTURE_SCHEMA)).toStrictEqual([]);
  });

  it("admits the GitHub provider's schema, which is the one that ships", () => {
    // The acceptance criterion's other half: the form that renders from the fixture's schema
    // is the form that renders from GitHub's, so the two must pass the same gate.
    expect(sourceSchemaViolations(GITHUB_SOURCE_SCHEMA)).toStrictEqual([]);
  });

  it("refuses what is not an object, in the string gate's own words", () => {
    expect(sourceSchemaViolations(null)).toStrictEqual(["schema must be an object"]);
    expect(sourceSchemaViolations("schema")).toStrictEqual(["schema must be an object"]);
  });

  it("delegates the string fields to the model-provider dialect's rules", () => {
    // `$schema`, `type`, `title`, `additionalProperties` and every string-field keyword are
    // that module's to judge; a violation there is reported in its words, not a paraphrase.
    const violations = sourceSchemaViolations({
      ...FIXTURE_SCHEMA,
      $schema: "https://json-schema.org/draft-07/schema",
      properties: { ...FIXTURE_SCHEMA.properties, project: { type: "number", title: "Key" } },
    });

    expect(violations).toContain(`$schema must be "${PROVIDER_CONFIG_DIALECT}"`);
    expect(violations).toContain('field "project": type must be "string"');
  });

  it("does not mistake a schema of nothing but lists for a schema of nothing", () => {
    // The string gate is handed the string fields only, and would otherwise complain that
    // there are none; a list-only schema is a legitimate schema.
    const schema = schemaWith({
      boards: { type: "array", title: "Boards", items: { type: "string" } },
    });

    expect(sourceSchemaViolations(schema)).toStrictEqual([]);
  });

  it("still refuses a schema that declares no field at all", () => {
    expect(sourceSchemaViolations(schemaWith({}))).toContain(
      "properties must declare at least one field",
    );
  });

  it("holds a required list field to be declared, and accepts one that is", () => {
    // The string gate cannot see a list, so a `required` naming one would be reported as
    // undeclared unless the check was made over the whole property set — which it is.
    const declared = schemaWith(
      { boards: { type: "array", title: "Boards", items: { type: "string" } } },
      ["boards"],
    );
    const undeclared = schemaWith(
      { boards: { type: "array", title: "Boards", items: { type: "string" } } },
      ["boards", "lanes"],
    );

    expect(sourceSchemaViolations(declared)).toStrictEqual([]);
    expect(sourceSchemaViolations(undeclared)).toStrictEqual([
      "required names lanes, which is not a declared property",
    ]);
  });

  it.each([
    ["no title", { type: "array", items: { type: "string" } }, "title must be a non-empty string"],
    ["no items", { type: "array", title: "Boards" }, "items must be an object"],
    [
      "items of the wrong type",
      { type: "array", title: "B", items: { type: "number" } },
      'items.type must be "string"',
    ],
    [
      "a pattern that will not compile",
      { type: "array", title: "B", items: { type: "string", pattern: "(" } },
      "items.pattern must be a regular expression",
    ],
    [
      "a fractional bound",
      { type: "array", title: "B", items: { type: "string" }, minItems: 1.5 },
      "minItems must be a non-negative integer",
    ],
    [
      "a negative item bound",
      { type: "array", title: "B", items: { type: "string", maxLength: -1 } },
      "items.maxLength must be a non-negative integer",
    ],
    [
      "bounds the wrong way round",
      { type: "array", title: "B", items: { type: "string" }, minItems: 5, maxItems: 2 },
      "minItems must not exceed maxItems",
    ],
    [
      "a secret list",
      { type: "array", title: "B", items: { type: "string" }, [SECRET_ANNOTATION]: true },
      `a list field has no ${SECRET_ANNOTATION}`,
    ],
    [
      "a default",
      { type: "array", title: "B", items: { type: "string" }, default: "x" },
      "a list field has no default",
    ],
    [
      "a composition keyword",
      { type: "array", title: "B", items: { type: "string" }, oneOf: [] },
      "a list field has no oneOf",
    ],
  ])("refuses a list field with %s", (_case, field, expected) => {
    const violations = sourceSchemaViolations(
      schemaWith({ boards: field as unknown as TicketSourceConfigSchema["properties"][string] }),
    );

    expect(violations).toContain(`field "boards": ${expected}`);
  });

  it("reports everything wrong at once, so a new provider's author fixes one boot failure", () => {
    const violations = sourceSchemaViolations(
      schemaWith({
        boards: { type: "array", items: { type: "number" } } as never,
        key: { type: "number", title: "" } as never,
      }),
    );

    expect(violations.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the derivation", () => {
  it("draws every field of the fixture schema, in declaration order, with its widget", () => {
    const fields = toSourceFormFields(FIXTURE_SCHEMA);

    expect(fields.map((field) => [field.name, field.widget])).toStrictEqual([
      ["site", "url"],
      ["project", "text"],
      ["region", "select"],
      ["boards", "list"],
      ["apiToken", "secret"],
    ]);
  });

  it("puts a list's item rules where the form looks for a field's rules, and its bounds beside them", () => {
    const boards = toSourceFormFields(FIXTURE_SCHEMA).find((field) => field.name === "boards");

    expect(boards).toStrictEqual({
      name: "boards",
      label: "Boards",
      widget: "list",
      required: true,
      help: "One board per line.",
      placeholder: null,
      defaultValue: null,
      choices: null,
      minLength: 1,
      maxLength: 32,
      pattern: null,
      minItems: 1,
      maxItems: 5,
    });
  });

  it("answers null for a list's bounds on every other widget, so a renderer needs no default", () => {
    for (const field of toSourceFormFields(FIXTURE_SCHEMA)) {
      if (field.widget !== "list") {
        expect(field.minItems).toBeNull();
        expect(field.maxItems).toBeNull();
      }
    }
  });

  it("derives a string field exactly as the model-provider dialect would", () => {
    const region = toSourceFormFields(FIXTURE_SCHEMA).find((field) => field.name === "region");

    expect(region).toMatchObject({
      widget: "select",
      required: false,
      choices: ["eu", "us"],
      defaultValue: "eu",
      help: null,
      placeholder: null,
    });
  });

  it("finds the secret field, and the stored schema is the schema without it", () => {
    expect(sourceSecretField(FIXTURE_SCHEMA)).toBe("apiToken");

    const stored = storedSourceSchema(FIXTURE_SCHEMA);

    expect(Object.keys(stored.properties)).toStrictEqual(["site", "project", "region", "boards"]);
    expect(stored.required).toStrictEqual(["site", "project", "boards"]);
  });

  it("answers a schema with no secret unchanged", () => {
    const schema = schemaWith({ site: { type: "string", title: "Site" } });

    expect(sourceSecretField(schema)).toBeNull();
    expect(storedSourceSchema(schema)).toBe(schema);
  });

  it("tells a list from a string field by its type", () => {
    expect(isListField(FIXTURE_SCHEMA.properties.boards)).toBe(true);
    expect(isListField(FIXTURE_SCHEMA.properties.site)).toBe(false);
  });
});

describe("the submission rules", () => {
  const GOOD = {
    site: "https://tracker.example.test",
    project: "PROJ",
    region: "us",
    boards: ["Board one", "Board two"],
    apiToken: "sk-fixture-token",
  };

  it("accepts a submission the schema describes", () => {
    expect(sourceConfigViolations(FIXTURE_SCHEMA, GOOD)).toStrictEqual({});
  });

  it("refuses a key the schema does not declare rather than dropping it", () => {
    expect(sourceConfigViolations(FIXTURE_SCHEMA, { ...GOOD, colour: "red" })).toStrictEqual({
      colour: ["colour is not a setting this source takes"],
    });
  });

  it("treats absent, an empty string and an empty list as one case: nothing", () => {
    const violations = sourceConfigViolations(FIXTURE_SCHEMA, {
      ...GOOD,
      project: "",
      boards: [],
    });

    expect(violations).toStrictEqual({
      project: ["Project key is required"],
      boards: ["Boards is required"],
    });
    expect(sourceConfigViolations(FIXTURE_SCHEMA, { ...GOOD, region: "" })).toStrictEqual({});
  });

  it("judges a string field by the model-provider dialect's own rules", () => {
    expect(sourceConfigViolations(FIXTURE_SCHEMA, { ...GOOD, project: "lower" })).toStrictEqual({
      project: ["Project key is not in the expected format"],
    });
    expect(sourceConfigViolations(FIXTURE_SCHEMA, { ...GOOD, region: "mars" })).toStrictEqual({
      region: ["Region must be one of eu, us"],
    });
  });

  it("refuses a list where a string was declared, and a string where a list was", () => {
    expect(sourceConfigViolations(FIXTURE_SCHEMA, { ...GOOD, project: ["PROJ"] })).toStrictEqual({
      project: ["Project key must be text"],
    });
    expect(sourceConfigViolations(FIXTURE_SCHEMA, { ...GOOD, boards: "Board one" })).toStrictEqual({
      boards: ["Boards must be a list of entries"],
    });
    expect(sourceConfigViolations(FIXTURE_SCHEMA, { ...GOOD, boards: [1, 2] })).toStrictEqual({
      boards: ["Boards must be a list of entries"],
    });
  });

  it("bounds a list, in the entry's own words", () => {
    expect(
      sourceConfigViolations(FIXTURE_SCHEMA, { ...GOOD, boards: ["a", "b", "c", "d", "e", "f"] }),
    ).toStrictEqual({ boards: ["Boards may hold at most 5 entries"] });

    const one = schemaWith({
      boards: { type: "array", title: "Boards", items: { type: "string" }, minItems: 1 },
    });

    expect(sourceConfigViolations(one, { boards: [""] })).toStrictEqual({});
    expect(
      sourceConfigViolations(
        schemaWith({
          boards: { type: "array", title: "Boards", items: { type: "string" }, minItems: 2 },
        }),
        { boards: ["one"] },
      ),
    ).toStrictEqual({ boards: ["Boards needs at least 2 entries"] });
  });

  it("holds every entry of a list to the item rules, and says each sentence once", () => {
    // Fifty repositories with the same typo are one complaint a person can act on.
    const violations = sourceConfigViolations(FIXTURE_SCHEMA, {
      ...GOOD,
      boards: ["x".repeat(40), "y".repeat(40)],
    });

    expect(violations).toStrictEqual({ boards: ["Boards must be at most 32 characters"] });
  });

  it("holds the GitHub schema's repository list to GitHub's own grammar", () => {
    const violations = sourceConfigViolations(GITHUB_SOURCE_SCHEMA, {
      login: "acme-robotics",
      repos: ["helios-firmware", "..", "acme/helios"],
      token: "ghp_x",
    });

    expect(violations).toStrictEqual({
      repos: ["Repositories is not in the expected format"],
    });
    expect(
      sourceConfigViolations(GITHUB_SOURCE_SCHEMA, {
        login: "acme/robotics",
        repos: [".github"],
        token: "ghp_x",
      }),
    ).toStrictEqual({ login: ["GitHub account is not in the expected format"] });
  });

  it("splits the credential off, and drops what the schema does not declare", () => {
    const parts = partitionSourceSubmission(FIXTURE_SCHEMA, { ...GOOD, colour: "red" });

    expect(parts.config).toStrictEqual({
      site: GOOD.site,
      project: GOOD.project,
      region: GOOD.region,
      boards: GOOD.boards,
    });
    expect(parts.secret).toBe(GOOD.apiToken);
    expect(JSON.stringify(parts.config)).not.toContain(GOOD.apiToken);
  });

  it("reads an empty credential as none, rather than sealing an empty string", () => {
    expect(partitionSourceSubmission(FIXTURE_SCHEMA, { ...GOOD, apiToken: "" }).secret).toBeNull();
    expect(partitionSourceSubmission(storedSourceSchema(FIXTURE_SCHEMA), GOOD).secret).toBeNull();
  });

  it("leaves an untouched optional field out of what is stored", () => {
    const parts = partitionSourceSubmission(FIXTURE_SCHEMA, { ...GOOD, region: "" });

    expect(parts.config).not.toHaveProperty("region");
  });

  it("keeps only the strings of a list, because the validator has already refused the rest", () => {
    const parts = partitionSourceSubmission(FIXTURE_SCHEMA, {
      ...GOOD,
      boards: ["one", 2, "three"],
    });

    expect(parts.config.boards).toStrictEqual(["one", "three"]);
  });
});
