import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/analyzer/analyzer.css` that are agreements with something outside it
 * (#516): the sheet and the components name the same classes, every length scales and every hue
 * is a token — what *both themes* and *CQ.1's rem type* can be verified as, since jsdom applies no
 * stylesheet — and the page adds no chrome to the shell.
 */

const ANALYZER = join(import.meta.dirname, "..", "..", "app", "analyzer");
const SHEET = readFileSync(join(ANALYZER, "analyzer.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(ANALYZER)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(ANALYZER, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations — the first rule with exactly this selector.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`(?:^|\\}|\\s)(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(analyzer[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:analyzer[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("analyzer")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("leaves the card, buttons and tags to the design system", () => {
    expect(CODE).not.toMatch(/\.ou-/);
  });

  it("adds no fixed or sticky chrome to the shell", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch or a hairline", () => {
    const lengths = [...CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)(?![\w-])/g)];

    for (const [value, , unit] of lengths) {
      if (unit === "px") expect(value, "only a 1px hairline may be px").toBe("1px");
      else if (unit === "%") expect(value).toBe("100%");
      else if (unit === "vw") expect(value, "the popover's ceiling on a narrow screen").toBe("80vw");
      else expect(["rem", "ch"]).toContain(unit);
    }
  });

  it("sets every type size through a token, so the 125% step moves all of it", () => {
    const sizes = [...CODE.matchAll(/font-size:\s*([^;]+);/g)];

    expect(sizes.length).toBeGreaterThan(0);
    for (const [, value] of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("names no colour except through a token, so both palettes are one sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });

  it("lets the computed headline wrap between the actions, not under them", () => {
    expect(rule("\\.analyzer__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.analyzer__headings")).toMatch(/min-width:\s*[\d.]+rem/);
    expect(rule("\\.analyzer__title")).toMatch(/font-size:\s*var\(--t-2xl\)/);
  });
});

describe("the meta strip", () => {
  it("draws the mockup's faint uppercase mono labels and dim mono values", () => {
    expect(rule("\\.analyzer-strip__label")).toMatch(/text-transform:\s*uppercase/);
    expect(rule("\\.analyzer-strip__label")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.analyzer-strip__value")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-strip__value")).toMatch(/color:\s*var\(--ink-dim\)/);
  });

  it("wraps the strip's slots on a narrow pane rather than scrolling it", () => {
    expect(rule("\\.analyzer-strip__row")).toMatch(/flex-wrap:\s*wrap/);
    expect(CODE).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
  });

  it("draws a model pill only in the model hue — the one a deterministic run never shows", () => {
    expect(rule("\\.analyzer-strip__model")).toMatch(/color:\s*var\(--model\)/);
    expect(COMPONENT).toContain('"analyzer-strip__model"');
  });

  it("opens each popover over the page, positioned by its own value, as prose", () => {
    expect(rule("\\.analyzer-pop")).toMatch(/position:\s*relative/);
    expect(rule("\\.analyzer-pop__panel")).toMatch(/position:\s*absolute/);
    expect(rule("\\.analyzer-pop__panel")).toMatch(/text-transform:\s*none/);
  });
});

describe("run progress", () => {
  it("tells budget_exceeded (a warning: findings kept) from failed (an error) by hue", () => {
    expect(rule("\\.analyzer-progress__status--budget")).toMatch(/color:\s*var\(--warn\)/);
    expect(rule("\\.analyzer-progress__status--failed")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.analyzer-progress__status--complete")).toMatch(/color:\s*var\(--ok\)/);
  });
});
