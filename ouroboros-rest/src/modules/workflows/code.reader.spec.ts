/**
 * The parser's literal readings — U.2 ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * Each reading returns the value a literal spells, or `undefined` having recorded one
 * `code_out_of_grammar` error on the offending syntax. It never throws, never evaluates, and checks
 * spelling rather than meaning: `99` is a number whatever the validator later says about it.
 */

import ts from "typescript";

import { FULL_SDK_HINT, WorkflowCodeErrorCode } from "./code.errors";
import { CodeReader, code, compact, list, propertyName, unwrap } from "./code.reader";

/**
 * A reader over `const value = <text>;`, and the value's expression.
 *
 * @param text - The expression's source.
 * @returns The reader and the expression.
 */
function read(text: string): { reader: CodeReader; value: ts.Expression } {
  const source = ts.createSourceFile(
    "/value.ts",
    `const value = ${text};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const [statement] = source.statements;
  const initializer = ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0].initializer
    : undefined;
  if (initializer === undefined) throw new Error(`Not an expression: ${text}`);

  return { reader: new CodeReader(source), value: initializer };
}

/**
 * Assert a reading failed with one out-of-grammar error, and return its message.
 *
 * @param reader - The reader.
 * @returns The error's message.
 */
function onlyError(reader: CodeReader): string {
  expect(reader.errors).toHaveLength(1);
  expect(reader.errors[0]).toMatchObject({
    code: WorkflowCodeErrorCode.OUT_OF_GRAMMAR,
    hint: FULL_SDK_HINT,
  });
  return reader.errors[0].message;
}

describe("CodeReader.string", () => {
  it.each([
    ['"text"', "text"],
    ["'text'", "text"],
    ["`text`", "text"],
    ['(("text"))', "text"],
    ['"line\\nbreak"', "line\nbreak"],
  ])("reads %s", (text, expected) => {
    const { reader, value } = read(text);

    expect(reader.string(value, "`title`")).toBe(expected);
    expect(reader.errors).toEqual([]);
  });

  it.each([
    ["42", "string literal"],
    ["issueTitle", "string literal"],
    ["`a${b}c`", "substitution"],
  ])("refuses %s, saying why", (text, words) => {
    const { reader, value } = read(text);

    expect(reader.string(value, "`title`")).toBeUndefined();
    expect(onlyError(reader)).toMatch(new RegExp(`^\`title\` .*${words}`));
  });

  it("anchors its error on the value, leading space excluded", () => {
    const { reader, value } = read("   42");
    reader.string(value, "`title`");

    expect(reader.errors[0]).toMatchObject({ start: 17, end: 19 });
  });

  it("opens its message with the phrase it was given, as a sentence", () => {
    const { reader, value } = read("42");
    reader.string(value, "a stage's id");

    expect(onlyError(reader)).toMatch(/^A stage's id is written as a string literal/);
  });
});

describe("CodeReader.strings", () => {
  it("reads a list of strings, and an empty list", () => {
    const { reader, value } = read('["build", "test"]');
    expect(reader.strings(value, "`require`")).toStrictEqual(["build", "test"]);

    const empty = read("[]");
    expect(empty.reader.strings(empty.value, "`require`")).toStrictEqual([]);
  });

  it("reports every entry that is not a string", () => {
    const { reader, value } = read('["build", 1, test]');

    expect(reader.strings(value, "`require`")).toBeUndefined();
    expect(reader.errors).toHaveLength(2);
  });

  it("refuses a value that is not a list", () => {
    const { reader, value } = read('"build"');

    expect(reader.strings(value, "`require`")).toBeUndefined();
    expect(onlyError(reader)).toContain("list");
  });
});

describe("CodeReader.number", () => {
  it.each([
    ["2", 2],
    ["400_000", 400000],
    ["0x10", 16],
    ["1e3", 1000],
    ["2.50", 2.5],
    ["-3", -3],
    ["(7)", 7],
  ])("reads %s as %p", (text, expected) => {
    const { reader, value } = read(text);

    expect(reader.number(value, "`retries`")).toBe(expected);
    expect(reader.errors).toEqual([]);
  });

  it("reads -0 as negative zero", () => {
    const { reader, value } = read("-0");
    expect(Object.is(reader.number(value, "`retries`"), -0)).toBe(true);
  });

  it.each(['"2"', "+2", "2n", "-x", "NaN", "Infinity"])("refuses %s", (text) => {
    const { reader, value } = read(text);

    expect(reader.number(value, "`retries`")).toBeUndefined();
    expect(onlyError(reader)).toContain("number literal");
  });
});

describe("CodeReader.boolean", () => {
  it.each([
    ["true", true],
    ["false", false],
    ["(true)", true],
  ])("reads %s", (text, expected) => {
    const { reader, value } = read(text);
    expect(reader.boolean(value, "`deleteBranch`")).toBe(expected);
  });

  it.each(['"true"', "1", "!0"])("refuses %s", (text) => {
    const { reader, value } = read(text);

    expect(reader.boolean(value, "`deleteBranch`")).toBeUndefined();
    expect(onlyError(reader)).toContain("true or false");
  });
});

