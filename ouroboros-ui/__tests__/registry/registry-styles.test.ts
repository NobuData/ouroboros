import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/registry/registry.css` that are agreements with something outside it
 * (#591).
 *
 * The generic rules — no colour literal anywhere but the token sheet, no absolute type size —
 * are `__tests__/styles.test.ts`'s, and they cover this sheet as they cover every other. What
 * is here is narrower: the facts this sheet has to keep in step with the components that use
 * it, with the section's own sheet, and with the shell's stacking contract, none of which is
 * visible from inside the file.
 *
 * **This is also where "verified in both themes" is actually verified.** jsdom applies no
 * stylesheet, so the render suites can prove the two palettes produce identical markup and
 * nothing more (`__tests__/helpers/palettes.tsx` sets this out). What proves the palettes
 * themselves are legible is that every hue here is a published token, and both palettes
 * publish contrast for each of them against the surface it is drawn on.
 */

const UI = join(import.meta.dirname, "..", "..");
const SHEET = readFileSync(join(UI, "app", "registry", "registry.css"), "utf8");
const MENU = readFileSync(join(UI, "app", "registry", "import-menu.tsx"), "utf8");
const SCREEN = readFileSync(join(UI, "app", "registry", "registry-screen.tsx"), "utf8");
const SECTION = readFileSync(join(UI, "app", "models", "models.css"), "utf8");

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

/** Every class this sheet declares a rule for. */
const DECLARED = [...CODE.matchAll(/\.(registry[a-z0-9_-]*)/g)].map((match) => match[1]);

describe("the sheet and the components", () => {
  it("declares a rule for every class it names, and something renders every one", () => {
    // The same agreement `ui-styles.test.ts` and `providers-styles.test.ts` hold: a class
    // nobody renders is a class nobody keeps correct, and a class rendered with no rule is a
    // treatment somebody thought they had shipped.
    expect(DECLARED.length).toBeGreaterThan(0);

    for (const name of new Set(DECLARED)) {
      expect(MENU + SCREEN, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("adds nothing the Models section already owns", () => {
    // The gutter rhythm, the page head and the tab set's placement are `app/models/models.css`'s
    // and are shared by all three pages of the section through `models-frame.tsx`. A second
    // copy here would be the anatomy drifting on one page.
    for (const owned of [".models__head", ".models__title", ".models__sub", ".models__subnav"]) {
      expect(SECTION, owned).toContain(owned);
      expect(CODE, owned).not.toContain(owned);
    }
  });

  it("re-declares no page frame of its own", () => {
    // This page is a Models page: it has the section's `<main>` and nothing else. A `.registry`
    // block rule here would be a second frame for one section.
    expect(CODE).not.toMatch(/\.registry\s*\{/);
  });
});

describe("the import dropdown", () => {
  it("anchors the panel to the trigger rather than to the page", () => {
    // Without the wrapper's positioning context the panel would be placed against the pane and
    // land somewhere the button is not.
    expect(rule("\\.registry-import")).toMatch(/position:\s*relative/);
    expect(rule("\\.registry-import__panel")).toMatch(/position:\s*absolute/);
  });

  it("hugs the trigger rather than taking the whole action column", () => {
    expect(rule("\\.registry-import")).toMatch(/display:\s*inline-flex/);
  });

  it("opens from the trigger's start edge, which is where this control sits", () => {
    // A menu that opened rightwards from a left-aligned action would hang off the pane at the
    // narrow end.
    expect(rule("\\.registry-import__panel")).toMatch(/left:\s*0/);
    expect(rule("\\.registry-import__panel")).not.toMatch(/right:\s*0/);
  });

  it("stacks above the page and below the shell's own chrome", () => {
    // The shell owns the values in `app/ui/chrome.ts`; a page menu that covered the sticky
    // subnav would be a page menu covering navigation.
    const stacking = /z-index:\s*(\d+)/.exec(rule("\\.registry-import__panel"));

    expect(stacking).not.toBeNull();
    expect(Number(stacking?.[1])).toBeGreaterThan(0);
    expect(Number(stacking?.[1])).toBeLessThan(50);
  });

  it("draws no shadow, because the token sheet publishes none", () => {
    // A shadow drawn from an opaque surface token is a block rather than a shadow. The
    // hairline and the raised surface separate the panel from the pane on their own — the same
    // choice `.shell-menu__panel` makes.
    expect(CODE).not.toContain("box-shadow");
  });

  it("sizes the panel in rem, so the reader's font-size preference moves it", () => {
    expect(rule("\\.registry-import__panel")).toMatch(/min-width:\s*[\d.]+rem/);
  });

  it("marks an inert row through aria-disabled rather than through :disabled", () => {
    // The house rule (`app/ui/button.tsx`): a `disabled` row leaves the tab order and takes its
    // own tooltip with it. The selector is what proves the sheet expects the reachable form.
    expect(CODE).toContain('.registry-import__item[aria-disabled="true"]');
    expect(CODE).not.toContain(".registry-import__item:disabled");
  });

  it("does not offer a hover treatment to a row that cannot act", () => {
    // A row that lit up under the pointer and then did nothing would be the one dishonest
    // thing on a control built to be honest.
    expect(CODE).toContain(':hover:not([aria-disabled="true"])');
  });

  it("resets the browser's own button styling, since the row is a menu item", () => {
    const item = rule("\\.registry-import__item");

    expect(item).toMatch(/border:\s*0/);
    expect(item).toMatch(/background:\s*transparent/);
    expect(item).toMatch(/font:\s*inherit/);
    expect(item).toMatch(/text-align:\s*left/);
  });
});

describe("the hint under the actions", () => {
  it("takes its own line rather than sitting beside the buttons it explains", () => {
    // It is a flex item of `.models__actions`, and the full basis is what wraps it under them.
    expect(rule("\\.registry__hint")).toMatch(/flex-basis:\s*100%/);
  });

  it("zeroes the block margin a browser gives its paragraph", () => {
    expect(rule("\\.registry__hint")).toMatch(/margin:\s*0/);
  });

  it("draws the link in the accent, because it is the one thing here that acts", () => {
    expect(rule("\\.registry__hint-link")).toContain("var(--accent)");
  });
});

describe("what the sheet may write down", () => {
  it("takes every colour from a token", () => {
    // Restated here as well as in `styles.test.ts` because this is the sheet's own suite and a
    // reader of it should see the rule that most constrains it.
    const colours = [...CODE.matchAll(/(?:color|background|border-color):\s*([^;]+);/g)];

    expect(colours.length).toBeGreaterThan(0);

    for (const [, value] of colours) {
      expect(value.trim(), value).toMatch(/var\(--|transparent|currentColor|inherit/);
    }
  });
});
