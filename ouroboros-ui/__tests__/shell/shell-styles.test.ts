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
 * Every class a component asks for, read from its `className` literals.
 *
 * Literals only, which is what these components write: a class composed at runtime would not
 * be findable this way, and `app/ui/class-names.ts` exists for the surfaces that need one.
 *
 * @param file Path of the component, relative to `app/`.
 * @returns The class names, deduplicated.
 */
function classesOf(file: string): string[] {
  const source = readFileSync(join(UI, "app", file), "utf8");
  const named = [...source.matchAll(/className="([^"{}]+)"/g)].flatMap((match) =>
    match[1].split(/\s+/).filter((name) => name.length > 0),
  );

  return [...new Set(named)].filter((name) => !GLOBAL.has(name));
}

describe("the shell's components and its stylesheet", () => {
  it.each([
    "shell/user-menu.tsx",
    "shell/shell-header.tsx",
    "shell/sidebar-nav.tsx",
    "shell/app-shell.tsx",
    "shell/theme-toggle.tsx",
  ])("%s asks for no class the sheet does not define", (file) => {
    expect(classesOf(file).filter((name) => !DEFINED.has(name))).toEqual([]);
  });

  it("has something to check, which an empty read would not", () => {
    // Without this the rule above would pass just as well against a component whose classes
    // stopped being readable, and say nothing at all.
    expect(classesOf("shell/user-menu.tsx")).toContain("shell-menu__submenu");
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
