import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `app/inbox/inbox.css`'s agreements (#466): the sheet and the components name the same classes,
 * the page adds no chrome to the shell (content-pane mount; the header and sidebar stay fixed under
 * scroll), every length is a token, a rem, a `ch` or a hairline — so the 125 % font-scale step
 * scales the page — and every hue is a token, so both themes come from `app/tokens.css`. jsdom
 * applies no stylesheet, so these are asserted on the source.
 */

const INBOX = join(import.meta.dirname, "..", "..", "app", "inbox");
const SHEET = readFileSync(join(INBOX, "inbox.css"), "utf8");
const COMPONENT = readdirSync(INBOX)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(INBOX, name), "utf8"))
  .join("\n");
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(inbox[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:inbox[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("inbox") && !name.startsWith("inbox-prefs-")),
);

describe("the inbox sheet", () => {
  it("declares and renders the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("adds no fixed or sticky chrome to the shell", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("sizes in tokens, rems, ch and hairlines only — so the font-scale preference scales it", () => {
    const lengths = [...CODE.matchAll(/(-?\d*\.?\d+)(px|rem|em|ch|%|vh|vw)\b/g)].map((match) => match[0]);

    for (const length of lengths) expect(length, length).toMatch(/^(\d*\.?\d+(rem|ch)|1px)$/);
  });

  it("colours in tokens only — so both themes come from the token sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CODE).not.toMatch(/\b(rgb|hsl)a?\(/);
  });
});