describe("CodeReader.array", () => {
  it("returns an array literal's elements", () => {
    const { reader, value } = read("[1, 2]");
    expect(reader.array(value, "`stages`")).toHaveLength(2);
  });

  it("refuses anything else", () => {
    const { reader, value } = read("{}");

    expect(reader.array(value, "`stages`")).toBeUndefined();
    expect(onlyError(reader)).toContain("square brackets");
  });
});

describe("CodeReader.object", () => {
  const keys = ["a", "b"];

  it("returns plain and string-keyed properties in source order", () => {
    const { reader, value } = read('{ b: 1, "a": 2 }');

    expect([...(reader.object(value, "`x`", keys)?.keys() ?? [])]).toStrictEqual(["b", "a"]);
    expect(reader.errors).toEqual([]);
  });

  it("refuses a key outside the set, naming the keys it takes, and keeps the rest", () => {
    const { reader, value } = read("{ c: 1, a: 2 }");

    expect([...(reader.object(value, "`x`", keys)?.keys() ?? [])]).toStrictEqual(["a"]);
    expect(onlyError(reader)).toBe("`c` is not an option of `x`. It takes `a` and `b`.");
  });

  it("refuses a key written twice, keeping the first", () => {
    const { reader, value } = read("{ a: 1, a: 2 }");
    const properties = reader.object(value, "`x`", keys);

    expect(properties?.get("a")?.getText()).toBe("1");
    expect(onlyError(reader)).toContain("twice");
  });

  it.each([
    "{ a }",
    "{ ...a }",
    "{ a() {} }",
    "{ [a]: 1 }",
    "{ 1: 2 }",
    "{ get a() { return 1; } }",
  ])("refuses the property in %s", (text) => {
    const { reader, value } = read(text);

    expect(reader.object(value, "`x`", keys)?.size).toBe(0);
    expect(onlyError(reader)).toContain("plain `key: value`");
  });

  it("refuses a value that is not an object literal", () => {
    const { reader, value } = read("[]");

    expect(reader.object(value, "`x`", keys)).toBeUndefined();
    expect(onlyError(reader)).toContain("object literal");
  });
});

describe("CodeReader.name", () => {
  const table = { xs: "XS", m: "M" };

  it("reads a spelling back into the table's value", () => {
    const { reader, value } = read("M");
    expect(reader.name(table, "M", value, "an effort constant")).toBe("m");
  });

  it("refuses a spelling the table lacks, listing the ones it has", () => {
    const { reader, value } = read("XL");

    expect(reader.name(table, "XL", value, "an effort constant")).toBeUndefined();
    expect(onlyError(reader)).toBe("`XL` is not an effort constant. The grammar has `XS` or `M`.");
  });

  it("shows spellings the way it is told to", () => {
    const { reader, value } = read("XL");
    reader.name(table, "XL", value, "an effort constant", (text) => `effort.${text}`);

    expect(onlyError(reader)).toBe(
      "effort.XL is not an effort constant. The grammar has effort.XS or effort.M.",
    );
  });
});

describe("CodeReader.span", () => {
  it("passes a range through", () => {
    const { reader } = read("1");
    expect(reader.span({ start: 3, end: 5 })).toStrictEqual({ start: 3, end: 5 });
  });

  it("never ends a node's span before it starts", () => {
    const source = ts.createSourceFile(
      "/value.ts",
      "const value = ;",
      ts.ScriptTarget.Latest,
      true,
    );
    const [statement] = source.statements as unknown as ts.VariableStatement[];
    const missing = statement.declarationList.declarations[0].initializer as ts.Expression;
    const { start, end } = new CodeReader(source).span(missing);

    expect(end).toBeGreaterThanOrEqual(start);
  });
});

describe("helpers", () => {
  it("unwraps every layer of parentheses", () => {
    expect(ts.isIdentifier(unwrap(read("((x))").value))).toBe(true);
  });

  it("reads identifier and string keys, and nothing else", () => {
    const { value } = read('{ a: 1, "b": 2, [c]: 3, 4: 5 }');
    const names = (value as ts.ObjectLiteralExpression).properties.map((property) =>
      property.name === undefined ? undefined : propertyName(property.name),
    );

    expect(names).toStrictEqual(["a", "b", undefined, undefined]);
  });

  it("drops absent members and keeps every other falsy value", () => {
    expect(compact({ a: undefined, b: null, c: 0, d: false, e: "" })).toStrictEqual({
      b: null,
      c: 0,
      d: false,
      e: "",
    });
  });

  it.each([
    [[], ""],
    [["a"], "a"],
    [["a", "b"], "a and b"],
    [["a", "b", "c"], "a, b and c"],
  ])("joins %j as %p", (words, phrase) => {
    expect(list(words)).toBe(phrase);
  });

  it("joins with another conjunction, and shows a name as code", () => {
    expect(list(["a", "b"], "or")).toBe("a or b");
    expect(code("title")).toBe("`title`");
  });
});
