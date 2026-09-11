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

/**
 * Every page class a component renders, out of its class-list string literals — a `className`
 * attribute, a `rowClassName` result, a `cx()` argument. A literal counts when it is nothing but
 * class tokens, so a sentence that happens to contain the word *issues* is not one.
 */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:(?:issues|ou-)[a-z0-9_-]*)(?:\s+(?:issues|ou-)[a-z0-9_-]*)*)"/g)]
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

describe("the backlog table (#117)", () => {
  it("draws the checkbox from the sheet, in tokens, with a hairline the font scale can move", () => {
    const box = rule("\\.issues-table__ckbox");

    expect(box).toContain("appearance: none");
    expect(box).toMatch(/border: [\d.]+rem solid var\(--line-strong\)/);
    expect(box).toContain("background: var(--inset)");

    const on = rule("\\.issues-table__ckbox:checked,\\s*\\.issues-table__ckbox:indeterminate");
    expect(on).toContain("background: var(--accent)");
    expect(on).toContain("color: var(--accent-ink)");
    expect(on).toContain("border-color: var(--accent-deep)");
  });

  it("marks the checked box and the indeterminate one with a glyph each, drawn rather than typed", () => {
    expect(rule("\\.issues-table__ckbox:checked::after")).toContain('content: "✓"');
    expect(rule("\\.issues-table__ckbox:indeterminate::after")).toMatch(/content: "."/);
  });

  it("animates the pill swap only under the reduced-motion guard, keyed on the attribute the table sets", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: no-preference)");
    const swap = CODE.indexOf(".issues-table__status[data-swapped]");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(swap).toBeGreaterThan(guard);
    expect(rule("\\.issues-table__status\\[data-swapped\\]")).toMatch(/animation: issues-pill-swap/);
    expect(CODE).toContain("@keyframes issues-pill-swap");
    expect(CODE).not.toMatch(/issues-table__status--swapped/);
  });

  it("lights the inspected row's number in the accent, apart from the check glow", () => {
    expect(rule("\\.issues-table__row--inspected \\.issues-table__number")).toContain("color: var(--accent)");
  });

  it("leaves the primitives' own classes to the design system's sheet", () => {
    // A page places a primitive by passing its class, never by restyling `.ou-*` from its own
    // sheet — the checked rows' glow is the primitive's accent selection, not a rule here.
    expect(CODE).not.toMatch(/\.ou-/);
  });
});

describe("the selection bar (#118)", () => {
  it("places the sticky bar and leaves its rim and glow to the primitive", () => {
    // The mockup's `.sel-bar` glow is `ou-sticky-bar--asking`'s; the page adds the gap above
    // and the wrap, and neither a colour nor a position of its own.
    const bar = rule("\\.issues-bar");

    expect(bar).toContain("flex-wrap: wrap");
    expect(bar).toMatch(/margin-top: var\(--sp-\d+\)/);
    expect(bar).not.toMatch(/color|background|box-shadow|position/);
  });

  it("opens the menu above the bar it hangs from", () => {
    // The chrome contract puts the sticky bar at z-index 11 (`app/ui/chrome.ts`); a panel that
    // opened beneath it would be a menu the bar covers.
    expect(rule("\\.issues-bar__menu")).toMatch(/z-index: (1[2-9]|[2-9]\d)/);
    expect(rule("\\.issues-bar__menu")).toContain("background: var(--surface)");
  });

  it("marks the checked row off the attribute actually set, in the accent", () => {
    expect(rule('\\.issues-bar__option\\[aria-checked="true"\\]')).toContain("var(--accent)");
    expect(CODE).not.toMatch(/issues-bar__option--(?:checked|current)/);
  });

  it("draws the toast in the accent rim and tint, since it answers the bar", () => {
    const toast = rule("\\.issues-toast");

    expect(toast).toContain("border: 0.0625rem solid var(--accent-line)");
    expect(toast).toContain("background: var(--accent-tint)");
  });
});

describe("the grid and the detail panel (#119)", () => {
  it("seats the table in eight columns and the panel in four, and stacks them at the mockup's break", () => {
    expect(rule("\\.issues__grid")).toMatch(/grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
    expect(rule("\\.issues__main")).toContain("grid-column: span 8");
    expect(rule("\\.issues__aside")).toContain("grid-column: span 4");

    const stack = CODE.indexOf(".issues__grid > *");
    expect(stack).toBeGreaterThan(CODE.indexOf("@media (max-width: 68.75rem)"));
    expect(rule("\\.issues__grid > \\*")).toContain("grid-column: span 12");
  });

  it("rules the excerpt on its reading edge, in logical properties, as an italic quotation", () => {
    const excerpt = rule("\\.issues-panel__excerpt");

    expect(excerpt).toMatch(/border-inline-start: [\d.]+rem solid var\(--line-strong\)/);
    expect(excerpt).toContain("font-style: italic");
    expect(excerpt).toContain("color: var(--ink-mut)");
  });

  it("colours the risk level off the attribute the component sets, in the three status inks", () => {
    expect(rule('\\.issues-panel__risk-level\\[data-risk="low"\\]')).toContain("var(--ok)");
    expect(rule('\\.issues-panel__risk-level\\[data-risk="medium"\\]')).toContain("var(--warn)");
    expect(rule('\\.issues-panel__risk-level\\[data-risk="high"\\]')).toContain("var(--err)");
    expect(CODE).not.toMatch(/issues-panel__risk-level--/);
  });

  it("draws the trace as a disclosure whose marker turns with the element's own state", () => {
    expect(rule("\\.issues-panel__trace-head")).toContain("list-style: none");
    expect(rule("\\.issues-panel__trace\\[open\\] > \\.issues-panel__trace-head::before")).toMatch(/content: "."/);
    expect(rule("\\.issues-panel__trace")).toContain("background: var(--inset)");
    expect(rule("\\.issues-panel__trace-line--err")).toContain("color: var(--err)");
  });

  it("pulses the skeleton only under the reduced-motion guard", () => {
    const guard = CODE.lastIndexOf("@media (prefers-reduced-motion: no-preference)");
    const pulse = CODE.indexOf("animation: issues-skeleton-pulse");

    expect(pulse).toBeGreaterThan(guard);
    expect(CODE).toContain("@keyframes issues-skeleton-pulse");
    expect(rule("\\.issues-panel__skeleton-bar")).toContain("background: var(--raised)");
  });

  it("keeps a long path or token from widening the column", () => {
    expect(rule("\\.issues-panel__files li")).toContain("overflow-wrap: anywhere");
    expect(rule("\\.issues-panel__title")).toContain("overflow-wrap: anywhere");
    expect(rule("\\.issues__main")).toContain("min-width: 0");
    expect(rule("\\.issues__aside")).toContain("min-width: 0");
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
