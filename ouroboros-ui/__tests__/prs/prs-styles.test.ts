import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/prs/prs.css` that are agreements with something outside it (#363). jsdom
 * applies no stylesheet, so *both themes* and *the 125% font-scale step* are verified as what they
 * reduce to: every hue is a token, every length is a token or a rem, and every type size is a
 * token. The shell compliance half — no chrome of its own, a fixed header and sidebar while the
 * pane scrolls — is that the sheet fixes and sticks nothing.
 */

const DIRECTORY = join(import.meta.dirname, "..", "..", "app", "prs");
const SHEET = readFileSync(join(DIRECTORY, "prs.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(DIRECTORY, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(prv[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:prv[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("prv")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
    }
  });

  it("write no style on an element — every treatment is a class", () => {
    expect(COMPONENT).not.toMatch(/\bstyle=\{/);
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch or a hairline", () => {
    for (const [value, , unit] of CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)/g)) {
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
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CODE).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);

    for (const [, value] of CODE.matchAll(
      /(?:^|[\s;{])(?:color|background|border-color|accent-color):\s*([^;]+);/g,
    )) {
      expect(value!.trim()).toMatch(/^(var\(--[a-z0-9-]+\)|none|inherit|transparent)$/);
    }
  });
});

describe("the shell", () => {
  it("adds no fixed or sticky chrome, so the header and sidebar stay put while the pane scrolls", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("wraps the head and its long values rather than scrolling the page sideways", () => {
    expect(CODE).toMatch(/\.prv-head \{[^}]*flex-wrap: wrap;/);
    expect(CODE).toMatch(/\.prv-head__main \{[^}]*min-width: 0;/);
    expect(CODE).toMatch(/\.prv-head__title \{[^}]*overflow-wrap: anywhere;/);
    expect(CODE).toMatch(/\.prv-return__evidence \{[^}]*overflow-wrap: anywhere;/);
    expect(CODE).not.toMatch(/overflow(-x)?:\s*(scroll|auto)/);
  });

  it("reads the actions from the left on a narrow pane", () => {
    expect(CODE).toMatch(
      /@media \(max-width: 68\.75rem\)\s*\{\s*\.prv-actions\s*\{\s*align-items: flex-start;/,
    );
  });
});
