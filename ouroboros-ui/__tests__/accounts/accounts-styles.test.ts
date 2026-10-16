import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Account approval's sheet: every class the two screens render has a rule, every rule is
 * rendered, both screens import it, and nothing in it is a colour or a type size of its own.
 */

const ACCOUNTS = join(import.meta.dirname, "..", "..", "app", "accounts");
const SHEET = readFileSync(join(ACCOUNTS, "accounts.css"), "utf8");
const COMPONENTS = ["pending-screen.tsx", "admin-screen.tsx"].map((file) =>
  readFileSync(join(ACCOUNTS, file), "utf8"),
);

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const DECLARED = new Set([...CODE.matchAll(/\.(accounts-[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  COMPONENTS.flatMap((source) =>
    [...source.matchAll(/"([^"]*)"/g)].flatMap((match) =>
      match[1].split(/\s+/).filter((token) => /^accounts-[a-z0-9_-]+$/.test(token)),
    ),
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

  it("is imported by both screens, so neither draws unstyled", () => {
    for (const source of COMPONENTS) expect(source).toContain('import "./accounts.css";');
  });

  it("has no inline style in either screen — classes only", () => {
    for (const source of COMPONENTS) expect(source).not.toMatch(/style=\{/);
  });
});

describe("every colour and every size", () => {
  it("is a token: no hex, rgb or hsl colour of its own", () => {
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CODE).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });

  it("sets every type size, space and radius from a token", () => {
    for (const [, property, value] of CODE.matchAll(
      /(font-size|line-height|padding|margin|gap|border-radius)[a-z-]*:\s*([^;]+);/g,
    )) {
      expect(value, `${property}: ${value}`).toMatch(/^(0|var\(--[a-z0-9-]+\)( (0|var\(--[a-z0-9-]+\)))*)$/);
    }
  });

  it("uses no px length but the hairline", () => {
    for (const [length] of CODE.matchAll(/\b\d+(\.\d+)?px\b/g)) expect(length).toBe("1px");
  });
});
