import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CodeSymbolTable } from "@/app/api/workflows";

/**
 * The code symbol table and a workflow file, as the code editor's suites read them (W.1,
 * [#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * Both are the shared contract's golden files rather than tables written here:
 * `schemas/workflow-dsl/fixtures/code-symbols/table.json` is exactly what
 * `ouroboros-rest`'s `code.symbols.spec.ts` asserts the service serves, and
 * `fixtures/code/standard-fix.loop.ts` is the printer's golden print. A suite that passes against
 * them passes against the real table and a real file, and a grammar change that alters either
 * turns these suites red rather than leaving them asserting a stale copy.
 */

/** The shared fixtures directory. */
const FIXTURES = join(import.meta.dirname, "..", "..", "..", "schemas", "workflow-dsl", "fixtures");

/** The table the service serves for mockup 05's four task routes and two skills. */
export const CODE_SYMBOLS = JSON.parse(
  readFileSync(join(FIXTURES, "code-symbols", "table.json"), "utf8"),
) as CodeSymbolTable;

/** The seeded `standard-fix`, as the printer writes it. */
export const STANDARD_FIX = readFileSync(join(FIXTURES, "code", "standard-fix.loop.ts"), "utf8");

/** Where a fixture's cursor is. Not a character the language uses. */
export const CURSOR = "¦";

/**
 * A fixture with its cursor marker taken out.
 *
 * @param source Text containing {@link CURSOR} exactly once.
 * @returns The text without it, and the offset it marked.
 * @throws {Error} When the marker is missing or repeated — a fixture that asserts nothing.
 */
export function atCursor(source: string): { text: string; pos: number } {
  const pos = source.indexOf(CURSOR);
  if (pos === -1 || source.indexOf(CURSOR, pos + 1) !== -1) {
    throw new Error("A fixture marks its cursor exactly once.");
  }
  return { text: source.slice(0, pos) + source.slice(pos + CURSOR.length), pos };
}

/**
 * The offset just after a piece of a file.
 *
 * @param text The file.
 * @param needle Text that occurs in it.
 * @param occurrence Which occurrence, from 0.
 * @returns The offset after it.
 * @throws {Error} When the file does not contain it that many times.
 */
export function after(text: string, needle: string, occurrence = 0): number {
  let index = -1;
  for (let seen = 0; seen <= occurrence; seen += 1) {
    index = text.indexOf(needle, index + 1);
    if (index === -1) throw new Error(`The file has no occurrence ${occurrence} of ${needle}.`);
  }
  return index + needle.length;
}

/**
 * The offset of a word inside a piece of a file — where a pointer resting on it would be.
 *
 * @param text The file.
 * @param needle Text that occurs in it and contains the word.
 * @param word The word.
 * @param occurrence Which occurrence of `needle`, from 0.
 * @returns The offset of the word's first character.
 */
export function wordIn(text: string, needle: string, word: string, occurrence = 0): number {
  const start = after(text, needle, occurrence) - needle.length;
  const offset = needle.indexOf(word);
  if (offset === -1) throw new Error(`${needle} does not contain ${word}.`);
  return start + offset;
}

/**
 * A workflow file around one body, for fixtures that need only part of one.
 *
 * @param body What goes inside `defineLoop`'s options.
 * @returns The file's text, up to wherever the body leaves off.
 */
export function loop(body: string): string {
  return `import { defineLoop } from "@ouroboros/sdk";\n\nexport default defineLoop("fixture", {\n${body}`;
}

/**
 * A workflow file around one stage call.
 *
 * @param call The call, as far as the fixture needs it.
 * @returns The file's text.
 */
export function stage(call: string): string {
  return loop(`  dsl: "1.0",\n  stages: [\n    ${call}`);
}
