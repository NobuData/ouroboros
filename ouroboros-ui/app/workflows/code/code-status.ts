/**
 * The code view's status bar, decided — V.6 ([#174](https://github.com/NobuData/ouroboros/issues/174)).
 *
 * `docs/mockups/05-workflow-code.html` closes the editor with one strip:
 *
 * ```
 * ⟲ synced with visual editor · v15 draft          DSL analyzer · Ln 24, Col 18 · UTF-8
 * ```
 *
 * A small strip making a large claim — that this editor and the visual one hold the same draft — so every
 * word here is derived from something observed rather than assumed:
 *
 * - **The sync word follows the save loop (V.4, #172) and never runs ahead of it.** *synced* only while
 *   nothing typed is unwritten; *saving…* from the first keystroke until the write lands; *parse error*
 *   while the service refuses the text; *conflict* once the loop has stopped for another editor's change,
 *   or while a kept text waits beside a draft that moved; *not saved* while a failed write waits to be
 *   tried again — the one state the mockup does not name, and not one to call synced.
 * - **`vN draft` counts from the version in force**, as **Publish vN** does, and follows a publish. A
 *   file printed from the version in force with nothing typed says so instead: there is no draft yet.
 * - **The right cluster reads `DSL analyzer`, not the mockup's `TypeScript 5.9 · LSP ready` (decision
 *   C5).** The editor's intelligence is schema-driven; there is no language server and no TypeScript
 *   compiler behind it, and a strip claiming either would be a decorative lie. #183's ADR is where the
 *   wording is revisited.
 * - **`Ln`/`Col` is the editor's own cursor**, counted in line feeds and UTF-16 code units — the units the
 *   service's diagnostic ranges use, so a finding at *Line 4, column 8* is where the strip reads
 *   `Ln 4, Col 8`. `UTF-8` is what the service stores and serves.
 *
 * **Framework-free and pure**, like `code-save.ts`.
 */

import { versionWord } from "../view";
import { lineStarts } from "./code-diagnostics";
import type { CodeSaveStatus } from "./code-save";

/** What the status bar says about the file and the visual editor. */
export type CodeSync = "synced" | "saving" | "parse-error" | "conflict" | "unsaved";

/**
 * Where the file stands against the draft the visual editor shows.
 *
 * @param status Where the save loop stands.
 * @param diverged Whether the tab holds text typed over a draft that has since moved.
 * @returns The sync state — never `synced` while anything typed is unwritten or refused.
 */
export function codeSync(status: CodeSaveStatus, diverged: boolean): CodeSync {
  if (diverged) return "conflict";

  switch (status.state) {
    case "idle":
    case "saved":
      return "synced";
    case "pending":
    case "saving":
      return "saving";
    case "invalid":
      return "parse-error";
    case "conflict":
      return "conflict";
    case "failed":
      return "unsaved";
  }
}

/** The glyph mockup 05 draws before *synced with visual editor*, and only there. */
export const SYNC_GLYPH = "⟲";

/** Each sync state, in the strip's words. */
export const SYNC_WORDS: Readonly<Record<CodeSync, string>> = {
  synced: "synced with visual editor",
  saving: "saving…",
  "parse-error": "parse error",
  conflict: "conflict",
  unsaved: "not saved",
};

/** The strip's accessible name. */
export const STATUS_BAR_LABEL = "Editor status";

/** What does the editor's analysis — schema-driven intelligence, not a language server (decision C5). */
export const ANALYZER_LABEL = "DSL analyzer";

/** The file's encoding, as the service stores and serves it. */
export const ENCODING_LABEL = "UTF-8";

/** A place in the file, 1-based. */
export interface CursorPosition {
  /** The line, counted by line feeds. */
  readonly line: number;
  /** The column, in UTF-16 code units from the line's start. */
  readonly column: number;
}

/** Where a freshly opened editor's cursor is, before it has reported anything. */
export const CURSOR_START: CursorPosition = { line: 1, column: 1 };

/**
 * The line and column of an offset.
 *
 * @param text The editor's whole text.
 * @param offset The cursor's offset into it. Clamped to the text, so a stale offset is never a place
 *   past the end.
 * @returns The position.
 */
export function cursorPosition(text: string, offset: number): CursorPosition {
  const at = Math.min(Math.max(Math.floor(offset), 0), text.length);
  const starts = lineStarts(text);

  let index = starts.length - 1;
  while (index > 0 && (starts[index] ?? 0) > at) index -= 1;

  return { line: index + 1, column: at - (starts[index] ?? 0) + 1 };
}

/**
 * A position, as the strip prints it.
 *
 * @param position The position.
 * @returns `Ln 24, Col 18`.
 */
export function cursorPlace(position: CursorPosition): string {
  return `Ln ${position.line}, Col ${position.column}`;
}

/**
 * The strip's right cluster.
 *
 * @param position The cursor.
 * @returns `DSL analyzer · Ln 24, Col 18 · UTF-8`.
 */
export function statusRight(position: CursorPosition): string {
  return [ANALYZER_LABEL, cursorPlace(position), ENCODING_LABEL].join(" · ");
}

/**
 * What the strip says the file is.
 *
 * @param currentVersion The version in force, or `null` for a workflow that has published nothing.
 * @param printedFrom The published version the file was printed from while nothing has been written over
 *   it, or `null` when there is a draft.
 * @returns `v15 draft` beside a `v14` in force; `v14 in force` for a file with no draft open.
 */
export function draftLabel(currentVersion: number | null, printedFrom: number | null): string {
  return printedFrom === null
    ? `${versionWord((currentVersion ?? 0) + 1)} draft`
    : `${versionWord(printedFrom)} in force`;
}
