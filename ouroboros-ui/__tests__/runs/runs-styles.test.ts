import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/runs/runs.css` that are agreements with something outside it (#309).
 * jsdom applies no stylesheet, so *both themes* and *the 125% font-scale step* are verified as
 * what they reduce to: every hue is a token, every length is a token or a rem, and every type
 * size is a token. The shell compliance half — no chrome of its own — is that the sheet fixes
 * and sticks nothing.
 */

const RUNS = join(import.meta.dirname, "..", "..", "app", "runs");
const SHEET = readFileSync(join(RUNS, "runs.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(RUNS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(RUNS, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(run[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:run[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("run")),
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
      else if (unit === "%") expect(value, "only a full-width cap may be a percentage").toBe("100%");
      else expect(["rem", "ch"]).toContain(unit);
    }
  });

  it("sets every type size through a token, so the 125% step moves all of it", () => {
    const sizes = [...CODE.matchAll(/font-size:\s*([^;]+);/g)];

    expect(sizes.length).toBeGreaterThan(0);
    for (const [, value] of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("names no colour except through a token, so both palettes are one sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CODE).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);

    for (const [, value] of CODE.matchAll(/(?:^|[\s;{])(?:color|background|border-color):\s*([^;]+);/g)) {
      expect(value!.trim()).toMatch(/^(var\(--[a-z0-9-]+\)|none|inherit|transparent)$/);
    }
  });
});

describe("the shell", () => {
  it("adds no fixed or sticky chrome, so the header and sidebar stay put while the pane scrolls", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });
});

describe("the stage timeline (#311)", () => {
  /**
   * One rule's body, by its exact selector.
   *
   * @param selector The selector as written.
   * @returns The declarations between its braces.
   */
  function rule(selector: string): string {
    const start = CODE.indexOf(`${selector} {`);
    expect(start, `${selector} is declared`).toBeGreaterThanOrEqual(0);

    return CODE.slice(start, CODE.indexOf("}", start));
  }

  it("animates only inside the reduced-motion guard, and the still variant keeps a ring", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: no-preference)", CODE.indexOf(".run-stepper"));
    const animation = CODE.indexOf("animation: run-step-pulse");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(animation).toBeGreaterThan(guard);
    for (const match of CODE.matchAll(/animation:/g)) expect(match.index).toBeGreaterThan(guard);
    expect(CODE.match(/transition:/g)?.length).toBeGreaterThan(0);
    for (const match of CODE.matchAll(/transition:/g)) expect(match.index).toBeGreaterThan(guard);

    // Without motion, active still reads: a static ring around the filled node.
    expect(rule(".run-step--active .run-step__node")).toMatch(/box-shadow:\s*0 0 0 0\.1875rem var\(--accent-tint\)/);
  });

  it("pulses only a live run's active node", () => {
    expect(CODE).toMatch(/\.run-stepper--live \.run-step--active \.run-step__node \{\s*animation: run-step-pulse/);
  });

  it("wraps the warn note and never truncates it", () => {
    const note = rule(".run-step__note");

    expect(note).toMatch(/overflow-wrap:\s*anywhere/);
    expect(note).not.toMatch(/text-overflow|white-space:\s*nowrap|overflow:\s*hidden|line-clamp/);
  });

  it("scrolls the strip inside its own wrapper, never the pane", () => {
    const scroll = rule(".run-timeline__scroll");

    expect(scroll).toMatch(/overflow-x:\s*auto/);
    expect(scroll).toMatch(/max-width:\s*100%/);
    expect(rule(".run-stepper")).toMatch(/min-width:\s*min-content/);
  });
});

describe("the agent transcript (#312)", () => {
  /**
   * One rule's body, by its exact selector.
   *
   * @param selector The selector as written.
   * @returns The declarations between its braces.
   */
  function rule(selector: string): string {
    const start = CODE.indexOf(`${selector} {`);
    expect(start, `${selector} is declared`).toBeGreaterThanOrEqual(0);

    return CODE.slice(start, CODE.indexOf("}", start));
  }

  it("scrolls in its own well, which never scrolls sideways — a wide diff scrolls inside itself", () => {
    const well = rule(".run-transcript__scroll");
    expect(well).toMatch(/overflow-y:\s*auto/);
    expect(well).toMatch(/overflow-x:\s*hidden/);
    expect(well).toMatch(/max-height:\s*[\d.]+rem/);

    expect(rule(".run-entry__diff")).toMatch(/overflow-x:\s*auto/);
    expect(rule(".run-entry__line")).toMatch(/white-space:\s*pre/);
    expect(rule(".run-entry")).toMatch(/min-width:\s*0/);
  });

  it("draws diffs in the code view's palette", () => {
    expect(rule(".run-entry__line--del")).toMatch(/background:\s*var\(--err-tint\);\s*color:\s*var\(--err\)/);
    expect(rule(".run-entry__line--add")).toMatch(/background:\s*var\(--ok-tint\);\s*color:\s*var\(--ok\)/);
  });

  it("sets the elision marker apart from content", () => {
    expect(rule(".run-entry--elision")).toMatch(/dashed/);
    expect(rule(".run-entry__elision")).toMatch(/font-style:\s*italic/);
  });

  it("pulses the live meter only inside the reduced-motion guard", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(CODE.indexOf(".run-entry__meter--live .run-entry__fill")).toBeGreaterThan(guard);
  });
});
