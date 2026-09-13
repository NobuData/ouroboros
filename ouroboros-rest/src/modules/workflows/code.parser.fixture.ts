/**
 * Test support shared by the parser's suites — U.2
 * ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * `code.parser.spec.ts` and `code.parser.errors.spec.ts` both start from a committed projection
 * under `schemas/workflow-dsl/fixtures/code/` and change one thing about it, so reading a projection
 * and making that change live here once. `*.fixture.ts` is left out of the build, so none of this
 * ships.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURES_DIR } from "./dsl.golden.fixture";

/**
 * A committed projection.
 *
 * @param name - The fixture's name: `minimal`, `standard-fix`, …
 * @returns The `.loop.ts` text.
 */
export function golden(name: string): string {
  return readFileSync(join(FIXTURES_DIR, "code", `${name}.loop.ts`), "utf8");
}

/**
 * Replace the first occurrence of a piece of text, failing the test if there is none.
 *
 * The failure matters: an edit whose `from` has drifted away from the golden file would otherwise
 * leave the file unchanged, and a test of a refusal would pass for the wrong reason.
 *
 * @param text - The file.
 * @param from - The text to replace, which must occur.
 * @param to - Its replacement, taken literally (no `$&` patterns).
 * @returns The edited file.
 */
export function edit(text: string, from: string, to: string): string {
  expect(text).toContain(from);
  return text.replace(from, () => to);
}
