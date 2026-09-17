import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/planning/planning.css` that are agreements with something outside it
 * (#283). The generic rules — no colour literal outside the token sheet, no px type — are
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

/** Every page class a component renders. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/className="([^"]+)"/g)]
    .flatMap((match) => match[1]!.split(/\s+/))
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

  it("scrolls nothing of its own, so the content pane is the one scroll container", () => {
    expect(CODE).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });
});
