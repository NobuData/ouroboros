import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The stage list's sheet (CE.3, #567): every class it declares is rendered and every class
 * rendered is declared, a row is mockup 20's `.stage-row`, the list scrolls inside its own
 * bounded wrapper and nothing else does, the highlight respects a reader who asked for less
 * motion, and **both themes** and **the 125% font-size step** hold because every value it reads
 * is a token or a rem.
 *
 * jsdom applies no stylesheet, so the render suite proves the markup is identical in both
 * palettes and this suite proves the palettes are what the sheet reads.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const COPILOT_DIR = join(UI, "app", "workflows", "copilot");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = readFileSync(join(COPILOT_DIR, "stages.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The module that draws the sheet's classes. */
const MODULES = readFileSync(join(COPILOT_DIR, "stages-card.tsx"), "utf8");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string): string {
  return new RegExp(`(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

const DECLARED = new Set([...CODE.matchAll(/\.(copilot-stages[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set([...MODULES.matchAll(/"(copilot-stages[a-z0-9_-]*)"/g)].map((match) => match[1]));

describe("the sheet and the module", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the module renders", () => {
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual([]);
  });

  it("builds no class name from a template — each is a literal the two lists can see", () => {
    expect(MODULES).not.toMatch(/`[^`]*copilot-stages[^`]*\$\{/);
    expect(MODULES).not.toMatch(/"[^"]*copilot-stages[a-z0-9_-]* [^"]*"/);
  });

  it("styles no primitive of the design system, none of the studio's classes, and neither of its neighbours'", () => {
    expect(CODE).not.toContain(".ou-");
    expect(CODE).not.toMatch(/\.studio|\.shell-|\.copilot-view|\.copilot-chat/);
  });

  it("draws nothing with an inline style", () => {
    expect(MODULES).not.toMatch(/\bstyle=/);
  });
});

describe("a row", () => {
  it("is mockup 20's: a wrapping line of centred items over a hairline, none under the last", () => {
    const line = rule("\\.copilot-stages__line");

    expect(line).toMatch(/display:\s*flex/);
    expect(line).toMatch(/flex-wrap:\s*wrap/);
    expect(line).toMatch(/align-items:\s*center/);
    expect(rule("\\.copilot-stages__row")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(rule("\\.copilot-stages__row:last-child")).toMatch(/border-bottom:\s*0/);
  });

  it("sets the number in faint mono, the glyph in the accent, and the name in full ink on one line", () => {
    expect(rule("\\.copilot-stages__idx")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.copilot-stages__idx")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.copilot-stages__glyph")).toMatch(/color:\s*var\(--accent\)/);
    expect(rule("\\.copilot-stages__name")).toMatch(/color:\s*var\(--ink\)/);
    expect(rule("\\.copilot-stages__name")).toMatch(/font-weight:\s*600/);
    expect(rule("\\.copilot-stages__name")).toMatch(/white-space:\s*nowrap/);
  });

  it("pushes edit to the trailing edge, faint until hovered", () => {
    expect(rule("\\.copilot-stages__edit")).toMatch(/margin-left:\s*auto/);
    expect(rule("\\.copilot-stages__edit")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.copilot-stages__edit:hover")).toMatch(/color:\s*var\(--accent\)/);
  });

  it("rings the row a finding names, and a row that holds the focus, in the accent", () => {
    expect(CODE).toMatch(/\.copilot-stages__row--target,\s*\.copilot-stages__row:focus-visible\s*\{[^}]*outline:\s*1px solid var\(--accent\)/);
  });

  it("is the containing block for its own visually hidden text, as the card is for the rest", () => {
    expect(rule("\\.copilot-stages__row")).toMatch(/position:\s*relative/);
    expect(rule("\\.copilot-stages")).toMatch(/position:\s*relative/);
  });
});

describe("an unresolved reference", () => {
  it("opens its note in the flow, on the warning rule and tint", () => {
    const note = rule("\\.copilot-stages__note");

    expect(note).toMatch(/border-left:\s*3px solid var\(--warn\)/);
    expect(note).toMatch(/background:\s*var\(--warn-tint\)/);
    expect(rule("\\.copilot-stages__note\\[hidden\\]")).toMatch(/display:\s*none/);
  });

  it("draws the info control as the quiet mark it is, in the warning hue", () => {
    const info = rule("\\.copilot-stages__info");

    expect(info).toMatch(/border:\s*0/);
    expect(info).toMatch(/background:\s*none/);
    expect(info).toMatch(/color:\s*var\(--warn\)/);
    expect(info).toMatch(/cursor:\s*pointer/);
  });

  it("never reaches for the ok hue — nothing here is a protection or a pass", () => {
    expect(CODE).not.toMatch(/--ok\b/);
    expect(rule("\\.copilot-stages__fact--warn")).toMatch(/color:\s*var\(--warn\)/);
  });
});

describe("the scroller", () => {
  it("is the one thing that scrolls inside itself, bounded in rem so it grows with the type", () => {
    const scroll = rule("\\.copilot-stages__scroll");

    expect(scroll).toMatch(/overflow-y:\s*auto/);
    expect(scroll).toMatch(/max-block-size:\s*[\d.]+rem/);
    expect(scroll).toMatch(/overscroll-behavior:\s*contain/);
    expect([...CODE.matchAll(/overflow-y:\s*(?:auto|scroll)/g)]).toHaveLength(1);
    expect(CODE).not.toMatch(/overflow:\s*(?:auto|scroll)/);
  });

  it("shows its focus, since a keyboard scrolls it", () => {
    expect(rule("\\.copilot-stages__scroll:focus-visible")).toMatch(/outline:\s*1px solid var\(--accent\)/);
  });

  it("pins nothing to the viewport and takes nothing out of the flow", () => {
    expect(CODE).not.toMatch(/position:\s*(?:fixed|sticky|absolute)/);
  });
});

describe("the highlight", () => {
  it("plays once, on the background alone, so no row moves", () => {
    const frames = /@keyframes copilot-stages-fresh\s*\{([\s\S]*?\})\s*\}/.exec(CODE)?.[1] ?? "";

    expect(frames).toMatch(/background:\s*var\(--accent-tint\)/);
    expect(frames).toMatch(/background:\s*transparent/);
    expect(frames).not.toMatch(/height|margin|padding|transform|width/);
  });

  it("is declared only where motion is welcome, and switched off where less was asked for", () => {
    const welcome = /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?\})\s*\}/.exec(CODE)?.[1] ?? "";
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(CODE)?.[1] ?? "";

    expect(welcome).toMatch(/\.copilot-stages__row--fresh\s*\{[^}]*animation:\s*copilot-stages-fresh/);
    expect(reduced).toMatch(/\.copilot-stages__row--fresh\s*\{[^}]*animation:\s*none/);
    expect(CODE.replace(/@media[\s\S]*?\}\s*\}/g, "")).not.toMatch(/animation:|transition:/);
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

  it("keeps every other length on a token or a rem, hairlines, rules and rings excepted", () => {
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(border|outline)/);
    }
    expect(CODE).not.toMatch(/\b2px\b/);
  });

  it("sizes nothing in percentages", () => {
    expect(CODE).not.toMatch(/\d%/);
  });

  it("fixes no height a larger type could be clipped by", () => {
    expect(CODE).not.toMatch(/(?:^|[;{\s])(?:height|max-height|block-size):/);
  });
});
