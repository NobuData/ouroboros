import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The code editor's sheet (W.1, [#177](https://github.com/NobuData/ouroboros/issues/177)):
 * every class it declares is rendered and every class rendered is declared, the card is mockup
 * 05's `.hover-doc` treatment, and **both themes** hold because every value the sheet reads is a
 * token — the colours defined in the light palette and again in the dark one.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const CODE_DIR = join(UI, "app", "workflows", "code");

/** The sheet without its prose. */
const CODE = readFileSync(join(CODE_DIR, "code.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every module in the directory, as one text. */
const MODULES = readdirSync(CODE_DIR)
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => readFileSync(join(CODE_DIR, name), "utf8"))
  .join("\n");

/** The token sheet without its prose. */
const TOKENS = readFileSync(join(UI, "app", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
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

const DECLARED = new Set([...CODE.matchAll(/\.(code-hover-doc[a-z0-9_-]*)/g)].map((m) => m[1]));
const RENDERED = new Set([...MODULES.matchAll(/"(code-hover-doc[a-z0-9_-]*)"/g)].map((m) => m[1]));

describe("the sheet and the modules", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the modules render", () => {
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual([]);
  });

  it("styles no primitive of the design system", () => {
    expect(CODE).not.toContain(".ou-");
  });
});

describe("mockup 05's .hover-doc treatment", () => {
  it("is a mono card on the surface with a strong border", () => {
    const card = rule("\\.code-hover-doc");

    expect(card).toContain("background: var(--surface)");
    expect(card).toContain("border: 1px solid var(--line-strong)");
    expect(card).toContain("border-radius: var(--r-sm)");
    expect(card).toContain("font-family: var(--f-mono)");
    expect(card).toContain("color: var(--ink-dim)");
  });

  it("colours the symbol in the model hue, types in the accent, and the doc faint and italic", () => {
    expect(rule("\\.code-hover-doc__name")).toContain("color: var(--model)");
    expect(rule("\\.code-hover-doc__type")).toContain("color: var(--accent)");
    expect(rule("\\.code-hover-doc__doc")).toContain("color: var(--ink-faint)");
    expect(rule("\\.code-hover-doc__doc")).toContain("font-style: italic");
  });

  it("sizes its type from the scale, so the font-size preference moves it", () => {
    expect(rule("\\.code-hover-doc")).toMatch(/font-size:\s*var\(--t-[a-z0-9]+\)/);
    expect(rule("\\.code-hover-doc")).toMatch(/max-width:\s*[\d.]+rem/);
  });

  it("wraps a long signature or doc inside the card rather than widening it", () => {
    expect(rule("\\.code-hover-doc")).toContain("overflow-wrap: anywhere");
  });
});

describe("both themes", () => {
  const light = definedIn(":root");
  const dark = definedIn(':root\\[data-theme="dark"\\]');
  const read = new Set([...CODE.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]));

  it("reads only tokens the light palette defines", () => {
    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((name) => !light.has(name))).toEqual([]);
  });

  it("reads only colours the dark palette redefines", () => {
    const colours = ["--surface", "--line-strong", "--ink-dim", "--ink-faint", "--model", "--accent", "--scrim"];

    expect([...read].filter((name) => colours.includes(name)).sort()).toEqual([...colours].sort());
    expect(colours.filter((name) => !dark.has(name))).toEqual([]);
  });

  it("writes no length the preference cannot move, except the hairline border", () => {
    expect(CODE.replace("1px solid", "")).not.toMatch(/\d+px/);
  });
});
