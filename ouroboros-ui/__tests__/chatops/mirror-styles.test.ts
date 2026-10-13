import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/chatops/chatops-mirror.css` that are agreements with something outside
 * it (#542): the sheet and the components name the same classes; every length scales and every
 * hue is a token — which is what *both themes* and *the 125% font-scale step* can be verified
 * as, since jsdom applies no stylesheet; the stream scrolls inside its own bounded wrapper and
 * nothing else does; and no line can push the pane sideways.
 */

const CHATOPS = join(import.meta.dirname, "..", "..", "app", "chatops");
const SHEET = readFileSync(join(CHATOPS, "chatops-mirror.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(CHATOPS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(CHATOPS, name), "utf8"))
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
  return new RegExp(`(?:^|\\}|\\s)(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

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

/** Every mirror class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(chatops-mirror[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every mirror class a component renders — a quoted string made only of mirror classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:chatops-mirror[a-z0-9_-]*\s*)+)"/g)].flatMap((match) => match[1]!.trim().split(/\s+/)),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("styles nothing but its own classes", () => {
    expect(CODE).not.toMatch(/\.ou-/);
    expect(CODE).not.toMatch(/\.shell-/);
    expect(CODE).not.toMatch(/\.chatops__/);
    expect(CODE).not.toMatch(/\.inbox-/);
  });

  it("has no inline style in any component", () => {
    expect(COMPONENT).not.toMatch(/\bstyle=\{/);
  });

  it("adds no fixed or sticky chrome to the shell", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky|absolute)/);
  });

  it("moves nothing: no animation and no transition", () => {
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
  });

  it("swaps the app mark with the palette, by attribute and by preference", () => {
    expect(rule("\\.chatops-mirror__mark--dark")).toMatch(/display:\s*none/);
    expect(CODE).toMatch(/:root\[data-theme="dark"\] \.chatops-mirror__mark--light\s*\{\s*display:\s*none/);
    expect(CODE).toMatch(/:root\[data-theme="dark"\] \.chatops-mirror__mark--dark\s*\{\s*display:\s*block/);
    expect(CODE).toMatch(/prefers-color-scheme:\s*dark[^}]*\{\s*:root:not\(\[data-theme="light"\]\)/);
  });
});

describe("scrolling", () => {
  it("scrolls the stream inside its own bounded wrapper, and never sideways", () => {
    const stream = rule("\\.chatops-mirror__stream");

    expect(stream).toMatch(/overflow-y:\s*auto/);
    expect(stream).toMatch(/overflow-x:\s*hidden/);
    expect(stream).toMatch(/max-height:\s*[\d.]+rem/);
    expect(stream).toMatch(/min-width:\s*0/);
  });

  it("has no other scroller but the composer's list, which is bounded too", () => {
    const scrollers = [...CODE.matchAll(/([^{}]+)\{[^}]*overflow(?:-[xy])?:\s*(?:auto|scroll)[^}]*\}/g)].map((match) =>
      match[1]!.trim(),
    );

    expect(scrollers.sort()).toEqual([".chatops-mirror__options", ".chatops-mirror__stream"]);
    expect(rule("\\.chatops-mirror__options")).toMatch(/max-height:\s*[\d.]+rem/);
    expect(CODE).not.toMatch(/overflow-x:\s*(?:auto|scroll)/);
  });

  it("clips the card rather than letting anything out of it", () => {
    expect(rule("\\.chatops-mirror")).toMatch(/overflow:\s*hidden/);
    expect(rule("\\.chatops-mirror")).toMatch(/min-width:\s*0/);
  });

  it("wraps every line that could be long inside its own box", () => {
    for (const name of [
      "chatops-mirror__mono",
      "chatops-mirror__reply",
      "chatops-mirror__headline",
      "chatops-mirror__line",
      "chatops-mirror__sys",
      "chatops-mirror__footnote",
      "chatops-mirror__resolution",
      "chatops-mirror__warning",
      "chatops-mirror__hint",
      "chatops-mirror__channel",
      "chatops-mirror__name",
    ]) {
      expect(rules(name), `${name} wraps`).toMatch(/overflow-wrap:\s*anywhere/);
    }

    for (const name of ["chatops-mirror__msg", "chatops-mirror__body", "chatops-mirror__rich", "chatops-mirror__answer", "chatops-mirror__reply"]) {
      expect(rules(name), `${name} may shrink`).toMatch(/min-width:\s*0/);
    }

    expect(rule("\\.chatops-mirror__answer")).toMatch(/align-items:\s*flex-start/);
  });

  it("wraps the head and the card's buttons under themselves on a narrow pane", () => {
    expect(rule("\\.chatops-mirror__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.chatops-mirror__trail")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.chatops-mirror__actions")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.chatops-mirror__meta")).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("the mockup's treatments", () => {
  it("draws each severity from its own token, on the card's edge and its headline", () => {
    for (const [severity, token] of [
      ["ok", "--ok"],
      ["warn", "--warn"],
      ["accent", "--accent"],
      ["err", "--err"],
    ] as const) {
      expect(rule(`\\.chatops-mirror__rich--${severity}`)).toMatch(new RegExp(`border-left-color:\\s*var\\(${token}\\)`));
      expect(rule(`\\.chatops-mirror__headline--${severity}`)).toMatch(new RegExp(`color:\\s*var\\(${token}\\)`));
    }
  });

  it("gives the card that waits for a person its glow, and only that one", () => {
    expect(rule("\\.chatops-mirror__rich--warn")).toMatch(/box-shadow:[^;]*var\(--warn-line\)/);
    expect(CODE.match(/box-shadow/g)).toHaveLength(1);
  });

  it("flanks a system line and a day with rules", () => {
    expect(CODE).toMatch(/\.chatops-mirror__sys::before,\s*\.chatops-mirror__sys::after\s*\{[^}]*height:\s*1px/);
    expect(CODE).toMatch(/\.chatops-mirror__day-rule::before/);
  });

  it("boxes a reply in the mono face, and a failed one in the error hue beside its words", () => {
    expect(rule("\\.chatops-mirror__reply")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.chatops-mirror__reply")).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(rule("\\.chatops-mirror__reply--err")).toMatch(/color:\s*var\(--err\)/);
  });

  it("marks Teams as unavailable to the eye as well as to the pointer", () => {
    expect(rule("\\.chatops-mirror__seg-item--off")).toMatch(/cursor:\s*not-allowed/);
    expect(rule("\\.chatops-mirror__seg-item--off")).toMatch(/text-decoration:\s*line-through/);
  });
});
