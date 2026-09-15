import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The save surfaces' sheet (V.4, #172): every class it declares is rendered and every class rendered is
 * declared; the strip is on the error tokens and the diverged panel on the warning tokens, each saying its
 * state in words too; and **both themes** hold because every colour it reads is a token both palettes
 * define.
 *
 * jsdom applies no stylesheet, so `code-save-flow.test.tsx` proves the markup and this suite proves what
 * the sheet reads.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const CODE_DIR = join(UI, "app", "workflows", "code");

/** The sheet without its prose. */
const SHEET = readFileSync(join(CODE_DIR, "code-save.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const MODULE = readFileSync(join(CODE_DIR, "code-save-surfaces.tsx"), "utf8");
const TOKENS = readFileSync(join(UI, "app", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string): string {
  return new RegExp(`(?:^|\\}|\\s)${selector}\\s*\\{([^}]*)\\}`).exec(SHEET)?.[1] ?? "";
}

/**
 * The custom properties one block of the token sheet defines.
 *
 * @param selector The block's selector, as a regular expression fragment.
 * @returns The names it defines.
 */
function definedIn(selector: string): Set<string> {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(TOKENS)?.[1] ?? "";
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
}

const DECLARED = new Set([...SHEET.matchAll(/\.(code-save[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  [...MODULE.matchAll(/"([^"\n]*)"/g)]
    .flatMap((match) => (match[1] ?? "").split(/\s+/))
    .filter((name) => name.startsWith("code-save")),
);

describe("the sheet and the module", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the module renders", () => {
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual([]);
  });
});

describe("the treatments", () => {
  it("puts the diagnostics strip on the error tint and line, with its count in the error hue", () => {
    expect(rule("\\.code-save__strip")).toMatch(/background:\s*var\(--err-tint\)/);
    expect(rule("\\.code-save__strip")).toMatch(/border:\s*1px solid var\(--err-line\)/);
    expect(rule("\\.code-save__count")).toMatch(/color:\s*var\(--err\)/);
  });

  it("underlines the first message as the jump it is, with a focus ring", () => {
    expect(rule("\\.code-save__jump")).toMatch(/text-decoration:\s*underline/);
    expect(rule("\\.code-save__jump:focus-visible")).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it("puts the diverged panel on the warning tint and line", () => {
    expect(rule("\\.code-save__diverged")).toMatch(/background:\s*var\(--warn-tint\)/);
    expect(rule("\\.code-save__diverged")).toMatch(/border:\s*1px solid var\(--warn-line\)/);
  });

  it("prints the diff in the editor's well and type, bounded, each line kept whole", () => {
    expect(rule("\\.code-save__diff")).toMatch(/background:\s*var\(--inset\)/);
    expect(rule("\\.code-save__diff")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.code-save__diff")).toMatch(/max-height:\s*[\d.]+rem/);
    expect(rule("\\.code-save__diff")).toMatch(/overflow:\s*auto/);
    expect(rule("\\.code-save__line")).toMatch(/white-space:\s*pre/);
  });

  it("colours theirs in the error hue and mine in the ok hue — beside the `-` and `+` marks", () => {
    expect(rule("\\.code-save__line--removed")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.code-save__line--added")).toMatch(/color:\s*var\(--ok\)/);
  });
});

describe("tokens and the type scale", () => {
  const light = definedIn(":root");
  const dark = definedIn(':root\\[data-theme="dark"\\]');
  const read = [...new Set([...SHEET.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1] ?? ""))];

  it("names no colour literal", () => {
    expect(SHEET).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("reads only tokens the light palette defines, and the dark palette redefines every colour among them", () => {
    expect(read.filter((name) => !light.has(name))).toEqual([]);

    const colours = read.filter((name) => !/^--(?:sp|t|lh|r|f)-/.test(name));
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.filter((name) => !dark.has(name))).toEqual([]);
  });

  it("takes every font size from the scale", () => {
    const sizes = [...SHEET.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]?.trim());

    expect(sizes.length).toBeGreaterThan(0);
    for (const value of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("writes pixels only for hairlines and focus rings", () => {
    for (const [declaration] of SHEET.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(?:border|outline)/);
    }
  });
});
