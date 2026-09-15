import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The workbench's sheet (V.3, #171): every class it declares is rendered and every class rendered
 * is declared; the mockup's treatments — the active row's accent inset, the active tab's accent top
 * border, the modified-dot, the err-dot — are on the tokens they name; and **both themes** hold
 * because every value it reads is a token.
 *
 * jsdom applies no stylesheet, so `code-workbench.test.tsx` proves the markup is identical in both
 * palettes and this suite proves the palettes are what the sheet reads.
 */

const CODE_DIR = join(import.meta.dirname, "..", "..", "..", "app", "workflows", "code");
const WORKFLOWS_DIR = join(CODE_DIR, "..");

/**
 * A sheet without its prose, so a rule cannot be found inside a comment.
 *
 * @param path The sheet.
 * @returns Its rules.
 */
function sheet(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const WORKBENCH = sheet(join(CODE_DIR, "code-workbench.css"));
const VIEW = sheet(join(CODE_DIR, "code-view.css"));
const STUDIO = sheet(join(WORKFLOWS_DIR, "workflows.css"));
const MODULE = readFileSync(join(CODE_DIR, "code-workbench.tsx"), "utf8");

/** The classes this sheet owns. */
const OWNED = /^(?:code-workbench|code-tree|code-tab)/;

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

const DECLARED = new Set(
  [...WORKBENCH.matchAll(/\.((?:code-workbench|code-tree|code-tab)[a-z0-9_-]*)/g)].map((match) => match[1]),
);
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
});

describe("mockup 05's treatments", () => {
  it("draws the open file's row in the accent inset treatment — tint, ink and a 2px rule", () => {
    const active = rule(WORKBENCH, "\\.code-tree \\.code-tree__row--active:hover");

    expect(active).toMatch(/background:\s*var\(--accent-tint\)/);
    expect(active).toMatch(/box-shadow:\s*inset 2px 0 0 var\(--accent\)/);
    expect(active).toMatch(/color:\s*var\(--accent\)/);
  });

  it("puts the open tab on the pane's surface under an accent top border", () => {
    expect(rule(WORKBENCH, "\\.code-tab--active:hover")).toMatch(/background:\s*var\(--surface\)/);

    const border = rule(WORKBENCH, "\\.code-tab--active::after");

    expect(border).toMatch(/border-block-start:\s*2px solid var\(--accent\)/);
    expect(border).toMatch(/inset-block-start:\s*0/);
    expect(border).toMatch(/content:\s*""/);
  });

  it("draws the modified-dot in the accent, and the paused workflow's dot in the rail's error hue", () => {
    expect(rule(WORKBENCH, "\\.code-tab__modified")).toMatch(/background:\s*var\(--accent\)/);
    expect(rule(WORKBENCH, "\\.code-tree__dot")).toMatch(/background:\s*var\(--err\)/);
    expect(rule(STUDIO, "\\.studio-rail__dot")).toMatch(/background:\s*var\(--err\)/);
  });

  it("hides the explorer below 1000px, as the mockup does", () => {
    const narrow = /@media \(max-width: 62\.5rem\)\s*\{([\s\S]*?)\n\}/.exec(WORKBENCH)?.[1] ?? "";

    expect(rule(narrow, "\\.code-tree")).toMatch(/display:\s*none/);
  });

  it("keeps the frame at the seat's floor, so nothing moves between a state with files and one without", () => {
    const floor = /min-height:\s*([^;]+);/.exec(rule(VIEW, "\\.code-view__seat"))?.[1];

    expect(floor).toBeDefined();
    expect(rule(WORKBENCH, "\\.code-workbench__body")).toContain(`min-height: ${floor};`);
  });

  it("styles no part of the editor — it brings its own sheet", () => {
    expect(WORKBENCH).not.toMatch(/\.cm-|\.code-editor/);
  });
});

describe("tokens and the type scale", () => {
  it("names no colour literal — every hue is a token both palettes define", () => {
    expect(WORKBENCH).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("takes every font size from the sheet's scale", () => {
    const sizes = [...WORKBENCH.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]?.trim());

    expect(sizes.length).toBeGreaterThan(0);
    for (const value of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("keeps every other length on a token or a rem — hairlines, rules, focus rings and shadows excepted", () => {
    for (const [declaration] of WORKBENCH.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(?:border|outline|box-shadow)/);
    }
  });
});
