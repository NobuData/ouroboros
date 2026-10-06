import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `app/get-started/get-started.css`'s agreements (#390; the detection card's `detect*` classes
 * since #391, the template tiles' `tile*` classes since #392): the sheet and the components name the
 * same classes; every length is a token, a rem, a `ch` or a hairline, so the 125 % font-scale
 * step scales the frame; every hue is a token, so both themes come from `app/tokens.css`; and only
 * the step content scrolls. jsdom applies no stylesheet, so these are asserted on the source.
 */

const DIR = join(import.meta.dirname, "..", "..", "app", "get-started");
const SHEET = readFileSync(join(DIR, "get-started.css"), "utf8");
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");
const COMPONENTS = readdirSync(DIR)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(DIR, name), "utf8"))
  .join("\n");

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.((?:wizard|offer-banner|detect|tiles?)[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string of page classes. */
const RENDERED = new Set(
  [...COMPONENTS.matchAll(/"((?:(?:wizard|offer-banner|detect|tiles?)[a-z0-9_-]*\s*)+)"/g)].flatMap((match) => match[1]!.trim().split(/\s+/)),
);

/** One rule's declarations. */
function rule(selector: string): string {
  const found = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(CODE);

  if (found === null) throw new Error(`no rule for ${selector}`);

  return found[1]!;
}

describe("the get-started sheet", () => {
  it("declares and renders the same classes", () => {
    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("sizes in tokens, rems, ch and hairlines only — no px text", () => {
    const lengths = [...CODE.matchAll(/(-?\d*\.?\d+)(px|rem|em|ch|vh|vw)\b/g)].map((match) => match[0]);

    for (const length of lengths) expect(length, length).toMatch(/^(-?\d*\.?\d+(rem|ch)|1px)$/);
  });

  it("colours in tokens only — so both themes come from the token sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CODE).not.toMatch(/\b(rgb|hsl)a?\(/);
  });

  it("scrolls the step content alone — the head, the rail and the bar keep their place", () => {
    expect(rule(".wizard")).toMatch(/height:\s*100%/);
    expect(rule(".wizard__content")).toMatch(/overflow-y:\s*auto/);
    expect(rule(".wizard__content")).toMatch(/min-height:\s*0/);
    for (const fixed of [".wizard__head", ".wizard-rail", ".wizard-bar"]) expect(rule(fixed)).toMatch(/flex:\s*none/);
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("collapses the rail two by two at the mockup's break", () => {
    expect(CODE).toMatch(/@media \(max-width: 56\.25rem\)\s*\{\s*\.wizard-rail__steps\s*\{[^}]*repeat\(2,/);
  });
});
