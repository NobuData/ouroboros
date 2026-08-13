import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/login/login.css` that are agreements with something outside it.
 *
 * The generic rules — no colour literal, rem where the type scale should reach — are
 * `__tests__/styles.test.ts`'s, and they cover this sheet as they cover every other. What is
 * here is narrower: the facts this sheet has to keep in step with a PNG, with the theme
 * contract, with the document's scroll lock, and with the drawing it is a port of, each of
 * which is invisible from inside the file.
 *
 * The last of those is [#717](https://github.com/NobuData/ouroboros/issues/717)'s: the
 * mockup-fidelity audit of the shipped split and brand panel. Its findings live in the
 * roadmap as a diff-list; what is here is the half of that list a later edit could silently
 * undo. The mockup's own numbers are written down as constants below rather than parsed out
 * of `docs/mockups/01-login.html` — the drawing is frozen (docs/DESIGN_TOKENS.md), a check
 * spanning two directories belongs at the repository level next to `verify-tokens.sh`, and
 * a test that reads the thing it is checking against agrees with it by construction.
 */

const UI = join(import.meta.dirname, "..", "..");
const SHEET = readFileSync(join(UI, "app", "login", "login.css"), "utf8");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** `docs/mockups/01-login.html`'s one breakpoint: `@media (max-width: 900px)`. */
const MOCKUP_BREAKPOINT_PX = 900;

/**
 * The font size a media query resolves `rem` against.
 *
 * Not the root's declared size and not the font-scale preference's: CSS Conditional § 4
 * evaluates relative units in a query against their *initial* values, which is what makes
 * the breakpoint below a fixed viewport width rather than one the reader can move.
 */
const ROOT_FONT_PX = 16;

/**
 * Read one rule's declarations out of the sheet.
 *
 * Whitespace in the selector is matched loosely — `li + li` finds `li+li` — so these cases
 * are about what a rule declares and not about how it was spaced. What is matched strictly
 * is where the selector ends: the brace has to follow it, so asking for `.login-brand` can
 * never return `.login-brand__lockup`'s declarations, and a rule that has been renamed
 * throws here rather than quietly passing on a sibling's.
 *
 * @param selector Selector to find, as the sheet writes it.
 * @returns Everything between that rule's braces, prose already stripped.
 * @throws {Error} When no rule in the sheet has that selector.
 */
function rule(selector: string): string {
  const wanted = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const found = new RegExp(`(?:^|[},])\\s*${wanted}\\s*\\{([^}]*)\\}`).exec(CODE);

  if (!found) throw new Error(`login.css has no \`${selector}\` rule`);

  return found[1];
}

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

describe("the lockup itself", () => {
  it("places the #14 pair and paints nothing over it", () => {
    // The mockup hangs two things on its lockup — `mix-blend-mode: screen` and a 34px
    // `drop-shadow(var(--glow))` — and they are one workaround, not two effects: that crop
    // was cut with its ground still attached, so it had to be blended onto the panel and
    // then given back the halo the blend flattened. docs/BRAND.md § Rules bans both on
    // these assets by name — no filter, no shadow behind the mark, and "the mockups' older
    // crops need [screen] because their background was never removed; these do not". The
    // #14 pair is de-grounded and carries its own glow in the artwork, which is why the
    // header's mark pair (shell.css) places its two and stops. This page had kept the
    // drop-shadow, where in the light palette it is a teal smear behind a navy wordmark.
    expect(rule(".login-brand__mark")).not.toMatch(/filter:/);
    expect(CODE).not.toContain("mix-blend-mode");
  });
});

describe("the mockup's 55/45 split", () => {
  it("gives the two panels the mockup's proportions", () => {
    expect(rule(".login-brand")).toMatch(/flex:\s*55\b/);
    expect(rule(".login-auth")).toMatch(/flex:\s*45\b/);
  });

  it("draws the seam between them the way the mockup does", () => {
    // The auth half is the raised plane with a hairline down its left edge; the brand half
    // is the page ground with the glows over it. Lose either and the split stops reading as
    // two surfaces and starts reading as one page with a wide margin.
    const auth = rule(".login-auth");

    expect(auth).toMatch(/background:\s*var\(--surface\)/);
    expect(auth).toMatch(/border-left:\s*1px solid var\(--line\)/);
  });

  it("stacks at the mockup's 900px, asked in a unit that keeps meaning the viewport", () => {
    // A media query resolves `rem` against the *initial* font size rather than the one
    // `:root` declares, so 56.25rem is 900px and the font-scale preference cannot move it —
    // which is the behaviour to want from a question about how wide the viewport is. One
    // query, because the mockup has one breakpoint.
    const queries = [...CODE.matchAll(/@media\s*\(max-width:\s*([\d.]+)rem\)/g)];

    expect(queries).toHaveLength(1);
    expect(Number(queries[0][1]) * ROOT_FONT_PX).toBe(MOCKUP_BREAKPOINT_PX);

    const stacked = CODE.slice(CODE.indexOf("@media"));

    expect(stacked).toMatch(/\.login__split\s*\{[^}]*flex-direction:\s*column/);
    expect(stacked).toMatch(/\.login-auth\s*\{[^}]*border-left:\s*none/);
    expect(stacked).toMatch(/\.login-auth\s*\{[^}]*border-top:\s*1px solid var\(--line\)/);
  });
});

