import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Autonomy policies card's sheet (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)):
 * every class it declares is rendered, every `policy-card`/`policy-publish` class the components
 * render is declared, and nothing on it is a hard-coded colour or a pixel type size.
 */

const POLICIES = join(import.meta.dirname, "..", "..", "app", "policies");
const SHEET = readFileSync(join(POLICIES, "policy-card.css"), "utf8");
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const COMPONENTS = ["policy-card.tsx", "publish-dialog.tsx"]
  .map((name) => readFileSync(join(POLICIES, name), "utf8"))
  .join("\n");

const DECLARED = new Set([...CODE.matchAll(/\.(policy-(?:card|publish)[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set(
  [...COMPONENTS.matchAll(/"(policy-(?:card|publish)[a-z0-9_-]*)"/g)].map((match) => match[1]),
);

describe("the sheet and the components", () => {
  it("declares a rule for every class the components render", () => {
    expect(RENDERED.size).toBeGreaterThan(0);

    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
    }
  });

  it("renders every class the sheet declares", () => {
    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
  });
});

describe("every colour and every size", () => {
  it("is a token, and no length that carries type is in px", () => {
    for (const [, value] of CODE.matchAll(/(?:color|background|border[a-z-]*):([^;]*);/g)) {
      expect(value).toMatch(/var\(--|transparent|none|0/);
    }

    expect(CODE).not.toMatch(/font-size:\s*\d+px/);
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("imports its sheet from both components", () => {
    for (const name of ["policy-card.tsx", "publish-dialog.tsx"]) {
      expect(readFileSync(join(POLICIES, name), "utf8")).toContain('import "./policy-card.css";');
    }
  });
});
