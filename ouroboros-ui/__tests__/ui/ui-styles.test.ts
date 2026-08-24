import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/ui/ui.css` that are agreements with something outside it.
 *
 * The generic rules — no colour literal anywhere but the token sheet, `@import` order,
 * the theme cross-fade — are `__tests__/styles.test.ts`'s, and they cover this sheet as
 * they cover every other. What is here is narrower, and it is what makes this file the
 * design system rather than a fourth stylesheet:
 *
 * - every class the primitives render has a rule, and every rule has a renderer;
 * - the treatments the design system *reasons* about — the inert control, the recessed
 *   empty state, the second shape on a status chip — are still what they were argued to be;
 * - nothing here names a size the reader's font-size preference cannot move.
 */

const UI_DIR = join(import.meta.dirname, "..", "..", "app", "ui");
const SHEET = readFileSync(join(UI_DIR, "ui.css"), "utf8");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * A module without its prose, so a class named in a comment is not counted as rendered.
 *
 * Block comments go entirely; line comments only where the line is nothing else, which
 * keeps a `//` inside a URL from taking the rest of its line with it.
 *
 * @param source The module's source.
 * @returns The source with its comments blanked out.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Every `.ts`/`.tsx` module in `app/ui/`, as `[name, source]`. */
const MODULES: readonly (readonly [string, string])[] = readdirSync(UI_DIR)
  .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
  .map((name) => [name, readFileSync(join(UI_DIR, name), "utf8")] as const);

/**
 * Every `.ts`/`.tsx` module under `app/`, as `[path, source]` — the primitives *and* their
 * callers, because a class may legitimately be rendered by a screen placing a primitive.
 *
 * @param dir The directory to walk.
 * @returns Every module found, recursively.
 */
function modules(dir: string): readonly (readonly [string, string])[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modules(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [[path, readFileSync(path, "utf8")] as const];
  });
}

/** Every class name this sheet defines a rule for. */
const DEFINED = new Set([...CODE.matchAll(/\.(ou-[\w-]+)/g)].map((match) => match[1]));

/** Every class name the application renders. */
const RENDERED = new Set(
  modules(join(UI_DIR, "..")).flatMap(([, source]) => [
    ...code(source).matchAll(/"(ou-[\w-]+)"/g),
  ]).map((match) => match[1]),
);

