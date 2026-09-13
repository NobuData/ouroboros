import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sources sheet ([#141](https://github.com/NobuData/ouroboros/issues/141)): every class
 * it names is rendered, every colour is a token, every length a token or a rem, and the
 * promised tile and the failed row carry their state in treatment as well as in words.
 */

const UI = join(import.meta.dirname, "..", "..");
const SOURCES = join(UI, "app", "sources");
const SHEET = readFileSync(join(SOURCES, "sources.css"), "utf8");

const COMPONENT = readdirSync(SOURCES)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(SOURCES, name), "utf8"))
  .join("\n");

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

function rule(selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

const DECLARED = [...CODE.matchAll(/\.(sources-[a-z0-9_-]+)/g)].map((match) => match[1]);

describe("the sheet and the components", () => {
  it("declares a rule for every class the sheet names, and renders every one", () => {
    expect(DECLARED.length).toBeGreaterThan(0);

    for (const name of new Set(DECLARED)) {
      expect(COMPONENT, `${name} is declared and never rendered`).toContain(name);
    }
  });

  it("adds nothing the dialog already owns", () => {
    expect(CODE).not.toContain("position: fixed");
    expect(CODE).not.toContain("--scrim");
    expect(CODE).not.toContain("z-index");
  });
});

describe("the row", () => {
  it("dashes a paused row and keeps a failed one solid in the error hue", () => {
    expect(rule("\\.sources-row--paused")).toContain("1px dashed var(--line-strong)");
    expect(rule("\\.sources-row--error")).toContain("border-color: var(--err-line)");
  });

  it("draws the second line in the hue of what it says", () => {
    expect(rule("\\.sources-row__sync--ok")).toContain("color: var(--ok)");
    expect(rule("\\.sources-row__sync--err")).toContain("color: var(--err)");
    expect(rule("\\.sources-row__sync--neutral")).toContain("color: var(--ink-faint)");
    expect(rule("\\.sources-row__sync--accent")).toContain("color: var(--accent)");
  });

  it("sizes the monogram in rem, so the preference moves it", () => {
    expect(rule("\\.sources-row__monogram")).toMatch(/width:\s*[\d.]+rem/);
    expect(rule("\\.sources-row__monogram")).toContain("background: var(--accent-tint)");
  });
});

describe("the add dialog", () => {
  it("draws the promised tile as visibly not a control, in words and in treatment", () => {
    const soon = rule("\\.sources-catalog__tile--soon");

    expect(soon).toContain("1px dashed var(--line-strong)");
    expect(soon).toContain("background: transparent");
    expect(soon).toContain("cursor: default");
    expect(COMPONENT).toContain("COMING_SOON_LABEL");
    expect(COMPONENT).toContain("V2_LABEL");
  });

  it("draws the refusal in the error hue", () => {
    expect(rule("\\.sources-add__failure")).toContain("color: var(--err)");
  });
});

describe("the skeleton", () => {
  it("draws every bar on the raised plane and pulses only under no-preference", () => {
    for (const bar of ["action", "monogram", "bar", "button"]) {
      expect(rule(`\\.sources-skeleton__${bar}`), bar).toContain("background: var(--raised)");
    }
    expect(CODE).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(CODE).toMatch(/@keyframes sources-skeleton-pulse/);
  });
});

describe("every colour and every size", () => {
  it("is a token", () => {
    const declarations = [...CODE.matchAll(/(?:color|background|border[a-z-]*):([^;]*);/g)];

    expect(declarations.length).toBeGreaterThan(0);
    for (const [, value] of declarations) {
      expect(value).toMatch(/var\(--|transparent|none|0|1px solid var\(--|1px dashed var\(--/);
    }
  });

  it("names no length in px that the reader's preference should move", () => {
    const pixels = [...CODE.matchAll(/(\d+)px/g)].map((match) => match[1]);

    expect(pixels.every((value) => value === "1")).toBe(true);
  });
});
