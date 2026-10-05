import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The webhook surfaces' sheet (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)):
 * every class a component renders has a rule, every rule is rendered, and nothing in it is a
 * colour or a type size of its own.
 */

const WEBHOOKS = join(import.meta.dirname, "..", "..", "app", "webhooks");
const SHEET = readFileSync(join(WEBHOOKS, "webhooks.css"), "utf8");
const COMPONENT_FILES = readdirSync(WEBHOOKS).filter((name) => name.endsWith(".tsx"));
const COMPONENTS = COMPONENT_FILES.map((name) => readFileSync(join(WEBHOOKS, name), "utf8"));

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const DECLARED = new Set([...CODE.matchAll(/\.(webhooks-[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  COMPONENTS.flatMap((source) => [...source.matchAll(/"(webhooks-[a-z0-9_-]*)"/g)].map((match) => match[1])),
);

describe("the sheet and the components", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("declares a rule for every class a component renders", () => {
    expect(RENDERED.size).toBeGreaterThan(0);

    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and has no rule`).toContain(name);
    }
  });

  it("is imported by every component, so none ever draws unstyled", () => {
    expect(COMPONENT_FILES.length).toBeGreaterThan(0);

    COMPONENTS.forEach((source, index) => {
      expect(source, COMPONENT_FILES[index]).toContain('import "./webhooks.css";');
    });
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
