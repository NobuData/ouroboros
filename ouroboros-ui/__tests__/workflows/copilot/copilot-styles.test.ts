import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The copilot's sheet (CE.1, #565): every class it declares is rendered and every class rendered
 * is declared, the body is mockup 20's two columns beside the studio's rail, a guard that is not
 * enforced is never drawn as protection, and **both themes** and **the 125% font-size step** hold
 * because every value it reads is a token or a rem.
 *
 * jsdom applies no stylesheet, so the render suites prove the markup is identical in both
 * palettes and this suite proves the palettes are what the sheet reads.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const COPILOT_DIR = join(UI, "app", "workflows", "copilot");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = readFileSync(join(COPILOT_DIR, "copilot.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The modules that draw the sheet's classes. */
const MODULES = ["copilot-screen.tsx", "copilot-flows.tsx", "promote-summary.tsx", "copilot-skeleton.tsx", "discard-dialog.tsx"]
  .map((name) => readFileSync(join(COPILOT_DIR, name), "utf8"))
  .join("\n");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string): string {
  return new RegExp(`(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

const DECLARED = new Set([...CODE.matchAll(/\.(copilot-view[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set([...MODULES.matchAll(/"(copilot-view[a-z0-9_-]*)"/g)].map((match) => match[1]));

describe("the sheet and the modules", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the modules render", () => {
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual([]);
  });

  it("builds no class name from a template — each is a literal the two lists can see", () => {
    expect(MODULES).not.toMatch(/`[^`]*copilot-view[^`]*\$\{/);
  });

  it("styles no primitive of the design system, and none of the studio's own classes, from here", () => {
    expect(CODE).not.toContain(".ou-");
    expect(CODE).not.toMatch(/\.studio|\.shell-/);
  });
});

describe("the body", () => {
  it("is mockup 20's five and seven columns, beside the rail and across the studio grid's other tracks", () => {
    const body = rule("\\.copilot-view__body");

    expect(body).toMatch(/grid-column:\s*2 \/ -1/);
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0, 5fr\) minmax\(0, 7fr\)/);
  });

  it("floors both tracks at zero, so a long line never widens the pane", () => {
    expect(rule("\\.copilot-view__body")).toMatch(/minmax\(0, 5fr\) minmax\(0, 7fr\)/);
    expect(rule("\\.copilot-view__side")).toMatch(/min-width:\s*0/);
    expect(rule("\\.copilot-view__seat")).toMatch(/min-width:\s*0/);
  });

  it("stacks to one column at the studio's own break", () => {
    const narrow = /@media \(max-width: 68\.75rem\)\s*\{([\s\S]*?)\n\}/.exec(CODE)?.[1] ?? "";

    expect(narrow).toMatch(/\.copilot-view__body,\s*\.copilot-view__vacant\s*\{[^}]*grid-column:\s*auto/);
    expect(narrow).toMatch(/\.copilot-view__body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it("scrolls nothing inside itself — the conversation's own wrapper is conversation.css's, and the only one", () => {
    expect(CODE).not.toMatch(/overflow(?:-[xy])?:\s*(?:auto|scroll)/);
    expect(CODE).not.toMatch(/position:\s*(?:fixed|sticky)/);
  });
});

describe("the gate under the buttons", () => {
  it("holds a measure, so a long reason wraps instead of crushing the title", () => {
    expect(rule("\\.copilot-view__actions")).toMatch(/max-width:\s*[\d.]+rem/);
    expect(rule("\\.copilot-view__actions")).toMatch(/flex-direction:\s*column/);
    expect(rule("\\.copilot-view__buttons")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("draws a block on the error rule and a flag on the warning rule", () => {
    expect(rule("\\.copilot-view__gate--blocked")).toMatch(/border-left:\s*3px solid var\(--err\)/);
    expect(rule("\\.copilot-view__gate--flagged")).toMatch(/border-left:\s*3px solid var\(--warn\)/);
  });
});

describe("the guards", () => {
  it("draws an enforced guard solid, on the ok hue", () => {
    const enforced = rule("\\.copilot-view__guard--enforced");

    expect(enforced).toMatch(/border:\s*1px solid var\(--ok-line\)/);
    expect(enforced).toMatch(/border-left:\s*3px solid var\(--ok\)/);
  });

  it("never draws a guard that is not enforced as protection: dashed, on the warning hue, no ok anywhere", () => {
    const unenforced = rule("\\.copilot-view__guard--unenforced");

    expect(unenforced).toMatch(/border:\s*1px dashed var\(--warn-line\)/);
    expect(unenforced).toMatch(/border-left:\s*3px dashed var\(--warn\)/);
    expect(unenforced).toMatch(/background:\s*var\(--warn-tint\)/);
    expect(unenforced).not.toMatch(/--ok/);
  });
});

describe("tokens and the type scale", () => {
  it("names no colour literal — every hue is a token both palettes define", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("takes every font size from the sheet's scale, so the reader's preference scales the surface", () => {
    expect(CODE).not.toMatch(/font-size:\s*[\d.]+px/);
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("keeps every other length on a token or a rem, hairlines and rules excepted", () => {
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^border/);
    }
  });

  it("fixes no height a larger type could be clipped by", () => {
    expect(CODE).not.toMatch(/(?:^|[;{\s])(?:height|max-height):/);
  });
});
