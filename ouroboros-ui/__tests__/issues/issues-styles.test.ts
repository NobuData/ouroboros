import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/issues/issues.css` that are agreements with something outside it (#115).
 *
 * The generic rules — no colour literal outside the token sheet, no absolute type size — are
 * `__tests__/styles.test.ts`'s and cover this sheet as they cover every other. What is here is
 * narrower: that the sheet and the components beside it name the same classes, that every length
 * scales with the font-size preference and every hue is a token (which is what *both themes* can be
 * verified as, since jsdom applies no stylesheet), and that the page takes nothing from the shell it
 * mounts in — no fixed or sticky chrome of its own, and no restyling of the shell's overlay.
 */

const ISSUES = join(import.meta.dirname, "..", "..", "app", "issues");
const SHEET = readFileSync(join(ISSUES, "issues.css"), "utf8");

/** Every component in the directory, as one source — a class any of them renders is owed a rule. */
const COMPONENT = readdirSync(ISSUES)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(ISSUES, name), "utf8"))
  .join("\n");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

/** Every page class this sheet declares a rule for. */
const DECLARED = new Set([...CODE.matchAll(/\.(issues[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders, out of its `className` strings. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/className="([^"]*)"/g)]
    .flatMap((match) => match[1]!.split(/\s+/))
    .filter((name) => name === "issues" || name.startsWith("issues_") || name.startsWith("issues-")),
);

describe("the sheet and the components", () => {
  it("declares a rule for every class it names, and something renders every one", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("renders no page class the sheet has no rule for", () => {
    expect(RENDERED.size).toBeGreaterThan(0);

    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
    }
  });
});

describe("both themes and every font scale", () => {
  it("sizes nothing in pixels, so the font-size preference moves every length", () => {
    expect(CODE).not.toMatch(/\d+px\b/);
  });

  it("draws every hue from a token, so each palette is the token sheet's", () => {
    const colours = [...CODE.matchAll(/(?:^|[\s;{])(?:color|background(?:-color)?|border-color):\s*([^;]+);/g)];

    expect(colours.length).toBeGreaterThan(0);
    for (const [, value] of colours) expect(value!.trim()).toMatch(/^var\(--[a-z0-9-]+\)$/);
  });

  it("draws a refusal in the error hue and a report in the muted one", () => {
    expect(rule("\\.issues__outcome--err")).toContain("var(--err)");
    expect(rule("\\.issues__outcome")).toContain("var(--ink-mut)");
    expect(rule("\\.issues__unread")).toContain("var(--err)");
    expect(rule("\\.issues-filter__unread")).toContain("var(--err)");
  });

  it("draws a pressed chip in the token sheet's accent triple, off the attribute actually set (#116)", () => {
    // The mockup's `.tag.chip-on`: accent ink, a 35% accent hairline, the accent tint. Keyed on
    // `aria-pressed` rather than on a second class, so the treatment cannot disagree with what a
    // screen reader is told — and the same declarations under both palettes, since the three are
    // tokens the sheet redefines per palette.
    const pressed = rule('\\.issues-filter__chip\\[aria-pressed="true"\\]');

    expect(pressed).toContain("color: var(--accent)");
    expect(pressed).toContain("border-color: var(--accent-line)");
    expect(pressed).toContain("background: var(--accent-tint)");
    expect(CODE).not.toMatch(/issues-filter__chip--on/);
  });
});

describe("the shell it mounts in", () => {
  it("holds nothing fixed or sticky, because the pane is the only scroll container", () => {
    expect(CODE).not.toMatch(/position:\s*(?:fixed|sticky)/);
  });

  it("lets the actions wrap under the headline rather than push the pane sideways", () => {
    expect(rule("\\.issues__head")).toContain("flex-wrap: wrap");
    expect(rule("\\.issues__actions")).toContain("flex-wrap: wrap");
  });

  it("dresses the confirmation's column and leaves the shell's overlay to the shell", () => {
    // The title and note inside the dialog are the shell's own `shell-overlay__*` treatments.
    expect(CODE).not.toContain(".shell-overlay");
    expect(COMPONENT).toContain("shell-overlay__title");
  });
});
