import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CHART_MIN_WIDTH_REM,
  MARK_BORDER_REM,
  MARK_CH_EM,
  MARK_FONT_REM,
  MARK_OFFSET_REM,
  MARK_PAD_REM,
  MARK_ROW_REM,
  MARK_SLACK_CH,
} from "@/app/charts/marks";

/**
 * The properties of `app/charts/charts.css` that are agreements with something outside it
 * (#442). The generic rules — no colour literal, no px type — are `__tests__/styles.test.ts`'s
 * and cover this sheet already; these are the chart-specific ones.
 */

const CHARTS_DIR = join(import.meta.dirname, "..", "..", "app", "charts");
const SHEET = readFileSync(join(CHARTS_DIR, "charts.css"), "utf8");
const TOKENS = readFileSync(join(CHARTS_DIR, "..", "tokens.css"), "utf8");

/**
 * A token's value in rem, as the token sheet first declares it.
 *
 * @param name The custom property, e.g. `--sp-4`.
 * @returns The number of rem.
 */
function tokenRem(name: string): number {
  return Number(new RegExp(`${name}:\\s*([\\d.]+)rem`).exec(TOKENS)?.[1]);
}

/**
 * One rule's declarations — the first rule with exactly this selector.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`(?:^|\\}|\\s)(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

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

describe("marker chips, and the layout that places them", () => {
  // app/charts/marks.ts solves the chips' layout in rem, at the chart's narrowest width. Every
  // length it assumes is declared here; if the two part, chips overlap where the layout says
  // they do not.
  const chip = rule("\\.chart-mark");

  it("is solved at the scroll wrapper's own minimum widths", () => {
    expect(rule("\\.chart-scroll__inner")).toContain(`min-width: ${CHART_MIN_WIDTH_REM.wide}rem`);
    expect(rule("\\.chart-scroll__inner--half")).toContain(`min-width: ${CHART_MIN_WIDTH_REM.half}rem`);
  });

  it("measures a chip in the type and the padding the sheet gives it", () => {
    expect(chip).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(chip).toMatch(/font-size:\s*var\(--t-2xs\)/);
    expect(tokenRem("--t-2xs")).toBe(MARK_FONT_REM);
    expect(chip).toMatch(/padding:\s*0 var\(--sp-3\)/);
    expect(tokenRem("--sp-3")).toBe(MARK_PAD_REM);
    expect(chip).toMatch(/border:\s*1px solid/);
    expect(tokenRem("--sp-1")).toBe(MARK_BORDER_REM);
    // The width is the text's alone — a button is border-box unless told otherwise, which would
    // take the padding out of it and ellipsise every label.
    expect(chip).toMatch(/box-sizing:\s*content-box/);
    expect(chip).toContain(`width: calc((var(--chart-chars, 0) + ${MARK_SLACK_CH}) * 1ch)`);
  });

  it("assumes an advance no narrower than a hinted renderer draws — a whole pixel up from 0.6em", () => {
    // IBM Plex Mono's advance is 0.6em: 6.6px of the chip's 11px face, which hinting snaps to 7.
    const hinted = Math.ceil(0.6 * MARK_FONT_REM * 16) / (MARK_FONT_REM * 16);

    expect(MARK_CH_EM).toBeGreaterThanOrEqual(hinted);
  });

  it("starts a chip after its vertical, or against the plot's right edge — whichever is further left", () => {
    const left = /left:\s*max\(\s*0%,\s*min\(([\s\S]*)\)\s*\);/.exec(chip)?.[1] ?? "";

    expect(left).toContain("calc(var(--chart-x, 0%) + var(--sp-2))");
    expect(tokenRem("--sp-2")).toBe(MARK_OFFSET_REM);
    // The edge rule subtracts the chip's whole width: its characters, both paddings, both borders.
    expect(left.replace(/\s+/g, " ")).toContain(
      `calc(100% - var(--chart-end, 0%) - (var(--chart-chars, 0) + ${MARK_SLACK_CH}) * 1ch - 2 * var(--sp-3) - var(--sp-1))`,
    );
  });

  it("stacks the rows at one pitch, in the band, the chips and their stems alike", () => {
    const pitch = `${MARK_ROW_REM}rem`;

    expect(rule("\\.chart-marks")).toContain(`var(--chart-rows, 0) * ${pitch}`);
    expect(chip).toContain(`var(--chart-row, 0) * ${pitch}`);
    expect(rule("\\.chart-mark__stem")).toContain(`var(--chart-row, 0) * ${pitch}`);
  });

  it("cuts a label that outgrows its room with an ellipsis instead of spilling onto a neighbour", () => {
    expect(chip).toMatch(/overflow:\s*hidden/);
    expect(chip).toMatch(/text-overflow:\s*ellipsis/);
    expect(chip).toMatch(/white-space:\s*nowrap/);
  });

  it("tints by tone from the warning and success tokens, opaque over the card's surface", () => {
    const warn = rule("\\.chart-mark--warn");
    const ok = rule("\\.chart-mark--ok");

    expect(warn).toMatch(/color:\s*var\(--warn\)/);
    expect(warn).toMatch(/border-color:\s*var\(--warn-line\)/);
    expect(warn).toMatch(/background:.*var\(--warn-tint\).*var\(--surface\)/);
    expect(ok).toMatch(/color:\s*var\(--ok\)/);
    expect(ok).toMatch(/border-color:\s*var\(--ok-line\)/);
    expect(ok).toMatch(/background:.*var\(--ok-tint\).*var\(--surface\)/);
    expect(ok).not.toMatch(/--warn/);
  });

  it("draws a focus ring on a chip, and the stem behind the chips", () => {
    expect(rule("\\.chart-mark:focus-visible")).toMatch(/outline:\s*2px solid var\(--accent\)/);
    expect(chip).toMatch(/z-index:\s*1/);
    expect(rule("\\.chart-mark__stem")).not.toMatch(/z-index/);
  });

  it("lays the day columns and the tooltip over the plot alone, never over the chips", () => {
    expect(rule("\\.chart-ts__plot")).toMatch(/position:\s*relative/);
    expect(rule("\\.chart-ts__hits")).toMatch(/position:\s*absolute/);
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
