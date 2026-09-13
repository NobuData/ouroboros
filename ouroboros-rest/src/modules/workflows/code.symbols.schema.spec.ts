import { DslSchemaError, readPublishedDslSchema, type JsonSchema } from "./catalog.schema";
import {
  asListed,
  describe as describeLocation,
  enumeration,
  locate,
  referenced,
  spelledValues,
  spellType,
  typeName,
} from "./code.symbols.schema";

/**
 * Reading a schema location for the code view's symbol table — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * Each question is asked of a small schema written to have exactly the case in it, and the ones
 * the symbol table depends on are asked again of the committed `v1.json`.
 */

/** A schema with one of everything the reader distinguishes. */
const SCHEMA: JsonSchema = {
  $id: "https://example.test/schema.json",
  description: "The root.",
  properties: {
    "a/b": { type: "string" },
    "t~n": { type: "integer" },
  },
  $defs: {
    effort: { description: "How much work.", enum: ["s", "m"] },
    reference: { description: "A name.", type: "string" },
    list: { type: "array", items: { $ref: "#/$defs/effort" } },
    inline: { type: "array", items: { enum: ["x", "y"] } },
    bare: { type: "array" },
    documented: { description: "Its own words.", $ref: "#/$defs/reference" },
    undocumented: { $ref: "#/$defs/reference" },
    object: { type: "object", properties: {} },
    loopA: { $ref: "#/$defs/loopB" },
    loopB: { $ref: "#/$defs/loopA" },
    elsewhere: { $ref: "https://example.test/other.json#/x" },
    dangling: { $ref: "#/$defs/nothing" },
    branches: { allOf: [{ type: "boolean" }] },
  },
};

describe("locate", () => {
  it("answers the root for the empty pointer", () => {
    expect(locate(SCHEMA, "")).toBe(SCHEMA);
  });

  it("walks objects and arrays", () => {
    expect(locate(SCHEMA, "/$defs/branches/allOf/0")).toEqual({ type: "boolean" });
  });

  it("unescapes `~1` and `~0`", () => {
    expect(locate(SCHEMA, "/properties/a~1b")).toEqual({ type: "string" });
    expect(locate(SCHEMA, "/properties/t~0n")).toEqual({ type: "integer" });
  });

  it.each([
    ["a location the schema does not have", "/$defs/missing"],
    ["a value that is not a subschema", "/$defs/effort/enum/0"],
    ["an inherited property name", "/$defs/toString"],
    ["text that is not a pointer", "$defs/effort"],
  ])("refuses %s", (_case, pointer) => {
    expect(() => locate(SCHEMA, pointer)).toThrow(DslSchemaError);
  });
});

describe("referenced", () => {
  it("answers nothing for a subschema without `$ref`", () => {
    expect(referenced(SCHEMA, locate(SCHEMA, "/$defs/effort"))).toBeUndefined();
  });

  it("names the definition a local `$ref` reaches", () => {
    const target = referenced(SCHEMA, locate(SCHEMA, "/$defs/undocumented"));

    expect(target?.name).toBe("reference");
    expect(target?.node).toBe(locate(SCHEMA, "/$defs/reference"));
  });

  it.each([
    ["a reference into another document", "/$defs/elsewhere"],
    ["a reference to a definition that does not exist", "/$defs/dangling"],
  ])("refuses %s", (_case, pointer) => {
    expect(() => referenced(SCHEMA, locate(SCHEMA, pointer))).toThrow(DslSchemaError);
  });
});

describe("describe", () => {
  it("prefers the location's own description to the one it references", () => {
    expect(describeLocation(SCHEMA, locate(SCHEMA, "/$defs/documented"))).toBe("Its own words.");
  });

  it("follows `$ref` when the location has none", () => {
    expect(describeLocation(SCHEMA, locate(SCHEMA, "/$defs/undocumented"))).toBe("A name.");
  });

  it("answers nothing, rather than a sentence, when nothing along the chain describes it", () => {
    expect(describeLocation(SCHEMA, locate(SCHEMA, "/$defs/object"))).toBeUndefined();
  });

  it("refuses a `$ref` chain that never ends", () => {
    expect(() => describeLocation(SCHEMA, locate(SCHEMA, "/$defs/loopA"))).toThrow(DslSchemaError);
  });
});

