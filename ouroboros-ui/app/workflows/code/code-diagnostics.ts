/**
 * A refused save's diagnostics, placed in the editor — V.4
 * ([#172](https://github.com/NobuData/ouroboros/issues/172)).
 *
 * A `422 workflow_code_invalid` carries every parse error as W.2's `CodeDiagnostic`
 * ([#178](https://github.com/NobuData/ouroboros/issues/178)): a 1-based line and column range, counted in
 * line feeds and UTF-16 code units — which is exactly how a JavaScript string counts, so a range turns
 * into offsets with no re-encoding.
 *
 * ### The ranges are about the text that was sent
 *
 * The answer arrives after the request left, and a person who kept typing has moved the file since. So a
 * diagnostic is always kept with the text it was counted in ({@link AnchoredDiagnostics}), and placed in
 * the editor through the difference between that text and the one on screen ({@link textChange}): the
 * region both texts start with and the region both end with do not move, an offset after the change moves
 * by its length, and an offset inside it clamps to its edge. Once placed, CodeMirror's lint state carries
 * each range through every later edit on its own.
 *
 * **Framework-free and pure**, apart from naming CodeMirror's `Diagnostic` type.
 */

import type { Diagnostic } from "@codemirror/lint";

import type { CodeDiagnostic } from "@/app/api/workflows";

import { isRecord } from "./code-view";

/** A diagnostic's range, as the service counts it. */
export type DiagnosticRange = CodeDiagnostic["range"];

/** Diagnostics, with the text their ranges were counted in. */
export interface AnchoredDiagnostics {
  /** The text the service read. */
  readonly anchor: string;
  /** What it found, in its order: errors first, then by position. */
  readonly items: readonly CodeDiagnostic[];
}

/** A request to put the cursor on a range and scroll to it. Each request is a new object. */
export interface RevealRequest {
  /** The text the range was counted in. */
  readonly anchor: string;
  /** The range. */
  readonly range: DiagnosticRange;
}

/** A range as offsets into a text: `from` inclusive, `to` exclusive, `from <= to`. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * Whether a value is a 1-based position.
 *
 * @param value Anything.
 * @returns `true` for an integer of at least 1.
 */
function isPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Read the diagnostics out of a `422 workflow_code_invalid`'s `details`.
 *
 * **Defensive on purpose**, like `readFindings`: `details` is an open object, so an entry without a
 * message or a whole range is skipped rather than drawn at a guessed place, and an unknown severity reads
 * as an error — the answer refused the save, so what it reports refused it.
 *
 * @param details The refusal's `details`.
 * @returns The diagnostics, in the service's order.
 */
export function readDiagnostics(details: unknown): readonly CodeDiagnostic[] {
  if (!isRecord(details) || !Array.isArray(details.diagnostics)) return [];

  return details.diagnostics.flatMap((entry: unknown): CodeDiagnostic[] => {
    if (!isRecord(entry) || typeof entry.message !== "string" || !isRecord(entry.range)) return [];

    const { line, column, endLine, endColumn } = entry.range;
    if (!isPosition(line) || !isPosition(column) || !isPosition(endLine) || !isPosition(endColumn)) return [];

    return [
      {
        severity: entry.severity === "warning" ? "warning" : "error",
        range: { line, column, endLine, endColumn },
        code: typeof entry.code === "string" ? entry.code : "",
        message: entry.message,
        ...(typeof entry.note === "string" ? { note: entry.note } : {}),
        ...(typeof entry.node === "string" ? { node: entry.node } : {}),
      },
    ];
  });
}

/**
 * Where each line of a text starts.
 *
 * @param text The text. Lines are counted by line feeds only, as the service counts them.
 * @returns The offset of each line's first character; always at least one line.
 */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/**
 * A range's offsets in the text it was counted in.
 *
 * Clamped rather than trusted: a line past the end is the last line, a column past a line's end is that
 * line's end, and an end before the start is an empty range at the start.
 *
 * @param text The text.
 * @param range The range.
 * @param starts The text's {@link lineStarts}, when the caller already has them.
 * @returns The span.
 */