describe("the sheet and the components it dresses", () => {
  it("defines a rule for every class the primitives render", () => {
    // A class with no rule is a component that renders unstyled and says nothing about it —
    // which in a design system is worse than a build error, because it looks like a design
    // decision.
    expect([...RENDERED].filter((name) => !DEFINED.has(name))).toEqual([]);
  });

  it("renders every class it defines a rule for", () => {
    // The other direction. A rule nobody renders is a rule nobody keeps correct: it
    // survives a token rename, a palette change and a refactor without ever being seen.
    expect([...DEFINED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("is imported by every module that renders one of its classes", () => {
    // Importing the sheet per module rather than once from the barrel is what makes
    // `@/app/ui/button` and `@/app/ui` behave identically. A module that renders a class
    // and imports nothing is styled only by whatever else the page happened to import.
    for (const [name, source] of MODULES) {
      if (!/"ou-[\w-]+"/.test(code(source))) continue;

      expect(source, `${name} renders a class without importing the sheet`).toContain(
        'import "./ui.css"',
      );
    }
  });
});

describe("the type scale", () => {
  it("names no font size in px, so the reader's preference scales every surface", () => {
    // Design system § 3.2: all type is rem-based, from one root change. A px font size is
    // the one length that would refuse to move with it.
    expect(CODE).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it("takes every font size from the sheet rather than inventing one", () => {
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("keeps every other length on a token or a rem, hairlines excepted", () => {
    // A px length is a length the font-size preference cannot move. Borders and shadow
    // spreads are the deliberate exception: a hairline that grows with the type is a
    // different hairline.
    const px = [...CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)].map((match) => match[0]);

    for (const declaration of px) {
      expect(declaration).toMatch(/^(?:border|box-shadow|outline)/);
    }
  });
});

describe("the chip's tones", () => {
  it("gives each one its own rule, so a state cannot fall back to another's colour", () => {
    for (const tone of ["accent", "ok", "warn", "err", "model"]) {
      expect(CODE).toContain(`.ou-chip--${tone}`);
    }
  });

  it("draws each from the token sheet's published triple for that hue", () => {
    // Ink, a 35% border and a 10–12% fill, all three from the same family
    // (`docs/DESIGN_TOKENS.md` § Status). A chip mixing two families is a chip whose
    // contrast nobody measured.
    for (const tone of ["ok", "warn", "err", "model"]) {
      const rule = new RegExp(`\\.ou-chip--${tone}\\s*\\{([^}]*)\\}`).exec(CODE);

      expect(rule, `.ou-chip--${tone} has no rule`).not.toBeNull();
      expect(rule?.[1]).toContain(`var(--${tone}-line)`);
      expect(rule?.[1]).toContain(`var(--${tone}-tint)`);
      expect(rule?.[1]).toContain(`var(--${tone})`);
    }
  });

  it("distinguishes states by shape as well as by hue", () => {
    // Colour alone leaves two states indistinguishable to a reader who cannot separate the
    // hues. The dot's second shape is what carries the difference.
    expect(CODE).toMatch(/\.ou-chip__dot--ring\s*\{[^}]*box-shadow:/);
  });

  it("takes the dot's colour from the chip, so the pair cannot drift between palettes", () => {
    const dot = /\.ou-chip__dot\s*\{([^}]*)\}/.exec(CODE);

    expect(dot?.[1]).toMatch(/background:\s*currentColor/);
  });
});

describe("the inert control", () => {
  it("drops the glow reserved for live things when a button cannot act", () => {
    // The accent glow is the token sheet's treatment for something that is running. A
    // button that cannot be pressed wearing it is the screen contradicting itself.
    const inert = /\.ou-btn\[aria-disabled="true"\]\s*\{([^}]*)\}/.exec(CODE);

    expect(inert?.[1]).toMatch(/box-shadow:\s*none/);
  });

  it("gives up the fill as well, or a filled treatment still reads live", () => {
    const filled = /\.ou-btn--primary\[aria-disabled="true"\][^{]*\{([^}]*)\}/.exec(CODE);

    expect(filled?.[1]).toMatch(/background:\s*var\(--raised\)/);
  });

  it("styles it off `aria-disabled`, which is the attribute actually set", () => {
    // The primitive uses `aria-disabled` rather than `disabled` so the explanation keeps
    // its place in the tab order. A sheet that styled `:disabled` would leave every inert
    // control looking live.
    expect(CODE).toContain('[aria-disabled="true"]');
    expect(CODE).not.toMatch(/\.ou-btn:disabled/);
  });

  it("does not light up under the pointer", () => {
    // Every hover is guarded, or an inert control still answers the mouse.
    for (const [, selector] of CODE.matchAll(/([^{}]*:hover[^{}]*)\{/g)) {
      if (!selector.includes(".ou-btn")) continue;

      expect(selector).toContain(':not([aria-disabled="true"])');
    }
  });
});

describe("the empty state", () => {
  it("recedes by surface rather than by opacity, so its prose still clears AA", () => {
    // Every contrast pair the token sheet publishes is measured against a surface, and a
    // translucent layer is not one of them — so a panel carrying sentences somebody is
    // meant to read cannot be dimmed.
    const empty = /\.ou-empty\s*\{([^}]*)\}/.exec(CODE);

    expect(empty).not.toBeNull();
    expect(empty?.[1]).not.toMatch(/opacity/);
    expect(empty?.[1]).toMatch(/background:\s*var\(--inset\)/);
  });

  it("keeps its own text on a named ink token rather than on inherited colour", () => {
    expect(CODE).toMatch(/\.ou-empty__note\s*\{[^}]*color:\s*var\(--ink-/);
  });

  it("zeroes the block margin a browser gives the paragraphs inside it", () => {
    // Added to the container's `gap` rather than replaced by it, so an unzeroed `p` reads
    // as an uneven gap rather than as a missing rule.
    for (const part of ["title", "note"]) {
      expect(CODE).toMatch(new RegExp(`\\.ou-empty__${part}\\s*\\{[^}]*margin:\\s*0`));
    }
  });
});

describe("the table", () => {
  it("scrolls sideways inside its own box", () => {
    // The content pane is the only scroll container in the product
    // (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3). One table without this is all it takes to
    // start the whole pane scrolling sideways.
    expect(CODE).toMatch(/\.ou-table-scroll\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("hands a sticky head to the pane by opening its wrapper", () => {
    // `position: sticky` pins within the nearest scrollport, and an `overflow-x: auto`
    // wrapper is one in both axes — a head inside it would stick to a box that never
    // scrolls vertically. Opening the wrapper is the recipe's first half (#646).
    expect(CODE).toMatch(/\.ou-table-scroll--open\s*\{[^}]*overflow-x:\s*visible/);
    expect(CODE).toMatch(/\.ou-table--sticky th\s*\{[^}]*position:\s*sticky/);
  });

  it("separates the sticky table's borders, so the hairline travels with the head", () => {
    // Collapsed borders belong to the grid rather than the cell and stay behind when a
    // row sticks; the replacement hairline is an inset shadow on the cell itself.
    expect(CODE).toMatch(/\.ou-table--sticky\s*\{[^}]*border-collapse:\s*separate/);
    expect(CODE).toMatch(/\.ou-table--sticky th\s*\{[^}]*box-shadow:\s*inset 0 -1px 0 var\(--line\)/);
  });
});

describe("the in-pane chrome", () => {
  /**
   * One rule's declarations — the frame suite's anchored helper, copied for the same
   * reason: a class must be found where it is the selector, not the tail of a longer one.
   *
   * @param selector The selector, with any regex characters already escaped.
   * @returns What is between its braces, or `""` when the sheet has no such rule.
   */
  function rule(selector: string): string {
    return CODE.match(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  }

  it("sticks every layer, and sticks it with an offset the chrome above published", () => {
    // The stacking contract (#646, `app/ui/chrome.ts`): the subnav owns the top edge, the
    // bar starts where the subnav ends, the table head clears both. Each `top` reads the
    // published measurement rather than restating a height, which is what holds the stack
    // together at every font scale.
    expect(rule("\\.ou-subnav")).toMatch(/position:\s*sticky/);
    expect(rule("\\.ou-subnav")).toMatch(/top:\s*0/);
    expect(rule("\\.ou-sticky-bar")).toMatch(/position:\s*sticky/);
    expect(rule("\\.ou-sticky-bar")).toMatch(/top:\s*var\(--ou-chrome-subnav,\s*0rem\)/);
    expect(rule("\\.ou-table--sticky th")).toMatch(
      /top:\s*calc\(var\(--ou-chrome-subnav,\s*0rem\) \+ var\(--ou-chrome-bar,\s*0rem\)\)/,
    );
  });

  it("stacks front-to-back in the same order as top-to-bottom", () => {
    // The documented order: subnav above bar above table head. If the z steps ever
    // inverted, the second team's sticky element would cover the first team's — the race
    // the contract exists to end.
    const layer = (selector: string) => Number(rule(selector).match(/z-index:\s*(\d+)/)?.[1]);

    expect(layer("\\.ou-subnav")).toBeGreaterThan(layer("\\.ou-sticky-bar"));
    expect(layer("\\.ou-sticky-bar")).toBeGreaterThan(layer("\\.ou-table--sticky th"));
    // And all of it under the shell's own ladder, whose lowest rung is the menu at 60.
    expect(layer("\\.ou-subnav")).toBeLessThan(60);
  });

  it("grounds every stuck layer on the scrim, over a blur", () => {
    // The token the sheet reserves for sticky chrome over scrolled content, and the
    // mockups' own topbar treatment: rows fade under the chrome rather than showing
    // through it, in either palette.
    for (const selector of ["\\.ou-subnav", "\\.ou-sticky-bar", "\\.ou-table--sticky th"]) {
      expect(rule(selector)).toMatch(/background:\s*var\(--scrim\)/);
      expect(rule(selector)).toMatch(/backdrop-filter:\s*blur\(/);
    }
  });

  it("keeps the underline the design system's gesture, and the hue a tone", () => {
    // The invariant the mockups share at every level: a 2px bar under the active tab,
    // inset from its edges, overlapping the row's hairline, glowing. What varies — 06's
    // model purple against 07/21's accent — is a pair of custom properties the modifier
    // redefines, so preserving a mockup's hue never means redrawing the gesture.
    const underline = CODE.match(
      /\.ou-subnav a\[aria-current\]::after\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(underline).toMatch(/height:\s*var\(--sp-1\)/);
    expect(underline).toMatch(/background:\s*var\(--ou-subnav-hue\)/);
    expect(underline).toMatch(/box-shadow:[^;]*var\(--ou-subnav-halo\)/);

    expect(rule("\\.ou-subnav")).toMatch(/--ou-subnav-hue:\s*var\(--accent\)/);
    expect(rule("\\.ou-subnav--model")).toMatch(/--ou-subnav-hue:\s*var\(--model\)/);
  });

  it("marks the active tab off aria-current, which is what a screen reader hears", () => {
    // The same fact the sidebar states the same way: the treatment cannot come apart from
    // what is announced, and a class-only active tab would lie to one kind of reader.
    expect(CODE).toContain(".ou-subnav a[aria-current]");
    expect(CODE).not.toMatch(/\.ou-subnav a\.(?:active|on)\b/);
  });

  it("puts a built tab and a `soon` tab in the same box", () => {
    // One rule for both, so the row does not change height as surfaces land and a tab that
    // is not built yet sits on the same baseline as the one beside it. Asserted as a shared
    // selector rather than as two matching rules, which is the thing that can drift.
    expect(CODE).toMatch(/\.ou-subnav a,\s*\.ou-subnav__soon\s*\{/);
  });

  it("leaves the `soon` tab unhoverable, because it is inert", () => {
    // A hover treatment on something that cannot be pressed is an invitation to press it.
    expect(rule("\\.ou-subnav__soon")).toMatch(/cursor:\s*default/);
    expect(CODE).not.toMatch(/\.ou-subnav__soon:hover/);
  });

  it("gives the `soon` mark the sidebar's own chip, so the two say one thing", () => {
    // `.shell-nav__soon` is the same mark on the same surfaces: a reader who has learnt one
    // has learnt the other, and a second design for the same admission would be drift.
    const mark = rule("\\.ou-subnav__mark");

    expect(mark).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(mark).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(mark).toMatch(/text-transform:\s*uppercase/);
  });

  it("reserves the asking rim for the bar that wants a decision", () => {
    expect(rule("\\.ou-sticky-bar--asking")).toMatch(/border-color:\s*var\(--accent-line\)/);
    expect(rule("\\.ou-sticky-bar--asking")).toMatch(/box-shadow:[^;]*var\(--accent-glow\)/);
  });
});

describe("the meter", () => {
  it("reads its fill from the custom property the component passes", () => {
    // The split this primitive is built on: the sheet keeps the colour, the height and the
    // radius, and the call site contributes one number.
    expect(CODE).toMatch(/\.ou-meter__fill\s*\{[^}]*width:\s*var\(--ou-meter-fill/);
  });

  it("falls back to an empty bar, never to a full one", () => {
    // A component that forgot to say how full a meter is should draw *nothing known*, which
    // is the honest reading. `width: 100%` as the fallback would make every unmeasured bar
    // report complete.
    expect(CODE).toMatch(/width:\s*var\(--ou-meter-fill,\s*0%\)/);
  });

  it("clips the fill to its track, so no value can draw outside the bar", () => {
    expect(CODE).toMatch(/\.ou-meter\s*\{[^}]*overflow:\s*hidden/);
  });

  it("gives each status tone its own rule, from the palette's own token", () => {
    for (const tone of ["ok", "warn", "err"]) {
      expect(CODE).toMatch(
        new RegExp(`\\.ou-meter--${tone} \\.ou-meter__fill\\s*\\{[^}]*var\\(--${tone}\\)`),
      );
    }
  });
});

describe("the live chip's halo", () => {
  it("moves only for a reader who has not asked for less motion", () => {
    // Everything the pulse says, the chip's own label says in words — so a reader who has
    // asked for stillness loses nothing by getting it.
    const guarded = /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.ou-chip__dot--pulse/;

    expect(CODE).toMatch(guarded);
  });

  it("pulses a shadow only, so nothing on the page moves or resizes", () => {
    const frames = /@keyframes ou-chip-pulse\s*\{([\s\S]*?)\n\}/.exec(CODE);

    expect(frames).not.toBeNull();
    expect(frames?.[1]).toMatch(/box-shadow/);
    expect(frames?.[1]).not.toMatch(/transform|width|height|margin/);
  });
});

describe("the switch", () => {
  it("moves only for a reader who has not asked for less motion", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: no-preference)");
    const moved = CODE.indexOf("transition:");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(moved).toBeGreaterThan(guard);
  });

  it("reports its state off `aria-checked`, which is what a screen reader hears", () => {
    // The visual state and the announced state are then the same fact rather than two that
    // have to be kept in step.
    expect(CODE).toContain('.ou-switch[aria-checked="true"]');
  });
});

describe("the focus ring", () => {
  it("adds to the product's ring rather than replacing it", () => {
    // The mockups set `outline: none` on a focused input and draw their own halo;
    // `app/globals.css` gives every control in the product one ring, on the element the
    // keyboard actually reached. Removing it here would leave the field the one control in
    // the application with a different focus treatment.
    expect(CODE).not.toMatch(/outline:\s*(?:none|0)/);
  });
});
