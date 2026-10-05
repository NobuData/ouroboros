import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The glob editor's sheet (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)): every
 * class it declares is one the component renders and the reverse, every colour is a token, and
 * no type is sized in px — so the editor follows both palettes and the font-size preference
 * wherever it is mounted.
 */

const GLOBS = join(import.meta.dirname, "..", "..", "app", "globs");
const SHEET = readFileSync(join(GLOBS, "globs.css"), "utf8");
const COMPONENT = readFileSync(join(GLOBS, "glob-editor.tsx"), "utf8");

/** The sheet without its prose, so a class cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every class the sheet declares a rule for. */
const DECLARED = new Set([...CODE.matchAll(/\.(glob-editor[a-z0-9_-]*)/g)].map((match) => match[1]));

/** Every class the component names in a string. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"([^"]*glob-editor[^"]*)"/g)].flatMap((match) =>
    match[1].split(/\s+/).filter((name) => name.startsWith("glob-editor")),
  ),
);

describe("the sheet and the component", () => {
  it("declares a rule for every class the component renders", () => {
    expect(RENDERED.size).toBeGreaterThan(0);

    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and has no rule`).toContain(name);
    }
  });

  it("renders every class the sheet declares", () => {
    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("stays out of the primitives' namespace", () => {
    expect(CODE).not.toMatch(/\.ou-/);
  });
});

describe("every colour and every size", () => {
  it("is a token, and no length is in px beyond a hairline", () => {
    for (const [, value] of CODE.matchAll(/(?:color|background|border[a-z-]*):([^;]*);/g)) {
      expect(value).toMatch(/var\(--|transparent|none|0/);
    }

    expect(CODE).not.toMatch(/font-size:\s*\d+px/);
    expect(CODE.replace(/\b1px solid/g, "")).not.toMatch(/\d+px/);
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
});
