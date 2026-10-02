import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/insights/insights.css` that are agreements with something outside it
 * (#443): the sheet and the components name the same classes, every length scales and every hue
 * is a token — which is what *both themes* and *the 125% font-scale step* can be verified as,
 * since jsdom applies no stylesheet — the mockup's grid, and that the page adds no chrome.
 */

const INSIGHTS = join(import.meta.dirname, "..", "..", "app", "insights");
const SHEET = readFileSync(join(INSIGHTS, "insights.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(INSIGHTS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(INSIGHTS, name), "utf8"))
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
const DECLARED = new Set([...CODE.matchAll(/\.(insights[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:insights[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("insights")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("leaves the stat tile to the design system rather than drawing a second one", () => {
    expect(CODE).not.toMatch(/\.ou-/);
    expect(COMPONENT).toContain("StatCard");
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

  it("lets a headline whose length changes wrap between the controls, not under them", () => {
    expect(rule("\\.insights__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.insights__headings")).toMatch(/min-width:\s*[\d.]+rem/);
    expect(rule("\\.insights__title")).toMatch(/text-wrap:\s*balance/);
    expect(rule("\\.insights__title")).toMatch(/font-size:\s*var\(--t-2xl\)/);
  });
});

describe("the range segment", () => {
  it("draws the chosen option in the accent fill and custom in the faint ink", () => {
    expect(rule("\\.insights-seg__option--selected")).toMatch(/background:\s*var\(--accent\)/);
    expect(rule("\\.insights-seg__option--selected")).toMatch(/color:\s*var\(--accent-ink\)/);
    expect(rule('\\.insights-seg__option\\[aria-disabled="true"\\]')).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule('\\.insights-seg__option\\[aria-disabled="true"\\]')).toMatch(/cursor:\s*not-allowed/);
  });
});

describe("the grid", () => {
  it("is the mockup's twelve columns, with the KPI row at c-2 c-2 c-2 c-3 c-3", () => {
    expect(rule("\\.insights__grid")).toMatch(/grid-template-columns:\s*repeat\(12,\s*1fr\)/);
    expect(rule("\\.insights-col--2")).toMatch(/grid-column:\s*span 2/);
    expect(rule("\\.insights-col--3")).toMatch(/grid-column:\s*span 3/);
    expect(COMPONENT).toContain('"insights-kpi insights-col--2"');
    expect(COMPONENT).toContain('"insights-kpi insights-col--3"');
  });

  it("stacks every card on a narrow pane", () => {
    expect(CODE).toMatch(/@media \(max-width: 40rem\)\s*\{\s*\.insights__grid > \*\s*\{\s*grid-column:\s*span 12;/);
  });
});

describe("the methodology popover", () => {
  it("opens over the cards, positioned by its own card, so the row never moves", () => {
    expect(rule("\\.insights-kpi")).toMatch(/position:\s*relative/);
    expect(rule("\\.insights-kpi__popover")).toMatch(/position:\s*absolute/);
  });

  it("resets the caption's uppercase mono, because the popover is prose", () => {
    expect(rule("\\.insights-kpi__popover")).toMatch(/text-transform:\s*none/);
    expect(rule("\\.insights-kpi__popover")).toMatch(/font-family:\s*var\(--f-ui\)/);
  });
});

describe("the bar cards and the scoreboard (#445)", () => {
  it("sit at the mockup's c-4 and c-8, and pair on a narrower pane", () => {
    expect(rule("\\.insights-col--4")).toMatch(/grid-column:\s*span 4/);
    expect(COMPONENT).toContain('"insights-series insights-col--4"');
    expect(COMPONENT).toContain('"insights-board insights-col--8"');
    expect(CODE).toMatch(/@media \(max-width: 68\.75rem\)\s*\{\s*\.insights-col--4\s*\{\s*grid-column:\s*span 6;/);
  });

  it("sizes the untouched column in rem, so the 125% step widens it with its type", () => {
    expect(rule("\\.insights-board__untouched-col")).toMatch(/width:\s*[\d.]+rem/);
  });

  it("colours the trend by goodness through the status tokens", () => {
    expect(rule("\\.insights-board__trend--good")).toMatch(/color:\s*var\(--ok\)/);
    expect(rule("\\.insights-board__trend--bad")).toMatch(/color:\s*var\(--err\)/);
  });

  it("draws the suggestion band on the inset well, as the mockup's row does", () => {
    expect(rule("\\.insights-board__suggestion")).toMatch(/background:\s*var\(--inset\)/);
  });
});
