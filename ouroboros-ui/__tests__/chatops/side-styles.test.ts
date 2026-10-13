import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/chatops/chatops-side.css` that are agreements with something outside it
 * (#543): the sheet and the components name the same classes; every length scales and every hue
 * is a token — which is what *both themes* and *the 125% font-scale step* can be verified as,
 * since jsdom applies no stylesheet; the command list scrolls inside its own bounded wrapper and
 * nothing else does; and no row can push the pane sideways.
 */

const CHATOPS = join(import.meta.dirname, "..", "..", "app", "chatops");
const SHEET = readFileSync(join(CHATOPS, "chatops-side.css"), "utf8");

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
 * @param name The class, without its dot.
 * @returns Their declarations, joined.
 */
function rules(name: string): string {
  return [...CODE.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) => selectors!.split(",").some((selector) => selector.trim() === `.${name}`))
    .map(([, , body]) => body)
    .join("\n");
}

/** Every side class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(chatops-side[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every side class a component renders — a quoted string made only of side classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:chatops-side[a-z0-9_-]*\s*)+)"/g)].flatMap((match) => match[1]!.trim().split(/\s+/)),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("styles nothing but its own classes, and leaves the card, the switch and the button to the design system", () => {
    expect(CODE).not.toMatch(/\.ou-/);
    expect(CODE).not.toMatch(/\.shell-/);
    expect(CODE).not.toMatch(/\.chatops__/);
    expect(CODE).not.toMatch(/\.chatops-mirror/);
    expect(CODE).not.toMatch(/\.inbox-/);
  });

  it("has no inline style in any component", () => {
    expect(COMPONENT).not.toMatch(/\bstyle=\{/);
  });

  it("adds no positioned chrome, and moves nothing", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky|absolute)/);
    expect(CODE).not.toMatch(/\b(animation|transition)\s*:/);
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
    expect(CODE).not.toMatch(/\bopacity\s*:/);
  });
});

describe("scrolling and wrapping", () => {
  it("scrolls the command list inside its own bounded wrapper, and nothing else", () => {
    const scrollers = [...CODE.matchAll(/([^{}]+)\{[^}]*overflow(?:-[xy])?:\s*(?:auto|scroll)[^}]*\}/g)].map((match) =>
      match[1]!.trim(),
    );

    expect(scrollers).toEqual([".chatops-side__cmd-scroll"]);
    expect(rules("chatops-side__cmd-scroll")).toMatch(/overflow-y:\s*auto/);
    expect(rules("chatops-side__cmd-scroll")).toMatch(/overflow-x:\s*hidden/);
    expect(rules("chatops-side__cmd-scroll")).toMatch(/max-height:\s*[\d.]+rem/);
    expect(CODE).not.toMatch(/overflow-x:\s*(?:auto|scroll)/);
  });

  it("wraps every row rather than pushing the pane sideways", () => {
    for (const name of [
      "chatops-side__cmd-line",
      "chatops-side__route-line",
      "chatops-side__chan",
      "chatops-side__oncall",
      "chatops-side__oncall-edit",
    ]) {
      expect(rules(name), `${name} wraps`).toMatch(/flex-wrap:\s*wrap/);
      expect(rules(name), `${name} may shrink`).toMatch(/min-width:\s*0/);
    }

    for (const name of ["chatops-side__cmd-code", "chatops-side__cmd-what", "chatops-side__evt", "chatops-side__oncall-who"]) {
      expect(rules(name), `${name} breaks a long word`).toMatch(/overflow-wrap:\s*anywhere/);
    }

    expect(CODE).not.toMatch(/white-space:\s*nowrap/);
  });
});

describe("the mockup's treatments", () => {
  it("draws a command in the accent mono face and its hints in the muted ink", () => {
    expect(rules("chatops-side__cmd-code")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rules("chatops-side__cmd-code")).toMatch(/color:\s*var\(--accent\)/);
    expect(rules("chatops-side__cmd-arg")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(rules("chatops-side__cmd-what")).toMatch(/text-align:\s*right/);
  });

  it("rules the rows apart with a hairline, and not after the last", () => {
    expect(rules("chatops-side__cmd")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(rules("chatops-side__route")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(CODE).toMatch(/\.chatops-side__cmd:last-child,\s*\.chatops-side__route:last-child\s*\{\s*border-bottom:\s*none/);
  });

  it("dims a denied command with an ink token, and warns in the warning hue", () => {
    expect(CODE).toMatch(/\.chatops-side__cmd--denied \.chatops-side__cmd-code[^{]*\{[^}]*color:\s*var\(--ink-faint\)/);
    expect(rules("chatops-side__evt-note")).toMatch(/color:\s*var\(--warn\)/);
    expect(rules("chatops-side__qualifier")).toMatch(/color:\s*var\(--warn\)/);
    expect(rules("chatops-side__oncall-who--warn")).toMatch(/color:\s*var\(--warn\)/);
    expect(rules("chatops-side__alert")).toMatch(/color:\s*var\(--err\)/);
  });
});
