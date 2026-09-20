import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/farm/farm.css` that are agreements with something outside it (#256). The
 * generic rules — no colour literal outside the token sheet, no px type — are
 * `__tests__/styles.test.ts`'s and stylelint's; what is here is that the sheet and the components
 * name the same classes, that every length scales and every hue is a token (which is what *both
 * themes* and *the 125% font-scale step* can be verified as, since jsdom applies no stylesheet),
 * the mockup's grid, and that the page adds no chrome to the shell.
 */

const FARM = join(import.meta.dirname, "..", "..", "app", "farm");
const SHEET = readFileSync(join(FARM, "farm.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(FARM)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(FARM, name), "utf8"))
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
const DECLARED = new Set([...CODE.matchAll(/\.(farm[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:farm[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("farm")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("leaves the stat tile to the design system rather than drawing a second one", () => {
    // The acceptance criterion is *via the shared StatCard composition*: a `.farm-stat` here
    // would be the dashboard's tile written twice.
    expect(CODE).not.toMatch(/\.farm-stat|\.ou-stat/);
    expect(COMPONENT).toContain("StatCard");
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

  it("sets every type size through a token, so the 125% step moves all of it", () => {
    const sizes = [...CODE.matchAll(/font-size:\s*([^;]+);/g)];

    expect(sizes.length).toBeGreaterThan(0);
    for (const [, value] of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("names no colour except through a token, so both palettes are one sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });

  it("lets a headline whose length changes with the fleet wrap between the actions, not under them", () => {
    expect(rule("\\.farm__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.farm__headings")).toMatch(/min-width:\s*[\d.]+rem/);
    expect(rule("\\.farm__title")).toMatch(/text-wrap:\s*balance/);
    expect(rule("\\.farm__title")).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});

describe("the grid", () => {
  it("is the mockup's twelve columns, with the stat row at four threes", () => {
    expect(rule("\\.farm__grid")).toMatch(/grid-template-columns:\s*repeat\(12,\s*1fr\)/);
    expect(rule("\\.farm-col--3")).toMatch(/grid-column:\s*span 3/);
  });

  it("halves the stat row before it stacks, at the mockup's two widths", () => {
    expect(CODE).toMatch(/@media \(max-width: 68\.75rem\)\s*\{\s*\.farm-col--3\s*\{\s*grid-column:\s*span 6;/);
    expect(CODE).toMatch(/@media \(max-width: 40rem\)\s*\{\s*\.farm__grid > \*\s*\{\s*grid-column:\s*span 12;/);
  });
});

describe("the shell", () => {
  it("adds no fixed or sticky chrome, so the header and sidebar stay the shell's", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("scrolls nothing of its own — the pane is the scroll container", () => {
    expect(CODE).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });
});
