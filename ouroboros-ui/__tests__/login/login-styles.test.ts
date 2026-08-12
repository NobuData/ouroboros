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
  it("recedes by surface rather than by opacity, so its prose still clears AA", () => {
    // The mockup drops this card to `opacity: 0.66`. Every contrast pair the token sheet
    // publishes is measured against a surface, and a translucent layer is not one of them —
    // so a card carrying sentences a signed-out visitor is meant to read cannot be dimmed.
    const preview = /\.login-card--preview\s*\{([^}]*)\}/.exec(SHEET);

    expect(preview).not.toBeNull();
    expect(preview?.[1]).not.toMatch(/opacity/);
    expect(preview?.[1]).toMatch(/background:\s*var\(--/);
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