describe("enumeration and spelledValues", () => {
  it("reads an enum on the location or along its `$ref` chain", () => {
    expect(enumeration(SCHEMA, locate(SCHEMA, "/$defs/effort"))).toEqual(["s", "m"]);
    expect(enumeration(SCHEMA, { $ref: "#/$defs/effort" })).toEqual(["s", "m"]);
    expect(enumeration(SCHEMA, locate(SCHEMA, "/$defs/object"))).toBeUndefined();
  });

  it("writes each member as listed by default", () => {
    expect(spelledValues(SCHEMA, locate(SCHEMA, "/$defs/effort"))).toEqual(["s", "m"]);
    expect(asListed("s")).toBe("s");
  });

  it("leaves out a member the spelling has no word for", () => {
    const upper = (value: unknown) => (value === "s" ? "S" : undefined);

    expect(spelledValues(SCHEMA, locate(SCHEMA, "/$defs/effort"), upper)).toEqual(["S"]);
  });

  it("answers an empty list for a location that lists nothing", () => {
    expect(spelledValues(SCHEMA, locate(SCHEMA, "/$defs/object"))).toEqual([]);
  });
});

describe("typeName", () => {
  it.each([
    ["effort", "Effort"],
    ["source_kind", "SourceKind"],
    ["node_id", "NodeId"],
  ])("writes %s as %s", (definition, expected) => {
    expect(typeName(definition)).toBe(expected);
  });
});

describe("spellType", () => {
  it.each<[string, JsonSchema, string | undefined]>([
    ["a scalar", { type: "integer" }, "integer"],
    ["a boolean", { type: "boolean" }, "boolean"],
    ["an inline enum", { enum: ["squash", "merge"] }, '"squash" | "merge"'],
    ["an enumerated definition, by name", { $ref: "#/$defs/effort" }, "Effort"],
    ["a scalar definition, by its type", { $ref: "#/$defs/reference" }, "string"],
    ["an array of an enumerated definition", { $ref: "#/$defs/list" }, "Effort[]"],
    ["an array of an inline enum, parenthesised", { $ref: "#/$defs/inline" }, '("x" | "y")[]'],
    ["an array with no item schema", { $ref: "#/$defs/bare" }, undefined],
    ["an object", { $ref: "#/$defs/object" }, undefined],
  ])("spells %s", (_case, node, expected) => {
    expect(spellType(SCHEMA, node)).toBe(expected);
  });

  it("writes an inline enum's members the way the code view does", () => {
    const events = (value: unknown) => (value === "ticket_queued" ? "issue.queued" : undefined);

    expect(spellType(SCHEMA, { enum: ["ticket_queued", "ticket_closed"] }, events)).toBe(
      '"issue.queued"',
    );
    expect(spellType(SCHEMA, { enum: ["ticket_closed"] }, events)).toBeUndefined();
  });
});

describe("against the committed schema", () => {
  const published = readPublishedDslSchema();

  it("reads the fields the symbol table spells", () => {
    const llm = "/$defs/llm_config/properties";

    expect(spellType(published, locate(published, `${llm}/limits/properties/token_budget`))).toBe(
      "integer",
    );
    expect(spellType(published, locate(published, `${llm}/skill`))).toBe("string");
    expect(
      spellType(
        published,
        locate(published, "/$defs/trigger/properties/conditions/properties/effort_lte"),
      ),
    ).toBe("Effort");
    expect(
      spellType(
        published,
        locate(
          published,
          "/$defs/term_config/allOf/0/then/properties/options/properties/merge_method",
        ),
      ),
    ).toBe('"squash" | "merge" | "rebase"');
  });

  it("documents `inherit_task` in its own words, not the reference's", () => {
    const task = locate(
      published,
      "/$defs/llm_config/properties/routing/oneOf/0/properties/inherit_task",
    );

    expect(describeLocation(published, task)).toBe(
      "Resolves the model assigned to a task kind in Model Routing.",
    );
  });
});
