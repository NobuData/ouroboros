import Ajv2020 from "ajv/dist/2020";

import {
  MODEL_ALIAS_PARAM_KEYS,
  MODEL_ALIAS_RESTRICTION_KEYS,
  MODEL_ALIAS_TEMPERATURE_MAX,
  MODEL_ALIAS_TOKENS_MAX,
  MODEL_ALIAS_TOKENS_MIN,
  THINKING_LEVELS,
} from "../db/schema";
import {
  MODEL_PARAM_DIALECT,
  MODEL_PARAM_TYPES,
  PARAM_NAME_PATTERN,
  PARAM_SOURCES,
  RESTRICTIONS_SCHEMA,
  SOURCES_ANNOTATION,
  STORABLE_PARAM_FIELDS,
  copyParamSchema,
  paramSchemaViolations,
  storageViolations,
  type ModelParamSchema,
} from "./provider.params";

/**
 * The dialect, and the two questions it deliberately keeps apart.
 *
 * {@link paramSchemaViolations} asks *is this a schema a renderer can be total over* —
 * shape only. {@link storageViolations} asks *is every field in it one
 * `model_aliases.params` will hold* — which is a different question with a different answer,
 * and the reason a fixture can prove a novel parameter renders while the conformance kit
 * refuses a shipped adapter that offers one. `provider.params.ts`'s header argues it; this is
 * where both halves are watched failing.
 *
 * Every check is exercised against a schema that is wrong on purpose, for
 * `provider.config.spec.ts`'s reason: a gate nobody has watched refuse something is a gate
 * that passes everything.
 */

/** A schema that is right in every way, for a case to spoil one part of. */
function wellFormed(): ModelParamSchema {
  return {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Model parameters",
    properties: {
      thinking: { type: "string", title: "Thinking", enum: THINKING_LEVELS },
      token_budget: {
        type: "integer",
        title: "Token budget",
        minimum: MODEL_ALIAS_TOKENS_MIN,
        maximum: 400_000,
      },
      temperature: { type: "number", title: "Temperature", minimum: 0, maximum: 1 },
    },
    additionalProperties: false,
  };
}

describe("the dialect's constants", () => {
  it("declares the four sources in precedence order, highest first", () => {
    // The order is load-bearing: `params.merge.ts` filters this list to order a field's
    // annotation, so a reshuffle here silently reorders every answer.
    expect(PARAM_SOURCES).toEqual(["adapter", "discovery", "catalog", "registry"]);
  });

  it("declares the four types a renderer switches over", () => {
    expect(MODEL_PARAM_TYPES).toEqual(["string", "integer", "number", "boolean"]);
  });

  it("uses JSON Schema's own extension mechanism for its annotation", () => {
    // `x-` prefixed, so a generic validator ignores it and the schema stays portable — which
    // is what lets a client hand the same document to Ajv that this service compiles.
    expect(SOURCES_ANNOTATION.startsWith("x-")).toBe(true);
  });

  it("spells param names the way the jsonb documents key them", () => {
    for (const key of MODEL_ALIAS_PARAM_KEYS) {
      expect(PARAM_NAME_PATTERN.test(key)).toBe(true);
    }

    for (const flag of MODEL_ALIAS_RESTRICTION_KEYS) {
      expect(PARAM_NAME_PATTERN.test(flag)).toBe(true);
    }
  });
});

