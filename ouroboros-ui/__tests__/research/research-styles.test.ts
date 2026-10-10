import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/research/research.css` that are agreements with something outside it
 * (#627): the sheet and the components name the same classes, every length scales and every hue
 * is a token — which is what *both themes* and *the 125% font-scale step* can be verified as,
 * since jsdom applies no stylesheet — the mockup's grid, and that the page adds no chrome.
 */

const RESEARCH = join(import.meta.dirname, "..", "..", "app", "research");
const SHEET = readFileSync(join(RESEARCH, "research.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(RESEARCH)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(RESEARCH, name), "utf8"))
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
  return new RegExp(`(?:^|\\}|\\s)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(research[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:research[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("research__") || name === "research"),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("leaves the card, the button and the eyebrow to the design system", () => {
    expect(CODE).not.toMatch(/\.ou-/);
    expect(COMPONENT).toMatch(/\bCard\b/);
    expect(COMPONENT).toMatch(/\bButton\b/);
    expect(COMPONENT).toMatch(/\bEyebrow\b/);
  });

  it("adds no fixed or sticky chrome to the shell, and no scroll container of its own", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
    expect(CODE).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch or a hairline", () => {
    const lengths = [...CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)(?![\w-])/g)];

    expect(lengths.length).toBeGreaterThan(0);
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

  it("lets the head wrap its actions under the headline rather than squeeze it", () => {
    expect(rule("\\.research__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.research__headings")).toMatch(/min-width:\s*[\d.]+rem/);
    expect(rule("\\.research__title")).toMatch(/text-wrap:\s*balance/);
    expect(rule("\\.research__title")).toMatch(/font-size:\s*var\(--t-2xl\)/);
    expect(rule("\\.research__actions")).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("the grid", () => {
  it("is the mockup's twelve columns: c-7 beside a c-5 side column, then c-12", () => {
    expect(rule("\\.research__grid")).toMatch(/grid-template-columns:\s*repeat\(12,\s*1fr\)/);
    expect(rule("\\.research__seat--main")).toMatch(/grid-column:\s*span 7/);
    expect(rule("\\.research__side")).toMatch(/grid-column:\s*span 5/);
    expect(rule("\\.research__side")).toMatch(/flex-direction:\s*column/);
    expect(rule("\\.research__seat--wide")).toMatch(/grid-column:\s*span 12/);
  });

  it("stacks the composer and the side column on a narrow pane", () => {
    expect(CODE).toMatch(
      /@media \(max-width: 68\.75rem\)\s*\{\s*\.research__seat--main,\s*\.research__side\s*\{\s*grid-column:\s*span 12;/,
    );
  });

  it("lets no seat push the pane sideways", () => {
    expect(rule("\\.research__seat")).toMatch(/min-width:\s*0/);
    expect(rule("\\.research__side")).toMatch(/min-width:\s*0/);
  });
});

describe("the landing ring", () => {
  it("is drawn from the accent tokens and replaces the browser's outline", () => {
    expect(rule("\\.research__seat--highlight")).toMatch(/box-shadow:[^;]*var\(--accent\)/);
    expect(rule("\\.research__seat:focus")).toMatch(/outline:\s*none/);
  });

  it("animates only for a reader who has not asked for less motion", () => {
    expect(rule("\\.research__seat")).not.toMatch(/transition/);
    expect(CODE).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.research__seat\s*\{\s*transition:/);
  });

  it("leaves room above a landed seat for the ring", () => {
    expect(rule("\\.research__seat")).toMatch(/scroll-margin-top:\s*var\(--sp-/);
  });
});
