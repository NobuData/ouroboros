import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/workflows/workflows.css` that are agreements with something outside it.
 *
 * The generic rule — no colour literal anywhere but the token sheet — is
 * `__tests__/styles.test.ts`'s, and it covers this sheet as it covers every other. What is
 * here is narrower: the facts this sheet has to keep in step with the components that use it,
 * with the mockup it reproduces, with the token sheet's contrast guarantees, and with the
 * font-size preference, none of which is visible from inside the file.
 *
 * **This is also where "both themes" is actually verified.** jsdom applies no stylesheet, so
 * no render test in this module can read a computed colour. What a render test *can* prove is
 * that the two palettes produce identical markup; what proves the palettes themselves are
 * legible is that every hue here is a published token, and both palettes publish contrast for
 * each of them against the surface it is drawn on.
 */

const UI = join(import.meta.dirname, "..", "..");
const SHEET = readFileSync(join(UI, "app", "workflows", "workflows.css"), "utf8");

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

describe("the page head", () => {
  it("lets the actions drop under the headings rather than crushing them", () => {
    expect(rule("\\.studio__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.studio__headings")).toMatch(/min-width:\s*[\d.]+rem/);
  });

  it("holds a measure on the subline, so the sentence is a paragraph rather than a band", () => {
    expect(rule("\\.studio__sub")).toMatch(/max-width:\s*\d+ch/);
    expect(rule("\\.studio__sub")).toMatch(/margin:/);
  });

  it("starts its content on the same line as the other module pages", () => {
    // The routing page's and the dashboard's gutter rhythm, so two pages in one product do not
    // start their content at two heights.
    expect(rule("\\.studio")).toMatch(/padding:\s*var\(--sp-11\) var\(--sp-10\) var\(--sp-12\)/);
  });
});

describe("the segmented control's placement", () => {
  it("spans the pane rather than sitting inset from it", () => {
    // The row is sticky. Inset from the pane's edges it would leave two gutters that scrolled
    // content shows through — so the page's padding is undone as margin and re-applied as
    // padding, and the segments still line up with the heading above them.
    expect(rule("\\.studio__subnav")).toMatch(/margin:[^;]*calc\(var\(--sp-10\) \* -1\)/);
    expect(rule("\\.studio__subnav")).toMatch(/padding:\s*0 var\(--sp-10\)/);
  });

  it("styles no primitive of the design system from here", () => {
    // Reaching into `.ou-*` from a page sheet would make a primitive mean something different
    // on one screen. A page places a primitive by passing its own class, never by restyling
    // the primitive's.
    expect(CODE).not.toContain(".ou-");
  });
});

describe("the studio grid", () => {
  it("is the mockup's rail beside the canvas, the rail at the mockup's 220px", () => {
    expect(rule("\\.studio__grid")).toMatch(/grid-template-columns:\s*13\.75rem minmax\(0, 1fr\)/);
  });

  it("floors the canvas track at zero, so a wide canvas never widens the pane", () => {
    // A grid track's default minimum is `auto` — the widest thing inside it — so a canvas wide
    // enough to need its wrapper's scroll would push the pane sideways instead (§ 1.3).
    expect(rule("\\.studio__grid")).toMatch(/minmax\(0,/);
  });

  it("stacks the rail above the canvas at the mockup's own break", () => {
    // 1100px, which is also the dashboard's and the routing page's break — two module pages
    // in one product should not break to one column at two different windows.
    expect(CODE).toMatch(/@media \(max-width: 68\.75rem\)/);
    expect(CODE).toMatch(
      /@media \(max-width: 68\.75rem\)\s*\{[\s\S]*?\.studio-rail__list\s*\{[\s\S]*?flex-direction:\s*row/,
    );
    // …and the skeleton's rail with it, so the two wrap at one window.
    expect(CODE).toMatch(
      /@media \(max-width: 68\.75rem\)\s*\{[\s\S]*?\.studio-skeleton__rail\s*\{[\s\S]*?flex-direction:\s*row/,
    );
  });

  it("reserves the seat at the mockup's canvas height, and the skeleton at the same", () => {
    // Nothing moves by more than the canvas's own chrome when #148 fills it — and nothing
    // moves at all when the data lands.
    expect(rule("\\.studio__seat")).toMatch(/min-height:\s*40rem/);
    expect(rule("\\.studio-skeleton__seat")).toMatch(/min-height:\s*40rem/);
  });
});

describe("the rail", () => {
  it("undoes the three defaults a browser gives the list it is built on", () => {
    expect(rule("\\.studio-rail__list")).toMatch(/margin:\s*0/);
    expect(rule("\\.studio-rail__list")).toMatch(/padding:\s*0/);
    expect(rule("\\.studio-rail__list")).toMatch(/list-style:\s*none/);
  });

  it("draws an item as the mockup's .wf-item: a hairline box with a rail on its left edge", () => {
    expect(rule("\\.studio-rail__item")).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(rule("\\.studio-rail__item")).toMatch(/border-left:\s*3px solid var\(--line\)/);
    expect(rule("\\.studio-rail__item")).toMatch(/background:\s*var\(--surface\)/);
    expect(rule("\\.studio-rail__item")).toMatch(/border-radius:\s*var\(--r-md\)/);
  });

  it("gives the selected item the mockup's accent gradient, from the token sheet's own pair", () => {
    // The mockup's `rgba(61, 214, 245, 0.4)` rim and `--glow-soft` stop are --accent-line and
    // --accent-tint, which both palettes publish against the surface.
    const active = rule("\\.studio-rail__item--active");

    expect(active).toMatch(/border-color:\s*var\(--accent-line\)/);
    expect(active).toMatch(/border-left-color:\s*var\(--accent\)/);
    expect(active).toMatch(/background:\s*linear-gradient\(90deg, var\(--accent-tint\), var\(--surface\) 55%\)/);
    expect(rule("\\.studio-rail__item--active \\.studio-rail__name")).toMatch(/color:\s*var\(--accent\)/);
  });

  it("draws the err-dot in the error hue, at a size that grows with the type", () => {
    expect(rule("\\.studio-rail__dot")).toMatch(/background:\s*var\(--err\)/);
    expect(rule("\\.studio-rail__dot")).toMatch(/width:\s*var\(--sp-/);
    expect(rule("\\.studio-rail__dot")).toMatch(/height:\s*var\(--sp-/);
    expect(rule("\\.studio-rail__dot")).toMatch(/border-radius:\s*var\(--r-round\)/);
  });

  it("sets the name in the display face and the caption in mono, because every part of a caption is a value", () => {
    expect(rule("\\.studio-rail__name")).toMatch(/font-family:\s*var\(--f-disp\)/);
    expect(rule("\\.studio-rail__caption")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.studio-rail__caption")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("lets a caption wrap rather than clipping it at the 150% font-scale step", () => {
    expect(rule("\\.studio-rail__caption")).not.toMatch(/white-space:\s*nowrap|text-overflow/);
  });

  it("draws the tile as the mockup's dashed .wf-item.new, and guards its hover on aria-disabled", () => {
    const tile = rule("\\.studio-rail \\.studio-rail__new");

    expect(tile).toMatch(/border:\s*1px dashed var\(--line\)/);
    expect(tile).toMatch(/background:\s*transparent/);
    expect(tile).toMatch(/text-align:\s*center/);
    expect(CODE).toMatch(/\.studio-rail \.studio-rail__new:hover:not\(\[aria-disabled="true"\]\)/);
    expect(rule('\\.studio-rail \\.studio-rail__new\\[aria-disabled="true"\\]')).toMatch(/cursor:\s*not-allowed/);
  });
});

describe("the states above the grid", () => {
  it("puts the read-only note and the failed banner in the grid's own rhythm, so the rail does not move", () => {
    expect(rule("\\.studio-readonly")).toMatch(/margin:\s*0 0 var\(--sp-9\)/);
    expect(rule("\\.studio-failed")).toMatch(/margin:\s*0 0 var\(--sp-9\)/);
  });

  it("styles the banner's box nowhere here — it is the primitive's", () => {
    expect(rule("\\.studio-failed")).not.toMatch(/border|background|color/);
  });

  it("keeps the read-only note's head on a named ink token, and its body on the muted one", () => {
    expect(rule("\\.studio-readonly__head")).toMatch(/color:\s*var\(--ink-dim\)/);
    expect(rule("\\.studio-readonly")).toMatch(/color:\s*var\(--ink-mut\)/);
  });

  it("rules the development note off from the seat with a hairline", () => {
    expect(rule("\\.studio__dev")).toMatch(/border-block-start:\s*1px solid var\(--line\)/);
    expect(rule("\\.studio__dev")).toMatch(/color:\s*var\(--ink-faint\)/);
  });
});

describe("the create dialog", () => {
  it("draws a refusal in the error hue and lets the controls wrap", () => {
    expect(rule("\\.studio-create__failure")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.studio-create__actions")).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("the loading skeleton", () => {
  it("mirrors the rail's gap, so the items land where the rail's will", () => {
    expect(rule("\\.studio-skeleton__rail")).toMatch(/gap:\s*var\(--sp-4\)/);
    expect(rule("\\.studio-rail__list")).toMatch(/gap:\s*var\(--sp-4\)/);
  });

  it("names every length in rem, a token or a ratio, so it scales with the type", () => {
    // A skeleton pinned in px would reserve the right height at one font size and the wrong
    // one at every other — which is the whole failure it exists to prevent.
    const block = CODE.slice(CODE.indexOf(".studio-skeleton"));

    for (const [, value] of block.matchAll(/(?:height|width):\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^(var\(--|[\d.]+rem|100%|\d+%|auto|1px)/);
    }
  });

  it("moves only for a reader who has not asked for less motion, and pulses opacity only", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: no-preference)");
    const animated = CODE.indexOf("animation:");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(animated).toBeGreaterThan(guard);

    const frames = /@keyframes studio-skeleton-pulse\s*\{([\s\S]*?)\n\}/.exec(CODE);

    expect(frames).not.toBeNull();
    expect(frames?.[1]).toMatch(/opacity/);
    expect(frames?.[1]).not.toMatch(/transform|width|height|margin/);
  });

  it("animates every shape the skeleton draws", () => {
    const guarded = /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?)\n\}/.exec(CODE);

    for (const shape of ["__title", "__sub", "__action", "__item", "__new", "__seat"]) {
      expect(guarded?.[1], `${shape} does not pulse`).toContain(`.studio-skeleton${shape}`);
    }
  });
});

describe("the type scale", () => {
  it("names no font size in px, so the reader's preference scales every surface", () => {
    expect(CODE).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it("takes every font size from the sheet rather than inventing one", () => {
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("keeps every other length on a token, a rem or a ratio, hairlines and the rail excepted", () => {
    // A px length is a length the font-size preference cannot move. Borders and outlines are
    // the deliberate exception: the item's 3px rail is a rule, and a rule that grew with the
    // type would be a different rule.
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(?:border|box-shadow|outline)/);
    }
  });
});
