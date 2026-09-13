import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import {
  FALLBACK_GLYPH,
  STAGE_PRESENTATIONS,
  deepFreeze,
  presentationFor,
} from "./catalog.presentation";
import { nodeTypeSchemas, readPublishedDslSchema } from "./catalog.schema";

/**
 * How node types are drawn and dropped — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * The treatments are held to the design itself: this suite reads mockup 04 and finds each glyph
 * inside a node carrying its class, and each class as a CSS rule. The defaults are held to the
 * published schema: every type's validates as it stands, except a model stage's, which is
 * missing precisely the three fields nobody should decide for the author.
 */

/** Mockup 04, the design reference the ticket names. */
const MOCKUP = readFileSync(
  join(__dirname, "..", "..", "..", "..", "docs", "mockups", "04-workflow-builder.html"),
  "utf8",
);

/** The committed schema, and its node types. */
const SCHEMA = readPublishedDslSchema();
const TYPES = nodeTypeSchemas(SCHEMA);

/** A value as a regular-expression literal. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One node type's config schema, compiled. */
function configValidator(type: string) {
  const entry = TYPES.find((candidate) => candidate.type === type)!;

  return new Ajv2020({ allErrors: true, strict: true }).compile(entry.configSchema);
}

describe("the node-type presentations", () => {
  it("cover every type the committed schema declares, and no type it does not", () => {
    // The tripwire for the fallback: a type added to `v1.json` surfaces with a placeholder
    // glyph, which is the ticket's *zero UI changes* — and this goes red until it is drawn one.
    expect(Object.keys(STAGE_PRESENTATIONS)).toEqual(TYPES.map((entry) => entry.type));
  });

  it.each(Object.entries(STAGE_PRESENTATIONS))(
    "draw %s the way mockup 04 does",
    (_type, presentation) => {
      const node = new RegExp(
        `class="node ${literal(presentation.class)}(?: [a-z]+)*"[^>]*>\\s*` +
          `<div class="ntype"><span class="glyph">${literal(presentation.glyph)}</span>`,
      );
      const rule = new RegExp(`^\\.node\\.${literal(presentation.class)}\\s*\\{`, "m");

      expect(MOCKUP).toMatch(node);
      expect(MOCKUP).toMatch(rule);
    },
  );

  it("label every type, each differently", () => {
    const labels = Object.values(STAGE_PRESENTATIONS).map((presentation) => presentation.label);

    expect(labels.every((label) => label.trim() !== "")).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("are frozen all the way down, because every request is served the same objects", () => {
    expect(Object.isFrozen(STAGE_PRESENTATIONS)).toBe(true);
    expect(Object.isFrozen(STAGE_PRESENTATIONS.llm.defaults.config.limits)).toBe(true);
  });
});

describe("the defaults a dropped node contains", () => {
  const title = new Ajv2020({ strict: true }).compile(
    (SCHEMA.$defs as { node: { properties: { title: object } } }).node.properties.title,
  );

  it.each(Object.entries(STAGE_PRESENTATIONS))(
    "give a %s a title the published schema accepts",
    (_type, presentation) => {
      expect(title(presentation.defaults.title)).toBe(true);
    },
  );

  it.each(["trigger", "infra", "flow", "term"])(
    "give a %s a config the published schema accepts as it stands",
    (type) => {
      const validate = configValidator(type);

      expect(validate(STAGE_PRESENTATIONS[type].defaults.config)).toBe(true);
    },
  );

  it("leave a model stage owing exactly its prompt, its routing and its permissions", () => {
    // P9: a permission nobody decided is a permission nobody can be held to — so the default is
    // a draft the validator flags, not a stage that quietly grants or withholds CI access.
    const validate = configValidator("llm");

    expect(validate(STAGE_PRESENTATIONS.llm.defaults.config)).toBe(false);
    expect(
      validate.errors!.map((error) => [error.keyword, String(error.params.missingProperty)]).sort(),
    ).toEqual([
      ["required", "permissions"],
      ["required", "prompt_template"],
      ["required", "routing"],
    ]);
  });

  it("start a model stage on the mockup inspector's mode and limits", () => {
    expect(STAGE_PRESENTATIONS.llm.defaults.config).toEqual({
      mode: "prompt",
      limits: { max_retries: 2, token_budget: 400000 },
    });
  });

  it("end an unconfigured run with a person, never with a merge", () => {
    expect(STAGE_PRESENTATIONS.term.defaults.config).toEqual({
      action: "needs_review",
      options: {},
    });
  });
});

describe("a type with no presentation", () => {
  it("is drawn neutrally, named for itself, and dropped with an empty config", () => {
    expect(presentationFor("sandbox")).toEqual({
      label: "sandbox",
      glyph: FALLBACK_GLYPH,
      class: "sandbox",
      defaults: { title: "sandbox", config: {} },
    });
  });

  it("is a type even when its name is an Object.prototype member", () => {
    expect(presentationFor("constructor").label).toBe("constructor");
    expect(presentationFor("toString").glyph).toBe(FALLBACK_GLYPH);
  });

  it("is frozen like the rest", () => {
    expect(Object.isFrozen(presentationFor("sandbox").defaults.config)).toBe(true);
  });

  it("does not shadow a listed type", () => {
    expect(presentationFor("flow")).toBe(STAGE_PRESENTATIONS.flow);
  });
});

describe("deepFreeze", () => {
  it("freezes nested objects and arrays, and answers the same value", () => {
    const value = { list: [{ leaf: 1 }], nested: { deeper: {} } };

    expect(deepFreeze(value)).toBe(value);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(value.nested.deeper)).toBe(true);
  });

  it("passes a primitive through", () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBeNull();
  });
});
