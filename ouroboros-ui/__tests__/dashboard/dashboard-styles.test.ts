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
