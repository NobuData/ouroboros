import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The agreements `app/farm/log-pane.css` keeps (#261). The farm's page sheet promises that
 * nothing on the page scrolls or animates by itself (`farm-styles.test.ts`); this sheet holds the
 * two exceptions the issue asks for, and this suite holds each to its condition: the pane scrolls
 * **inside its own wrapper**, and the cursor moves **only for a live build** and only for a
 * reader who has not asked for less motion. jsdom applies no stylesheet, so *both themes* and
 * *rem-based type* are verified the way every sheet's are — every hue a token, every length one
 * that scales.
 */

const FARM = join(import.meta.dirname, "..", "..", "app", "farm");
const SHEET = readFileSync(join(FARM, "log-pane.css"), "utf8");
const COMPONENT = readFileSync(join(FARM, "log-pane.tsx"), "utf8");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** The sheet without its keyframes, whose percentages are moments, not lengths. */
const RULES = CODE.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`(?<![\\w-])${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

/** Every class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(log-pane[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every class the component renders — a quoted string made only of the pane's classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:log-pane[a-z0-9_-]*\s*)+)"/g)].flatMap((match) => match[1]!.trim().split(/\s+/)),
);

describe("the sheet and the component", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("agree on the three numbers the component publishes", () => {
    for (const property of ["--log-pane-rows", "--log-pane-first", "--log-pane-cols"]) {
      expect(COMPONENT).toContain(`"${property}"`);
      expect(CODE).toContain(`var(${property})`);
    }
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch or a hairline — and the sheet's height in vh", () => {
    const lengths = [...RULES.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)/g)];

    for (const [value, , unit] of lengths) {
      if (unit === "px") expect(["1px", "-2px"], "only a hairline or the focus ring's inset may be px").toContain(value);
      else expect(["rem", "ch", "vh"]).toContain(unit);
    }
  });

  it("sets its type size through a token, so the 125% step moves it", () => {
    const sizes = [...CODE.matchAll(/font-size:\s*([^;]+);/g)];

    expect(sizes.length).toBeGreaterThan(0);
    for (const [, value] of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("keeps the row height in rem, in one place, and derives the geometry from it", () => {
    expect(rule("\\.log-pane")).toMatch(/--log-pane-row:\s*[\d.]+rem/);
    expect(rule("\\.log-pane__line")).toMatch(/height:\s*var\(--log-pane-row\)/);
    expect(rule("\\.log-pane__line")).toMatch(/line-height:\s*var\(--log-pane-row\)/);
    expect(rule("\\.log-pane__sizer")).toMatch(/height:\s*calc\(var\(--log-pane-rows\) \* var\(--log-pane-row\)\)/);
    expect(rule("\\.log-pane__window")).toMatch(
      /transform:\s*translateY\(calc\(var\(--log-pane-first\) \* var\(--log-pane-row\)\)\)/,
    );
  });

  it("names no colour except through a token, so both palettes are one sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});

describe("the pane scrolls inside its own wrapper", () => {
  it("scrolls in the scroller, both ways, and nowhere else", () => {
    const scrolling = [...CODE.matchAll(/([^{}]+)\{[^{}]*overflow(?:-[xy])?:\s*(?:auto|scroll)/g)].map((match) =>
      match[1]!.trim(),
    );

    expect(scrolling).toEqual([".log-pane__scroller"]);
    expect(rule("\\.log-pane__scroller")).toMatch(/overflow:\s*auto/);
  });

  it("has a height of its own, so a long log grows the scrollbar and not the page", () => {
    expect(rule("\\.log-pane__scroller")).toMatch(/height:\s*[\d.]+rem/);
    expect(rule("\\.log-pane--tall \\.log-pane__scroller")).toMatch(/height:\s*min\(/);
  });

  it("never wraps output, which is what makes a row one line high", () => {
    expect(rule("\\.log-pane__line")).toMatch(/white-space:\s*pre;/);
  });

  it("widens to the longest line inside the scroller rather than pushing the card", () => {
    expect(rule("\\.log-pane__sizer")).toMatch(/min-width:\s*calc\(var\(--log-pane-cols\) \* 1ch/);
    expect(rule("\\.log-pane")).toMatch(/min-width:\s*0/);
  });

  it("keeps the reader's place itself, with the browser's own anchoring off", () => {
    expect(rule("\\.log-pane__scroller")).toMatch(/overflow-anchor:\s*none/);
  });

  it("adds no fixed or sticky chrome", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });
});

describe("the cursor", () => {
  it("animates under the live modifier and nowhere else", () => {
    const animated = [...CODE.matchAll(/([^{}@]+)\{[^{}]*animation:/g)].map((match) => match[1]!.trim());

    expect(animated).toEqual([".log-pane__cursor--live"]);
    expect(rule("\\.log-pane__cursor")).not.toMatch(/animation/);
  });

  it("blinks only for a reader who has not asked for less motion", () => {
    expect(CODE).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.log-pane__cursor--live\s*\{\s*animation:\s*log-pane-blink/,
    );
    // Outside the guard, the live modifier is a glow and no movement.
    expect(rule("\\.log-pane__cursor--live")).not.toMatch(/animation/);
  });

  it("is the mockup's block, in rem and in the accent", () => {
    const cursor = rule("\\.log-pane__cursor");

    expect(cursor).toMatch(/width:\s*[\d.]+rem/);
    expect(cursor).toMatch(/height:\s*[\d.]+rem/);
    expect(cursor).toMatch(/background:\s*var\(--accent\)/);
  });

  it("draws the line it follows in the accent", () => {
    expect(rule("\\.log-pane__line--last")).toMatch(/color:\s*var\(--accent\)/);
  });
});

describe("a gap looks like a gap", () => {
  it("draws a hole in its own hue, between dashed rules no build prints", () => {
    expect(rule("\\.log-pane__line--gap")).toMatch(/color:\s*var\(--warn\)/);
    expect(CODE).toMatch(
      /\.log-pane__line--gap::before,\s*\.log-pane__line--gap::after\s*\{[^}]*border-top:\s*1px dashed var\(--warn-line\)/,
    );
  });

  it("draws the pane's own notes apart from output too", () => {
    expect(rule("\\.log-pane__line--note")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.log-pane__line--note")).toMatch(/font-style:\s*italic/);
  });

  it("keeps the measuring row out of sight and out of flow", () => {
    expect(rule("\\.log-pane__probe")).toMatch(/visibility:\s*hidden/);
    expect(rule("\\.log-pane__probe")).toMatch(/position:\s*absolute/);
  });
});
