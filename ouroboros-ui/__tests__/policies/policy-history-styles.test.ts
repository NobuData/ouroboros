import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The version tag's and history dialog's sheet (BS.4,
 * [#494](https://github.com/NobuData/ouroboros/issues/494)): every class the component renders has
 * a rule, every rule is rendered, and nothing in it is a colour or a type size of its own.
 */

const POLICIES = join(import.meta.dirname, "..", "..", "app", "policies");
const SHEET = readFileSync(join(POLICIES, "policy-history.css"), "utf8");
const COMPONENT = readFileSync(join(POLICIES, "policy-history.tsx"), "utf8");

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const DECLARED = new Set([...CODE.matchAll(/\.(policy-history[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"(policy-history[a-z0-9_-]*)"/g)].map((match) => match[1]),
);

describe("the sheet and the component", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("declares a rule for every class the component renders", () => {
    expect(RENDERED.size).toBeGreaterThan(0);

    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and has no rule`).toContain(name);
    }
  });

  it("is imported by the component, so the dialog never draws unstyled", () => {
    expect(COMPONENT).toContain('import "./policy-history.css";');
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
