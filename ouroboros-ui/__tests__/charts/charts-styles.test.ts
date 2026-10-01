import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/charts/charts.css` that are agreements with something outside it
 * (#442). The generic rules — no colour literal, no px type — are `__tests__/styles.test.ts`'s
 * and cover this sheet already; these are the chart-specific ones.
 */

const CHARTS_DIR = join(import.meta.dirname, "..", "..", "app", "charts");
const SHEET = readFileSync(join(CHARTS_DIR, "charts.css"), "utf8");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** The reduced-motion guard's body, braces balanced. */
function motionBlock(): string {
  const start = CODE.indexOf("@media (prefers-reduced-motion: no-preference)");
  if (start < 0) return "";

  let depth = 0;
  const open = CODE.indexOf("{", start);

  for (let index = open; index < CODE.length; index++) {
    if (CODE[index] === "{") depth++;
    if (CODE[index] === "}") depth--;
    if (depth === 0) return CODE.slice(open + 1, index);
  }

  return "";
}

/** Every module in `app/charts/`, without its comments. */
const MODULES: readonly string[] = readdirSync(CHARTS_DIR)
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) =>
    readFileSync(join(CHARTS_DIR, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, " "),
  );

describe("motion", () => {
  it("animates nothing outside the reduced-motion guard", () => {
    // Entrance animation is decoration. A reader who has asked for less motion must get the
    // final state at once, which holds only if no `animation` is declared anywhere else.
    const outside = CODE.replace(motionBlock(), "");

    expect(motionBlock()).toMatch(/animation:/);
    expect(outside).not.toMatch(/animation:/);
    expect(outside).not.toMatch(/transition:/);
  });

  it("guards on `no-preference`, so the default for an unknown preference is still motion-safe", () => {
    expect(CODE).not.toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe("scrolling", () => {
  it("scrolls a wide chart inside its own wrapper, never the content pane", () => {
    expect(CODE).toMatch(/\.chart-scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(CODE).toMatch(/\.chart-scroll__inner\s*\{[^}]*min-width:\s*[\d.]+rem/);
  });
});

describe("type", () => {
  it("takes every font size from the rem scale, so the 125% font scale reaches the charts", () => {
    const sizes = [...CODE.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]!.trim());

    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toMatch(/^var\(--t-/);
  });

  it("sets no font size as an SVG attribute, which no root size would move", () => {
    for (const source of MODULES) {
      expect(source).not.toMatch(/fontSize=/);
      expect(source).not.toMatch(/font-size=/);
    }
  });
});

describe("the sheet and the charts it dresses", () => {
  const defined = new Set([...CODE.matchAll(/\.(chart-[\w-]+)/g)].map((match) => match[1]));
  const rendered = new Set(
    MODULES.flatMap((source) =>
      [...source.matchAll(/"([^"]*chart-[^"]*)"/g)].flatMap((match) =>
        match[1]!.split(/\s+/).filter((name) => /^chart-[\w-]+$/.test(name)),
      ),
    ),
  );

  it("defines a rule for every class a chart renders", () => {
    expect([...rendered].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("renders every class it defines a rule for", () => {
    expect([...defined].filter((name) => !rendered.has(name))).toEqual([]);
  });

  it("is imported by every module that renders one of its classes", () => {
    for (const name of readdirSync(CHARTS_DIR).filter((file) => file.endsWith(".tsx"))) {
      expect(readFileSync(join(CHARTS_DIR, name), "utf8"), name).toContain('import "./charts.css"');
    }
  });
});
