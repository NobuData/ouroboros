import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/planning/planning.css` that are agreements with something outside it
 * (#283, #284). The generic rules — no colour literal outside the token sheet, no px type — are
 * `__tests__/styles.test.ts`'s and stylelint's; what is here is that the sheet and the components
 * name the same classes, that every length scales and every hue is a token (which is what *both
 * themes* and *the 125% font scale* can be verified as, since jsdom applies no stylesheet), the
 * mockup's grid proportions, and that the page adds no chrome to the shell.
 */

const PLANNING = join(import.meta.dirname, "..", "..", "app", "planning");
const SHEET = readFileSync(join(PLANNING, "planning.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(PLANNING)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(PLANNING, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(planning[a-z0-9_-]*)/g)].map((match) => match[1]!));

/**
 * Every page class a component renders — in a `className="…"`, or in a string literal made only of
 * page classes, which is how a `cx(…)` modifier or a lookup table of classes names one (#284). Ids
 * live in the `.ts` modules, so a quoted `planning…` in a component is a class.
 */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:planning[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("planning")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch or a hairline", () => {
    const lengths = [...CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)/g)];

    for (const [value, , unit] of lengths) {
      if (unit === "px") expect(value, "only a 1px hairline may be px").toBe("1px");
      else expect(["rem", "ch"]).toContain(unit);
    }
  });

  it("names no colour except through a token", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});

describe("the grid", () => {
  it("is the mockup's twelve columns, 7 / 5 and then 12", () => {
    expect(rule("\\.planning__grid")).toMatch(/grid-template-columns:\s*repeat\(12,\s*1fr\)/);
    expect(rule("\\.planning__generator")).toMatch(/grid-column:\s*span 7/);
    expect(rule("\\.planning__side")).toMatch(/grid-column:\s*span 5/);
    expect(rule("\\.planning__roadmap")).toMatch(/grid-column:\s*span 12/);
  });

  it("stacks the 7 and the 5 full width on a narrow pane", () => {
    const narrow = /@media \(max-width: [\d.]+rem\)\s*\{\s*\.planning__generator,\s*\.planning__side\s*\{\s*grid-column:\s*span 12;/;

    expect(CODE).toMatch(narrow);
  });
});

describe("the shell", () => {
  it("adds no fixed or sticky chrome, so the header and sidebar stay the shell's", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("scrolls nothing of its own but the gantt's wrapper, and that only sideways (#286)", () => {
    const scrolling = [...CODE.matchAll(/([^{}]+)\{[^}]*overflow(-[xy])?:\s*(auto|scroll)/g)];

    expect(scrolling.map((match) => match[1]!.trim())).toEqual([".planning-gantt__scroll"]);
    expect(rule("\\.planning-gantt__scroll")).toMatch(/overflow-x:\s*auto/);
    expect(rule("\\.planning-gantt__scroll")).not.toMatch(/overflow(-y)?:/);
  });
});

describe("the generator card (#284)", () => {
  it("tints the three monograms with the mockup's token hues — accent, model, ok", () => {
    expect(rule("\\.planning-mgram--gh")).toMatch(/color:\s*var\(--accent\)/);
    expect(rule("\\.planning-mgram--ji")).toMatch(/color:\s*var\(--model\)/);
    expect(rule("\\.planning-mgram--ln")).toMatch(/color:\s*var\(--ok\)/);
  });

  it("marks the selected tracker in the accent and the unwritable ones as unavailable", () => {
    expect(rule("\\.planning-seg__option--selected")).toMatch(/color:\s*var\(--accent\)/);
    expect(rule('\\.planning-seg__option\\[aria-disabled="true"\\]')).toMatch(/cursor:\s*not-allowed/);
  });

  it("never gives the outline region a display, so its `hidden` attribute keeps working", () => {
    expect(rule("\\.planning-gen__outline")).not.toMatch(/display/);
  });

  it("sets every type size in the generator through a token", () => {
    const generator = CODE.slice(CODE.indexOf(".planning-gen {"));

    for (const [, value] of generator.matchAll(/font-size:\s*([^;]+);/g)) expect(value).toMatch(/^var\(--t-/);
  });
});