describe("paramSchemaViolations", () => {
  it("accepts a well-formed schema", () => {
    expect(paramSchemaViolations(wellFormed())).toEqual([]);
  });

  it("refuses anything that is not an object at all", () => {
    for (const value of [null, undefined, 7, "schema", []]) {
      expect(paramSchemaViolations(value)).toEqual(["schema must be an object"]);
    }
  });

  it("requires the dialect, the type, a title and a closed object", () => {
    const violations = paramSchemaViolations({
      $schema: "https://example.invalid/schema",
      type: "array",
      title: "",
      properties: {},
      additionalProperties: true,
    });

    expect(violations).toEqual([
      `$schema must be "${MODEL_PARAM_DIALECT}"`,
      'type must be "object"',
      "title must be a non-empty string",
      "additionalProperties must be false",
      "a schema with no properties must carry a description saying why",
    ]);
  });

  it("reports every problem at once rather than the first", () => {
    // The reason the check answers a list: a new adapter with six problems should be six
    // sentences and one run, not six edit-and-rerun cycles.
    expect(paramSchemaViolations({ type: "array", title: "", properties: 3 }).length).toBe(5);
  });

  it("has no required keyword, and says so rather than ignoring one", () => {
    // A schema carrying `required` was written against a different idea of what a param is —
    // they are all optional — and silently dropping the keyword would leave that idea in place.
    expect(paramSchemaViolations({ ...wellFormed(), required: ["thinking"] })).toEqual([
      "the dialect has no required — every param is optional by construction",
    ]);
  });

  describe("an empty schema", () => {
    it("is legitimate when it says why", () => {
      expect(
        paramSchemaViolations({
          $schema: MODEL_PARAM_DIALECT,
          type: "object",
          title: "Nothing to tune",
          description: "This provider is a fixed catalog and publishes no per-call parameters.",
          properties: {},
          additionalProperties: false,
        }),
      ).toEqual([]);
    });

    it("is refused when it does not", () => {
      // The one rule about honesty rather than shape: an empty form the inspector cannot
      // explain is indistinguishable from one that failed to load.
      expect(
        paramSchemaViolations({
          $schema: MODEL_PARAM_DIALECT,
          type: "object",
          title: "Nothing to tune",
          properties: {},
          additionalProperties: false,
        }),
      ).toEqual(["a schema with no properties must carry a description saying why"]);
    });
  });

  describe("one field", () => {
    /** A schema whose single field is whatever a case supplies. */
    function withField(name: string, field: unknown): string[] {
      return paramSchemaViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "One field",
        properties: { [name]: field },
        additionalProperties: false,
      });
    }

    it("must be an object with a known type and a label", () => {
      expect(withField("thinking", { type: "date", title: "" })).toEqual([
        `param "thinking": type must be one of ${MODEL_PARAM_TYPES.join(", ")}`,
        'param "thinking": title must be a non-empty string',
      ]);
    });

    it("must be named the way a jsonb key is", () => {
      expect(withField("Token Budget", { type: "integer", title: "Budget" })).toEqual([
        `param "Token Budget": a param name must match ${PARAM_NAME_PATTERN.source}`,
      ]);
    });

    it("still reports its name when it is not an object", () => {
      // A report saying "must be an object" with no field name is a report somebody has to go
      // looking with.
      expect(withField("thinking", null)).toEqual(['param "thinking": must be an object']);
    });

    it("may carry an enum only when it is a string", () => {
      expect(withField("token_budget", { type: "integer", title: "B", enum: ["a"] })).toEqual([
        'param "token_budget": enum is for a string field — see provider.params.ts',
      ]);
    });

    it("may not carry an empty enum, or one holding something other than strings", () => {
      expect(withField("thinking", { type: "string", title: "T", enum: [] })).toEqual([
        'param "thinking": enum, when present, must be a non-empty array',
      ]);
      expect(withField("thinking", { type: "string", title: "T", enum: ["off", 2] })).toEqual([
        'param "thinking": every enum value must be a string',
      ]);
    });

    it("may carry bounds only when it is numeric", () => {
      expect(withField("thinking", { type: "string", title: "T", minimum: 1, maximum: 2 })).toEqual(
        [
          'param "thinking": minimum is for a number or an integer field',
          'param "thinking": maximum is for a number or an integer field',
        ],
      );
    });

    it("may not carry a bound that is not a finite number", () => {
      expect(withField("token_budget", { type: "integer", title: "B", maximum: "lots" })).toEqual([
        'param "token_budget": maximum, when present, must be a finite number',
      ]);
      expect(withField("token_budget", { type: "integer", title: "B", minimum: Infinity })).toEqual(
        ['param "token_budget": minimum, when present, must be a finite number'],
      );
    });

    it("may not bound an integer field at a fraction", () => {
      expect(withField("token_budget", { type: "integer", title: "B", minimum: 1.5 })).toEqual([
        'param "token_budget": minimum on an integer field must be a whole number',
      ]);
    });

    it("may not declare a range nothing satisfies", () => {
      // It renders as an input a person cannot fill in correctly and validates as a field that
      // always fails, which is worse than either half alone.
      expect(
        withField("temperature", { type: "number", title: "T", minimum: 2, maximum: 1 }),
      ).toEqual(['param "temperature": minimum 2 is above maximum 1']);
    });

    it("may not start at a value its own rules refuse", () => {
      // The specific bug worth a check: the form starts at a value, the person changes
      // nothing, and the save is refused by the schema the form was rendered from.
      expect(
        withField("thinking", { type: "string", title: "T", enum: ["off"], default: "max" }),
      ).toEqual(['param "thinking": default "max" is not one of its enum values']);
      expect(
        withField("temperature", { type: "number", title: "T", maximum: 1, default: 3 }),
      ).toEqual(['param "temperature": default 3 is above maximum 1']);
      expect(
        withField("temperature", { type: "number", title: "T", minimum: 1, default: 0 }),
      ).toEqual(['param "temperature": default 0 is below minimum 1']);
      expect(withField("token_budget", { type: "integer", title: "B", default: 1.5 })).toEqual([
        'param "token_budget": default 1.5 is not a integer',
      ]);
      expect(withField("thinking", { type: "string", title: "T", default: true })).toEqual([
        'param "thinking": default true is not a string',
      ]);
    });

    it("accepts a default that is inside its own rules", () => {
      expect(
        withField("temperature", { type: "number", title: "T", maximum: 1, default: 0 }),
      ).toEqual([]);
      expect(withField("batch_ok", { type: "boolean", title: "B", default: false })).toEqual([]);
    });

    it("may not annotate itself with a source that is not one", () => {
      expect(
        withField("thinking", { type: "string", title: "T", [SOURCES_ANNOTATION]: ["vibes"] }),
      ).toEqual([`param "thinking": ${SOURCES_ANNOTATION} names vibes, which is not a source`]);
      expect(
        withField("thinking", { type: "string", title: "T", [SOURCES_ANNOTATION]: [] }),
      ).toEqual([
        `param "thinking": ${SOURCES_ANNOTATION}, when present, must be a non-empty array`,
      ]);
    });

    it("may not reach for a keyword the dialect does not have", () => {
      expect(withField("thinking", { type: "string", title: "T", oneOf: [], $ref: "#/x" })).toEqual(
        ['param "thinking": the dialect has no $ref, oneOf — see provider.params.ts'],
      );
    });
  });

  it("passes a schema in the dialect to a generic validator unchanged", () => {
    // The dialect is a *subset* of JSON Schema rather than a lookalike, which is what lets the
    // same document validate a write here and a form in a browser.
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = ajv.compile(wellFormed());

    expect(validate({})).toBe(true);
    expect(validate({ thinking: "max", token_budget: 400_000 })).toBe(true);
    expect(validate({ thinking: "maximum" })).toBe(false);
    expect(validate({ context_clamp: 32_768 })).toBe(false);
  });
});

