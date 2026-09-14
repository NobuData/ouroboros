import type { CodeRange } from "./code.errors";
import { parseWorkflowCode, slugRangeOf } from "./code.parser";
import { edit, golden } from "./code.parser.fixture";

/**
 * Where a file writes its slug — for U.3's save
 * ([#167](https://github.com/NobuData/ouroboros/issues/167)), which refuses a file that names a
 * different workflow and underlines the slug when it does.
 *
 * The range is only worth anything if it lands on the literal however the file is laid out, so the
 * cases are the layouts the parser accepts: canonical, reformatted across lines, parenthesised,
 * and saved with Windows line endings.
 */

/** The committed projection of the minimal fixture. */
const MINIMAL = golden("minimal");

/**
 * The text a one-line range covers, counting lines by line feeds as the range does.
 *
 * @param text - The file, with line feeds.
 * @param range - The range, or `undefined`.
 * @returns The covered text, or `undefined` when there is no range.
 */
function covered(text: string, range: CodeRange | undefined): string | undefined {
  if (range === undefined) return undefined;

  expect(range.endLine).toBe(range.line);
  return text.split("\n")[range.line - 1].slice(range.column - 1, range.endColumn - 1);
}

describe("slugRangeOf", () => {
  it("is the slug's string literal, quotes included, in a canonical file", () => {
    const range = slugRangeOf(MINIMAL);

    expect(range).toStrictEqual({ line: 3, column: 27, endLine: 3, endColumn: 36 });
    expect(covered(MINIMAL, range)).toBe('"minimal"');
  });

  it("follows the literal into a reformatted, parenthesised call", () => {
    const text = edit(
      MINIMAL,
      'export default defineLoop("minimal", {',
      'export default defineLoop(\n  ("minimal"),\n  {',
    );

    expect(parseWorkflowCode(text).errors).toEqual([]);
    expect(slugRangeOf(text)).toStrictEqual({ line: 4, column: 4, endLine: 4, endColumn: 13 });
    expect(covered(text, slugRangeOf(text))).toBe('"minimal"');
  });

  it("counts lines by line feeds when the file was saved with carriage returns", () => {
    expect(slugRangeOf(MINIMAL.replace(/\n/g, "\r\n"))).toStrictEqual(slugRangeOf(MINIMAL));
  });

  it("anchors a slug the parser read as written, which is the one the save refuses", () => {
    const text = edit(MINIMAL, 'defineLoop("minimal"', 'defineLoop("Not A Slug"');

    expect(covered(text, slugRangeOf(text))).toBe('"Not A Slug"');
  });

  it.each([
    ["a file with no default export", "const loop = 1;\n"],
    ["a default export that is not a call", "export default loop;\n"],
    ["a call with no arguments", "export default defineLoop();\n"],
  ])("is undefined for %s", (_name, text) => {
    expect(slugRangeOf(text)).toBeUndefined();
  });
});
