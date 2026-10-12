import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The safety strip's sheet (CE.5, #569): every class it declares is rendered and every class
 * rendered is declared, a column is mockup 20's `.safe-col`, the trace opens in the flow, a
 * withheld claim is on the warning treatment, and **both themes** and **the 125% font-size step**
 * hold because every value it reads is a token or a rem.
 *
 * jsdom applies no stylesheet, so the render suite proves the markup is identical in both
 * palettes and this suite proves the palettes are what the sheet reads.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const COPILOT_DIR = join(UI, "app", "workflows", "copilot");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = readFileSync(join(COPILOT_DIR, "safety.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The module that draws the sheet's classes. */
const MODULES = readFileSync(join(COPILOT_DIR, "safety-strip.tsx"), "utf8");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string): string {
  return new RegExp(`(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

const DECLARED = new Set([...CODE.matchAll(/\.(copilot-safety[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set([...MODULES.matchAll(/"(copilot-safety[a-z0-9_-]*)"/g)].map((match) => match[1]));

describe("the sheet and the module", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the module renders, the card's own name excepted", () => {
    // `copilot-safety` is the card's hook for a test and a screenshot; the card primitive styles it.
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual(["copilot-safety"]);
  });

  it("builds no class name from a template — each is a literal the two lists can see", () => {
    expect(MODULES).not.toMatch(/`[^`]*copilot-safety[^`]*\$\{/);
    expect(MODULES).not.toMatch(/"[^"]*copilot-safety[a-z0-9_-]* [^"]*"/);
  });

  it("styles no primitive of the design system, none of the studio's classes, and none of its neighbours'", () => {
    expect(CODE).not.toContain(".ou-");
    expect(CODE).not.toMatch(/\.studio|\.shell-|\.copilot-view|\.copilot-chat|\.copilot-stages|\.copilot-dry/);
  });

  it("draws nothing with an inline style", () => {
    expect(MODULES).not.toMatch(/\bstyle=/);
  });
});

describe("a column", () => {
  it("is mockup 20's: equal columns with a floor in rem, wrapping when the card is narrow", () => {
    const columns = rule("\\.copilot-safety__columns");

    expect(columns).toMatch(/display:\s*flex/);
    expect(columns).toMatch(/flex-wrap:\s*wrap/);
    expect(columns).toMatch(/align-items:\s*flex-start/);
    expect(rule("\\.copilot-safety__column")).toMatch(/flex:\s*1 1 8\.5rem/);
    expect(rule("\\.copilot-safety__column")).toMatch(/min-width:\s*0/);
  });

  it("sets the key in mono, wide-tracked capitals in the accent, over a muted sentence", () => {
    const key = rule("\\.copilot-safety__key");

    expect(key).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(key).toMatch(/letter-spacing:\s*var\(--tr-wide\)/);
    expect(key).toMatch(/text-transform:\s*uppercase/);
    expect(key).toMatch(/color:\s*var\(--accent\)/);
    expect(rule("\\.copilot-safety__sentence")).toMatch(/color:\s*var\(--ink-mut\)/);
  });
});

describe("the trace", () => {
  it("opens in the flow, on the accent rule, and is gone when hidden", () => {
    const trace = rule("\\.copilot-safety__trace");

    expect(trace).toMatch(/border-left:\s*3px solid var\(--accent\)/);
    expect(trace).toMatch(/background:\s*var\(--inset\)/);
    expect(rule("\\.copilot-safety__trace\\[hidden\\]")).toMatch(/display:\s*none/);
    expect(CODE).not.toMatch(/position:\s*(?:fixed|sticky|absolute)/);
  });

  it("draws the info control as the quiet mark it is, and shows its focus", () => {
    const info = rule("\\.copilot-safety__info");

    expect(info).toMatch(/border:\s*0/);
    expect(info).toMatch(/background:\s*none/);
    expect(info).toMatch(/cursor:\s*pointer/);
    expect(rule("\\.copilot-safety__info:focus-visible")).toMatch(/outline:\s*0\.125rem solid var\(--accent\)/);
  });
});

describe("a claim withheld", () => {
  it("is on the warning rule and tint in full ink — not a footnote", () => {
    const withheld = rule("\\.copilot-safety__withheld");

    expect(withheld).toMatch(/border-left:\s*3px solid var\(--warn\)/);
    expect(withheld).toMatch(/background:\s*var\(--warn-tint\)/);
    expect(withheld).toMatch(/color:\s*var\(--ink\)/);
  });

  it("never reaches for the ok hue — the strip states mechanisms, it does not award a pass", () => {
    expect(CODE).not.toMatch(/--ok\b/);
  });
});

describe("tokens and the type scale", () => {
  it("names no colour literal — every hue is a token both palettes define", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("takes every font size from the sheet's scale, so the reader's preference scales the surface", () => {
    expect(CODE).not.toMatch(/font-size:\s*[\d.]+px/);
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("keeps every other length on a token or a rem, hairlines and rules excepted", () => {
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(border|outline)/);
    }
    expect(CODE).not.toMatch(/\b2px\b/);
  });

  it("sizes nothing in percentages and scrolls nothing inside itself", () => {
    expect(CODE).not.toMatch(/\d%/);
    expect(CODE).not.toMatch(/overflow(?:-[xy])?:\s*(?:auto|scroll)/);
  });

  it("fixes no height a larger type could be clipped by", () => {
    expect(CODE).not.toMatch(/(?:^|[;{\s])(?:height|max-height|block-size):/);
  });
});
