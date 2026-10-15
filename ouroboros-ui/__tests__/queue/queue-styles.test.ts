import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The waiting-reason sheet (DI.4, #1312): every class it declares is rendered, every colour is a
 * token, every type size is a token, and nothing scrolls or sticks on its own.
 */

const QUEUE = join(import.meta.dirname, "..", "..", "app", "queue");
const SHEET = readFileSync(join(QUEUE, "queue.css"), "utf8");
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const COMPONENTS = readdirSync(QUEUE)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(QUEUE, name), "utf8"))
  .join("\n");

describe("the sheet and the components", () => {
  it("renders every class it declares, all under the module's own prefix", () => {
    const declared = new Set([...CODE.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((match) => match[1]));

    expect(declared.size).toBeGreaterThan(3);
    for (const name of declared) {
      expect(name).toMatch(/^queue-/);
      expect(COMPONENTS, `${name} is declared and never rendered`).toContain(name);
    }
  });
});

describe("tokens and lengths", () => {
  it("draws every colour from a token", () => {
    for (const [, value] of CODE.matchAll(/(?:^|[\s;{])(?:color|background|border[a-z-]*):([^;]*);/g)) {
      expect(value).toMatch(/var\(--/);
    }
  });

  it("sizes type in tokens, never px", () => {
    expect(CODE).not.toMatch(/font-size:\s*\d/);
  });

  it("writes no length but a hairline outside a token", () => {
    for (const [length] of CODE.matchAll(/[\d.]+px/g)) expect(length).toBe("1px");
  });

  it("adds no scroll container and sticks nothing", () => {
    expect(CODE).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
    expect(CODE).not.toMatch(/position:\s*(sticky|fixed)/);
  });
});
