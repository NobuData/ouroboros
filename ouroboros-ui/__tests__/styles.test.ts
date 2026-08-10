import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
