import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Danger zone's sheet (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)): every
 * class the components render has a rule, every rule is rendered, and nothing in it is a colour
 * or a type size of its own.
 */

const LIFECYCLE = join(import.meta.dirname, "..", "..", "app", "lifecycle");
const SHEET = readFileSync(join(LIFECYCLE, "danger.css"), "utf8");
const FILES = readdirSync(LIFECYCLE).filter((name) => name.endsWith(".tsx"));
const COMPONENTS = FILES.map((name) => readFileSync(join(LIFECYCLE, name), "utf8")).join("\n");

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const DECLARED = new Set([...CODE.matchAll(/\.(danger-zone[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  [...COMPONENTS.matchAll(/"(danger-zone[a-z0-9_-]*)(?: danger-zone[a-z0-9_-]*)*"/g)].flatMap(
    (match) => match[0].slice(1, -1).split(" "),
  ),
);

describe("the sheet and the components", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("declares a rule for every class the components render", () => {
    expect(RENDERED.size).toBeGreaterThan(0);

    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and has no rule`).toContain(name);
    }
  });

  it("is imported by every component that renders one of its classes", () => {
    for (const name of FILES) {
      const source = readFileSync(join(LIFECYCLE, name), "utf8");
      if (!/"danger-zone/.test(source)) continue;

      expect(source, name).toContain('import "./danger.css";');
    }
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

  it("dims nothing by opacity, so the error-rimmed rows keep their contrast", () => {
    expect(CODE).not.toMatch(/opacity/);
  });
});
