import { readdirSync } from "node:fs";
import { join } from "node:path";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

/**
 * The px ban's own proof ([#648](https://github.com/NobuData/ouroboros/issues/648)): the
 * acceptance criterion is *"the stylelint rule is red on a px font-size fixture and green
 * across the whole codebase"*, written as a test so it is checked on every pull request
 * rather than the day the rule was added.
 *
 * This runs the **shipped configuration** — `configFile` points at `stylelint.config.mjs`,
 * never at a copy — so what is proved red and green here is exactly what `yarn lint` runs.
 * The relationship to `__tests__/styles.test.ts` is deliberate overlap, not redundancy: that
 * test proves the shipped sheets are clean wherever the tests run; the linter is the answer
 * at the moment an offending line is written, and this file is what keeps the two from
 * quietly diverging.
 */

const UI = join(import.meta.dirname, "..");

/** The one configuration `yarn lint` runs, resolved the way stylelint itself resolves it. */
const CONFIG = { configFile: join(UI, "stylelint.config.mjs"), configBasedir: UI };

/**
 * Lint one snippet under the shipped configuration.
 *
 * @param code The CSS to judge.
 * @returns Whether stylelint found an error in it.
 */
async function rejects(code: string): Promise<boolean> {
  const result = await stylelint.lint({ ...CONFIG, code });
  return result.errored;
}

describe("the px type ban (#648)", () => {
  it.each([
    ["a px font-size", ".x { font-size: 12px; }"],
    ["a px size inside the font shorthand", ".x { font: 600 13px/1.3 sans-serif; }"],
    ["a px line-height", ".x { line-height: 18px; }"],
    ["a pt font-size, which is just as immovable", ".x { font-size: 9pt; }"],
  ])("is red on %s", async (_name, fixture) => {
    expect(await rejects(fixture)).toBe(true);
  });

  it.each([
    // The allowlist, by construction: px is correct wherever it is not type, so those
    // properties are simply not named by the rule — hairlines, shadow offsets, and the 1px
    // boxes of `.sr-only`, which must not scale.
    ["a hairline border", ".x { border: 1px solid red; }"],
    ["a shadow offset", ".x { box-shadow: 0 1px 2px red; }"],
    ["a rem font-size", ".x { font-size: 0.8125rem; }"],
    ["a unitless line-height", ".x { line-height: 1.45; }"],
    ["a token read", ".x { font-size: var(--t-sm); }"],
  ])("is green on %s", async (_name, fixture) => {
    expect(await rejects(fixture)).toBe(false);
  });

  it("is green across every shipped sheet", async () => {
    // The same files `yarn lint` covers. Passed as files rather than a glob so the test
    // fails loudly if the directory moves, instead of linting nothing and passing.
    const result = await stylelint.lint({ ...CONFIG, files: join(UI, "app", "**", "*.css") });
    const failed = result.results.filter((sheet) => sheet.errored);

    expect(failed.map((sheet) => sheet.source)).toEqual([]);
    // And it looked at something: an empty pass over zero files proves nothing.
    expect(result.results.length).toBeGreaterThanOrEqual(6);
  });

  it("bans every absolute unit the styles test names, on the same three properties", async () => {
    // `__tests__/styles.test.ts` matches font/font-size against px|pt|pc|in|cm|mm|Q. The two
    // vocabularies drifting apart would mean a unit one guard rejects and the other waves
    // through — red here the day someone trims either list.
    const { default: config } = (await import("../stylelint.config.mjs")) as {
      default: { rules: Record<string, [Record<string, string[]>, unknown]> };
    };
    const [properties] = config.rules["declaration-property-unit-disallowed-list"];

    expect(Object.keys(properties).sort()).toEqual(["font", "font-size", "line-height"]);
    for (const units of Object.values(properties)) {
      expect([...units].sort()).toEqual(["Q", "cm", "in", "mm", "pc", "pt", "px"].sort());
    }
  });

  it("covers line-height, which the styles test's regex never did", async () => {
    // The one gap #648 actually closes: ABSOLUTE_TYPE_SIZE in styles.test.ts matches only
    // font/font-size. If that regex ever grows line-height coverage this test loses its
    // reason but not its truth; until then it is the record of why both guards exist.
    expect(await rejects(".x { line-height: 18px; }")).toBe(true);
  });

  it("has sheets to check, which an empty directory would not", () => {
    const sheets = readdirSync(join(UI, "app"), { recursive: true }).filter(
      (name) => typeof name === "string" && name.endsWith(".css"),
    );

    expect(sheets.length).toBeGreaterThanOrEqual(6);
  });
});
