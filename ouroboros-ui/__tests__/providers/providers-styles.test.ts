import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/providers/providers.css` that are agreements with something outside
 * it (#225).
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
const SHEET = readFileSync(join(UI, "app", "providers", "providers.css"), "utf8");
const COMPONENT = readFileSync(join(UI, "app", "providers", "audit-trail.tsx"), "utf8");

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
const DECLARED = [...CODE.matchAll(/\.(providers-audit[a-z0-9_-]*)/g)].map(
  (match) => match[1],
);

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
