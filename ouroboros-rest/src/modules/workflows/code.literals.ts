/**
 * How the code view spells a value — U.1
 * ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * Every function here is total over its input domain, deterministic, and produces text the
 * TypeScript scanner reads back as *exactly* the value it started from. That last property is
 * the one that needs care, because the obvious spellings are not all lossless:
 *
 * * **`JSON.stringify` is almost a TypeScript string literal, but not quite.** It leaves
 *   U+2028 and U+2029 raw, which ECMAScript 2019 allows inside a string and the TypeScript
 *   scanner does not — it treats both as line breaks and reports an unterminated string. So
 *   those two are escaped on top of JSON's own escaping.
 * * **A template literal normalises line endings.** A raw carriage return inside backticks
 *   cooks to a line feed, so a prompt written on Windows would come back one byte shorter.
 *   `\r` is therefore always an escape, never a raw character.
 * * **Only `\n` may break a line.** The span map (#178) counts lines by line feeds, and an
 *   editor that also broke on U+2028 would disagree with it about which line a node is on.
 *
 * `code.printer.spec.ts` holds all of this to the compiler: every value it prints is re-scanned
 * by `ts.createSourceFile` and must produce no diagnostic.
 */

/**
 * Characters the TypeScript scanner treats as line breaks and JSON leaves raw: U+2028 and
 * U+2029. Built from their code points so this source file itself never carries either one raw.
 */
const SCANNER_LINE_BREAKS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, "g");

/**
 * Spell a string as a double-quoted TypeScript string literal.
 *
 * @param value - Any string, including one with lone surrogates or control characters.
 * @returns The literal, quotes included. Non-ASCII text other than the two scanner line breaks
 *   is left as written, so `"≤ M ↓"` reads as it does on the canvas.
 */
export function quoteString(value: string): string {
  return JSON.stringify(value).replace(SCANNER_LINE_BREAKS, (character) =>
    unicodeEscape(character),
  );
}

/**
 * Spell a list of strings as a one-line array literal: `["build", "test"]`.
 *
 * @param values - The strings, in order.
 * @returns The literal. An empty list is `[]`, though no valid document asks for one.
 */
export function stringArray(values: readonly string[]): string {
  return `[${values.map(quoteString).join(", ")}]`;
}

/**
 * Spell a string as a template literal, keeping its line feeds as real line breaks.
 *
 * Used for prompt templates, for the reason `dsl.yaml.ts` uses literal blocks: a reader
 * comparing the code view with the inspector's prompt box has to see the same text in both.
 * The continuation lines therefore start at column zero — indenting them would change the
 * prompt.
 *
 * Escaped: the backslash, the backtick, `$` where it would open `${`, the carriage return,
 * U+2028 and U+2029, lone surrogates (which UTF-8 cannot carry), and every other C0 control
 * except tab and line feed.
 *
 * @param value - The string.
 * @returns The literal, backticks included.
 */
export function templateLiteral(value: string): string {
  let text = "`";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const code = value.charCodeAt(index);

    if (character === "\\") text += "\\\\";
    else if (character === "`") text += "\\`";
    else if (character === "$" && value[index + 1] === "{") text += "\\$";
    else if (character === "\r") text += "\\r";
    else if (character === "\n" || character === "\t") text += character;
    else if (code < 0x20 || code === 0x2028 || code === 0x2029) text += unicodeEscape(character);
    else if (isLoneSurrogate(value, index)) text += unicodeEscape(character);
    else text += character;
  }

  return `${text}\``;
}

/**
 * Spell a token budget the way mockup 05 does: `400_000`.
 *
 * @param value - A non-negative safe integer.
 * @returns The digits, grouped in threes by numeric separators. Values under 1000 carry none.
 * @throws {RangeError} When the value is not a non-negative safe integer — a budget the schema
 *   would have refused, and a number no grouping can spell losslessly.
 */
export function tokenBudgetLiteral(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`A token budget must be a non-negative safe integer, not ${value}`);
  }

  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

/**
 * Spell a canvas coordinate for the layout block.
 *
 * `String(n)` is the shortest text `Number()` reads back as the same double, so fractions from
 * a drag survive exactly. The one value it loses is negative zero, which it prints as `0`, so
 * that is spelled out.
 *
 * @param value - A finite number.
 * @returns Its text.
 * @throws {RangeError} When the value is `NaN` or infinite, which no JSON document can hold.
 */
export function coordinate(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`A coordinate must be finite, not ${value}`);

  return Object.is(value, -0) ? "-0" : String(value);
}

/**
 * A `\uXXXX` escape for one UTF-16 code unit.
 *
 * @param character - A single code unit.
 * @returns The escape, with four lower-case hex digits.
 */
function unicodeEscape(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

/**
 * Whether the code unit at `index` is half of a surrogate pair with no other half.
 *
 * @param value - The string.
 * @param index - The position of the code unit to test.
 * @returns `true` for a high surrogate not followed by a low one, or a low surrogate not
 *   preceded by a high one.
 */
function isLoneSurrogate(value: string, index: number): boolean {
  const code = value.charCodeAt(index);

  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }

  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = value.charCodeAt(index - 1);
    return !(previous >= 0xd800 && previous <= 0xdbff);
  }

  return false;
}
