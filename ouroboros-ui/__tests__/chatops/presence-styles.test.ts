import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/chatops/chatops-presence.css` that are agreements with something
 * outside it (#544): the sheet and the components name the same classes; every length scales and
 * every hue is a token — which is what *both themes* and *the 125% font-scale step* can be
 * verified as, since jsdom applies no stylesheet; nothing scrolls or is positioned; and the
 * preview's marks are drawn differently from the mirror's live ones.
 */

const CHATOPS = join(import.meta.dirname, "..", "..", "app", "chatops");
const SHEET = readFileSync(join(CHATOPS, "chatops-presence.css"), "utf8");
const MIRROR = readFileSync(join(CHATOPS, "chatops-mirror.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(CHATOPS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(CHATOPS, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * Every rule a selector takes part in, grouped ones included.
 *
 * @param name The selector, without its dot.
 * @param sheet The sheet to read. This card's when omitted.
 * @returns Their declarations, joined.
 */
function rules(name: string, sheet: string = CODE): string {
  return [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) => selectors!.split(",").some((selector) => selector.trim() === `.${name}`))
    .map(([, , body]) => body)
    .join("\n");
}

/** Every presence class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(chatops-presence[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every presence class a component renders — a quoted string made only of presence classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:chatops-presence[a-z0-9_-]*\s*)+)"/g)].flatMap((match) => match[1]!.trim().split(/\s+/)),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("styles nothing but its own classes — the messages stay the mirror's, the button the design system's", () => {
    expect(CODE).not.toMatch(/\.ou-/);
    expect(CODE).not.toMatch(/\.shell-/);
    expect(CODE).not.toMatch(/\.chatops__/);
    expect(CODE).not.toMatch(/\.chatops-mirror/);
    expect(CODE).not.toMatch(/\.chatops-side/);
  });

  it("adds no positioned chrome, no scroller, and moves nothing", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky|absolute)/);
    expect(CODE).not.toMatch(/overflow(?:-[xy])?:\s*(?:auto|scroll)/);
    expect(CODE).not.toMatch(/\b(animation|transition)\s*:/);
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem or a hairline", () => {
    for (const [value, , unit] of CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)(?![\w-])/g)) {
      if (unit === "px") expect(value, "only a 1px hairline may be px").toBe("1px");
      else expect(unit).toBe("rem");
    }

    expect(CODE).toMatch(/var\(--sp-/);
  });

  it("sets every type size through a token, so the 125% step moves all of it", () => {
    const sizes = [...CODE.matchAll(/font-size:\s*([^;]+);/g)];

    expect(sizes.length).toBeGreaterThan(0);
    for (const [, value] of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("names no colour except through a token, so both palettes are one sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
    expect(CODE).not.toMatch(/\bopacity\s*:/);
  });

  it("wraps every line rather than pushing the pane sideways", () => {
    for (const name of ["chatops-presence__mark"]) expect(rules(name)).toMatch(/flex-wrap:\s*wrap/);

    for (const name of [
      "chatops-presence__arrives",
      "chatops-presence__text",
      "chatops-presence__why",
      "chatops-presence__sys",
      "chatops-presence__caption",
      "chatops-presence__today",
    ]) {
      expect(rules(name), `${name} breaks a long word`).toMatch(/overflow-wrap:\s*anywhere/);
    }

    expect(CODE).not.toMatch(/white-space:\s*nowrap/);
  });
});

describe("the preview's marks", () => {
  it("draws the chip and its arrival in the warning hue — not the mirror chip's accent", () => {
    expect(rules("chatops-presence__chip")).toMatch(/color:\s*var\(--warn\)/);
    expect(rules("chatops-presence__chip")).toMatch(/background:\s*var\(--warn-tint\)/);
    expect(rules("chatops-presence__arrives")).toMatch(/color:\s*var\(--warn\)/);
    expect(rules("chatops-mirror__chip", MIRROR)).toMatch(/color:\s*var\(--accent\)/);
  });

  it("frames the illustrated thread with a dashed line", () => {
    expect(rules("chatops-presence__thread--preview")).toMatch(/border:\s*1px dashed var\(--line-strong\)/);
  });

  it("tells the illustrated system line from the mirror's: faint and dashed, where the mirror's is green and solid", () => {
    expect(rules("chatops-presence__sys")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rules("chatops-presence__sys")).toMatch(/font-style:\s*italic/);
    expect(CODE).toMatch(/\.chatops-presence__sys::before,\s*\.chatops-presence__sys::after\s*\{[^}]*border-top:\s*1px dashed/);

    expect(rules("chatops-mirror__sys", MIRROR)).toMatch(/color:\s*var\(--ok\)/);
    expect(rules("chatops-mirror__sys", MIRROR)).not.toMatch(/italic/);
    expect(MIRROR).not.toMatch(/dashed/);
  });
});
