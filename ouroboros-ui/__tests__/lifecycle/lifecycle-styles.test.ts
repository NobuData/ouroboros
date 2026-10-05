import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The lifecycle's sheet (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)) — the
 * paused banner and the recovery screen: every class the components render has a rule, every
 * rule is rendered, nothing in it is a colour or a type size of its own, and the banner is a row
 * of the shell's grid rather than something fixed or stuck.
 */

const LIFECYCLE = join(import.meta.dirname, "..", "..", "app", "lifecycle");
const SHEET = readFileSync(join(LIFECYCLE, "lifecycle.css"), "utf8");
const COMPONENTS = ["lifecycle-banner.tsx", "recovery-screen.tsx"].map((file) =>
  readFileSync(join(LIFECYCLE, file), "utf8"),
);

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const DECLARED = new Set([...CODE.matchAll(/\.(lifecycle-[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  COMPONENTS.flatMap((source) =>
    [...source.matchAll(/"(lifecycle-[a-z0-9_-]*)"/g)].map((match) => match[1]),
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

  it("is imported by both components, so neither draws unstyled", () => {
    for (const source of COMPONENTS) expect(source).toContain('import "./lifecycle.css";');
  });
});

describe("the banner's place in the frame", () => {
  it("is the shell grid's second row, across both columns — never fixed, never stuck", () => {
    const banner = CODE.match(/\.lifecycle-banner\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(banner).toMatch(/grid-row:\s*2/);
    expect(banner).toMatch(/grid-column:\s*1 \/ -1/);
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
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
