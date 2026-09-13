import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The settings frame's sheet ([#141](https://github.com/NobuData/ouroboros/issues/141)):
 * the same frame rules the Models section draws, so two admin pages start their content on
 * the same line.
 */

const UI = join(import.meta.dirname, "..", "..");
const SETTINGS = join(UI, "app", "settings");
const SHEET = readFileSync(join(SETTINGS, "settings.css"), "utf8");
const MODELS = readFileSync(join(UI, "app", "models", "models.css"), "utf8");

const COMPONENT = readdirSync(SETTINGS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(SETTINGS, name), "utf8"))
  .join("\n");

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

function rule(sheet: string, selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(sheet.replace(/\/\*[\s\S]*?\*\//g, " "))?.[1] ?? "";
}

const DECLARED = [...CODE.matchAll(/\.(settings[a-z0-9_-]*)/g)].map((match) => match[1]);

describe("the sheet and the components", () => {
  it("declares a rule for every class the sheet names, and renders every one", () => {
    expect(DECLARED.length).toBeGreaterThan(0);

    for (const name of new Set(DECLARED)) {
      expect(COMPONENT, `${name} is declared and never rendered`).toContain(name);
    }
  });
});

describe("the frame", () => {
  it.each(["", "__head", "__headings", "__title", "__sub", "__actions", "__subnav"])(
    "draws .settings%s with the Models frame's own measurements",
    (suffix) => {
      expect(rule(SHEET, `\\.settings${suffix}`)).toBe(rule(MODELS, `\\.models${suffix}`));
    },
  );
});

describe("every colour and every size", () => {
  it("is a token, and no type size is in px", () => {
    for (const [, value] of CODE.matchAll(/(?:color|background|border[a-z-]*):([^;]*);/g)) {
      expect(value).toMatch(/var\(--|transparent|none|0/);
    }
    expect(CODE).not.toMatch(/font-size:\s*\d+px/);
  });
});
