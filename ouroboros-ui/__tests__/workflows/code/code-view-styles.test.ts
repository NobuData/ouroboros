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

describe("the file card's head", () => {
  it("keeps the path's own case and spacing inside a card title that sets capitals", () => {
    // Seen in a browser: the inherited title treatment printed WORKFLOWS/STANDARD-FIX.LOOP.TS.
    const path = rule("\\.code-view__path");

    expect(path).toMatch(/text-transform:\s*none/);
    expect(path).toMatch(/letter-spacing:\s*normal/);
    expect(path).toMatch(/font-family:\s*var\(--f-mono\)/);
  });
});

describe("the editor", () => {
  it("is not styled here — it brings its own sheet", () => {
    expect(CODE).not.toMatch(/\.cm-|\.code-editor/);
  });
});

describe("the skeleton", () => {
  it("reserves the seat's own floor, so nothing moves when the file lands in a state with none", () => {
    const floor = /min-height:\s*([^;]+);/.exec(rule("\\.code-view__seat"))?.[1];

    expect(floor).toBeDefined();
    expect(rule("\\.code-skeleton__file")).toContain(`min-height: ${floor};`);
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