describe("storageViolations", () => {
  it("accepts a schema whose every field the column can hold", () => {
    expect(storageViolations(wellFormed())).toEqual([]);
  });

  it("accepts an empty schema — a fixed catalog stores nothing and offers nothing", () => {
    expect(
      storageViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Nothing",
        description: "Nothing to tune.",
        properties: {},
        additionalProperties: false,
      }),
    ).toEqual([]);
  });

  it("refuses a param the column has no key for", () => {
    // The rule a *registered* adapter is held to. A key V019 refuses is a control somebody
    // fills in correctly and cannot save, and the conformance kit is where an author meets it.
    const violations = storageViolations({
      $schema: MODEL_PARAM_DIALECT,
      type: "object",
      title: "Novel",
      properties: { speculative_decoding: { type: "boolean", title: "Speculative decoding" } },
      additionalProperties: false,
    });

    expect(violations).toEqual([
      `param "speculative_decoding" is not one of the keys model_aliases.params stores ` +
        `(${MODEL_ALIAS_PARAM_KEYS.join(", ")}) — see V019, decision R3`,
    ]);
  });

  it("refuses a param typed differently from the column's own domain", () => {
    expect(
      storageViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Wrong type",
        properties: { temperature: { type: "string", title: "Temperature" } },
        additionalProperties: false,
      }),
    ).toEqual(['param "temperature": must be a number — model_aliases.params stores one']);
  });

  it("refuses a ceiling above what V019 accepts", () => {
    expect(
      storageViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Too wide",
        properties: { temperature: { type: "number", title: "Temperature", maximum: 5 } },
        additionalProperties: false,
      }),
    ).toEqual([
      `param "temperature": maximum must be at most ${MODEL_ALIAS_TEMPERATURE_MAX} — V019's ceiling`,
    ]);
  });

  it("refuses a floor below what V019 accepts", () => {
    // Zero is the interesting case: a budget of zero is not a small budget, it is an
    // instruction to produce nothing, and V019 refuses it.
    expect(
      storageViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Too low",
        properties: { token_budget: { type: "integer", title: "Budget", minimum: 0 } },
        additionalProperties: false,
      }),
    ).toEqual([
      `param "token_budget": minimum must be at least ${MODEL_ALIAS_TOKENS_MIN} — V019's floor`,
    ]);
  });

  it("allows an absent bound, which the merge is what fills", () => {
    // The asymmetry: a ceiling the adapter does not know is the ordinary case — Anthropic's
    // maximum output differs per model and no adapter can ask offline — and `params.merge.ts`
    // fills it and then clamps it. What is refused is a bound *stated* wider than the column.
    expect(
      storageViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Unbounded above",
        properties: { max_output: { type: "integer", title: "Max output", minimum: 1 } },
        additionalProperties: false,
      }),
    ).toEqual([]);
  });

  it("requires a choice field to declare the choices V019 accepts", () => {
    expect(
      storageViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "No enum",
        properties: { thinking: { type: "string", title: "Thinking" } },
        additionalProperties: false,
      }),
    ).toEqual([
      `param "thinking": must declare an enum — V019 accepts ${THINKING_LEVELS.join(", ")}`,
    ]);
  });

  it("refuses a choice V019 does not accept", () => {
    expect(
      storageViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Extra level",
        properties: {
          thinking: { type: "string", title: "Thinking", enum: ["off", "std", "max", "ultra"] },
        },
        additionalProperties: false,
      }),
    ).toEqual(['param "thinking": offers ultra, which V019 does not accept']);
  });

  it("accepts a narrower choice list than V019's", () => {
    // Narrowing is what an adapter is *for*: a model that only reasons at one level offers one.
    expect(
      storageViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Narrower",
        properties: { thinking: { type: "string", title: "Thinking", enum: ["off", "max"] } },
        additionalProperties: false,
      }),
    ).toEqual([]);
  });

  it("refuses anything that is not a schema at all", () => {
    expect(storageViolations(null)).toEqual(["schema must be an object"]);
    expect(storageViolations({ properties: 7 })).toEqual(["properties must be an object"]);
  });
});

