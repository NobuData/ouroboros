import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rule rows' sheet (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)):
 * `app/policies/policy-rules.css` and the two components that draw from it name exactly the same
 * classes, every colour is a token, and every length that carries type is rem — so the card
 * follows the palette and the font-size preference with no value of its own.
 */

const POLICIES = join(import.meta.dirname, "..", "..", "app", "policies");
const SHEET = readFileSync(join(POLICIES, "policy-rules.css"), "utf8");
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");
const COMPONENTS = ["rule-row.tsx", "rule-editors.tsx"]
  .map((name) => readFileSync(join(POLICIES, name), "utf8"))
  .join("\n");

/** Every class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(policy-rule[a-z0-9_-]*)/g)].map((match) => match[1]));

/** Every `policy-rule…` class a component writes as a string. */
const RENDERED = new Set(
  [...COMPONENTS.matchAll(/"(policy-rule[a-z0-9_-]*)"/g)].map((match) => match[1]),
);

describe("the sheet and the components", () => {
  it("declares a rule for every class the components render", () => {
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

  it("is imported by both components", () => {
    expect(COMPONENTS.match(/import "\.\/policy-rules\.css";/g)).toHaveLength(2);
  });

  it("uses no other prefix: the shared sheets' classes stay the shared sheets'", () => {
    const foreign = [...CODE.matchAll(/\.([a-z][a-z0-9_-]*)/g)]
      .map((match) => match[1])
      .filter((name) => !name.startsWith("policy-rule"));

    expect(foreign).toEqual([]);
  });
});

describe("every colour and every size", () => {
  it("is a token", () => {
    for (const [, value] of CODE.matchAll(/(?:color|background|border[a-z-]*|box-shadow):([^;]*);/g)) {
      expect(value).toMatch(/var\(--|transparent|none/);
    }
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  });

  it("carries type in rem-based tokens, never an absolute unit", () => {
    for (const [, value] of CODE.matchAll(/(?:font-size|line-height):([^;]*);/g)) {
      expect(value).toMatch(/var\(--(?:t|lh)-/);
    }
    expect(CODE).not.toMatch(/font(?:-size)?:\s*[^;]*\d(?:px|pt)/);
  });

  it("spaces with tokens and sizes boxes in rem", () => {
    for (const [, value] of CODE.matchAll(/(?:padding|margin|gap)[a-z-]*:([^;]*);/g)) {
      expect(value).toMatch(/^(?:\s*(?:var\(--sp-\d+\)|0))+\s*$/);
    }
    for (const [, value] of CODE.matchAll(/[\s;{](?:max-width|width):([^;]*);/g)) {
      expect(value).toMatch(/rem|ch/);
    }
  });
});

describe("the row", () => {
  it("is mockup 17's .policy-row: switch beside the text, a hairline under every row but the last", () => {
    expect(CODE).toMatch(/\.policy-rule\s*\{[^}]*display:\s*flex[^}]*align-items:\s*flex-start/);
    expect(CODE).toMatch(/\.policy-rule\s*\{[^}]*border-bottom:\s*1px solid var\(--line\)/);
    expect(CODE).toMatch(/\.policy-rule:last-of-type\s*\{[^}]*border-bottom:\s*none/);
    expect(CODE).toMatch(/\.policy-rule__terms\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
