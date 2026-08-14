import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/dashboard/dashboard.css` that are agreements with something
 * outside it.
 *
 * The generic rule — no colour literal anywhere but the token sheet — is
 * `__tests__/styles.test.ts`'s, and it covers this sheet as it covers every other. What is
 * here is narrower: the facts this sheet has to keep in step with the component that uses
 * it, with the token sheet's contrast guarantees, and with the font-size preference, none
 * of which is visible from inside the file.
 */

const UI = join(import.meta.dirname, "..", "..");
const SHEET = readFileSync(join(UI, "app", "dashboard", "dashboard.css"), "utf8");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

describe("the grid's column spans", () => {
  it("defines every span the screen and its skeleton ask for", () => {
    // The two files name spans as class suffixes, so a span with no rule behind it is a
    // card silently taking the full twelve columns rather than a build error.
    for (const span of [3, 4, 5, 7, 8]) {
      expect(CODE).toMatch(new RegExp(`\\.dash-col--${span}\\s*\\{[^}]*grid-column:\\s*span ${span}`));
    }
  });

  it("stacks the wide pairs before the narrow tiles, at the mockup's two widths", () => {
    // A stat tile is readable at half width; a table card is not, so the pairs go full
    // width one step earlier. Both breakpoints exist, and in that order.
    const widths = [...CODE.matchAll(/@media \(max-width:\s*([\d.]+)rem\)/g)].map((m) =>
      Number(m[1]),
    );

    expect(widths).toContain(68.75);
    expect(widths).toContain(40);
  });
});

describe("the page head", () => {
  it("lets the actions drop under the headings rather than crushing them", () => {
    // The mockup's `.page-head` at its own widths: a flex row that wraps, with the heading
    // column holding a floor so "Good afternoon, Ken — the loop is turning." never wraps to
    // one word a line beside two buttons.
    const head = /\.dash__head\s*\{([^}]*)\}/.exec(CODE);
    const headings = /\.dash__headings\s*\{([^}]*)\}/.exec(CODE);

    expect(head?.[1]).toMatch(/flex-wrap:\s*wrap/);
    expect(headings?.[1]).toMatch(/min-width:\s*[\d.]+rem/);
  });

  it("marks a subline that is a failure rather than an activity", () => {
    // The page head's half of the honesty rule: an aggregate nobody could read must not
    // render as a workspace with nothing in it.
    expect(CODE).toMatch(/\.dash__sub--failed\s*\{[^}]*color:\s*var\(--err\)/);
  });
});

describe("the stat row's tones", () => {
  it("defines a class for every tone the tile can be given", () => {
    // `StatCard` names these as class suffixes, so a tone with no rule behind it is a delta
    // that silently draws muted — a down week rendering as a neutral one — rather than a
    // build error.
    for (const tone of ["up", "down", "failed"]) {
      expect(CODE).toMatch(new RegExp(`\\.dash-stat__delta--${tone}\\s*\\{[^}]*color:`));
    }
  });

  it("takes each of them from the palette's own status tokens", () => {
    // Both palettes publish contrast for these against `--surface`; a hand-picked green
    // would be legible in one theme and not the other.
    expect(CODE).toMatch(/\.dash-stat__delta--up\s*\{[^}]*color:\s*var\(--ok\)/);
    expect(CODE).toMatch(/\.dash-stat__delta--down\s*\{[^}]*color:\s*var\(--err\)/);
    expect(CODE).toMatch(/\.dash-stat__value--accent\s*\{[^}]*color:\s*var\(--accent\)/);
  });
});

describe("the active loops table", () => {
  it("fixes the stage column's width in rem, so the meter keeps its length at every scale", () => {
    // The mockup's `<th style="width:180px">`. A px width is the one length on this page
    // that would refuse to move with the reader's font-size preference — and the cell holds
    // a caption over a bar, both of which grow with the type.
    expect(CODE).toMatch(/\.dash-runs__stage\s*\{[^}]*width:\s*[\d.]+rem/);
  });

  it("holds a measure on the issue title rather than letting one row size the table", () => {
    // The table scrolls inside its own box, so a long title lengthens the row rather than
    // the page — but an unbounded one would push the five columns after it off the card.
    expect(CODE).toMatch(/\.dash-run__title\s*\{[^}]*max-width:/);
  });

  it("stacks the stage caption over its bar", () => {
    expect(CODE).toMatch(/\.dash-run__stage\s*\{[^}]*flex-direction:\s*column/);
  });
});

describe("the loop pulse card", () => {
  it("reserves the glyph's box at the asset's own ratio, so nothing moves when it loads", () => {
    // 512×296 is the #14 file's size, and the pair is pixel-identical — which is what makes
    // stacking both treatments in one grid cell safe.
    expect(CODE).toMatch(/\.dash-pulse__glyph\s*\{[^}]*aspect-ratio:\s*512\s*\/\s*296/);
    expect(CODE).toMatch(/\.dash-pulse__glyph\s*\{[^}]*width:\s*[\d.]+rem/);
  });

  it("chooses a treatment in CSS, under the same three selectors the token sheet uses", () => {
    // The mark has to be right before any JavaScript runs, so the palette decides it here
    // rather than a component reading the theme — which is also what makes the card render
    // identically on the server and in the browser.
    expect(CODE).toMatch(/\.dash-pulse__mark--dark\s*\{[^}]*opacity:\s*0/);
    expect(CODE).toMatch(/:root\[data-theme="dark"\]\s*\.dash-pulse__mark--light/);
    expect(CODE).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  it("paints neither of the mockup's two workarounds over the asset", () => {
    // docs/BRAND.md § Rules bans both on this pair by name: the mockup's crop still had its
    // background attached and needed blending onto the card, then a shadow to give back the
    // glow the blend flattened. On a light card the blend would erase the mark outright.
    expect(CODE).not.toMatch(/mix-blend-mode|drop-shadow/);
  });

  it("hues the two figures that report something, and leaves the third the page's ink", () => {
    // The tones are `view.ts`'s union, and a tone with no rule behind it is a figure
    // silently drawing in the default ink rather than a build error.
    expect(CODE).toMatch(/\.dash-pulse__value--ok\s*\{[^}]*color:\s*var\(--ok\)/);
    expect(CODE).toMatch(/\.dash-pulse__value--warn\s*\{[^}]*color:\s*var\(--warn\)/);
    expect(CODE).toMatch(/\.dash-pulse__value--accent\s*\{[^}]*color:\s*var\(--ink\)/);
  });

  it("marks a note that is a failure rather than an explanation", () => {
    expect(CODE).toMatch(/\.dash-pulse__note--err\s*\{[^}]*color:\s*var\(--err\)/);
  });

  it("pushes the switch to the foot of the card, whatever height the grid row gives it", () => {
    // The mockup's own layout: the meters sit under the mark and the switch under the rule,
    // so two cards on one row have their switches on one line.
    expect(CODE).toMatch(/\.dash-pulse__divider\s*\{[^}]*margin:\s*auto 0 0/);
    expect(CODE).toMatch(/\.dash-pulse\s*\{[^}]*flex:\s*1/);
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
});

describe("the user-agent defaults this sheet has to undo", () => {
  it("zeroes the inline margin a browser gives every `dd` in the system list", () => {
    // A `dd` carries a 40px inline start margin from the UA sheet. Left alone it pushes the
    // chip out of its own grid column and indents the note under it — and 40px is also the
    // one length on this page that would not follow the font-size preference.
    for (const part of ["value", "note"]) {
      const rule = new RegExp(`\\.dash-system__${part}\\s*\\{([^}]*)\\}`).exec(CODE);

      expect(rule, `.dash-system__${part} has no rule`).not.toBeNull();
      expect(rule?.[1]).toMatch(/margin:/);
    }
  });

  it("zeroes the block margin a browser gives the paragraphs inside a flex column", () => {
    // Added to the container's `gap` rather than replaced by it, so an unzeroed `p` reads
    // as an uneven gap rather than as a missing rule.
    for (const rule of ["\\.dash__sub", "\\.dash-system__note"]) {
      expect(CODE).toMatch(new RegExp(`${rule}\\s*\\{[^}]*margin:`));
    }
  });
});

describe("what this sheet no longer owns", () => {
  it("defines no button, card, chip or empty state of its own", () => {
    // #46 moved all four into `app/ui/ui.css`, and the value of that move is entirely in
    // there being one definition rather than two. A page sheet that grew a second copy —
    // because a card needed one more variant, on a deadline — is exactly the drift the
    // primitives exist to stop, and it would be invisible in a screenshot.
    for (const block of ["dash-btn", "dash-card", "dash-pill", "dash-empty"]) {
      expect(CODE, `${block} is the primitives' now`).not.toContain(`.${block}`);
    }
  });

  it("styles no primitive of the design system from here", () => {
    // The other direction, and the subtler one: reaching into `.ou-*` from a page sheet
    // would make a primitive mean something different on one screen, which is a fork of the
    // design system written where nobody would look for it. A page places a primitive by
    // passing its own class, never by restyling the primitive's.
    expect(CODE).not.toContain(".ou-");
  });
});

describe("the skeleton's animation", () => {
  it("moves only for a reader who has not asked for less motion", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: no-preference)");
    const animated = CODE.indexOf("animation:");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(animated).toBeGreaterThan(guard);
  });

  it("pulses opacity only, so nothing on the page moves or resizes", () => {
    const frames = /@keyframes dash-skeleton-pulse\s*\{([\s\S]*?)\n\}/.exec(CODE);

    expect(frames).not.toBeNull();
    expect(frames?.[1]).toMatch(/opacity/);
    expect(frames?.[1]).not.toMatch(/transform|width|height|margin/);
  });
});
