import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/registry/registry.css` that are agreements with something outside it
 * (#591, the allowed-models table's rules since #592, and the two flows behind the head's
 * actions since #594).
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
const REGISTRY = join(UI, "app", "registry");
const SHEET = readFileSync(join(REGISTRY, "registry.css"), "utf8");
const SECTION = readFileSync(join(UI, "app", "models", "models.css"), "utf8");
const SHELL = readFileSync(join(UI, "app", "shell", "shell.css"), "utf8");
const PRIMITIVES = readFileSync(join(UI, "app", "ui", "ui.css"), "utf8");

/**
 * Every component in the directory, as one source — the sheet dresses the menu, the screen,
 * the table and the switch, and a class any of them renders is a class the sheet owes a rule.
 */
const COMPONENT = readdirSync(REGISTRY)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(REGISTRY, name), "utf8"))
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

/** Every class this sheet declares a rule for. */
const DECLARED = [...CODE.matchAll(/\.(registry[a-z0-9_-]*)/g)].map((match) => match[1]);

describe("the sheet and the components", () => {
  it("declares a rule for every class it names, and something renders every one", () => {
    // The same agreement `ui-styles.test.ts` and `providers-styles.test.ts` hold: a class
    // nobody renders is a class nobody keeps correct, and a class rendered with no rule is a
    // treatment somebody thought they had shipped.
    expect(DECLARED.length).toBeGreaterThan(0);

    for (const name of new Set(DECLARED)) {
      expect(COMPONENT, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("renders no registry class the sheet has no rule for", () => {
    // Class-shaped strings only: a block, element or modifier under the page's prefix. The
    // surface name the tab set takes (`active="registry"`) and the `*_ID` constants the cards'
    // `aria-labelledby` point at are this page's too, and are not classes.
    const source = COMPONENT.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*const \w+_ID = .*$/gm, " ");
    const rendered = new Set(
      [...source.matchAll(/"(registry(?:-|__)[a-z0-9_-]*)"/g)].map((match) => match[1]),
    );

    expect(rendered.size).toBeGreaterThan(0);

    for (const name of rendered) {
      expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
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

  it("draws no drop shadow, because the token sheet publishes none", () => {
    // A shadow drawn from an opaque surface token is a block rather than a shadow. The
    // hairline and the raised surface separate the panel from the pane on their own — the same
    // choice `.shell-menu__panel` makes. The one `box-shadow` the sheet writes is the health
    // dot's inset ring (#592), which is a shape rather than a shadow — the same technique
    // `.ou-chip__dot--ring` uses.
    expect(rule("\\.registry-import__panel")).not.toContain("box-shadow");

    const shadows = [...CODE.matchAll(/box-shadow:\s*([^;]+);/g)].map((match) => match[1]?.trim());

    expect(shadows.length).toBeGreaterThan(0);
    for (const shadow of shadows) expect(shadow).toMatch(/^inset /);
  });

  it("sizes the panel in rem, so the reader's font-size preference moves it", () => {
    expect(rule("\\.registry-import__panel")).toMatch(/min-width:\s*[\d.]+rem/);
  });

  it("keeps no inert treatment for a row, because since #594 every row acts", () => {
    // A rule for a state nothing renders is a rule nobody keeps correct — and health is not a
    // filter on this menu, so there is no second inert case waiting for one either.
    expect(CODE).not.toContain("aria-disabled");
    expect(CODE).not.toContain(".registry-import__item:disabled");
  });

  it("gives a focused row the treatment a hovered one gets", () => {
    // The menu's roving focus is how a keyboard reader moves through these rows, and a row they
    // have landed on should look like the row a pointer is over.
    expect(CODE).toContain(".registry-import__item:focus-visible");
    expect(rule("\\.registry-import__item:hover,\\s*\\.registry-import__item:focus-visible")).toContain(
      "var(--accent-wash)",
    );
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

describe("the allowed-models table (#592)", () => {
  it("restyles nothing of the #46 table — the accent selection is the primitive's own tone", () => {
    // A page reaching into `.ou-table` from its own sheet is the fork of the design system the
    // primitive exists to prevent; mockup 21's accent `.selected` is declared on the table
    // (`SelectionTone`) and drawn by `app/ui/ui.css`.
    expect(CODE).not.toContain(".ou-table");
    expect(PRIMITIVES).toContain(".ou-table--accent .ou-table__row--selected td");
  });

  it("dims the unbound row cell by cell, and exempts its health cell by the column's class", () => {
    // The mockup's `tr.dim td { opacity: .55 }` and `td.no-dim { opacity: 1 }`. The exemption
    // is by the health column's own class, which the primitive puts on every cell of the
    // column, so the rule cannot drift from the markup.
    expect(rule("\\.registry-table__row--dim td")).toMatch(/opacity:\s*0\.55/);
    expect(rule("\\.registry-table__row--dim td\\.registry-table__health")).toMatch(/opacity:\s*1/);
  });

  it("gives every health tone a rule of its own, so none falls back to another's hue", () => {
    for (const tone of ["ok", "warn", "err"]) {
      expect(rule(`\\.registry-table__health-cell--${tone}`), tone).toContain(`var(--${tone})`);
    }
  });

  it("draws the dot from currentColor and the ring as a second shape, not a second hue", () => {
    expect(rule("\\.registry-table__dot")).toMatch(/background:\s*currentColor/);
    expect(rule("\\.registry-table__dot--ring")).toMatch(/background:\s*transparent/);
    expect(rule("\\.registry-table__dot--ring")).toContain("currentColor");
  });

  it("mutes the healthy word so a healthy cell hues only its dot", () => {
    expect(rule("\\.registry-table__health-cell--ok \\.registry-table__state")).toContain("var(--ink-mut)");
  });

  it("draws the faint treatment for *no provider* and the em-dash from the faint ink token", () => {
    expect(rule("\\.registry-table__none")).toContain("var(--ink-faint)");
  });

  it("lets the switch's note wrap inside a column whose head does not", () => {
    expect(rule("\\.registry-table__switch")).toMatch(/width:\s*[\d.]+rem/);
    expect(rule("\\.registry-switch__note")).toMatch(/white-space:\s*normal/);
    expect(rule("\\.registry-switch__note--err")).toContain("var(--err)");
  });

  it("sizes every column width in rem, so the font-size preference moves them", () => {
    for (const column of ["params", "num", "switch"]) {
      expect(rule(`\\.registry-table__${column}`), column).toMatch(/(?:min-)?width:\s*[\d.]+rem/);
    }
  });

  it("lays the seat row out at the section's break, in rem", () => {
    expect(rule("\\.registry-aside")).toMatch(/grid-template-columns:\s*repeat\(3,/);
    expect(CODE).toMatch(/@media \(max-width:\s*[\d.]+rem\)\s*\{\s*\.registry-aside/);
    expect(SECTION).toContain("@media (max-width: 68.75rem)");
    expect(CODE).toContain("@media (max-width: 68.75rem)");
  });

  it("resets the confirmation's list, since the referrers are chips rather than bullets", () => {
    const list = rule("\\.registry-confirm__referrers");

    expect(list).toMatch(/list-style:\s*none/);
    expect(list).toMatch(/padding:\s*0/);
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

describe("the create dialog, the parameter form and the import wizard (#594)", () => {
  it("restyles none of the #46 primitives it is built from", () => {
    // Three dialogs' worth of controls, all of them the design system's. A page writing rules
    // for `.ou-field`, `.ou-input` or `.ou-btn` is the fork those primitives exist to prevent —
    // and the table's own rule (above) has held since #592.
    for (const primitive of [".ou-field", ".ou-input", ".ou-btn", ".ou-table"]) {
      expect(CODE, primitive).not.toContain(primitive);
    }
  });

  it("adds no dialog frame of its own, because the shell's overlay owns one", () => {
    // The backdrop, the panel, the title and the note are `app/shell/shell.css`'s; a second
    // frame here would be a second dialog a reader has to learn.
    for (const owned of [".shell-overlay", ".shell-overlay__panel", ".shell-overlay__title"]) {
      expect(SHELL, owned).toContain(owned);
      expect(CODE, owned).not.toContain(owned);
    }
  });

  it("puts the mode radio's label beside it rather than under it, in a grid", () => {
    // The hint under each choice is what makes the two labels line up with each other; a hint
    // on the same line would push them apart.
    expect(rule("\\.registry-create__mode")).toMatch(/display:\s*grid/);
    expect(rule("\\.registry-create__radio")).toContain("var(--accent)");
  });

  it("draws the bind-later notice on the accent wash, as the one thing that describes an outcome", () => {
    expect(rule("\\.registry-create__unbound")).toContain("var(--accent-wash)");
    expect(rule("\\.registry-create__unbound-link")).toContain("var(--accent)");
  });

  it("draws every refusal in the error hue, in all three surfaces", () => {
    for (const failure of [
      "\\.registry-create__failure",
      "\\.registry-params__switch-error",
      "\\.registry-wizard__failure",
    ]) {
      expect(rule(failure), failure).toContain("var(--err)");
    }
  });

  it("names no parameter, because the form is drawn from a schema it did not write", () => {
    // The whole claim of `GET /registry/param-schema` is that a new adapter arrives with a
    // working form and no UI written for it. A rule for `thinking` would be that claim broken
    // in the one place nobody looks.
    for (const parameter of ["thinking", "token_budget", "temperature", "context_clamp"]) {
      expect(CODE, parameter).not.toContain(parameter);
    }
  });

  it("gives every wizard step a treatment of its own, so none falls back to another's", () => {
    for (const state of ["done", "current", "todo"]) {
      expect(rule(`\\.registry-wizard__step--${state}`), state).toMatch(/var\(--/);
    }
  });

  it("puts the current step in the accent, which is what answers *where am I*", () => {
    expect(rule("\\.registry-wizard__step--current")).toContain("var(--accent)");
  });

  it("recedes an already-named candidate the way the table recedes its unbound row", () => {
    // Two surfaces, one product: the same opacity, cell by cell.
    expect(rule("\\.registry-wizard__row--aliased td")).toMatch(/opacity:\s*0\.55/);
    expect(rule("\\.registry-table__row--dim td")).toMatch(/opacity:\s*0\.55/);
  });

  it("sizes every candidate column in rem, so the font-size preference moves them", () => {
    for (const column of ["tick", "model", "name", "price", "caps"]) {
      expect(rule(`\\.registry-wizard__${column}`), column).toMatch(/(?:min-)?width:\s*[\d.]+rem/);
    }
  });

  it("lets a row's error wrap inside a cell whose column would hold it on one line", () => {
    expect(rule("\\.registry-wizard__name-field")).toMatch(/white-space:\s*normal/);
  });
});
