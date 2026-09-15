import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The code view's sheet (V.1, #169): every class it declares is rendered and every class
 * rendered is declared, the listing is mockup 05's `.ln` treatment scrolling inside itself, and
 * **both themes** hold because every value it reads is a token.
 *
 * jsdom applies no stylesheet, so the render suites prove the markup is identical in both
 * palettes and this suite proves the palettes are what the sheet reads.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const CODE_DIR = join(UI, "app", "workflows", "code");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = readFileSync(join(CODE_DIR, "code-view.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The modules that draw the sheet's classes. */
const MODULES = ["code-screen.tsx", "code-skeleton.tsx"]
  .map((name) => readFileSync(join(CODE_DIR, name), "utf8"))
  .join("\n");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

const DECLARED = new Set(
  [...CODE.matchAll(/\.((?:code-view|code-skeleton)[a-z0-9_-]*)/g)].map((match) => match[1]),
);
const RENDERED = new Set(
  [...MODULES.matchAll(/"((?:code-view|code-skeleton)[a-z0-9_-]*)"/g)].map((match) => match[1]),
);

describe("the sheet and the modules", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the modules render", () => {
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual([]);
  });
});

describe("the editor and the workbench", () => {
  it("are not styled here — each brings its own sheet", () => {
    expect(CODE).not.toMatch(/\.cm-|\.code-editor|\.code-workbench|\.code-tree|\.code-tab/);
  });
});

describe("the skeleton (V.7, #175)", () => {
  it("reserves the editor's well at the height the editor is bounded to, so the pane does not grow", () => {
    const editor = readFileSync(join(CODE_DIR, "code-editor.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    const bound = /\.code-editor \.cm-editor\s*\{[^}]*max-height:\s*([^;]+);/.exec(editor)?.[1];

    expect(bound).toBeDefined();
    expect(rule("\\.code-skeleton__editor")).toContain(`height: ${bound};`);
  });

  it("draws its regions on the workbench's own layout classes, and styles none of them here", () => {
    const skeleton = readFileSync(join(CODE_DIR, "code-skeleton.tsx"), "utf8");

    for (const region of [
      "code-workbench__toggles",
      "code-workbench__body",
      "code-tree",
      "code-workbench__editor",
      "code-tabs",
      "code-workbench__pane",
      "code-panel",
      "code-status",
    ]) {
      expect(skeleton).toContain(`"${region}"`);
    }
    expect(CODE).not.toMatch(/\.code-panel|\.code-status/);
  });

  it("lets its bars take their row's line box rather than a height of their own", () => {
    const bar = rule("\\.code-skeleton__bar");

    expect(bar).toMatch(/display:\s*inline-block/);
    expect(bar).not.toMatch(/(?:^|\s)height:/);
    expect(bar).toMatch(/color:\s*transparent/);
  });

  it("pulses only for a reader who has not asked for less motion, and pulses opacity only", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: no-preference)");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(CODE.indexOf("animation:")).toBeGreaterThan(guard);

    const frames = /@keyframes code-skeleton-pulse\s*\{([\s\S]*?)\n\}/.exec(CODE)?.[1];

    expect(frames).toMatch(/opacity/);
    expect(frames).not.toMatch(/transform|width|height|margin/);
  });
});

describe("tokens and the type scale", () => {
  it("names no colour literal — every hue is a token both palettes define", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("takes every font size from the sheet's scale", () => {
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("keeps every other length on a token or a rem, hairlines and focus rings excepted", () => {
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(?:border|outline)/);
    }
  });
});
