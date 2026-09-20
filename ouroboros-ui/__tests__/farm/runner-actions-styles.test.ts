import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The agreements `app/farm/runner-actions.css` keeps (#260). The farm's page sheet promises that
 * nothing on the page is placed against the viewport and nothing animates by itself
 * (`farm-styles.test.ts`); this sheet holds the two exceptions AI.5 needs, and this suite holds
 * each to the one selector that needs it: the runner menu's **panel** is `position: fixed`,
 * because the table's sideways scroller would clip it, and the **queue chip that just moved**
 * animates, only for a reader who has not asked for less motion. `log-pane-styles.test.ts` is
 * the same arrangement for the live card.
 *
 * jsdom applies no stylesheet, so *both themes* and *rem-based type* are verified the way every
 * sheet's are — every hue a token, every length one that scales.
 */

const FARM = join(import.meta.dirname, "..", "..", "app", "farm");
const SHEET = readFileSync(join(FARM, "runner-actions.css"), "utf8");

/** The two components that render this sheet's classes. */
const COMPONENTS = ["runner-menu.tsx", "runner-cells.tsx"]
  .map((name) => readFileSync(join(FARM, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** The sheet without its keyframes, whose stops are moments, not rules. */
const RULES = CODE.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`(?<![\\w-])${selector}\\s*\\{([^}]*)\\}`).exec(RULES)?.[1] ?? "";
}

/** Every class the sheet declares. */
const DECLARED = new Set(
  [...CODE.matchAll(/\.((?:runner-menu|queue-move)[a-z0-9_-]*)/g)].map((match) => match[1]!),
);

/** Every class of this sheet's that a component writes, as a whole word inside a string literal. */
const RENDERED = new Set(
  [...COMPONENTS.matchAll(/"([^"\n]*)"/g)]
    .flatMap((match) => match[1]!.split(/\s+/))
    .filter((word) => /^(?:runner-menu|queue-move)(?:__[a-z-]+)?(?:--[a-z-]+)?$/.test(word)),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("uses no `farm…` class, so the page sheet's own suite never has to look here", () => {
    expect(CODE).not.toMatch(/\.farm/);
  });

  it("agrees with the menu on the two custom properties that place the panel", () => {
    for (const property of ["--runner-menu-top", "--runner-menu-right"]) {
      expect(COMPONENTS).toContain(`"${property}"`);
      expect(CODE).toContain(`var(${property}`);
    }
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem or a hairline", () => {
    const lengths = [...RULES.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)/g)];

    for (const [value, , unit] of lengths) {
      if (unit === "px") expect(value, "only a hairline may be px").toBe("1px");
      else expect(unit).toBe("rem");
    }
  });

  it("sets its type size through a token, so the 125% step moves it", () => {
    const sizes = [...CODE.matchAll(/font-size:\s*([^;]+);/g)];

    expect(sizes.length).toBeGreaterThan(0);
    for (const [, value] of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("names no colour except through a token, so both palettes are one sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });

  it("recedes by ink, never by opacity", () => {
    expect(CODE).not.toMatch(/opacity/);
    expect(rule("\\.runner-menu__item--blocked,[^{]*")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("reaches into no design-system class", () => {
    expect(CODE).not.toMatch(/\.ou-/);
  });
});

describe("the menu's panel", () => {
  it("is the one thing placed against the viewport", () => {
    const fixed = [...RULES.matchAll(/([^{}@]+)\{[^{}]*position:\s*(?:fixed|sticky)/g)].map((match) =>
      match[1]!.trim(),
    );

    expect(fixed).toEqual([".runner-menu__panel"]);
  });

  it("is placed by the two properties the component measures, and nowhere by a literal", () => {
    const panel = rule("\\.runner-menu__panel");

    expect(panel).toMatch(/top:\s*var\(--runner-menu-top/);
    expect(panel).toMatch(/right:\s*var\(--runner-menu-right/);
    expect(panel).not.toMatch(/(?:bottom|left):/);
  });

  it("has a measure that lets a blocked item's reason wrap rather than widen the page", () => {
    const panel = rule("\\.runner-menu__panel");

    expect(panel).toMatch(/max-width:\s*[\d.]+rem/);
    expect(rule("\\.runner-menu__reason")).toMatch(/white-space:\s*normal/);
  });

  it("scrolls nothing", () => {
    expect(CODE).not.toMatch(/overflow(?:-[xy])?:\s*(?:auto|scroll)/);
  });

  it("draws the destructive item in the error hue under the pointer and the keyboard alike", () => {
    expect(CODE).toMatch(
      /\.runner-menu__item--danger:hover,\s*\.runner-menu__item--danger:focus-visible\s*\{[^}]*color:\s*var\(--err\)/,
    );
  });

  it("gives a blocked item no pointer's invitation", () => {
    expect(rule("\\.runner-menu__item--blocked,[^{]*")).toMatch(/cursor:\s*not-allowed/);
  });
});

describe("a queue depth that just moved", () => {
  it("animates under the moved attribute and nowhere else", () => {
    const animated = [...RULES.matchAll(/([^{}@]+)\{[^{}]*animation:/g)].map((match) => match[1]!.trim());

    expect(animated).toEqual([".queue-move[data-moved]"]);
    expect(CODE).not.toMatch(/transition/);
  });

  it("moves only for a reader who has not asked for less motion", () => {
    expect(CODE).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.queue-move\[data-moved\]\s*\{\s*animation:\s*queue-move-arrive/,
    );
  });

  it("is seen without the motion: the accent sits outside the guard", () => {
    // The first `.queue-move[data-moved]` rule in the sheet is the unguarded one.
    const still = rule("\\.queue-move\\[data-moved\\]");

    expect(still).toMatch(/color:\s*var\(--accent\)/);
    expect(still).toMatch(/background:\s*var\(--accent-tint\)/);
    expect(still).not.toMatch(/animation/);
  });

  it("marks nothing on a chip that has not moved", () => {
    expect(rule("\\.queue-move")).toBe("");
  });

  it("is driven by the attribute the cell sets", () => {
    expect(COMPONENTS).toMatch(/data-moved=\{moved \|\| undefined\}/);
  });
});
