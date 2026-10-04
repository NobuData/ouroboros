import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Members & Roles card's sheet (BS.3, #493): every class it declares is rendered, every colour
 * is a token, every type size is rem (CQ.1), nothing scrolls or sticks on its own, and the pending
 * row is dimmed by colour so its Resend and Revoke stay full-contrast.
 */

const MEMBERS = join(import.meta.dirname, "..", "..", "app", "members");
const SHEET = readFileSync(join(MEMBERS, "members.css"), "utf8");
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

const COMPONENTS = readdirSync(MEMBERS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(MEMBERS, name), "utf8"))
  .join("\n");

/**
 * The declarations of the first rule for a selector.
 *
 * @param selector A regex source for the selector.
 * @returns The body, or empty.
 */
function rule(selector: string): string {
  return new RegExp(`(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

describe("the sheet and the components", () => {
  it("renders every class it declares", () => {
    const declared = new Set([...CODE.matchAll(/\.(members[a-z0-9_-]*)/g)].map((match) => match[1]));

    expect(declared.size).toBeGreaterThan(10);
    for (const name of declared) {
      expect(COMPONENTS, `${name} is declared and never rendered`).toContain(name);
    }
  });
});

describe("tokens and lengths", () => {
  it("draws every colour from a token", () => {
    for (const [, value] of CODE.matchAll(/(?:^|[\s;{])(?:color|background|border[a-z-]*|accent-color):([^;]*);/g)) {
      expect(value).toMatch(/var\(--|transparent|none|0|inherit|dotted/);
    }
  });

  it("sizes type in tokens, never px", () => {
    expect(CODE).not.toMatch(/font-size:\s*\d+px/);
  });

  it("writes every length that is not a hairline in rem, ch or a token", () => {
    for (const [length] of CODE.matchAll(/[\d.]+px/g)) expect(length).toBe("1px");
    expect(CODE).not.toMatch(/\d(vw|vh)/);
  });

  it("adds no scroll container and sticks nothing — the pane and the table own that", () => {
    expect(CODE).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
    expect(CODE).not.toMatch(/position:\s*(sticky|fixed)/);
  });
});

describe("the rows", () => {
  it("dims the pending row by colour, not opacity", () => {
    expect(CODE).not.toMatch(/opacity/);
    expect(CODE).toMatch(
      /\.members__row--pending \.members__name,\s*\.members__row--pending \.members__muted\s*\{\s*color: var\(--ink-dim\);/,
    );
  });

  it("gives the service avatar the muted treatment", () => {
    expect(rule("\\.members__avatar--service")).toMatch(/background:\s*var\(--raised\)/);
  });

  it("shows the capability's consequence on hover and on keyboard focus", () => {
    expect(CODE).toMatch(/\.members__cap:hover \.members__tip,\s*\.members__cap:focus-within \.members__tip\s*\{\s*display: block;/);
  });

  it("draws the error toast in the error tokens", () => {
    expect(rule("\\.members__toast--error")).toMatch(/border-color:\s*var\(--err-line\)/);
  });
});
