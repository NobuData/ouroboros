import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MODEL_ALIAS_PARAM_KEYS, PROVIDER_CONNECTION_KINDS } from "../db/schema";
import { PARAM_SHAPES } from "./param.shapes.fixture";
import { toParamFields, widgetForParam } from "./param.forms";
import {
  MODEL_PARAM_DIALECT,
  RESTRICTIONS_SCHEMA,
  SOURCES_ANNOTATION,
  type ModelParamSchema,
} from "./provider.params";

/**
 * CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)) fourth acceptance
 * criterion, in two halves.
 *
 * > *"A fake adapter declaring a novel param renders its field in the inspector with **no UI
 * > change** — fixture-proved."*
 *
 *   * **The fixture** is `param.shapes.fixture.ts`: five inspector shapes as schemas, each with
 *     the field list it must render to, written out in full. They differ in how many fields
 *     there are, in which widget each gets, and — the last one — in whether this build has ever
 *     heard of the parameter at all. They all come out of the same call.
 *   * **The proof there is no special-casing** is reading this module's own source with its
 *     comments stripped and failing if any of V019's param names or V015's provider kinds
 *     appears in the code. That is the only version of the claim that survives somebody being
 *     in a hurry; a test named *renders without special-casing* asserts nothing.
 *
 * `provider.forms.spec.ts` is the same suite for the connection form, and says why.
 */

describe("the param renderer knows nothing about params", () => {
  it("names no param the registry stores anywhere in its code", () => {
    const source = readFileSync(join(__dirname, "param.forms.ts"), "utf8");
    // Comments are stripped first, deliberately. The claim is about behaviour, and prose that
    // explains which control a rule came from is documentation working rather than a leak.
    const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    for (const param of MODEL_ALIAS_PARAM_KEYS) {
      expect(code).not.toContain(param);
    }
  });

  it("names no provider kind either", () => {
    const source = readFileSync(join(__dirname, "param.forms.ts"), "utf8");
    const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    for (const kind of PROVIDER_CONNECTION_KINDS) {
      expect(code).not.toContain(kind);
    }
  });

  it("imports nothing from an adapter", () => {
    // The other half of the same claim: a renderer that reached for an adapter would have
    // acquired a provider's opinion through the back door. `.dependency-cruiser.cjs` enforces
    // this across the whole service; here it is asserted where it matters most.
    const source = readFileSync(join(__dirname, "param.forms.ts"), "utf8");

    expect(source).not.toContain("./adapters/");
  });
});

describe("the five inspector shapes", () => {
  it.each(PARAM_SHAPES.map((shape) => [shape.name, shape.drawn, shape] as const))(
    "renders %s — %s",
    (_name, _drawn, shape) => {
      expect(toParamFields(shape.schema)).toEqual(shape.fields);
    },
  );

  it("draws five different-looking stacks out of one function", () => {
    // The summary of the whole fixture: same call, five shapes. If this ever collapses to one
    // shape, the dialect has stopped being expressive enough and somebody is about to add a
    // branch to an inspector.
    const rendered = PARAM_SHAPES.map((shape) =>
      toParamFields(shape.schema)
        .map((field) => `${field.label}:${field.widget}`)
        .join(" + "),
    );

    expect(rendered).toEqual([
      "Thinking:select + Token budget:integer + Max output:integer + Temperature:number",
      "Max output:integer + Temperature:number",
      "Max output:integer + Context clamp:integer + Temperature:number",
      "",
      "Speculative decoding:switch",
    ]);
  });

  it("renders a parameter it has never heard of exactly like one it has", () => {
    // The criterion said plainly. The novel shape's field is indistinguishable in *kind* from
    // any other — a name, a label, a widget and a source — which is what "no UI change" means:
    // there is nothing for a client to add.
    const [novel] = toParamFields(PARAM_SHAPES[PARAM_SHAPES.length - 1].schema);
    const [known] = toParamFields(RESTRICTIONS_SCHEMA);

    expect(Object.keys(novel)).toEqual(Object.keys(known));
    expect(novel.widget).toBe(known.widget);
    expect(MODEL_ALIAS_PARAM_KEYS).not.toContain(novel.name);
  });
});

