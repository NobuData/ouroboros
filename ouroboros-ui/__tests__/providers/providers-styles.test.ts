import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/providers/providers.css` that are agreements with something outside
 * it (#225, the add-provider flow's rules since #231, and the cards' since #228).
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

  it("adds nothing the dialog already owns", () => {
    // The panel, the scrim, the scroll lock and the focus ring are `.shell-overlay`'s — the
    // one implementation of § 1.3's dialog contract. A second set here would be a fork of it.
    expect(CODE).not.toContain("position: fixed");
    expect(CODE).not.toContain("z-index");
    expect(CODE).not.toContain("--scrim");
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
