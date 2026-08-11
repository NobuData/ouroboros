import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { THEME_FADE_ATTRIBUTE, THEME_FADE_MS } from "@/app/theme";

/**
 * The rule this module is held to: `app/tokens.css` is the only file in it that may
 * write a colour down. Everything else reads `var(--token)`, which is what makes a theme
 * change a redefinition rather than a restyle — and what lets #17 switch the palette by
 * stamping one attribute.
 *
 * `scripts/verify-tokens.sh` holds `app/tokens.css` byte-identical to its source,
 * `docs/design/tokens.css`. That check belongs at the repository level because it spans
 * two directories; this one belongs here, because it is the one that has to run on every
 * pull request that touches the UI.
 */

const APP_DIR = join(import.meta.dirname, "..", "app");
const SHEET = "tokens.css";

/**
 * Any colour CSS can spell: `#` and 3, 4, 6 or 8 hex digits followed by something that
 * is not part of the word, or any of the colour functions. The lengths are CSS's own,
 * which is what keeps a `#faced` fragment identifier out of the results. Mirrors
 * `COLOUR_LITERAL` in scripts/verify-tokens.sh.
 */
const COLOUR_LITERAL =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

/**
 * Every stylesheet under `app/`, recursively, as paths relative to `app/`.
 *
 * @param dir Directory to walk. Defaults to `app/`.
 * @param prefix Path already walked, used to build the relative name.
 * @returns Relative paths of every `.css` file found, in directory order.
 */
function stylesheets(dir: string = APP_DIR, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return stylesheets(join(dir, entry.name), relative);
    return entry.name.endsWith(".css") ? [relative] : [];
  });
}

describe("the module's stylesheets", () => {
  const sheets = stylesheets();

  it("include the token sheet and at least one sheet built on it", () => {
    // Without this the colour-literal check below would pass on an empty app/ and say
    // nothing at all.
    expect(sheets).toContain(SHEET);
    expect(sheets).toContain("globals.css");
  });

  it.each(sheets.filter((name) => name !== SHEET))(
    "%s carries no colour literal",
    (name) => {
      const source = readFileSync(join(APP_DIR, name), "utf8");
      const found = source.match(COLOUR_LITERAL);

      expect(found?.[0] ?? null).toBeNull();
    },
  );

  it("keep every colour in the token sheet, so the check above has something to guard", () => {
    const sheet = readFileSync(join(APP_DIR, SHEET), "utf8");

    expect(sheet).toMatch(COLOUR_LITERAL);
  });
});

describe("the token sheet", () => {
  const sheet = readFileSync(join(APP_DIR, SHEET), "utf8");

  it("declares color-scheme in all three palette blocks", () => {
    // This is what makes native scrollbars, form controls and the browser's own canvas
    // follow the theme, and it is why the engine (#17) sets no `color-scheme` of its own:
    // stamping `data-theme` selects a block, and the block carries the property. Three
    // occurrences — light on :root, dark for the explicit choice, dark for the unset case.
    expect(sheet.match(/^\s*color-scheme:/gm)).toHaveLength(3);
  });

  it("selects the dark palette both explicitly and from the OS", () => {
    expect(sheet).toContain('[data-theme="dark"]');
    expect(sheet).toContain('(prefers-color-scheme: dark)');
    // The selector that lets an explicit light choice beat a dark OS.
    expect(sheet).toContain(':not([data-theme="light"])');
  });
});

describe("globals.css", () => {
  const source = readFileSync(join(APP_DIR, "globals.css"), "utf8");

  it("imports the token sheet", () => {
    expect(source).toMatch(/@import\s+["']\.\/tokens\.css["'];/);
  });

  it("imports it before any rule of its own, which CSS requires of @import", () => {
    // Comments are collapsed first so both offsets are measured in the same string, and
    // so a `{` inside the file's opening comment is not mistaken for a rule.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    const importAt = code.indexOf("@import");
    const firstRuleAt = code.search(/\S\s*\{/);

    expect(importAt).toBeGreaterThanOrEqual(0);
    expect(firstRuleAt).toBeGreaterThanOrEqual(0);
    expect(importAt).toBeLessThan(firstRuleAt);
  });

  it("maps each self-hosted face onto the sheet's family token", () => {
    for (const [token, face] of [
      ["--f-disp", "--font-display"],
      ["--f-ui", "--font-ui"],
      ["--f-mono", "--font-mono"],
    ]) {
      expect(source).toContain(`${token}: var(${face},`);
    }
  });
});

/**
 * The CSS half of the theme cross-fade. The other half is `app/theme.ts`, which arms it;
 * these are the four properties that make the pair a design rather than two features that
 * happen to agree.
 */
describe("the theme cross-fade", () => {
  const source = readFileSync(join(APP_DIR, "globals.css"), "utf8");
  /** The sheet without its prose, so a rule cannot be found inside a comment. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ");

  /** Every rule that sets a transition, as `[selector, declarations]`. */
  const transitions = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((rule) => rule[2].includes("transition"))
    .map((rule) => [rule[1], rule[2]] as const);

  it("lasts exactly as long as the window the engine holds open for it", () => {
    // Two numbers, one duration: CSS runs the fade and only JavaScript can take the
    // attribute off afterwards. Drift shortens the fade or leaves the page transitioning
    // after it, and neither is visible in a unit test of either half alone.
    expect(source).toContain(`--theme-fade: ${THEME_FADE_MS}ms`);
    expect(transitions.flatMap((rule) => rule[1].match(/var\(--theme-fade\)/g) ?? [])).not
      .toHaveLength(0);
  });

  it("applies only while a swap is armed", () => {
    // A standing transition on every colour would also slow the ones colour is used to
    // report — a status turning red, a stage going live — which have to land at once.
    expect(transitions).not.toHaveLength(0);

    for (const [selector] of transitions) {
      for (const one of selector.split(",")) {
        expect(one).toContain(`[${THEME_FADE_ATTRIBUTE}]`);
      }
    }
  });

  it("reaches descendants only, never the root element itself", () => {
    // The root's own `color` is the system CanvasText, which `color-scheme` flips with the
    // palette — and Chrome restarts an inherited property's transition on every descendant
    // for as long as an ancestor is transitioning it. Include :root here and every piece of
    // text in the product finishes about twice as late as the surface behind it.
    for (const [selector] of transitions) {
      for (const one of selector.split(",")) {
        expect(one.trim()).toMatch(
          new RegExp(`\\[${THEME_FADE_ATTRIBUTE}\\]\\s+\\S`),
        );
      }
    }
  });

  it("names the properties it moves rather than transitioning all of them", () => {
    // `all` would sweep up layout and transform, so anything that happened to move during
    // the swap would slide instead of moving.
    for (const [, declarations] of transitions) {
      expect(declarations).not.toMatch(/transition:\s*all\b/);
    }
  });

  it("is off for a reader who has asked for less motion", () => {
    // The engine arms the attribute either way and asks the OS nothing, so this query is
    // the only place the preference is honoured — and honouring it means exactly the
    // instant swap that was there before the fade existed.
    const guard = code.indexOf("@media (prefers-reduced-motion: no-preference)");

    expect(guard).toBeGreaterThanOrEqual(0);
    for (const [selector] of transitions) {
      expect(code.indexOf(selector)).toBeGreaterThan(guard);
    }
  });
});
