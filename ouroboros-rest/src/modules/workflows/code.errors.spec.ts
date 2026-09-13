/**
 * The parser's diagnostic vocabulary — U.2 ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * Three codes, a pointer for the out-of-grammar one, and the arithmetic that turns an offset into
 * the 1-based line and column an editor underlines: counting line feeds and nothing else, so the
 * parser, the printer's span map and the layout reader agree about which line is which.
 */

import {
  FULL_SDK_HINT,
  LineMap,
  type PendingCodeError,
  placeErrors,
  WorkflowCodeErrorCode,
} from "./code.errors";

const { OUT_OF_GRAMMAR, SYNTAX_ERROR, LAYOUT_INVALID } = WorkflowCodeErrorCode;

/** U+2028 and U+2029, built from their code points so this file never holds them raw. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe("WorkflowCodeErrorCode", () => {
  it("names the three codes the grammar document lists", () => {
    expect(Object.values(WorkflowCodeErrorCode)).toEqual([
      "code_syntax_error",
      "code_out_of_grammar",
      "code_layout_invalid",
    ]);
  });

  it("points out-of-grammar errors at the full-SDK decision", () => {
    expect(FULL_SDK_HINT).toContain("full SDK (v2)");
    expect(FULL_SDK_HINT).toContain("https://github.com/NobuData/ouroboros/issues/180");
  });
});

describe("LineMap", () => {
  const lines = new LineMap("ab\ncd\n");

  it.each([
    [0, 1, 1],
    [1, 1, 2],
    [2, 1, 3],
    [3, 2, 1],
    [5, 2, 3],
    [6, 3, 1],
  ])("places offset %i at line %i, column %i", (offset, line, column) => {
    expect(lines.position(offset)).toStrictEqual({ line, column });
  });

  it("clamps offsets outside the text to its ends", () => {
    expect(lines.position(-4)).toStrictEqual({ line: 1, column: 1 });
    expect(lines.position(99)).toStrictEqual({ line: 3, column: 1 });
  });

  it("counts the empty line after a trailing line feed", () => {
    expect(lines.lineCount).toBe(3);
  });

  it("gives each line's span without its line feed", () => {
    expect(lines.lineSpan(1)).toStrictEqual({ start: 0, end: 2 });
    expect(lines.lineSpan(2)).toStrictEqual({ start: 3, end: 5 });
    expect(lines.lineSpan(3)).toStrictEqual({ start: 6, end: 6 });
  });

  it.each([0, 4, 1.5])("refuses the line %p, which the text does not have", (line) => {
    expect(() => lines.lineSpan(line)).toThrow(RangeError);
  });

  it("breaks lines at line feeds only, not at U+2028, U+2029 or a carriage return", () => {
    const text = `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c\rd\ne`;
    const map = new LineMap(text);

    expect(map.lineCount).toBe(2);
    expect(map.position(text.indexOf("d"))).toStrictEqual({ line: 1, column: 7 });
    expect(map.position(text.indexOf("e"))).toStrictEqual({ line: 2, column: 1 });
  });

  it("maps an empty text to one empty line", () => {
    const map = new LineMap("");

    expect(map.lineCount).toBe(1);
    expect(map.position(0)).toStrictEqual({ line: 1, column: 1 });
    expect(map.lineSpan(1)).toStrictEqual({ start: 0, end: 0 });
  });
});

describe("placeErrors", () => {
  const lines = new LineMap("one\ntwo\nthree");
  const pending: PendingCodeError[] = [
    { code: LAYOUT_INVALID, message: "b", start: 4, end: 7 },
    { code: OUT_OF_GRAMMAR, message: "z", start: 0, end: 3, hint: FULL_SDK_HINT },
    { code: SYNTAX_ERROR, message: "a", start: 4, end: 7 },
    { code: LAYOUT_INVALID, message: "a", start: 4, end: 7 },
    { code: SYNTAX_ERROR, message: "x", start: 4, end: 5 },
  ];

  it("sorts by start, end, code and message, and places each on its lines", () => {
    const second = { line: 2, column: 1, endLine: 2, endColumn: 4 };

    expect(placeErrors(pending, lines)).toStrictEqual([
      {
        code: OUT_OF_GRAMMAR,
        message: "z",
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 4,
        hint: FULL_SDK_HINT,
      },
      { code: SYNTAX_ERROR, message: "x", line: 2, column: 1, endLine: 2, endColumn: 2 },
      { code: LAYOUT_INVALID, message: "a", ...second },
      { code: LAYOUT_INVALID, message: "b", ...second },
      { code: SYNTAX_ERROR, message: "a", ...second },
    ]);
  });

  it("carries no hint key on an error that has no hint", () => {
    expect(placeErrors(pending, lines).filter((error) => "hint" in error)).toHaveLength(1);
  });

  it("leaves its input alone", () => {
    const before = structuredClone(pending);
    placeErrors(pending, lines);

    expect(pending).toStrictEqual(before);
  });
});
