import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The right panel's sheet (V.5, #173): every class it declares is rendered and every class rendered
 * is declared; mockup 05's `.rp` treatments — the ok glyph, the warn row, the loopback row in the
 * accent, the mono eyebrow heads — are on the tokens they name; the panel hides below 1000px and its
 * toggle shows it; and **both themes** hold because every value it reads is a token both palettes
 * define.
 *
 * jsdom applies no stylesheet, so `code-panel-view.test.tsx` proves the markup is identical in both
 * palettes and this suite proves the palettes are what the sheet reads.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const CODE_DIR = join(UI, "app", "workflows", "code");

/**
 * A sheet without its prose, so a rule cannot be found inside a comment.
 *
 * @param path The sheet.
 * @returns Its rules.
 */
function sheet(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const PANEL = sheet(join(CODE_DIR, "code-panel.css"));
const WORKBENCH = sheet(join(CODE_DIR, "code-workbench.css"));
const TOKENS = sheet(join(UI, "app", "tokens.css"));
const MODULE = readFileSync(join(CODE_DIR, "code-panel-view.tsx"), "utf8");

/** The classes this sheet owns. */
const OWNED = /^code-panel/;

/**
 * One rule's declarations.
 *
 * @param css The sheet.
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(css: string, selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

/**
 * The sheet's narrow-viewport block.
 *
 * @param css The sheet.
 * @returns Everything inside `@media (max-width: 62.5rem) { … }`.
 */
function narrow(css: string): string {
  const start = css.indexOf("@media (max-width: 62.5rem)");
  return start === -1 ? "" : css.slice(start);
}

const DECLARED = new Set([...PANEL.matchAll(/\.(code-panel[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  [...MODULE.matchAll(/"([^"\n]*)"/g)]
    .flatMap((match) => (match[1] ?? "").split(/\s+/))
    .filter((name) => OWNED.test(name)),
);

describe("the sheet and the module", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the module renders", () => {
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual([]);
  });

  it("styles no primitive of the design system", () => {
    expect(PANEL).not.toContain(".ou-");
  });
});

describe("mockup 05's .rp treatments", () => {
  it("is a column on the inset well behind a hairline", () => {
    const panel = rule(PANEL, "\\.code-panel");

    expect(panel).toContain("background: var(--inset)");
    expect(panel).toContain("border-inline-start: 1px solid var(--line)");
    expect(panel).toContain("overflow-y: auto");
  });

  it("heads each section with a faint mono eyebrow", () => {
    const head = rule(PANEL, "\\.code-panel__head");

    expect(head).toContain("font-family: var(--f-mono)");
    expect(head).toContain("color: var(--ink-faint)");
    expect(head).toContain("text-transform: uppercase");
  });

  it("colours the ok glyph, the warn row and dot, and the error mark by their state tokens", () => {
    expect(rule(PANEL, "\\.code-panel__icon--ok")).toContain("color: var(--ok)");
    expect(rule(PANEL, "\\.code-panel__check--warn")).toContain("color: var(--warn)");
    expect(rule(PANEL, "\\.code-panel__dot")).toContain("background: var(--warn)");
    expect(rule(PANEL, "\\.code-panel__icon--err")).toContain("color: var(--err)");
  });

  it("draws the loopback row, its number and its glyph in the accent", () => {
    const loopback = /([^{}]*code-panel__row--loopback[^{}]*)\{([^}]*)\}/.exec(PANEL);

    expect(loopback?.[1]).toContain(".code-panel__row--loopback .code-panel__number");
    expect(loopback?.[1]).toContain(".code-panel__row--loopback .code-panel__glyph");
    expect(loopback?.[2]).toContain("color: var(--accent)");
  });
});

describe("below 1000px", () => {
  it("hides the panel, shows it again when open, and draws the toggle only there", () => {
    expect(rule(PANEL, "\\.code-panel-toggle")).toContain("display: none");

    const block = narrow(PANEL);
    expect(rule(block, "\\.code-panel")).toContain("display: none");
    expect(rule(block, "\\.code-panel\\.code-panel--open")).toContain("display: block");
    expect(rule(block, "\\.code-panel-toggle")).toContain("display: inline-flex");
  });

  it("wraps the workbench's body, so the open panel takes a row under the editor", () => {
    expect(rule(narrow(WORKBENCH), "\\.code-workbench__body")).toContain("flex-wrap: wrap");
  });
});

describe("both themes", () => {
  it("reads nothing but tokens for colour — no literal", () => {
    expect(PANEL).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(PANEL).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });

  it("reads only tokens the token sheet defines, and every colour in both palettes", () => {
    const read = new Set([...PANEL.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]));
    const colours = ["--inset", "--line", "--ink", "--ink-dim", "--ink-faint", "--ok", "--warn", "--err", "--accent"];

    for (const token of read) {
      expect(TOKENS, token).toMatch(new RegExp(`${token}\\s*:`));
    }
    for (const token of colours) {
      expect(read.has(token), `the sheet reads ${token}`).toBe(true);
      expect(TOKENS.match(new RegExp(`${token}\\s*:`, "g"))?.length ?? 0, token).toBeGreaterThanOrEqual(2);
    }
  });

  it("sets no type size in px, so the font-size preference scales the panel", () => {
    expect(PANEL).not.toMatch(/font-size:\s*[\d.]+px/);
  });
});
