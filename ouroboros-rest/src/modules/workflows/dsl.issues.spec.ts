import { z } from "zod";

import { DslErrorCode } from "./dsl.errors";
import { diagnosticsFromZodIssues, valueAtPath } from "./dsl.issues";

/**
 * Run a schema over a value and translate whatever it says.
 *
 * The translation is asserted through real zod failures rather than hand-built issue
 * objects: what this file is about is which of zod's codes mean which of ours, and an issue
 * this suite wrote itself would prove only that the switch statement has the case it has.
 */
function translate(schema: z.ZodType, value: unknown, base: (string | number)[] = []) {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("expected the schema to reject this value");
  return diagnosticsFromZodIssues(parsed.error.issues, base, value);
}

describe("valueAtPath", () => {
  it("reads a nested property", () => {
    expect(valueAtPath({ a: { b: [0, 1, 2] } }, ["a", "b", 1])).toBe(1);
  });

  it("answers undefined for an absent property rather than throwing", () => {
    expect(valueAtPath({ a: {} }, ["a", "b", "c"])).toBeUndefined();
  });

  it("answers undefined when a step is a scalar", () => {
    expect(valueAtPath({ a: 4 }, ["a", "b"])).toBeUndefined();
  });

  it("answers the root itself for the empty path", () => {
    expect(valueAtPath({ a: 1 }, [])).toEqual({ a: 1 });
  });
});

describe("diagnosticsFromZodIssues", () => {
  it("calls an absent property required, not a type mismatch", () => {
    // zod reports both as `invalid_type`; pydantic distinguishes them, and so must this.
    expect(translate(z.strictObject({ title: z.string() }), {})).toEqual([
      { code: DslErrorCode.SCHEMA_REQUIRED, path: "/title", message: expect.any(String) as string },
    ]);
  });

  it("calls a present value of the wrong type a type mismatch", () => {
    expect(translate(z.strictObject({ title: z.string() }), { title: 7 })).toEqual([
      { code: DslErrorCode.SCHEMA_TYPE, path: "/title", message: expect.any(String) as string },
    ]);
  });

  it("calls an absent enum member required, because there is no type to be wrong about", () => {
    expect(translate(z.strictObject({ kind: z.enum(["a", "b"]) }), {})).toEqual([
      { code: DslErrorCode.SCHEMA_REQUIRED, path: "/kind", message: expect.any(String) as string },
    ]);
  });

  it("calls a value outside a closed vocabulary an enum failure, and names the vocabulary", () => {
    const [diagnostic] = translate(z.strictObject({ kind: z.enum(["a", "b"]) }), { kind: "c" });
    expect(diagnostic.code).toBe(DslErrorCode.SCHEMA_ENUM);
    expect(diagnostic.message).toContain('"a"');
    expect(diagnostic.message).toContain('"b"');
  });

  it("separates a number out of bounds from a collection of the wrong size", () => {
    const schema = z.strictObject({
      retries: z.int().min(0).max(10),
      names: z.array(z.string()).min(1),
    });
    expect(translate(schema, { retries: 99, names: [] })).toEqual([
      { code: DslErrorCode.SCHEMA_RANGE, path: "/retries", message: "Must be at most 10." },
      {
        code: DslErrorCode.SCHEMA_LENGTH,
        path: "/names",
        message: "Must hold at least 1 entries.",
      },
    ]);
  });

  it("reports a number below its minimum as a range failure too", () => {
    expect(translate(z.strictObject({ budget: z.int().min(1000) }), { budget: 1 })).toEqual([
      { code: DslErrorCode.SCHEMA_RANGE, path: "/budget", message: "Must be at least 1000." },
    ]);
  });

  it("reports a string that fails its pattern", () => {
    const [diagnostic] = translate(z.strictObject({ id: z.string().regex(/^[a-z]+$/) }), {
      id: "Not An Id",
    });
    expect(diagnostic.code).toBe(DslErrorCode.SCHEMA_PATTERN);
    expect(diagnostic.path).toBe("/id");
  });

  it("names every undeclared property, one diagnostic each, anchored at the property", () => {
    // zod reports one issue listing several keys; a canvas needs one diagnostic per field.
    expect(translate(z.strictObject({ id: z.string() }), { id: "a", colour: 1, size: 2 })).toEqual([
      {
        code: DslErrorCode.SCHEMA_UNKNOWN_PROPERTY,
        path: "/colour",
        message: expect.stringContaining("colour") as string,
      },
      {
        code: DslErrorCode.SCHEMA_UNKNOWN_PROPERTY,
        path: "/size",
        message: expect.stringContaining("size") as string,
      },
    ]);
  });

  it("prefixes every path with where the parsed value lives in the document", () => {
    expect(translate(z.strictObject({ mode: z.string() }), {}, ["nodes", 3, "config"])).toEqual([
      {
        code: DslErrorCode.SCHEMA_REQUIRED,
        path: "/nodes/3/config/mode",
        message: expect.any(String) as string,
      },
    ]);
  });

  it("attaches the anchor it is given to every diagnostic", () => {
    const parsed = z.strictObject({ mode: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      diagnosticsFromZodIssues(
        parsed.error.issues,
        ["nodes", 0, "config"],
        {},
        { node: "implement" },
      ),
    ).toEqual([
      {
        code: DslErrorCode.SCHEMA_REQUIRED,
        path: "/nodes/0/config/mode",
        node: "implement",
        message: expect.any(String) as string,
      },
    ]);
  });

  it("falls back to a type failure for a construct the DSL does not use, rather than throwing", () => {
    // `not_multiple_of` is not reachable from any schema in dsl.schema.ts. The default arm
    // exists so that adding one to the DSL is a conformance failure rather than a 500.
    const [diagnostic] = translate(z.strictObject({ n: z.number().multipleOf(3) }), { n: 4 });
    expect(diagnostic.code).toBe(DslErrorCode.SCHEMA_TYPE);
    expect(diagnostic.path).toBe("/n");
  });
});
