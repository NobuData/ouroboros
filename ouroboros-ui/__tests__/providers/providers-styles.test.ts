import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/providers/providers.css` that are agreements with something outside
 * it (#225, the add-provider flow's rules since #231, the cards' since #228, and the page's
 * states, the strip and the skeleton since #232).
 *
 * The generic rule — no colour literal anywhere but the token sheet — is
 * `__tests__/styles.test.ts`'s, and it covers this sheet as it covers every other. What is
 * here is narrower: the facts this sheet has to keep in step with the component that uses it,
 * with the token sheet's contrast guarantees, and with the reader's font-size preference,
 * none of which is visible from inside the file.
 *
 * **This is also where "renders in both themes" is actually verified.** jsdom applies no
 * stylesheet, so `audit-trail.test.tsx` can prove the two palettes produce identical markup
 * and nothing more (`__tests__/helpers/palettes.tsx` sets this out). What proves the palettes
 * themselves are legible is that every hue here is a published token, and both palettes
 * publish contrast for each of them against the surface it is drawn on.
 */

const UI = join(import.meta.dirname, "..", "..");
const PROVIDERS = join(UI, "app", "providers");
const SHEET = readFileSync(join(PROVIDERS, "providers.css"), "utf8");

/**
 * Every component in the directory, as one source — the sheet dresses the sheet's listing
 * (`audit-trail.tsx`), the dialog (`add-provider.tsx`) and the dashed card
 * (`providers-screen.tsx`), and a class any of them renders is a class the sheet owes a rule.
 */
const COMPONENT = readdirSync(PROVIDERS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(PROVIDERS, name), "utf8"))
  .join("\n");

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

/** Every class the sheet declares a rule for. */
const DECLARED = [...CODE.matchAll(/\.(providers-[a-z0-9_-]+)/g)].map((match) => match[1]);

describe("the sheet and the component", () => {
  it("declares a rule for every class the sheet names, and renders every one", () => {
    // The same agreement `ui-styles.test.ts` holds the design system to: a class nobody
    // renders is a class nobody keeps correct, and a class rendered with no rule is a
    // treatment somebody thought they had shipped.
    expect(DECLARED.length).toBeGreaterThan(0);

    for (const name of new Set(DECLARED)) {
      expect(COMPONENT, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("adds nothing the dialog already owns, and stacks only the one dropdown it introduces", () => {
    // The panel, the scrim, the scroll lock and the focus ring are `.shell-overlay`'s — the
    // one implementation of § 1.3's dialog contract, and a second set here would fork it. The
    // card's overflow menu (#229) is the sheet's first dropdown, though, and a dropdown that
    // did not lift above the card below it would open behind it; the registry's import menu
    // makes exactly this one exception in its own sheet, at the same value.
    expect(CODE).not.toContain("position: fixed");
    expect(CODE).not.toContain("--scrim");
    expect([...CODE.matchAll(/z-index/g)]).toHaveLength(1);
    expect(rule("\\.providers-card__menu-panel")).toMatch(/z-index:\s*20/);
  });
});

describe("the columns", () => {
  it("fixes the two columns a reader scans, and lets the sentence take what is left", () => {
    // The stamp column has to start in the same place on every row; the action column is the
    // only one whose content is a sentence.
    expect(rule("\\.providers-audit__when")).toContain("width");
    expect(rule("\\.providers-audit__who")).toContain("width");
    expect(rule("\\.providers-audit__kind")).toContain("width");
    expect(rule("\\.providers-audit__what")).not.toContain("width");
  });

  it("keeps a stamp on one line and lets a refused sentence take two", () => {
    // A refused row is the longest cell in the table and the one a reader most needs to read,
    // so it wraps rather than truncating into `rotated the credential · refused · provider_va…`.
    expect(rule("\\.providers-audit__when")).toContain("white-space: nowrap");
    expect(rule("\\.providers-audit__what")).toContain("flex-wrap: wrap");
  });

  it("sizes every column in rem, so the reader's font-size preference moves them", () => {
    for (const column of ["when", "who", "kind"]) {
      expect(rule(`\\.providers-audit__${column}`)).toMatch(/width:\s*[\d.]+rem/);
    }
  });
});

describe("the refusal marker", () => {
  it("is drawn in the error hue the palette publishes, and never a literal", () => {
    const marker = rule("\\.providers-audit__refused");

    expect(marker).toContain("color: var(--err)");
    expect(marker).toContain("background: var(--err-tint)");
    expect(marker).toContain("border: 1px solid var(--err-line)");
  });

  it("carries a shape of its own, so it is not colour alone", () => {
    // The health strip's `unknown` chip makes the same argument: a row that reads as a
    // completed reveal to somebody who cannot distinguish two hues would be this trail's most
    // consequential lie. The word is the component's; the pill is what stops it reading as
    // prose in the middle of the sentence.
    const marker = rule("\\.providers-audit__refused");

    expect(marker).toContain("border-radius: var(--r-pill)");
    expect(COMPONENT).toContain("refused");
  });
});

describe("the add-provider flow", () => {
  it("draws the promised tile as visibly not a control, in words and in treatment", () => {
    // The `coming soon` tile: a dashed hairline on no ground, muted ink, an arrow cursor —
    // and the word beside the label, so the state is not the treatment alone.
    const soon = rule("\\.providers-catalog__tile--soon");

    expect(soon).toContain("1px dashed var(--line-strong)");
    expect(soon).toContain("background: transparent");
    expect(soon).toContain("cursor: default");
    expect(COMPONENT).toContain("coming soon");
  });

  it("draws the dashed card as the mockup does, on the design system's card", () => {
    const card = rule("\\.providers-add-card");

    expect(card).toContain("1px dashed var(--line-strong)");
    expect(card).toContain("background: transparent");
    expect(rule("\\.providers-add-card__note")).toContain("max-width: 34ch");
  });

  it("draws the duplicate warning in the warn hue and the refusal in the error hue", () => {
    // A duplicate is *probably a mistake*; a refusal is *refused*. Two facts, two hues, and
    // the words carry each besides.
    expect(rule("\\.providers-add__warning")).toContain("background: var(--warn-tint)");
    expect(rule("\\.providers-add__warning")).toContain("border: 1px solid var(--warn-line)");
    expect(rule("\\.providers-add__failure")).toContain("color: var(--err)");
  });

  it("sizes the monogram and the tile grid in rem, so the font-size preference moves them", () => {
    expect(rule("\\.providers-catalog__monogram")).toMatch(/width:\s*[\d.]+rem/);
    expect(rule("\\.providers-catalog")).toMatch(/minmax\([\d.]+rem/);
  });
});

describe("the provider cards", () => {
  it("lays the grid out two abreast, collapsing to one at a rem breakpoint", () => {
    // Responsive two-column → single (#228), and the breakpoint moves with the reader's
    // font-size preference because it is rem rather than px.
    expect(rule("\\.providers-grid")).toContain("repeat(2, minmax(0, 1fr))");
    expect(CODE).toMatch(/@media \(max-width: [\d.]+rem\)\s*\{\s*\.providers-grid\s*\{[^}]*minmax\(0, 1fr\)/);
  });

  it("tints each monogram from the token sheet's published triples, and never a mixed colour", () => {
    // The mockup mixes its tints with `color-mix()`; here each tint is the hue's own
    // `-line` / `-tint` tokens, which both palettes publish contrast for.
    for (const [tint, hue] of [
      ["model", "model"],
      ["accent", "accent"],
      ["warn", "warn"],
      ["ok", "ok"],
    ]) {
      const declarations = rule(`\\.providers-card__monogram--${tint}`);

      expect(declarations).toContain(`border-color: var(--${hue}-line)`);
      expect(declarations).toContain(`background: var(--${hue}-tint)`);
      expect(declarations).toContain(`color: var(--${hue})`);
    }
    expect(CODE).not.toContain("color-mix");
  });

  it("sizes the monogram in rem — the mockup's 42px square, following the preference", () => {
    expect(rule("\\.providers-card__monogram")).toMatch(/width:\s*[\d.]+rem/);
    expect(rule("\\.providers-card__monogram")).toMatch(/height:\s*[\d.]+rem/);
  });

  it("dims a switched-off card's regions and keeps its head at full ink", () => {
    expect(CODE).toMatch(/\.providers-card--off > :not\(\.providers-card__head\)\s*\{[^}]*opacity/);
  });

  it("pushes the foot to the bottom so two cards' feet share a line", () => {
    expect(rule("\\.providers-card__foot")).toContain("margin-top: auto");
    expect(rule("\\.providers-card__foot")).toContain("border-top: 1px solid var(--line)");
  });

  it("draws the test note in the ok hue and the meta row in the faint mono the mockup uses", () => {
    expect(rule("\\.providers-card__test-note")).toContain("color: var(--ok)");
    expect(rule("\\.providers-card__meta")).toContain("font-family: var(--f-mono)");
    expect(rule("\\.providers-card__meta")).toContain("color: var(--ink-faint)");
  });
});

describe("the page's states (#232)", () => {
  it("draws the read-only note at the routing page's measure and rhythm", () => {
    expect(rule("\\.providers-readonly")).toContain("max-width: 72ch");
    expect(rule("\\.providers-readonly")).toContain("margin: 0 0 var(--sp-9)");
    expect(rule("\\.providers-readonly__head")).toContain("font-weight: 600");
  });

  it("gives the banner the grid's own gap below it, and adds nothing to the primitive's box", () => {
    expect(rule("\\.providers-banner")).toContain("margin: 0 0 var(--sp-8)");
    expect(rule("\\.providers-banner")).not.toContain("background");
  });

  it("spans the guidance across the grid and keeps the failed seat to a card's seat", () => {
    // Empty and failed are visually distinct: one card across the whole grid with the action
    // on it, against a seat beside the dashed card under a banner.
    expect(rule("\\.providers-grid__guidance")).toContain("grid-column: 1 / -1");
    expect(rule("\\.providers-grid__seat")).not.toContain("grid-column");
    expect(rule("\\.providers-grid__seat")).toMatch(/min-height:\s*[\d.]+rem/);
  });

  it("dashes a switched-off card's frame as well as dimming it, so it is not a degraded one", () => {
    // *Not in play* is the dashed treatment across this sheet — the add card, the promised
    // tile — and a degraded card keeps the solid frame because it is in play and struggling.
    expect(rule("\\.providers-card--off")).toContain("border: 1px dashed var(--line-strong)");
    expect(rule("\\.providers-add-card")).toContain("1px dashed var(--line-strong)");
  });
});

describe("the cap and its warning (#232)", () => {
  it("keeps the input at the mockup's width, right-aligned, and lets the notes under it take a sentence", () => {
    expect(rule("\\.providers-card__cap \\.ou-input")).toMatch(/width:\s*[\d.]+rem/);
    expect(rule("\\.providers-card__cap \\.ou-input")).toContain("text-align: right");
    expect(rule("\\.providers-card__cap")).toContain("max-width: 18rem");
    expect(rule("\\.providers-card__cap")).toContain("align-items: flex-end");
  });

  it("draws P7's glyph faint, with a help cursor, beside the figure rather than inside it", () => {
    expect(rule("\\.providers-card__meter-warning")).toContain("color: var(--ink-faint)");
    expect(rule("\\.providers-card__meter-warning")).toContain("cursor: help");
    expect(rule("\\.providers-card__meter-trail")).toContain("display: inline-flex");
  });
});

describe("the security strip (#232)", () => {
  it("tints the shield from the accent's published triple, and never a mixed colour", () => {
    const shield = rule("\\.providers-security__shield");

    expect(shield).toContain("border: 1px solid var(--accent-line)");
    expect(shield).toContain("background: var(--accent-tint)");
    expect(shield).toContain("color: var(--accent)");
    expect(shield).toMatch(/width:\s*[\d.]+rem/);
  });

  it("gives the sentence the mockup's measure and its emphasis the full ink", () => {
    expect(rule("\\.providers-security__copy")).toContain("max-width: 78ch");
    expect(rule("\\.providers-security__copy")).toContain("color: var(--ink-dim)");
    expect(rule("\\.providers-security__copy strong")).toContain("color: var(--ink)");
  });

  it("wraps as one row, under the grid, with the grid's gap above it", () => {
    expect(rule("\\.providers-security")).toContain("flex-wrap: wrap");
    expect(rule("\\.providers-security")).toContain("margin-top: var(--sp-8)");
  });
});

describe("the skeleton (#232)", () => {
  /** Every bar the skeleton draws. */
  const BARS = [
    "slot",
    "action",
    "monogram",
    "bar",
    "pill",
    "switch",
    "input",
    "button",
    "meter",
    "plus",
  ];

  it("draws every bar on the raised plane, so it is legible on the card in both palettes", () => {
    for (const bar of BARS) {
      expect(rule(`\\.providers-skeleton__${bar}`), bar).toContain("background: var(--raised)");
    }
  });

  it("reserves each control's box in rem or in tokens, so the reservation holds at 125%", () => {
    // The monogram's square, the switch's track, an input's box and a small button's — the
    // sizes the card's own primitives take, none of them in px.
    expect(rule("\\.providers-skeleton__monogram")).toContain("width: 2.625rem");
    expect(rule("\\.providers-skeleton__switch")).toContain("width: 2.375rem");
    expect(rule("\\.providers-skeleton__input")).toMatch(/height:\s*[\d.]+rem/);
    expect(rule("\\.providers-skeleton__button")).toMatch(/height:\s*[\d.]+rem/);
    expect(rule("\\.providers-skeleton__meter")).toContain("height: var(--sp-3)");
    expect(rule("\\.providers-skeleton__pill")).toContain("height: var(--sp-8)");
    expect(rule("\\.providers-skeleton__input--cap")).toContain("width: 6.75rem");
  });

  it("pulses only for a reader who has not asked for less motion", () => {
    const motion = /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?providers-skeleton-pulse/.exec(CODE);

    expect(motion).not.toBeNull();
    expect(CODE).toMatch(/@keyframes providers-skeleton-pulse/);
    // No bar animates outside the media query.
    const outside = CODE.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}\n/g, "");
    expect(outside).not.toMatch(/providers-skeleton__[a-z-]+\s*\{[^}]*animation/);
  });
});

describe("every colour and every size", () => {
  it("is a token", () => {
    // `styles.test.ts` enforces this across the module; asserting it here as well is what
    // keeps the rule visible in the sheet's own suite.
    const declarations = [...CODE.matchAll(/(?:color|background|border[a-z-]*):([^;]*);/g)];

    expect(declarations.length).toBeGreaterThan(0);
    for (const [, value] of declarations) {
      expect(value).toMatch(/var\(--|transparent|none|0|1px solid var\(--/);
    }
  });

  it("names no length in px that the reader's preference should move", () => {
    // Hairlines stay in px, because a border that grows with the type is a different border.
    const pixels = [...CODE.matchAll(/(\d+)px/g)].map((match) => match[1]);

    expect(pixels.every((value) => value === "1")).toBe(true);
  });
});
