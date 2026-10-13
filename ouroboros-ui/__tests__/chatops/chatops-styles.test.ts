import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/chatops/chatops.css` that are agreements with something outside it
 * (#541): the sheet and the components name the same classes, every length scales and every hue
 * is a token — which is what *both themes* and *the 125% font-scale step* can be verified as,
 * since jsdom applies no stylesheet — and that the page adds no chrome and no scroller.
 */

const CHATOPS = join(import.meta.dirname, "..", "..", "app", "chatops");
const SHEET = readFileSync(join(CHATOPS, "chatops.css"), "utf8");

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

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(chatops[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:chatops[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("chatops__") || name === "chatops"),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("leaves the card, the button, the eyebrow and the overlay to the design system", () => {
    expect(CODE).not.toMatch(/\.ou-/);
    expect(CODE).not.toMatch(/\.shell-/);
    expect(COMPONENT).toMatch(/\bCard\b/);
    expect(COMPONENT).toMatch(/\bButton\b/);
    expect(COMPONENT).toMatch(/\bEyebrow\b/);
    expect(COMPONENT).toMatch(/\bShellOverlay\b/);
  });

  it("adds no fixed or sticky chrome to the shell, and no scroller of its own", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
    // The pane is the page's one scroll container; the picker's list grows inside the shell's
    // overlay panel, which scrolls for it.
    expect(CODE).not.toMatch(/overflow(?:-[xy])?:\s*(?:auto|scroll)/);
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

  it("lets the head wrap its actions under the headline rather than squeeze it", () => {
    expect(rule("\\.chatops__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.chatops__headings")).toMatch(/min-width:\s*[\d.]+rem/);
    expect(rule("\\.chatops__title")).toMatch(/text-wrap:\s*balance/);
    expect(rule("\\.chatops__title")).toMatch(/font-size:\s*var\(--t-2xl\)/);
    expect(rule("\\.chatops__actions")).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("the health strip", () => {
  it("wraps rather than pushing the pane sideways", () => {
    expect(rule("\\.chatops__facts")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.chatops__facts")).toMatch(/min-width:\s*0/);
    expect(rule("\\.chatops__health-row")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("draws each tone from its own token — beside the words, which the components always render", () => {
    expect(rule("\\.chatops__fact--ok")).toMatch(/color:\s*var\(--ok\)/);
    expect(rule("\\.chatops__fact--warn")).toMatch(/color:\s*var\(--warn\)/);
    expect(rule("\\.chatops__fact--err")).toMatch(/color:\s*var\(--err\)/);
  });
});

describe("the rows", () => {
  it("wrap their controls under their text on a narrow pane", () => {
    expect(rule("\\.chatops__channel-actions")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.chatops__pick-row")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.chatops__picker-foot")).toBe("");
    expect(CODE).toMatch(/\.chatops__picker-actions,\s*\.chatops__picker-foot\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
