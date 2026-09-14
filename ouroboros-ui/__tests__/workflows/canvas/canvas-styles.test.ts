import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/workflows/canvas/canvas.css` that are agreements with something
 * outside it — above all with React Flow's own sheet, and with mockup 04's visual language.
 *
 * The generic rule — no colour literal anywhere but the token sheet — is
 * `__tests__/styles.test.ts`'s and covers this sheet as it covers every other. What is here is
 * #148's *both themes render from tokens — no library default colors leak through*, as an
 * assertion: the library's `base.css` names every colour it would fall back to as a
 * `--xy-*-default` custom property, and this sheet must redefine each one, on a token, so the
 * fallback is never reached. The list is read from the library's sheet, not copied, so an
 * upgrade that adds a colour goes red here rather than grey on the canvas.
 *
 * And it is #149's treatments, rule by rule: each node type's hue, the trigger's top rule, the
 * octagon, the mini pill, the `.sel` glow, the chip, the loop's dash and glow, the active path's
 * accent, the arrowheads and the four label tones — each on the token the mockup's value maps
 * to, which is what makes the dark-only mockup a two-palette canvas. Whether the picture then
 * *looks* like the mockup is the e2e studio leg's screenshot pair.
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
  it("is the mockup's .node: a box on the surface with a 3px rail in its treatment's hue, at the mockup's geometry in rem", () => {
    const node = rule("\\.studio-node");

    expect(node).toMatch(/width:\s*12\.75rem/);
    expect(node).toMatch(/min-height:\s*6\.5rem/);
    expect(node).toMatch(/border:\s*1px solid var\(--line-strong\)/);
    expect(node).toMatch(/border-left:\s*3px solid var\(--studio-node-hue\)/);
    expect(node).toMatch(/background:\s*var\(--surface\)/);
    expect(node).toMatch(/border-radius:\s*var\(--r-md\)/);
  });

  it("lifts the rim under the pointer and keeps the treatment's rail, as the mockup's hover does", () => {
    const hover = rule("\\.studio-canvas \\.react-flow__node:hover \\.studio-node");

    expect(hover).toMatch(/border-color:\s*var\(--ink-faint\)/);
    expect(hover).toMatch(/border-left-color:\s*var\(--studio-node-hue\)/);
    expect(rule("\\.studio-canvas \\.react-flow__node:hover \\.studio-node--trigger")).toMatch(
      /border-top-color:\s*var\(--studio-node-hue\)/,
    );
  });

  it("takes the design system's ring when focused", () => {
    expect(CODE).toMatch(/\.react-flow__node:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--accent-line\)/);
  });

  it("hides the connection points without removing their size", () => {
    // React Flow measures an edge's end from the handle's box.
    const port = rule("\\.studio-node__port");

    expect(port).toMatch(/opacity:\s*0/);
    expect(port).not.toMatch(/display:\s*none|width:\s*0|height:\s*0/);
  });

  it("sets the type line in mono small caps in the treatment's hue, and the title in the UI face", () => {
    const typeLine = rule("\\.studio-node__kind");

    expect(typeLine).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(typeLine).toMatch(/text-transform:\s*uppercase/);
    expect(typeLine).toMatch(/letter-spacing:\s*var\(--tr-wider\)/);
    expect(typeLine).toMatch(/color:\s*var\(--studio-node-hue\)/);
    expect(rule("\\.studio-node__glyph")).toMatch(/margin-inline-end:\s*var\(--sp-2\)/);
    expect(rule("\\.studio-node__title")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("the five treatments", () => {
  it.each([
    ["trigger", "--accent"],
    ["llm", "--model"],
    ["infra", "--warn"],
    ["flow", "--ink-dim"],
    ["term", "--ok"],
  ])("gives the %s stage the mockup's hue, %s", (kind, token) => {
    expect(rule(`\\.studio-node--${kind}`)).toMatch(new RegExp(`--studio-node-hue:\\s*var\\(${token}\\)`));
  });

  it("declares every treatment after the base box, so each one's hue wins over the default", () => {
    const base = CODE.indexOf("\n.studio-node {");

    for (const kind of ["trigger", "llm", "infra", "flow", "term", "pill"]) {
      expect(CODE.indexOf(`\n.studio-node--${kind} {`), kind).toBeGreaterThan(base);
    }
  });

  it("crowns the trigger with the accent rule across its top", () => {
    expect(rule("\\.studio-node--trigger")).toMatch(/border-top:\s*2px solid var\(--studio-node-hue\)/);
  });

  it("cuts the flow node to the mockup's octagon, at a spacing step so it scales with the box", () => {
    const polygon = /clip-path:\s*polygon\(([^;]*)\);/.exec(rule("\\.studio-node--flow"))?.[1] ?? "";
    const corners = polygon.split(",").map((corner) => corner.trim());

    expect(corners).toEqual([
      "var(--sp-7) 0",
      "calc(100% - var(--sp-7)) 0",
      "100% var(--sp-7)",
      "100% calc(100% - var(--sp-7))",
      "calc(100% - var(--sp-7)) 100%",
      "var(--sp-7) 100%",
      "0 calc(100% - var(--sp-7))",
      "0 var(--sp-7)",
    ]);
  });

  it("draws Back to queue as the mockup's 176 × 44 pill, its title and dot centred", () => {
    const pill = rule("\\.studio-node--pill");

    expect(pill).toMatch(/width:\s*11rem/);
    expect(pill).toMatch(/min-height:\s*2\.75rem/);
    expect(pill).toMatch(/border-radius:\s*var\(--r-pill\)/);
    expect(pill).toMatch(/display:\s*flex/);
    expect(pill).toMatch(/align-items:\s*center/);
    expect(pill).toMatch(/justify-content:\s*center/);
    expect(rule("\\.studio-node--pill \\.studio-node__title")).toMatch(/margin-top:\s*0/);
    expect(rule("\\.studio-node__dot")).toMatch(/background:\s*var\(--studio-node-hue\)/);
    expect(rule("\\.studio-node__dot")).toMatch(/border-radius:\s*var\(--r-round\)/);
  });
});

describe("the selection glow", () => {
  it("is the mockup's .sel: the accent rim, a 3px ring in the accent tint, and the accent's glow", () => {
    const selected = rule("\\.studio-canvas \\.react-flow__node\\.selected \\.studio-node");

    expect(selected).toMatch(/border-color:\s*var\(--accent\)/);
    expect(selected).toMatch(/box-shadow:\s*0 0 0 3px var\(--accent-tint\),\s*0 0 26px -4px var\(--accent-glow\)/);
  });

  it("comes after the hover rule, so a hovered selection keeps its accent", () => {
    expect(CODE.indexOf(".react-flow__node.selected .studio-node")).toBeGreaterThan(
      CODE.indexOf(".react-flow__node:hover .studio-node"),
    );
  });

  it("follows the octagon, which clips a box-shadow, from the unclipped wrapper", () => {
    expect(rule("\\.studio-canvas \\.react-flow__node\\.selected:has\\(> \\.studio-node--flow\\)")).toMatch(
      /filter:\s*drop-shadow\(0 0 3px var\(--accent-tint\)\) drop-shadow\(0 0 12px var\(--accent-glow\)\)/,
    );
  });
});

describe("the chip row", () => {
  it("is the mockup's .nchip: a mono value on the inset well, hairlined, at the extra-small radius", () => {
    const chip = rule("\\.studio-node__chip");

    expect(chip).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(chip).toMatch(/background:\s*var\(--inset\)/);
    expect(chip).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(chip).toMatch(/border-radius:\s*var\(--r-xs\)/);
    expect(chip).toMatch(/color:\s*var\(--ink-mut\)/);
  });

  it("never lets a chip outgrow its node — a long name ends in an ellipsis", () => {
    const chip = rule("\\.studio-node__chip");

    expect(chip).toMatch(/max-width:\s*100%/);
    expect(chip).toMatch(/overflow:\s*hidden/);
    expect(chip).toMatch(/text-overflow:\s*ellipsis/);
    expect(chip).toMatch(/white-space:\s*nowrap/);
  });

  it("wraps the row under the title, and dots the runner chip in the treatment's hue", () => {
    expect(rule("\\.studio-node__chips")).toMatch(/flex-wrap:\s*wrap/);
    // Into the box's trailing padding and no further — the node's own inline padding, negated.
    expect(rule("\\.studio-node")).toMatch(/padding:\s*var\(--sp-5\) var\(--sp-6\)/);
    expect(rule("\\.studio-node__chips")).toMatch(/margin-inline-end:\s*calc\(var\(--sp-6\) \* -1\)/);
    expect(rule("\\.studio-node__chip-dot")).toMatch(/background:\s*var\(--studio-node-hue\)/);
  });
});

describe("the edges", () => {
  it("fills each arrowhead in its line's colour — the mockup's .mkd, .mka and .mkl", () => {
    expect(rule("\\.studio-arrow--plain")).toMatch(/fill:\s*var\(--line-strong\)/);
    expect(rule("\\.studio-arrow--active")).toMatch(/fill:\s*var\(--accent\)/);
    expect(rule("\\.studio-arrow--loop")).toMatch(/fill:\s*var\(--accent-deep\)/);
  });

  it("keeps the arrowheads' SVG out of the layout", () => {
    const markers = rule("\\.studio-canvas__markers");

    expect(markers).toMatch(/position:\s*absolute/);
    expect(markers).toMatch(/width:\s*0/);
    expect(markers).toMatch(/height:\s*0/);
  });

  it("draws the active path in the accent, with the accent's glow", () => {
    const active = rule("\\.studio-canvas \\.studio-edge--active");

    expect(active).toMatch(/stroke:\s*var\(--accent\)/);
    expect(active).toMatch(/filter:\s*drop-shadow\(0 0 5px var\(--accent-glow\)\)/);
  });

  it("draws the loop dashed in accent-deep under a glow of its own", () => {
    const loop = rule("\\.studio-canvas \\.studio-edge--loop");

    expect(loop).toMatch(/stroke:\s*var\(--accent-deep\)/);
    expect(loop).toMatch(/stroke-dasharray:\s*7 6/);
    expect(loop).toMatch(/filter:\s*drop-shadow\(0 0 4px var\(--accent-tint\)\)/);
  });

  it("keeps the dash on a loop the path takes, in the path's accent", () => {
    const both = rule("\\.studio-canvas \\.studio-edge--loop\\.studio-edge--active");

    expect(both).toMatch(/stroke:\s*var\(--accent\)/);
    expect(both).not.toMatch(/stroke-dasharray/);
    expect(CODE.indexOf(".studio-edge--loop.studio-edge--active")).toBeGreaterThan(
      CODE.indexOf(".studio-canvas .studio-edge--loop {"),
    );
  });
});

describe("the edge labels", () => {
  it("are the mockup's .elabel: a mono pill on the deepest ground, inside a hairline", () => {
    const pill = rule("\\.studio-edge-label");

    expect(pill).toMatch(/position:\s*absolute/);
    expect(pill).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(pill).toMatch(/border-radius:\s*var\(--r-pill\)/);
    expect(pill).toMatch(/background:\s*var\(--ground-deep\)/);
    expect(pill).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(pill).toMatch(/white-space:\s*nowrap/);
  });

  it.each([
    ["accent", "--accent", "--accent-line"],
    ["warn", "--warn", "--warn-line"],
    ["ok", "--ok", "--ok-line"],
    ["err", "--err", "--err-line"],
  ])("take the %s tone: its ink on its line", (tone, ink, line) => {
    const pill = rule(`\\.studio-edge-label--${tone}`);

    expect(pill).toMatch(new RegExp(`color:\\s*var\\(${ink}\\)`));
    expect(pill).toMatch(new RegExp(`border-color:\\s*var\\(${line}\\)`));
  });

  it("sit against their line with `translate`, which adds to the edge's own inline transform", () => {
    // `transform` here would replace the midpoint the edge writes inline and stack every pill at
    // the stage's origin; `translate` composes with it.
    expect(rule("\\.studio-edge-label")).toMatch(/translate:\s*-50% -50%/);
    expect(rule('\\.studio-edge-label\\[data-anchor="above"\\]')).toMatch(/translate:\s*-50% -100%/);
    expect(rule('\\.studio-edge-label\\[data-anchor="beside"\\]')).toMatch(/translate:\s*0 -50%/);
    expect(CODE).not.toMatch(/\.studio-edge-label[^{]*\{[^}]*(?:^|[;\s])transform:/);
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

  it("keeps every other length on a token, a rem, a ratio or a viewport share, rules, rings and glows excepted", () => {
    // A px length is a length the font-size preference cannot move. Borders, outlines, shadows
    // and the edges' drop-shadow glows are the deliberate exception: the node's 3px rail is a
    // rule, as the rail item's is, and a glow is a shadow.
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(?:border|box-shadow|outline|filter|--xy-)/);
    }
  });
});
