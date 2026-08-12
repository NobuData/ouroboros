import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/login/login.css` that are agreements with something outside it.
 *
 * The generic rules — no colour literal, rem where the type scale should reach — are
 * `__tests__/styles.test.ts`'s, and they cover this sheet as they cover every other. What is
 * here is narrower: three facts this sheet has to keep in step with a PNG, with the theme
 * contract, and with the document's scroll lock, each of which is invisible from inside the
 * file.
 */

const UI = join(import.meta.dirname, "..", "..");
const SHEET = readFileSync(join(UI, "app", "login", "login.css"), "utf8");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

describe("the lockup's reserved box", () => {
  it("declares the aspect ratio of the asset it is reserving space for", () => {
    // The pair is absolutely stacked in one grid cell, so nothing in the flow measures them:
    // without this the column jumps by the lockup's height when the images decode. A ratio
    // that drifted from the file would reserve the wrong box and letterbox the mark.
    const declared = /aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/.exec(SHEET);

    expect(declared).not.toBeNull();

    const png = readFileSync(join(UI, "public", "brand", "lockup-tagline-light.png"));

    expect(Number(declared?.[1])).toBe(png.readUInt32BE(16));
    expect(Number(declared?.[2])).toBe(png.readUInt32BE(20));
  });
});

describe("the light/dark lockup pair", () => {
  it("mirrors the token sheet's three palette blocks, so CSS alone picks the treatment", () => {
    // The same three selectors app/tokens.css uses and the header's mark pair repeats:
    // light on the bare :root, the explicit dark choice, then dark from the OS with an
    // explicit light choice still winning. Miss the third and a light-choosing reader on a
    // dark OS gets the dark lockup on a light panel.
    expect(SHEET).toContain('[data-theme="dark"] .login-brand__mark--light');
    expect(SHEET).toContain("(prefers-color-scheme: dark)");
    expect(SHEET).toContain(':not([data-theme="light"])');
  });

  it("hides one of the pair by opacity, never by display", () => {
    // `display` cannot be interpolated, so a pair swapped that way snaps to the new mark
    // halfway through the theme cross-fade — and an unlaid-out mark cannot hold the box.
    const marks = [...SHEET.matchAll(/\.login-brand__mark--(?:light|dark)\s*\{([^}]*)\}/g)];

    expect(marks.length).toBeGreaterThan(0);
    for (const [, declarations] of marks) {
      expect(declarations).not.toMatch(/display:/);
    }
  });
});

describe("the step nobody can act on yet", () => {
  it("dims nothing anywhere on this screen", () => {
    // The mockup drops step 2 to `opacity: 0.66` before sign-in. Every contrast pair the
    // token sheet publishes is measured against a surface, and a translucent layer is not
    // one of them — so a card carrying sentences a signed-out visitor is meant to read
    // cannot be dimmed. Since #46 the recession is the `Card` primitive's `inset` surface,
    // chosen in `app/login/workspace-card.tsx` and asserted in that component's suite; what
    // this sheet owes is not to have reintroduced the dimming by another route.
    // The one opacity on this screen is the lockup pair's cross-fade, which is how the
    // brand mark follows the palette (above) rather than a surface being dimmed.
    for (const [, selector] of CODE.matchAll(/([^{}]*)\{[^{}]*opacity:[^{}]*\}/g)) {
      expect(selector).toContain("__mark");
    }
  });
});

describe("what this sheet no longer owns", () => {
  it("defines no card, button, chip, field, switch or empty state of its own", () => {
    // #46 moved all six into `app/ui/ui.css`, and the value of that move is entirely in
    // there being one definition rather than one per screen. What is left here is this
    // screen's frame, its brand panel, its rows and its monogram — the shapes no other
    // screen has.
    for (const block of [
      ".login-card",
      ".login-btn",
      ".login-pill",
      ".login-field__",
      ".login-switch ",
      ".login-empty",
    ]) {
      expect(CODE, `${block} is the primitives' now`).not.toContain(block);
    }
  });

  it("styles no primitive of the design system from here", () => {
    // Reaching into `.ou-*` from a page sheet would fork the design system on one screen,
    // in the file nobody would think to look in. A page places a primitive by passing its
    // own class to it, never by restyling the primitive's own.
    expect(CODE).not.toContain(".ou-");
  });
});

describe("the screen's own scroll container", () => {
  it("scrolls itself, because the document is locked and it renders outside the shell", () => {
    // globals.css locks html/body so the shell's content pane is the only scrolling thing in
    // the product. A screen outside the shell inherits that lock, so without this rule a
    // short viewport clips the second card with no way to reach it.
    const login = /\.login\s*\{([^}]*)\}/.exec(SHEET);

    expect(login?.[1]).toMatch(/height:\s*100%/);
    expect(login?.[1]).toMatch(/overflow-y:\s*auto/);
  });
});