export function rangeSpan(text: string, range: DiagnosticRange, starts: readonly number[] = lineStarts(text)): Span {
  const offset = (line: number, column: number): number => {
    const index = Math.min(Math.max(line, 1), starts.length) - 1;
    const lineStart = starts[index] ?? 0;
    const next = starts[index + 1];
    const lineEnd = next === undefined ? text.length : next - 1;

    return Math.min(lineStart + Math.max(column, 1) - 1, lineEnd);
  };

  const from = offset(range.line, range.column);
  return { from, to: Math.max(from, offset(range.endLine, range.endColumn)) };
}

/** The one region two texts differ in. */
export interface TextChange {
  /** How many leading characters both share. */
  readonly prefix: number;
  /** How many trailing characters both share, not overlapping the prefix. */
  readonly suffix: number;
  /** The earlier text's length. */
  readonly before: number;
  /** The later text's length minus the earlier's. */
  readonly delta: number;
}

/**
 * The region two texts differ in.
 *
 * @param before The earlier text.
 * @param after The later text.
 * @returns The shared head, the shared tail, and the change in length.
 */
export function textChange(before: string, after: string): TextChange {
  const shortest = Math.min(before.length, after.length);

  let prefix = 0;
  while (prefix < shortest && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;

  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  return { prefix, suffix, before: before.length, delta: after.length - before.length };
}

/**
 * Carry an offset in the earlier text into the later one.
 *
 * @param change The {@link textChange} between them.
 * @param offset The offset in the earlier text.
 * @param side Which edge of the changed region an offset inside it goes to: `-1` its start, `1` its end.
 * @returns The offset in the later text.
 */
export function mapOffset(change: TextChange, offset: number, side: -1 | 1): number {
  const changedEnd = change.before - change.suffix;

  if (offset <= change.prefix) return offset;
  if (offset >= changedEnd) return offset + change.delta;
  return side < 0 ? change.prefix : changedEnd + change.delta;
}

/**
 * A range counted in one text, as offsets into another.
 *
 * @param anchor The text the range was counted in.
 * @param doc The text on screen.
 * @param range The range.
 * @returns The span in `doc`.
 */
export function anchoredSpan(anchor: string, doc: string, range: DiagnosticRange): Span {
  const span = rangeSpan(anchor, range);
  const change = textChange(anchor, doc);
  const from = mapOffset(change, span.from, -1);

  return { from, to: Math.max(from, mapOffset(change, span.to, 1)) };
}

/**
 * The diagnostics as CodeMirror draws them — squiggles, gutter markers and the hover card.
 *
 * @param anchored The diagnostics and the text they were counted in.
 * @param doc The text on screen.
 * @returns One CodeMirror diagnostic per entry: its message, then the service's note on its own line.
 */
export function editorDiagnostics(anchored: AnchoredDiagnostics, doc: string): Diagnostic[] {
  const starts = lineStarts(anchored.anchor);
  const change = textChange(anchored.anchor, doc);

  return anchored.items.map((item) => {
    const span = rangeSpan(anchored.anchor, item.range, starts);
    const from = mapOffset(change, span.from, -1);

    return {
      from,
      to: Math.max(from, mapOffset(change, span.to, 1)),
      severity: item.severity,
      message: item.note === undefined ? item.message : `${item.message}\n${item.note}`,
      ...(item.code === "" ? {} : { source: item.code }),
    };
  });
}

/** The diagnostics strip's accessible name. */
export const DIAGNOSTICS_LABEL = "Why this file did not save";

/** The tooltip on the strip's first message. */
export const JUMP_TITLE = "Go to this place in the file";

/**
 * Where a range starts, in words.
 *
 * @param range The range.
 * @returns `Line 4, column 8`.
 */
export function diagnosticPlace(range: DiagnosticRange): string {
  return `Line ${range.line}, column ${range.column}`;
}

/**
 * How many diagnostics there are, in words — the strip's count.
 *
 * @param items The diagnostics.
 * @returns `1 error`, `3 errors`, `2 errors, 1 warning` — or `No problems found` for none, which a refused
 *   save with an unreadable answer can leave.
 */
export function diagnosticsSummary(items: readonly CodeDiagnostic[]): string {
  const errors = items.filter((item) => item.severity === "error").length;
  const warnings = items.length - errors;
  const parts = [
    errors === 0 ? null : `${errors} ${errors === 1 ? "error" : "errors"}`,
    warnings === 0 ? null : `${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? "No problems found" : parts.join(", ");
}