describe("widgetForParam", () => {
  it.each([
    ["a string with choices", { type: "string", title: "T", enum: ["a"] }, "select"],
    ["a string without", { type: "string", title: "T" }, "text"],
    ["a whole number", { type: "integer", title: "T" }, "integer"],
    ["a number", { type: "number", title: "T" }, "number"],
    ["a flag", { type: "boolean", title: "T" }, "switch"],
  ] as const)("draws %s as a %s", (_what, field, widget) => {
    expect(widgetForParam(field)).toBe(widget);
  });

  it("is decided by what the field says about itself, not by its name", () => {
    // Two identically named fields, two types, two widgets. The name contributes nothing,
    // which is the property the source-reading tests above assert from the other side.
    const asChoice = widgetForParam({ type: "string", title: "Thinking", enum: ["off"] });
    const asFlag = widgetForParam({ type: "boolean", title: "Thinking" });

    expect(asChoice).toBe("select");
    expect(asFlag).toBe("switch");
  });
});

describe("toParamFields", () => {
  const SCHEMA: ModelParamSchema = {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Ordered",
    properties: {
      zebra: { type: "boolean", title: "Zebra" },
      apple: { type: "boolean", title: "Apple" },
      mango: { type: "boolean", title: "Mango" },
    },
    additionalProperties: false,
  };

  it("keeps the schema's own order rather than sorting", () => {
    // Field order is a contract — the inspector draws the fields in the order their author
    // wrote them — so a renderer that tidied them would silently reorder somebody's form.
    expect(toParamFields(SCHEMA).map((field) => field.name)).toEqual(["zebra", "apple", "mango"]);
  });

  it("keeps that order across a JSON round trip", () => {
    const roundTripped = JSON.parse(JSON.stringify(SCHEMA)) as ModelParamSchema;

    expect(toParamFields(roundTripped).map((field) => field.name)).toEqual([
      "zebra",
      "apple",
      "mango",
    ]);
  });

  it("answers an empty list for a schema with nothing to tune", () => {
    // Not a failure and not a null: a fixed-catalog provider has no fields, and the caller
    // renders the schema's description instead.
    expect(
      toParamFields({
        $schema: MODEL_PARAM_DIALECT,
        type: "object",
        title: "Nothing",
        description: "This provider publishes nothing to set.",
        properties: {},
        additionalProperties: false,
      }),
    ).toEqual([]);
  });

  it("turns every absent keyword into an explicit null", () => {
    // The asymmetry this file's header describes: absence is fine in a schema an author is
    // writing and unhelpful in a value a renderer is consuming.
    const [field] = toParamFields({
      $schema: MODEL_PARAM_DIALECT,
      type: "object",
      title: "Bare",
      properties: { bare: { type: "boolean", title: "Bare" } },
      additionalProperties: false,
    });

    expect(field).toEqual({
      name: "bare",
      label: "Bare",
      widget: "switch",
      help: null,
      defaultValue: null,
      choices: null,
      minimum: null,
      maximum: null,
      sources: ["adapter"],
    });
  });

  it("takes a field with no source annotation to be the adapter's own", () => {
    // An adapter writing its own schema is stating what it supports, so `adapter` is the
    // honest default; the annotation is something only the merge needs to write.
    const [field] = toParamFields({
      $schema: MODEL_PARAM_DIALECT,
      type: "object",
      title: "Unannotated",
      properties: { flag: { type: "boolean", title: "Flag" } },
      additionalProperties: false,
    });

    expect(field.sources).toEqual(["adapter"]);
  });

  it("reports the sources a merged field carries, unchanged", () => {
    const [field] = toParamFields({
      $schema: MODEL_PARAM_DIALECT,
      type: "object",
      title: "Merged",
      properties: {
        clamp: {
          type: "integer",
          title: "Clamp",
          maximum: 32_768,
          [SOURCES_ANNOTATION]: ["adapter", "discovery"],
        },
      },
      additionalProperties: false,
    });

    expect(field.sources).toEqual(["adapter", "discovery"]);
  });

  it("copies the choices rather than handing out the schema's own array", () => {
    // The caller is a form holding this while somebody uses it. A shared array would let a
    // client's sort land in the schema it was rendered from.
    const schema: ModelParamSchema = {
      $schema: MODEL_PARAM_DIALECT,
      type: "object",
      title: "Choice",
      properties: { pick: { type: "string", title: "Pick", enum: ["a", "b"] } },
      additionalProperties: false,
    };

    const [field] = toParamFields(schema);
    (field.choices as string[]).push("c");

    expect(schema.properties.pick.enum).toEqual(["a", "b"]);
  });

  it("renders the registry's own restrictions schema, which no adapter contributes to", () => {
    // The proof that "one renderer draws both halves" is true rather than intended: the
    // restrictions schema goes through the same call as any adapter's.
    expect(toParamFields(RESTRICTIONS_SCHEMA).map((field) => [field.name, field.widget])).toEqual([
      ["review_vote_only", "switch"],
      ["batch_ok", "switch"],
    ]);
  });
});
