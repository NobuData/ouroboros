import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/shell/shell.css` that are agreements with something outside it.
 *
 * The generic rules — no colour literal outside the token sheet, no type size in a unit the
 * reader's font-size preference cannot move — are `__tests__/styles.test.ts`'s, and they
 * cover this sheet as they cover every other. What is here is narrower, and is the class of
 * mistake neither the compiler nor a rendering test would catch: a component naming a class
 * the sheet does not define. That is not a build error and not a failed assertion — it is an
 * unstyled element, which in a menu positioned absolutely over a page is a panel that lands
 * somewhere else entirely.
 */

const UI = join(import.meta.dirname, "..", "..");

/** The sheet without its prose, so a rule can never be found inside a comment. */
const SHEET = readFileSync(join(UI, "app", "shell", "shell.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  " ",
);

/**
 * Every class the sheet has a rule for.
 *
 * Read as tokens rather than as parsed selectors, which is enough for the question being
 * asked — *is this name written down at all* — and does not need a CSS parser to answer it.
 * A decimal length contributes a stray entry (`1.875rem` gives `875rem`); nothing named like
 * that is ever asked about.
 */
const DEFINED = new Set([...SHEET.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));

/** The one class the shell borrows from `app/globals.css`, which is not this sheet's to hold. */
const GLOBAL = new Set(["sr-only"]);

/**
 * Every class a component asks for.
 *
 * Two forms, because the shell writes both: a plain `className="…"`, and the literals handed
 * to `cx()` (`app/ui/class-names.ts`) by a component whose class list depends on state. The
 * second form is where the *modifiers* live — the active row, the open drawer — which are
 * exactly the classes a rendering test cannot miss the absence of, because an unstyled
 * modifier looks like a component that is simply not in that state.
 *
 * @param file Path of the component, relative to `app/`.
 * @returns The class names, deduplicated.
 */
function classesOf(file: string): string[] {
  const source = readFileSync(join(UI, "app", file), "utf8");
  const attributes = [...source.matchAll(/className="([^"{}]+)"/g)].map((match) => match[1]);
  const composed = [...source.matchAll(/\bcx\(([^)]*)\)/g)].flatMap((match) =>
    [...match[1].matchAll(/"([^"]+)"/g)].map((literal) => literal[1]),
  );

  const named = [...attributes, ...composed].flatMap((value) =>
    value.split(/\s+/).filter((name) => name.length > 0),
  );

  return [...new Set(named)].filter((name) => !GLOBAL.has(name));
}

describe("the shell's components and its stylesheet", () => {
  it.each([
    "shell/user-menu.tsx",
    "shell/shell-header.tsx",
    "shell/sidebar-nav.tsx",
    "shell/sidebar-toggle.tsx",
    "shell/app-shell.tsx",
    "shell/theme-toggle.tsx",
    "shell/overlay.tsx",
    "shell/search-pill.tsx",
    "shell/tenant-chip.tsx",
  ])("%s asks for no class the sheet does not define", (file) => {
    expect(classesOf(file).filter((name) => !DEFINED.has(name))).toEqual([]);
  });

  it("has something to check, which an empty read would not", () => {
    // Without this the rule above would pass just as well against a component whose classes
    // stopped being readable, and say nothing at all. One of each form: an attribute, and a
    // modifier composed through `cx`.
    expect(classesOf("shell/user-menu.tsx")).toContain("shell-menu__submenu");
    expect(classesOf("shell/sidebar-nav.tsx")).toContain("shell-nav--open");
  });
});

/**
 * The frame CP.1 ([#643](https://github.com/NobuData/ouroboros/issues/643)) is accountable
 * for, read from the sheet.
 *
 * Scroll containment is CSS and nothing else — there is no component to render and assert
 * against, because the whole point of decision S2 is that the *layout* holds the rule rather
 * than any page inside it. jsdom computes no styles, so the honest unit-level assertion is
 * that the declarations are written down; that a browser then does what they say is the e2e
 * leg's (CP.5, #647), which is what the issue means by "e2e-assertable".
 *
 * Each of these is a rule somebody could delete without a rendering test going red, and each
 * one deleted is a different way the shell stops containing anything.
 */
describe("the shell frame", () => {
  /**
   * One rule's declarations.
   *
   * @param selector The selector, as it is written in the sheet.
   * @returns What is between its braces, or `""` when the sheet has no such rule — which
   *   fails the assertion that follows rather than passing it vacuously.
   */
  function rule(selector: string): string {
    const pattern = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`);
    return SHEET.match(pattern)?.[1] ?? "";
  }

  it("is a grid of exactly the viewport, so only a cell that asks can scroll", () => {
    const shell = rule(".app-shell");

    // § 1.3's grid, and the lock it depends on: `html`/`body` are held at 100% with overflow
    // hidden in app/globals.css, and this is the element that fills them.
    expect(shell).toMatch(/grid-template-rows:\s*auto 1fr/);
    expect(shell).toMatch(/grid-template-columns:\s*auto 1fr/);
    expect(shell).toMatch(/height:\s*100%/);
    expect(shell).toMatch(/overflow:\s*hidden/);
  });

  it("declares the sidebar slot's three widths, and drives the sidebar from one property", () => {
    // The acceptance criterion "the grid holds at every breakpoint with the sidebar slot at
    // 240px, 64px and drawer widths": all three are values of one custom property, so the
    // sidebar moves between them without touching the grid.
    const shell = rule(".app-shell");

    expect(shell).toMatch(/--shell-sidebar-wide:\s*15rem/);
    expect(shell).toMatch(/--shell-sidebar-rail:\s*4rem/);
    expect(shell).toMatch(/--shell-sidebar-drawer:\s*0rem/);
    expect(shell).toMatch(/--shell-sidebar-choice:\s*var\(--shell-sidebar-wide\)/);
    expect(shell).toMatch(/--shell-sidebar:\s*var\(--shell-sidebar-choice\)/);

    // And the sidebar reads it rather than restating a width of its own.
    expect(rule(".shell-nav")).toMatch(/width:\s*var\(--shell-sidebar\)/);
  });

  it("keeps the reader's choice and the layout's width as two properties", () => {
    // Written as one, the stamped choice (a selector) would outrank the drawer breakpoint (a
    // media query), and a reader who had expanded the sidebar would find it still sitting in
    // the grid on a phone. The split is what keeps every rule at its natural specificity.
    for (const choice of ["wide", "rail"] as const) {
      expect(SHEET).toMatch(
        new RegExp(
          `:root\\[data-sidebar="${choice}"\\] \\.app-shell\\s*\\{\\s*--shell-sidebar-choice:\\s*var\\(--shell-sidebar-${choice}\\)`,
        ),
      );
    }
  });

  it("makes the rail the default below 1024px, not the rule", () => {
    // The property the *choice* lives in, so the two selectors above still win: below 1024px
    // the rail is what a reader who has said nothing gets.
    expect(SHEET).toMatch(
      /@media \(max-width: 64rem\)\s*\{\s*\.app-shell\s*\{\s*--shell-sidebar-choice:\s*var\(--shell-sidebar-rail\)/,
    );
  });

  it("asks the sidebar's own width whether there is room for a label", () => {
    // The rail treatment is reached three ways — the breakpoint, the reader's chevron, and
    // never by the drawer, which is 240px wide at every viewport. A rule per trigger would be
    // the same declarations three times; a container query is the one question that matters,
    // asked of the element that can answer it.
    expect(rule(".shell-nav")).toMatch(/container:\s*shell-sidebar \/ inline-size/);
    expect(SHEET).toMatch(/@container shell-sidebar \(max-width: 8rem\)/);
  });

  it("hides the rail's labels from the page without hiding them from a screen reader", () => {
    // `display: none` would take the label out of the accessibility tree with it, leaving a
    // rail of unnamed icons for exactly the readers who cannot see the icons.
    const rail = SHEET.match(/@container shell-sidebar \(max-width: 8rem\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(rail).toContain(".shell-nav__label");
    expect(rail).not.toMatch(/\.shell-nav__label,?[^{]*\{[^}]*display:\s*none/);
    expect(rail).toMatch(/clip-path:\s*inset\(50%\)/);
  });

  it("takes the sidebar out of the grid below 768px and floats it over the pane", () => {
    // § 1.2's drawer: the slot has no width because the sidebar is no longer in it, and the
    // sidebar is placed against the viewport under the header.
    const drawer = SHEET.match(/@media \(max-width: 48rem\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(drawer).toMatch(/--shell-sidebar:\s*var\(--shell-sidebar-drawer\)/);
    expect(drawer).toMatch(/position:\s*fixed/);
    expect(drawer).toMatch(/top:\s*var\(--shell-header\)/);
    // Closed, it is hidden rather than merely translated away: an off-screen sidebar that is
    // still visible is one the keyboard tabs into and a screen reader reads out.
    expect(drawer).toMatch(/visibility:\s*hidden/);
    expect(drawer).toMatch(/\.shell-nav--open\s*\{\s*visibility:\s*visible/);
  });

  it("draws the hamburger only where there is a drawer to open", () => {
    expect(rule(".shell-burger")).toMatch(/display:\s*none/);
    expect(SHEET).toMatch(/@media \(max-width: 48rem\)[\s\S]*?\.shell-burger\s*\{\s*display:\s*grid/);
  });

  it("slides the sidebar between its two widths rather than cutting to the new one", () => {
    // The chevron changes a custom property, and a property change lands in a single frame: the
    // sidebar arrives at the width it was collapsed to without having travelled there, and the
    // pane's edge jumps with it. `width` is the property because the grid's first column is
    // `auto` — a transform would paint the sidebar somewhere it does not occupy and leave the
    // pane where it was.
    expect(rule(".app-shell")).toMatch(/--shell-sidebar-slide:\s*160ms/);
    expect(SHEET).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.shell-nav\s*\{\s*transition:\s*width var\(--shell-sidebar-slide\)/,
    );

    // Ordered before the drawer's own transition, which replaces this one below 768px where
    // there is no width to interpolate. The other order would hand the drawer a width
    // transition instead of a slide, which is a drawer that appears rather than arrives.
    expect(SHEET.indexOf("var(--shell-sidebar-slide)")).toBeLessThan(
      SHEET.indexOf("var(--shell-drawer-slide)"),
    );

    // And the sidebar clips what outruns it, so the scrollbar `overflow-y: auto` would
    // otherwise offer a `nowrap` label mid-collapse never appears.
    expect(rule(".shell-nav")).toMatch(/overflow-x:\s*hidden/);
  });

  it("keeps the drawer's slide behind the reduced-motion preference", () => {
    // The same guard the theme's cross-fade keeps: a reader who has asked for less motion
    // gets the drawer instantly, which is the behaviour that was there before the transition.
    expect(SHEET).toMatch(
      /@media \(max-width: 48rem\) and \(prefers-reduced-motion: no-preference\)/,
    );
  });

  it("draws an unbuilt row as one that cannot be pressed", () => {
    const soon = rule(".shell-nav__item--soon");

    // The inert pair every other control in the product takes from `[aria-disabled="true"]`:
    // the faint ink, and a cursor that says the row is not going anywhere.
    expect(soon).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(soon).toMatch(/cursor:\s*not-allowed/);

    // The icon recedes with it, and has to: on the rail the label is sr-only, which leaves the
    // icon as the only thing a sighted reader has to tell an unreachable row from a live one.
    // The badge goes too — a count urging a press on a row that cannot be pressed.
    expect(SHEET).toMatch(
      /\.shell-nav__item--soon \.shell-nav__icon,\s*\.shell-nav__item--soon \.shell-nav__badge\s*\{\s*opacity:/,
    );

    // And the label is not dimmed with them. § 3.5's "'soon' surfaces are labelled, never dead"
    // is the sentence that forbids taking the one part that has to stay readable down as well,
    // which is what an opacity on the row entire would do.
    expect(soon).not.toMatch(/opacity:/);
  });

  it("takes the header's height from the shell rather than restating it", () => {
    // The drawer starts below the header, so two rules know that number — and two files
    // knowing it is one file's chance to change it alone.
    expect(rule(".app-shell")).toMatch(/--shell-header:\s*3\.5rem/);
    expect(rule(".shell-header")).toMatch(/height:\s*var\(--shell-header\)/);
  });

  it("gives the pane vertical scroll, a stable gutter, and no way to scroll sideways", () => {
    const pane = rule(".app-shell__pane");

    expect(pane).toMatch(/overflow-y:\s*auto/);
    // The acceptance criterion "no horizontal scrollbar appears on the pane at 1280–3840px":
    // a wide widget scrolls in its own wrapper (CP.4), and the pane refuses outright.
    expect(pane).toMatch(/overflow-x:\s*hidden/);
    // And the one that stops a short page and a long page being laid out at different widths.
    expect(pane).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("centres the measure the design system gives every page", () => {
    // § 2: max content width 1440px, centred. 90rem is that at the 100% font step, and moves
    // with the reader's preference because it is rem.
    const measure = rule(".app-shell__measure");

    expect(measure).toMatch(/max-width:\s*90rem/);
    expect(measure).toMatch(/margin:\s*0 auto/);
  });

  it("pays back the gutter the lock takes away", () => {
    // The whole subtlety of `app/shell/pane-scroll.ts`, as a rule: `scrollbar-gutter: stable`
    // reserves a gutter only for an overflow of scroll or auto, so locking with `hidden`
    // un-reserves it and the pane's contents reflow under the dialog. The measured width comes
    // back as padding, and the property is what carries it.
    const locked = rule(".app-shell__pane--locked");

    expect(locked).toMatch(/overflow-y:\s*hidden/);
    expect(locked).toMatch(/padding-inline-end:\s*var\(--shell-pane-gutter/);
  });

  it("keeps the overlay layer from being a box", () => {
    // It is a grid child. A layer that generated one would be a fourth cell in a three-cell
    // grid — or, positioned, an invisible sheet over the whole product.
    expect(rule(".shell-overlays")).toMatch(/display:\s*contents/);
  });

  it("stacks an overlay above the menu panel and the skip link", () => {
    // A dialog covers a menu, and covers a skip link leading into a page the reader cannot
    // reach while it is open.
    const layers = (selector: string) => Number(rule(selector).match(/z-index:\s*(\d+)/)?.[1]);

    expect(layers(".shell-overlay")).toBeGreaterThan(layers(".shell-skip"));
    expect(layers(".shell-skip")).toBeGreaterThan(layers(".shell-menu__panel"));
  });

  it("places the overlay against the viewport rather than against the frame", () => {
    // `fixed`, not `absolute`: the shell grid is the same size as the viewport today and would
    // stop being so the moment anything about the frame changed.
    expect(rule(".shell-overlay")).toMatch(/position:\s*fixed/);
  });
});

describe("the account menu's own rules", () => {
  it("takes every font size from the token sheet rather than inventing one", () => {
    // Design system § 3.2 and CQ.1: all type is rem-based, from one root change, so the
    // font-size preference scales the menu along with everything else.
    for (const [, value] of SHEET.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("marks the chosen workspace by its ARIA state rather than by a class", () => {
    // The selector is `[aria-checked="true"]`, which means the treatment cannot come apart
    // from what a screen reader is told: a row that looks chosen and does not announce it is
    // a row that lies to exactly one kind of reader.
    expect(SHEET).toMatch(/\.shell-menu__choice\[aria-checked="true"\]\s*\{/);
  });

  it("keeps both transports out of the layout they sit in", () => {
    // The sign-out form and the submenu's presentational wrapper carry markup the
    // accessibility tree needs and the column must not see. `display: contents` is what makes
    // each a passage rather than a box — the same rule `app/login/login.css` keeps for the
    // switch form on step 2.
    for (const name of ["shell-menu__form", "shell-menu__branch"]) {
      expect(SHEET).toMatch(new RegExp(`\\.${name}\\s*\\{[^}]*display:\\s*contents`));
    }
  });

  it("crops the avatar's picture to the shape the rest of the cluster is drawn in", () => {
    // The button is a circle with a hairline; a picture of unknown aspect would otherwise
    // sit inside it as a rectangle, or push the header's row height around.
    expect(SHEET).toMatch(/\.shell-avatar\s*\{[^}]*overflow:\s*hidden/);
    expect(SHEET).toMatch(/\.shell-avatar__image\s*\{[^}]*object-fit:\s*cover/);
  });
});
