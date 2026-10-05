import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Audit card's sheet (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)): every
 * class the module renders has a rule, every rule is rendered, and nothing in it is a colour or a
 * type size of its own.
 */

const MODULE = join(import.meta.dirname, "..", "..", "app", "audit-log");
const SHEET = readFileSync(join(MODULE, "audit-log.css"), "utf8");
const FILES = readdirSync(MODULE).filter((name) => /\.tsx?$/.test(name));
const SOURCE = FILES.map((name) => readFileSync(join(MODULE, name), "utf8")).join("\n");

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const DECLARED = new Set([...CODE.matchAll(/\.(audit-log[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  [...SOURCE.matchAll(/"((?:audit-log[a-z0-9_-]*\s*)+)"/g)].flatMap((match) => match[1].trim().split(/\s+/)),
);

describe("the sheet and the module", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("declares a rule for every class the module renders", () => {
    expect(RENDERED.size).toBeGreaterThan(0);

    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and has no rule`).toContain(name);
    }
  });

  it("is imported by every component, so none draws unstyled", () => {
    for (const name of FILES.filter((file) => file.endsWith(".tsx"))) {
      expect(readFileSync(join(MODULE, name), "utf8"), name).toContain('import "./audit-log.css";');
    }
  });

  it("styles each actor kind differently", () => {
    const hues = ["human", "bot", "service", "system"].map(
      (kind) => new RegExp(`\\.audit-log__actor--${kind}\\s*\\{\\s*color:\\s*([^;]+);`).exec(CODE)?.[1],
    );

    expect(hues.every((hue) => hue !== undefined)).toBe(true);
    expect(new Set(hues).size).toBe(4);
  });
});

describe("every colour and every size", () => {
  it("is a token, and no length that carries type is in px", () => {
    for (const [, value] of CODE.matchAll(/(?:color|background|border[a-z-]*|outline):([^;]*);/g)) {
      expect(value).toMatch(/var\(--|transparent|none|0/);
    }

    expect(CODE).not.toMatch(/font-size:\s*\d+px/);
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b/i);

    for (const [, size] of CODE.matchAll(/font-size:([^;]*);/g)) {
      expect(size.trim()).toMatch(/^var\(--t-/);
    }
  });
});
