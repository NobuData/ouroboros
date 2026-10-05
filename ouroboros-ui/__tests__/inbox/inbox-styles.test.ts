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

  it("lays the side column out as the mockup's 8 / 4 grid, stacked at the mockup's break (#469)", () => {
    expect(CODE).toMatch(/\.inbox__grid\s*\{[^}]*grid-template-columns:\s*repeat\(12, minmax\(0, 1fr\)\)/);
    expect(CODE).toMatch(/\.inbox__main\s*\{[^}]*grid-column:\s*span 8/);
    expect(CODE).toMatch(/\.inbox__side\s*\{[^}]*grid-column:\s*span 4/);
    expect(CODE).toMatch(
      /@media \(max-width: 68\.75rem\)\s*\{\s*\.inbox__main,\s*\.inbox__side\s*\{[^}]*grid-column:\s*1 \/ -1/,
    );
  });

  /** One rule's declarations, by its exact selector list. */
  function declarations(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/,\s*/g, ",\\s*");
    const found = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(CODE);

    if (found === null) throw new Error(`no rule for ${selector}`);

    return found[1]!;
  }

  it("opens a tooltip beside its control from the wrapper's own hover and focus (#468)", () => {
    expect(declarations(".inbox-tip__note")).toMatch(/display:\s*none/);
    // `:focus-within` on the wrapper, not on its parts: it is the one thing still true while the
    // focus is moving from the control to a link in the note.
    expect(
      declarations(
        ".inbox-tip:not(.inbox-tip--framed):hover .inbox-tip__note, .inbox-tip:not(.inbox-tip--framed):focus-within .inbox-tip__note, .inbox-tip--pinned .inbox-tip__note",
      ),
    ).toMatch(/display:\s*inline-flex/);
  });

  it("opens a tooltip that frames a row from its control and its note only — never from the row (#469)", () => {
    expect(
      declarations(
        ".inbox-tip--framed:has(.inbox-tip__toggle:hover) .inbox-tip__note, .inbox-tip--framed:has(.inbox-tip__toggle:focus-visible) .inbox-tip__note, .inbox-tip--framed .inbox-tip__note:hover, .inbox-tip--framed.inbox-tip--pinned .inbox-tip__note",
      ),
    ).toMatch(/display:\s*block/);
    // A wrapper that opened its own note would open the policy card's on any touch of a row.
    expect(CODE).not.toMatch(/\.inbox-tip--framed:hover/);
    expect(CODE).not.toMatch(/\.inbox-tip--framed:focus-within/);
    expect(CODE).not.toMatch(/\.inbox-tip:hover/);
    expect(CODE).not.toMatch(/\.inbox-tip:focus-within/);
  });

  it("keeps a framed tooltip's control touching its note, so a pointer can cross to it (#469)", () => {
    // No row gap, no cross-axis alignment that would shorten the control, no margin on the note.
    for (const selector of [".inbox-rules__line", ".inbox-rules__trail"]) {
      expect(declarations(selector)).toMatch(/column-gap:/);
      expect(declarations(selector)).not.toMatch(/(?<!column-)gap:|align-items:|padding/);
    }
    expect(declarations(".inbox-tip--framed")).toMatch(/display:\s*block/);
    expect(declarations(".inbox-rules__row .inbox-tip__note")).not.toMatch(/margin/);
    expect(declarations(".inbox-rules__line")).not.toMatch(/margin/);
  });

  it("keeps a resolved row's tick with its line when the line wraps (#469 narrowed the column)", () => {
    expect(declarations(".inbox-resolved__what")).toMatch(/display:\s*flex/);
    // Without a zero floor the line could not shrink, and would drop to a line of its own instead.
    expect(declarations(".inbox-resolved__what")).toMatch(/min-width:\s*0/);
    expect(declarations(".inbox-resolved__what")).not.toMatch(/flex-wrap/);
  });

  it("gives a channel's sentences the card's width: only the name shares a line with the mark (#469)", () => {
    expect(declarations(".inbox-channels__head")).toMatch(/display:\s*flex/);
    expect(declarations(".inbox-channels__row")).not.toMatch(/display:\s*flex/);
  });

  it("lets a side card's head wrap, so its action never leaves the card (#469)", () => {
    expect(declarations(".inbox-side__head")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("sets only a connected channel's mark in the ok colour (#469)", () => {
    expect(CODE).toMatch(/\.inbox-channels__mark\s*\{[^}]*color:\s*var\(--ink-faint\)/);
    expect(CODE).toMatch(/\.inbox-channels__mark--ok\s*\{[^}]*color:\s*var\(--ok\)/);
  });

  it("colours in tokens only — so both themes come from the token sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CODE).not.toMatch(/\b(rgb|hsl)a?\(/);
  });
});