describe("the brand panel's ground", () => {
  it("layers the mockup's glow, corner wash and dot grid over it", () => {
    const background = /background:([^;]*);/.exec(rule(".login-brand"))?.[1] ?? "";

    expect(background.match(/radial-gradient\(/g)).toHaveLength(3);
    for (const token of ["--accent-tint", "--accent-wash", "--grid-dot", "--ground"]) {
      expect(background, `the ${token} layer`).toContain(`var(${token})`);
    }
  });

  it("is the ground the token sheet has measured text against, not the mockup's deeper one", () => {
    // The mockup writes `--bg0`, which the rename table makes `--ground-deep` — and the
    // token sheet keeps that one for gutters and backdrops, measuring no text against it.
    // In the light palette it is darker than `--raised`, where `--ink-faint` already only
    // reaches 4.58:1, so the trust row printed on it would fall under AA. Taking the
    // mockup's ground means measuring `--ground-deep` as a text surface in the token sheet
    // first, which is a #16 change; #717 weighed it and left this alone deliberately, so a
    // later reader comparing the two files does not "correct" it back.
    const background = rule(".login-brand");

    expect(background).toContain("var(--ground)");
    expect(background).not.toContain("var(--ground-deep)");
  });

  it("holds the dot grid's texture in px, so a raised type scale cannot thin it", () => {
    // The dot is 1px and the tile it repeats on has to be px with it: grow the tile with
    // the type and the dots stay the size they were while the grid spreads, which is a
    // different texture — the thing this sheet's own opening rule says not to make. The
    // glows above it are rem for the opposite reason. They light the lockup and the lines,
    // and light that stayed put while its subject grew would slide off it.
    const grid = /radial-gradient\(var\(--grid-dot\)[^)]*\)[^,;]*/.exec(rule(".login-brand"));

    expect(grid?.[0]).toContain("1px");
    expect(grid?.[0]).not.toMatch(/[\d.]+rem/);
  });
});

describe("the mockup's three brand lines", () => {
  it("carries the ink / dim / accent treatment, the first line by inheritance", () => {
    // Ink, then dim, then accent — the claim, its expansion, the payoff. The first names no
    // colour because the one it would name is the one it already has from body, and a rule
    // restating an inherited value is a second place to keep it correct.
    expect(rule(".login-brand__line")).not.toMatch(/color:/);
    expect(rule(".login-brand__line:nth-child(2)")).toMatch(/color:\s*var\(--ink-dim\)/);
    expect(rule(".login-brand__line:nth-child(3)")).toMatch(/color:\s*var\(--accent\)/);
  });

  it("keeps the mockup's halo on the payoff line, in the tint and not the reserved glow", () => {
    // `--accent-tint` is the rename of the `--glow-soft` the mockup reaches for here.
    // docs/BRAND.md reserves `--accent-glow` for live things — running loops, the primary
    // action, the active nav item — and a tagline is none of them. The token also settles
    // the light palette without a second rule: 10% of a deep teal, blurred, behind dark
    // text on a light ground comes to nothing, which is what a glow should come to where
    // there is no dark for it to sit in.
    const payoff = rule(".login-brand__line:nth-child(3)");

    expect(payoff).toMatch(/text-shadow:[^;]*var\(--accent-tint\)/);
    expect(payoff).not.toContain("--accent-glow");
  });

  it("prints the trust row in the mockup's faint uppercase mono", () => {
    const trust = rule(".login-brand__trust");

    expect(trust).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(trust).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(trust).toMatch(/text-transform:\s*uppercase/);
    // The mockup sets its separators as `<span class="sep">·</span>`. Here they are drawn
    // rather than written, which is what keeps the row three claims to a screen reader
    // instead of three claims and two full stops.
    expect(rule(".login-brand__trust li + li::before")).toMatch(/color:\s*var\(--line-strong\)/);
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
