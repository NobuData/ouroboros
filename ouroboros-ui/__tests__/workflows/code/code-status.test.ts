import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { CodeSaveState } from "@/app/workflows/code/code-save";
import {
  ANALYZER_LABEL,
  CURSOR_START,
  ENCODING_LABEL,
  SYNC_GLYPH,
  SYNC_WORDS,
  codeSync,
  cursorPlace,
  cursorPosition,
  draftLabel,
  statusRight,
} from "@/app/workflows/code/code-status";

/**
 * The status bar's decisions (V.6, #174) — the ticket's criteria that are words:
 *
 * - **status transitions are truthful across every V.4 state** — synced, saving, parse error, conflict;
 * - **the right cluster reads `DSL analyzer`, not `LSP ready` (C5, verified)**;
 * - **the cursor position matches the editor** — counted as the service counts a range.
 *
 * The strip as drawn and driven is `code-flows-flow.test.tsx`'s.
 */

const EVERY_STATE: readonly CodeSaveState[] = ["idle", "pending", "saving", "saved", "invalid", "conflict", "failed"];

describe("the sync word", () => {
  it.each([
    ["idle", "synced"],
    ["saved", "synced"],
    ["pending", "saving"],
    ["saving", "saving"],
    ["invalid", "parse-error"],
    ["conflict", "conflict"],
    ["failed", "unsaved"],
  ] as const)("reads a save loop that is %s as %s", (state, sync) => {
    expect(codeSync({ state, reason: null }, false)).toBe(sync);
  });

  it("calls a kept text waiting beside a moved draft a conflict, whatever the loop says", () => {
    for (const state of EVERY_STATE) expect(codeSync({ state, reason: null }, true)).toBe("conflict");
  });

  it("is synced only when nothing typed is unwritten or refused", () => {
    const synced = EVERY_STATE.filter((state) => codeSync({ state, reason: null }, false) === "synced");

    expect(synced).toEqual(["idle", "saved"]);
  });

  it("says each state in the mockup's words, and the glyph is ⟲", () => {
    expect(SYNC_WORDS).toEqual({
      synced: "synced with visual editor",
      saving: "saving…",
      "parse-error": "parse error",
      conflict: "conflict",
      unsaved: "not saved",
    });
    expect(SYNC_GLYPH).toBe("⟲");
  });
});

describe("the right cluster (decision C5)", () => {
  it("reads DSL analyzer, the cursor and UTF-8, in the ticket's order", () => {
    expect(statusRight({ line: 24, column: 18 })).toBe("DSL analyzer · Ln 24, Col 18 · UTF-8");
    expect(ANALYZER_LABEL).toBe("DSL analyzer");
    expect(ENCODING_LABEL).toBe("UTF-8");
  });

  it("drops the mockup's LSP ready and TypeScript 5.9 — verified against the mockup's own strip", () => {
    const mockup = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "..", "docs", "mockups", "05-workflow-code.html"),
      "utf8",
    );

    // The claim being refused is really the mockup's…
    expect(mockup).toMatch(/TypeScript 5\.9&nbsp;·&nbsp;LSP ready/);
    // …and nothing the strip can print makes it.
    for (const position of [CURSOR_START, { line: 24, column: 18 }]) {
      expect(statusRight(position)).not.toMatch(/LSP|language server|TypeScript/i);
    }
    expect(Object.values(SYNC_WORDS).join(" ")).not.toMatch(/LSP|TypeScript/i);
  });
});

describe("the cursor", () => {
  /** Two lines, a blank one, and a last line with no line feed after it. */
  const TEXT = "ab\ncde\n\nf";

  it.each([
    [0, 1, 1],
    [2, 1, 3],
    [3, 2, 1],
    [6, 2, 4],
    [7, 3, 1],
    [8, 4, 1],
    [9, 4, 2],
  ])("puts offset %i at Ln %i, Col %i", (offset, line, column) => {
    expect(cursorPosition(TEXT, offset)).toEqual({ line, column });
  });

  it("clamps an offset outside the text rather than naming a place that does not exist", () => {
    expect(cursorPosition(TEXT, -4)).toEqual({ line: 1, column: 1 });
    expect(cursorPosition(TEXT, 99)).toEqual({ line: 4, column: 2 });
    expect(cursorPosition("", 3)).toEqual({ line: 1, column: 1 });
  });

  it("counts UTF-16 code units, as the service counts a diagnostic's column", () => {
    // `😀` is two code units, so the `x` after it is the fourth column.
    expect(cursorPosition("é😀x", 3)).toEqual({ line: 1, column: 4 });
  });

  it("starts at Ln 1, Col 1, and prints as the mockup does", () => {
    expect(CURSOR_START).toEqual({ line: 1, column: 1 });
    expect(cursorPlace(CURSOR_START)).toBe("Ln 1, Col 1");
    expect(cursorPlace({ line: 24, column: 18 })).toBe("Ln 24, Col 18");
  });
});

describe("the draft label", () => {
  it("counts the draft from the version in force, as Publish does", () => {
    expect(draftLabel(14, null)).toBe("v15 draft");
    expect(draftLabel(null, null)).toBe("v1 draft");
  });

  it("names the version in force for a file printed from it with nothing written over it", () => {
    expect(draftLabel(14, 14)).toBe("v14 in force");
  });
});
