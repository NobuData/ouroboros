/**
 * How the code view spells a value — U.1 ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * Every spelling is held to the compiler rather than to a string written out here: the text is
 * parsed with `ts.createSourceFile` and the value the compiler reads back has to be the value
 * that was spelled. That is what makes these tests about losslessness rather than about the
 * formatter agreeing with itself.
 */

import ts from "typescript";

import {
  coordinate,
  quoteString,
  stringArray,
  templateLiteral,
  tokenBudgetLiteral,
} from "./code.literals";
import { compilerLineCount, expressionOf, syntaxErrors } from "./code.recover.fixture";

/** U+2028 and U+2029, built from their code points so this file never holds them raw. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
/** One backslash. */
const BACKSLASH = "\\";

/** Strings chosen because a naive spelling loses or breaks each of them. */
const HOSTILE_STRINGS: [string, string][] = [
  ["plain ASCII", "Code the change"],
  ["double quotes and a backslash", `say "hi" ${BACKSLASH} bye`],
  ["mockup 04's edge label", "≤ M ↓"],
  ["a line feed, a tab and a carriage return", "a\nb\tc\r\nd\re"],
  ["the two characters the scanner breaks lines on", `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`],
  ["a surrogate pair", "ship it 🚀"],
  ["a lone high surrogate", `x${String.fromCharCode(0xd800)}y`],
  ["a lone low surrogate at the end", `x${String.fromCharCode(0xdc00)}`],
  ["control characters", `nul${String.fromCharCode(0)}bell${String.fromCharCode(7)}`],
  ["backticks and a placeholder", "run `make` with ${target} for {{issue.title}}"],
  ["dollars that open nothing", "costs $5, and ends with $"],
  ["the empty string", ""],
];

/**
 * The value the compiler reads out of a string or template literal.
 *
 * @param literal - The literal's source.
 * @returns Its cooked value.
 */
function cooked(literal: string): string {
  const expression = expressionOf(literal);
  if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
    throw new Error(`Not a literal: ${literal}`);
  }

  return expression.text;
}

describe("quoteString", () => {
  it.each(HOSTILE_STRINGS)("spells %s so the compiler reads back the same string", (_, value) => {
    const literal = quoteString(value);

    expect(syntaxErrors(`const value = ${literal};`)).toEqual([]);
    expect(cooked(literal)).toBe(value);
  });

  it.each(HOSTILE_STRINGS)("keeps %s on one line", (_, value) => {
    const literal = quoteString(value);

    expect(literal).not.toMatch(/[\n\r]/);
    expect(literal).not.toContain(LINE_SEPARATOR);
    expect(literal).not.toContain(PARAGRAPH_SEPARATOR);
    expect(compilerLineCount(literal)).toBe(1);
  });

  it("leaves non-ASCII text as the canvas prints it", () => {
    expect(quoteString("≤ M ↓")).toBe('"≤ M ↓"');
  });

  it("escapes U+2028 and U+2029, which JSON leaves raw and the scanner refuses", () => {
    expect(quoteString(`a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}`)).toBe(
      `"a${BACKSLASH}u2028b${BACKSLASH}u2029"`,
    );
    expect(JSON.stringify(LINE_SEPARATOR)).toContain(LINE_SEPARATOR);
  });
});

describe("stringArray", () => {
  it("spells a list on one line, the way mockup 05's gate does", () => {
    expect(stringArray(["build", "test", "review"])).toBe('["build", "test", "review"]');
  });

  it("spells an empty list as []", () => {
    expect(stringArray([])).toBe("[]");
  });

  it("quotes each member so the compiler reads every one back", () => {
    const members = ['a "b"', "≤ M ↓", `x${LINE_SEPARATOR}y`];
    const literal = expressionOf(stringArray(members));

    expect(ts.isArrayLiteralExpression(literal)).toBe(true);
    expect(
      (literal as ts.ArrayLiteralExpression).elements.map((element) => cooked(element.getText())),
    ).toStrictEqual(members);
  });
});

describe("templateLiteral", () => {
  it.each(HOSTILE_STRINGS)("spells %s so the compiler reads back the same string", (_, value) => {
    const literal = templateLiteral(value);

    expect(syntaxErrors(`const value = ${literal};`)).toEqual([]);
    expect(cooked(literal)).toBe(value);
  });

  it.each(HOSTILE_STRINGS)("breaks %s only at its own line feeds", (_, value) => {
    const literal = templateLiteral(value);

    expect(literal).not.toContain("\r");
    expect(literal).not.toContain(LINE_SEPARATOR);
    expect(literal).not.toContain(PARAGRAPH_SEPARATOR);
    expect(compilerLineCount(literal)).toBe(literal.split("\n").length);
    expect(literal.split("\n").length).toBe(value.split("\n").length);
  });

  it("keeps a prompt's line feeds as real line breaks, unindented", () => {
    expect(templateLiteral("Scope the issue.\n\n  Issue: {{issue.title}}")).toBe(
      "`Scope the issue.\n\n  Issue: {{issue.title}}`",
    );
  });

  it("escapes the three characters that would end or interpolate the literal", () => {
    expect(templateLiteral("`${x}` and \\")).toBe("`\\`\\${x}\\` and \\\\`");
  });

  it("leaves a dollar that opens nothing alone", () => {
    expect(templateLiteral("$5 or $")).toBe("`$5 or $`");
  });

  it("escapes a carriage return rather than letting the literal normalise it", () => {
    expect(templateLiteral("a\r\nb")).toBe("`a\\r\nb`");
  });
});

describe("tokenBudgetLiteral", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1_000"],
    [120000, "120_000"],
    [400000, "400_000"],
    [10000000, "10_000_000"],
  ])("spells %d as %s", (value, text) => {
    expect(tokenBudgetLiteral(value)).toBe(text);
    expect(syntaxErrors(`const budget = ${text};`)).toEqual([]);

    const literal = expressionOf(text);
    expect(ts.isNumericLiteral(literal)).toBe(true);
    expect(Number((literal as ts.NumericLiteral).text.replace(/_/g, ""))).toBe(value);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("refuses %p", (value) => {
    expect(() => tokenBudgetLiteral(value)).toThrow(RangeError);
  });
});

describe("coordinate", () => {
  it.each([24, 306.5, -100000, 100000, 0.1 + 0.2, 1e-7, 0])(
    "spells %p so Number() reads it back",
    (value) => {
      expect(Object.is(Number(coordinate(value)), value)).toBe(true);
    },
  );

  it("keeps negative zero, which String() would print as 0", () => {
    expect(String(-0)).toBe("0");
    expect(coordinate(-0)).toBe("-0");
    expect(Object.is(Number(coordinate(-0)), -0)).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "refuses %p",
    (value) => {
      expect(() => coordinate(value)).toThrow(RangeError);
    },
  );
});
