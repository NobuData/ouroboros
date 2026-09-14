import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/workflows/canvas/canvas.css` that are agreements with something
 * outside it — above all with React Flow's own sheet.
 *
 * The generic rule — no colour literal anywhere but the token sheet — is
 * `__tests__/styles.test.ts`'s and covers this sheet as it covers every other. What is here is
 * the ticket's *both themes render from tokens — no library default colors leak through*, as
 * an assertion: the library's `base.css` names every colour it would fall back to as a
 * `--xy-*-default` custom property, and this sheet must redefine each one, on a token, so the
 * fallback is never reached. The list is read from the library's sheet, not copied, so an
 * upgrade that adds a colour goes red here rather than grey on the canvas.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const SHEET = readFileSync(join(UI, "app", "workflows", "canvas", "canvas.css"), "utf8");
const BASE = readFileSync(createRequire(import.meta.url).resolve("@xyflow/react/dist/base.css"), "utf8");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations.
 *
 * The selector is matched from the start of a line that does not continue a group, so
 * `.studio-canvas__zoom-level` finds the rule of its own and not the grouped
 * `.studio-canvas__zoom-step,\n.studio-canvas__zoom-level` whose second line it also is.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`(?<!,\\s*)(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

/** The block that re-themes the library. */
const THEME = rule("\\.studio-canvas \\.react-flow");

/**
 * Every `--xy-*-default` the library's light block declares — the names, with `-default`
 * removed, that this sheet has to define.
 */
const LIBRARY_DEFAULTS = [
  ...new Set(
    [...BASE.matchAll(/--xy-([a-z-]+?)-default:/g)].map((match) => `--xy-${match[1]}`),
  ),
];

describe("the library's defaults", () => {
  it("are found, so the rule below has something to hold the sheet to", () => {
    expect(LIBRARY_DEFAULTS.length).toBeGreaterThan(10);
    expect(LIBRARY_DEFAULTS).toContain("--xy-edge-stroke");
    expect(LIBRARY_DEFAULTS).toContain("--xy-background-pattern-dots-color");
  });

  it.each(LIBRARY_DEFAULTS)("%s is redefined on a token, or on a non-colour", (name) => {
    // The three pattern colours share one override, which is how the library itself resolves
    // them: `--xy-background-pattern-color` before any variant's default.
    const defined = name.startsWith("--xy-background-pattern-")
      ? "--xy-background-pattern-color"
      : name;
    const declaration = new RegExp(`${defined}:\\s*([^;]+);`).exec(THEME)?.[1]?.trim();

    expect(declaration, `${defined} is not defined on .studio-canvas .react-flow`).toBeDefined();
    // A token, `transparent`, or a width — never a colour of the sheet's own.
    expect(declaration).toMatch(/^(?:\d+px solid var\(--|\d+px dashed var\(--|var\(--|transparent$|\d+$)/);
  });

  it("re-colours the one literal the library sets outside a custom property", () => {
    // `.react-flow__attribution a { color: #999 }` in base.css.
    expect(rule("\\.studio-canvas \\.react-flow__attribution a")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("never selects the library's own dark class", () => {
    // The tokens switch with the palette; `.dark` would be a second theme switch.
    expect(CODE).not.toMatch(/\.dark\b/);
  });
});

describe("the stage", () => {
  it("is the mockup's dot grid over the inset well", () => {
    expect(rule("\\.studio-canvas")).toMatch(/background:\s*var\(--inset\)/);
    expect(THEME).toMatch(/--xy-background-pattern-color:\s*var\(--line\)/);
    expect(THEME).toMatch(/--xy-background-color:\s*transparent/);
  });

  it("pans inside its own wrapper, so the content pane never scrolls sideways for it", () => {
    // § 1.3: wide content scrolls inside its own wrapper, never at pane level.
    expect(rule("\\.studio-canvas__stage")).toMatch(/overflow:\s*hidden/);
    expect(rule("\\.studio-canvas")).toMatch(/overflow:\s*hidden/);
    expect(rule("\\.studio-canvas")).toMatch(/min-width:\s*0/);
  });

  it("keeps the seat's floor, so nothing moves when the canvas replaces it", () => {
    expect(rule("\\.studio-canvas__stage")).toMatch(/min-height:\s*40rem/);
    expect(rule("\\.studio-canvas__stage")).toMatch(/max-height:\s*76vh/);
    expect(rule("\\.studio-canvas__stage")).toMatch(/height:\s*[\d.]+rem/);
  });

  it("draws the edges on the strong line and the selected one on the accent", () => {
    expect(THEME).toMatch(/--xy-edge-stroke:\s*var\(--line-strong\)/);
    expect(THEME).toMatch(/--xy-edge-stroke-selected:\s*var\(--accent\)/);
    expect(THEME).toMatch(/--xy-edge-stroke-width:\s*2/);
  });

  it("draws the rubber band in the accent tint", () => {
    expect(THEME).toMatch(/--xy-selection-background-color:\s*var\(--accent-tint\)/);
    expect(THEME).toMatch(/--xy-selection-border:\s*1px dashed var\(--accent-line\)/);
  });
});

describe("the stage node", () => {
  it("is the mockup's .node: a box on the surface with a 3px rail, at the mockup's geometry in rem", () => {
    const node = rule("\\.studio-node");

    expect(node).toMatch(/width:\s*12\.75rem/);
    expect(node).toMatch(/min-height:\s*6\.5rem/);
    expect(node).toMatch(/border:\s*1px solid var\(--line-strong\)/);
    expect(node).toMatch(/border-left:\s*3px solid var\(--line-strong\)/);
    expect(node).toMatch(/background:\s*var\(--surface\)/);
    expect(node).toMatch(/border-radius:\s*var\(--r-md\)/);
  });

  it("takes the accent when selected, and the design system's ring when focused", () => {
    expect(rule("\\.studio-canvas \\.react-flow__node\\.selected \\.studio-node")).toMatch(
      /border-color:\s*var\(--accent\)/,
    );
    expect(CODE).toMatch(/\.react-flow__node:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--accent-line\)/);
  });

  it("hides the connection points without removing their size", () => {
    // React Flow measures an edge's end from the handle's box.
    const port = rule("\\.studio-node__port");

    expect(port).toMatch(/opacity:\s*0/);
    expect(port).not.toMatch(/display:\s*none|width:\s*0|height:\s*0/);
  });

  it("sets the type line in mono small caps and the title in the UI face", () => {
    expect(rule("\\.studio-node__kind")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.studio-node__kind")).toMatch(/text-transform:\s*uppercase/);
    expect(rule("\\.studio-node__title")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("the toolbar", () => {
  it("is the mockup's .canvas-toolbar: ruled off from the stage, on the surface, wrapping", () => {
    const toolbar = rule("\\.studio-canvas__toolbar");

    expect(toolbar).toMatch(/border-top:\s*1px solid var\(--line\)/);
    expect(toolbar).toMatch(/background:\s*var\(--surface\)/);
    expect(toolbar).toMatch(/flex-wrap:\s*wrap/);
  });

  it("draws the zoom group as the mockup's .zoom, its controls in mono", () => {
    expect(rule("\\.studio-canvas__zoom")).toMatch(/border:\s*1px solid var\(--line-strong\)/);
    expect(rule("\\.studio-canvas__zoom")).toMatch(/background:\s*var\(--raised\)/);
    expect(rule("\\.studio-canvas__zoom-step,\\s*\\.studio-canvas__zoom-level")).toMatch(
      /font-family:\s*var\(--f-mono\)/,
    );
    expect(rule("\\.studio-canvas__zoom-level")).toMatch(/border-inline:\s*1px solid var\(--line\)/);
  });

  it("pushes the hint to the trailing edge in faint mono, and the unsaved note in the warn hue", () => {
    expect(rule("\\.studio-canvas__hint")).toMatch(/margin-left:\s*auto/);
    expect(rule("\\.studio-canvas__hint")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.studio-canvas__unsaved")).toMatch(/color:\s*var\(--warn\)/);
  });

  it("styles no primitive of the design system from here", () => {
    expect(CODE).not.toContain(".ou-");
  });
});

describe("the type scale", () => {
  it("takes every font size from the sheet rather than inventing one", () => {
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("keeps every other length on a token, a rem, a ratio or a viewport share, rules and rings excepted", () => {
    // A px length is a length the font-size preference cannot move. Borders, outlines and the
    // shadow are the deliberate exception: the node's 3px rail is a rule, as the rail item's is.
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(?:border|box-shadow|outline|--xy-)/);
    }
  });
});