describe("STORABLE_PARAM_FIELDS", () => {
  it("covers V019's vocabulary exactly", () => {
    expect(Object.keys(STORABLE_PARAM_FIELDS)).toEqual([...MODEL_ALIAS_PARAM_KEYS]);
  });

  it("bounds every token count where the column does", () => {
    for (const key of ["token_budget", "max_output", "context_clamp"] as const) {
      expect(STORABLE_PARAM_FIELDS[key].minimum).toBe(MODEL_ALIAS_TOKENS_MIN);
      expect(STORABLE_PARAM_FIELDS[key].maximum).toBe(MODEL_ALIAS_TOKENS_MAX);
    }
  });

  it("is itself a schema in the dialect", () => {
    // The widest schema this product can hold, checked against the same gate an adapter's is —
    // a domain that would not pass the dialect could not be served if an adapter matched it.
    expect(
      paramSchemaViolations({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Everything the column stores",
        properties: STORABLE_PARAM_FIELDS,
        additionalProperties: false,
      }),
    ).toEqual([]);
  });
});

describe("RESTRICTIONS_SCHEMA", () => {
  it("is in the dialect", () => {
    expect(paramSchemaViolations(RESTRICTIONS_SCHEMA)).toEqual([]);
  });

  it("declares V019's two flags as flags, and nothing else", () => {
    expect(Object.keys(RESTRICTIONS_SCHEMA.properties)).toEqual([...MODEL_ALIAS_RESTRICTION_KEYS]);

    for (const flag of MODEL_ALIAS_RESTRICTION_KEYS) {
      expect(RESTRICTIONS_SCHEMA.properties[flag].type).toBe("boolean");
    }
  });

  it("attributes both flags to the registry rather than to any provider", () => {
    // The point of serving them adapter-independently: they are what this workspace allows the
    // alias to be used for, which is true whatever is on the other end of it.
    for (const flag of MODEL_ALIAS_RESTRICTION_KEYS) {
      expect(RESTRICTIONS_SCHEMA.properties[flag][SOURCES_ANNOTATION]).toEqual(["registry"]);
    }
  });

  it("holds none of V019's param keys", () => {
    for (const key of MODEL_ALIAS_PARAM_KEYS) {
      expect(RESTRICTIONS_SCHEMA.properties[key]).toBeUndefined();
    }
  });
});

describe("copyParamSchema", () => {
  it("answers an equal value that shares nothing with the original", () => {
    const schema = wellFormed();
    const copy = copyParamSchema(schema);

    expect(copy).toEqual(schema);
    expect(copy).not.toBe(schema);
    expect(copy.properties).not.toBe(schema.properties);
    expect(copy.properties.thinking).not.toBe(schema.properties.thinking);
  });

  it("leaves the original alone when the copy is edited", () => {
    // The reason every `paramSchema()` returns one: the caller is a form holding the value
    // while somebody fills it in, and a shared object would have those edits land in an
    // adapter that is a singleton across every workspace.
    const schema = wellFormed();
    const copy = copyParamSchema(schema) as { title: string };
    copy.title = "tampered";

    expect(schema.title).toBe("Model parameters");
  });
});
