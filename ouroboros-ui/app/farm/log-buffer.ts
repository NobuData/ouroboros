/**
 * The rows a log pane draws, folded out of the pages a build's log arrives in
 * (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * A log arrives as pages of text cut at arbitrary bytes (`app/api/farm.ts`'s `BuildLog`), and a
 * pane draws rows. This is the fold between them, and it owns the three properties the issue
 * asks of the pane that are about *data* rather than about scrolling:
 *
 * - **Appended, never rebuilt.** A page adds rows to the end and may extend the one row that was
 *   still being written. Every row keeps its key for as long as it is held, so what React does
 *   with a new page is mount the new rows and change one text node.
 * - **Bounded.** At most {@link LogLimits.maxLines} rows are held; older ones leave from the head
 *   and are *counted*, so the pane can say that they did. A line longer than
 *   {@link LogLimits.maxColumns} is broken into rows, so one unterminated megabyte cannot become
 *   one megabyte-wide row either.
 * - **A gap looks like a gap.** AH.5 reports holes as data, by byte position. Each becomes a row
 *   of its own kind, placed where it happened — in the middle of a line if that is where the
 *   bytes went missing, because the text either side of a hole was never one line.
 *
 * **Framework-free and pure**: {@link appendPage} returns a new buffer and leaves the one it was
 * given alone, so a snapshot a component is rendering from never changes under it.
 */

import type { BuildLog } from "@/app/api/farm";

import { compactCarriage, isHighSurrogate, resolveCarriage, safeCut, sanitize } from "./log-text";

/** What a row is: a line the build printed, a hole in the log, or a note from the pane itself. */
export type LogRowKind = "text" | "gap" | "note";

/** One row of the pane. */
export interface LogRow {
  /**
   * The row's identity, ascending in reading order and never reused — a React key, and the
   * coordinate the pane keeps a reader's place by when older rows leave.
   */
  readonly key: number;
  /** What kind of row it is. */
  readonly kind: LogRowKind;
  /** What it says — already safe to draw. */
  readonly text: string;
}

/** The rows held, and what is needed to take the next page. */
export interface LogBuffer {
  /** The held rows, oldest first: `text` and `gap` rows only. */
  readonly lines: readonly LogRow[];
  /**
   * The last row's text **as it arrived**, while that line has not ended — or `null` when the
   * last line is complete. Kept unsanitized because an escape sequence can be split between two
   * pages, and only the raw text can be completed by the next one.
   */
  readonly open: string | null;
  /** The key the next row takes. */
  readonly next: number;
  /** How many rows have left from the head. */
  readonly dropped: number;
  /** The widest row seen, in characters — what the pane sizes its sideways scroll by. */
  readonly columns: number;
}

/** Nothing read yet. */
export const EMPTY_LOG_BUFFER: LogBuffer = Object.freeze({
  lines: Object.freeze([]),
  open: null,
  next: 0,
  dropped: 0,
  columns: 0,
});

/** How much a buffer may hold. */
export interface LogLimits {
  /** The most rows held at once. */
  readonly maxLines: number;
  /** The longest a row may be, in characters, before the line is broken. */
  readonly maxColumns: number;
}

/** The key of the note above the first held row. Negative, so it sorts before every line. */
export const EARLIER_KEY = -1;

/** The key of the marker under the last row — what was elided after the stored log's end. */
export const TAIL_KEY = Number.MAX_SAFE_INTEGER;

/* ------------------------------------------------------------------ what a marker says */

/** How a count is written — `2,481,392`. One locale, so a log reads the same for everybody. */
const COUNT = new Intl.NumberFormat("en-US");

/**
 * A count and its noun.
 *
 * @param count How many.
 * @param noun What of, in the singular.
 * @returns `1 byte`, `2,481,392 bytes`.
 */
function counted(count: number, noun: string): string {
  return `${COUNT.format(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * What an elision marker says — the issue's `[… 2,481,392 bytes elided]`.
 *
 * The two figures are different facts: bytes the agent's throttle or the rate guard **counted and
 * dropped**, and chunks that **never arrived**, whose size nobody knows. Whichever is present is
 * said; the dashes either side are the stylesheet's.
 *
 * @param bytes Bytes elided at this position.
 * @param missingChunks Chunks lost at this position.
 * @returns The marker's text.
 */
export function elisionLabel(bytes: number, missingChunks: number): string {
  const parts: string[] = [];

  if (bytes > 0) parts.push(`${counted(bytes, "byte")} elided`);
  if (missingChunks > 0) parts.push(`${counted(missingChunks, "chunk")} lost`);

  return `[… ${parts.length === 0 ? "output elided" : parts.join(" · ")}]`;
}

/**
 * What the marker under the log says: everything elided after the last stored byte, as one
 * figure, and why when the reason is the per-job cap.
 *
 * @param tail The page's `tail`.
 * @returns The marker's text.
 */
export function tailLabel(tail: NonNullable<BuildLog["tail"]>): string {
  const label = elisionLabel(tail.bytes, tail.missingChunks);

  return tail.capped ? `${label.slice(0, -1)} — log cap reached]` : label;
}

/* ------------------------------------------------------------------ bytes to characters */

/** U+FFFD — what a byte that is not UTF-8 decodes to. */
const REPLACEMENT = 0xfffd;

/**
 * How many bytes a character took in the stream.
 *
 * @param text The text.
 * @param at The position of the character's first code unit.
 * @param replacementWidth What a U+FFFD counts as — see {@link textIndexes}.
 * @returns Its UTF-8 width, and how many code units it spans.
 */
function widthAt(
  text: string,
  at: number,
  replacementWidth: number,
): { bytes: number; units: number } {
  const unit = text.charCodeAt(at);

  if (unit < 0x80) return { bytes: 1, units: 1 };
  if (unit < 0x800) return { bytes: 2, units: 1 };
  if (unit === REPLACEMENT) return { bytes: replacementWidth, units: 1 };
  if (isHighSurrogate(unit) && at + 1 < text.length) return { bytes: 4, units: 2 };

  return { bytes: 3, units: 1 };
}

/**
 * Where byte positions in a page fall in its text.
 *
 * A marker's `offset` is a position in the **byte** stream and the page is a **string**, so the
 * page is walked once, counting what each character weighed in UTF-8.
 *
 * **One character is ambiguous.** U+FFFD in the text is either a genuine U+FFFD (three bytes) or
 * what an invalid byte decoded to (counted once, AH.5). The page's own length settles it: if
 * reading every U+FFFD as three bytes accounts for the page exactly, they are genuine; otherwise
 * they are read as one byte each, which is what a compiler printing a stray `0x80` produces. A
 * page mixing both kinds places a marker a few characters out — inside the page, never lost.
 *
 * @param text The page's text.
 * @param byteLength How many bytes the page covers — `nextOffset - offset`.
 * @param positions Byte positions relative to the page's start, ascending.
 * @returns The index in `text` each position falls at, clamped to the text.
 */
export function textIndexes(
  text: string,
  byteLength: number,
  positions: readonly number[],
): number[] {
  if (positions.length === 0) return [];

  let genuine = 0;
  for (let at = 0; at < text.length; ) {
    const width = widthAt(text, at, 3);
    genuine += width.bytes;
    at += width.units;
  }

  const replacementWidth = genuine === byteLength ? 3 : 1;
  const indexes: number[] = [];
  let at = 0;
  let bytes = 0;

  for (const position of positions) {
    while (bytes < position && at < text.length) {
      const width = widthAt(text, at, replacementWidth);
      bytes += width.bytes;
      at += width.units;
    }

    indexes.push(at);
  }

  return indexes;
}

/* ------------------------------------------------------------------ the fold */

/** A buffer being written — {@link appendPage}'s own copy, frozen again before it is returned. */
interface Draft {
  lines: LogRow[];
  open: string | null;
  next: number;
  dropped: number;
  columns: number;
}

/**
 * Write one line — new, or the one still open — breaking it into rows where it is too long.
 *
 * @param draft The buffer being written.
 * @param raw The line as it arrived, carriage returns resolved as far as they can be.
 * @param ended Whether its `\n` has arrived.
 * @param maxColumns The longest a row may be.
 * @returns Nothing; `draft` is updated.
 */
function writeLine(draft: Draft, raw: string, ended: boolean, maxColumns: number): void {
  // The row this line already has, if it was open: it is rewritten in place, under its own key.
  let key = draft.open === null ? null : (draft.lines.pop()?.key ?? null);
  let rest = raw;

  while (rest.length > maxColumns) {
    const cut = safeCut(rest, maxColumns);

    pushRow(draft, key, sanitize(resolveCarriage(rest.slice(0, cut))));
    key = null;
    rest = rest.slice(cut);
  }

  pushRow(draft, key, sanitize(resolveCarriage(rest)));
  draft.open = ended ? null : rest;
}

/**
 * Add a text row.
 *
 * @param draft The buffer being written.
 * @param key The key to reuse, or `null` to take the next one.
 * @param text The row's text.
 * @returns Nothing; `draft` is updated.
 */
function pushRow(draft: Draft, key: number | null, text: string): void {
  draft.lines.push({ key: key ?? takeKey(draft), kind: "text", text });
  draft.columns = Math.max(draft.columns, text.length);
}

/**
 * Take the next key.
 *
 * @param draft The buffer being written.
 * @returns A key no row has carried.
 */
function takeKey(draft: Draft): number {
  const key = draft.next;
  draft.next += 1;

  return key;
}

/**
 * Append a run of text: every `\n` ends a line, and what follows the last one stays open.
 *
 * @param draft The buffer being written.
 * @param text The text, exactly as the page carried it.
 * @param maxColumns The longest a row may be.
 * @returns Nothing; `draft` is updated.
 */
function appendText(draft: Draft, text: string, maxColumns: number): void {
  const parts = text.split("\n");

  parts.forEach((part, index) => {
    const ended = index < parts.length - 1;

    // What follows the last `\n` is the start of a line nobody has printed yet: no row until it
    // has text, so a log that ends in a newline does not end in an empty row.
    if (!ended && part === "") return;

    const raw = (draft.open ?? "") + part;

    writeLine(draft, ended ? raw : compactCarriage(raw), ended, maxColumns);
  });
}

/**
 * Append a hole. Whatever line was open is over: the bytes that would have finished it are the
 * ones that are missing.
 *
 * @param draft The buffer being written.
 * @param text What the marker says.
 * @returns Nothing; `draft` is updated.
 */
function appendGap(draft: Draft, text: string): void {
  draft.open = null;
  draft.lines.push({ key: takeKey(draft), kind: "gap", text });
}

/** What {@link appendPage} hands back. */
export interface Appended {
  /** The buffer, with the page in it. */
  readonly buffer: LogBuffer;
  /**
   * Whether the reader is still inside a line it joined part-way — see
   * {@link appendPage}'s `skipping`.
   */
  readonly skipping: boolean;
}

/**
 * Fold one page into a buffer.
 *
 * @param buffer The rows held so far. Left as it is.
 * @param page The page. **The caller has already checked that it continues the log** — that
 *   `page.offset` is where the last page ended — which is `app/farm/log-stream.ts`'s half of
 *   *no duplicated or skipped output*.
 * @param limits How much may be held.
 * @param skipping Whether the page begins inside a line the reader never saw the start of —
 *   true after a jump to the log's tail, which lands on an arbitrary byte. Everything up to and
 *   including the first `\n` is then left out, markers and all, so the pane never opens on the
 *   second half of a line (or of a character) presented as a whole one.
 * @returns The new buffer, and whether the first `\n` is still to come.
 */
export function appendPage(
  buffer: LogBuffer,
  page: Pick<BuildLog, "bytes" | "offset" | "nextOffset" | "elisions">,
  limits: LogLimits,
  skipping = false,
): Appended {
  const text = page.bytes;
  const newline = skipping ? text.indexOf("\n") : -1;
  const stillSkipping = skipping && newline === -1;
  const start = !skipping ? 0 : stillSkipping ? text.length : newline + 1;

  const marks = [...page.elisions].sort((a, b) => a.offset - b.offset);
  const indexes = textIndexes(
    text,
    page.nextOffset - page.offset,
    marks.map((mark) => mark.offset - page.offset),
  );

  const draft: Draft = { ...buffer, lines: [...buffer.lines] };
  let from = start;

  marks.forEach((mark, index) => {
    const at = indexes[index];

    // A hole inside the part that is not shown is part of what is not shown.
    if (at < start) return;

    appendText(draft, text.slice(from, at), limits.maxColumns);
    appendGap(draft, elisionLabel(mark.bytes, mark.missingChunks));
    from = at;
  });

  appendText(draft, text.slice(from), limits.maxColumns);

  const over = Math.max(0, draft.lines.length - limits.maxLines);
  if (over > 0) {
    draft.lines.splice(0, over);
    draft.dropped += over;
  }

  return {
    buffer: Object.freeze({ ...draft, lines: Object.freeze(draft.lines) }),
    skipping: stillSkipping,
  };
}

/* ------------------------------------------------------------------ what the pane draws */

/** What is drawn around the held rows. */
export interface LogFrame {
  /**
   * What to say above the first row when earlier output is not held — because rows left from
   * the head, or because the reader joined at the tail — or `null` to say nothing.
   */
  readonly earlier: string | null;
  /** The latest page's `tail` — what was elided after the stored log's end — or `null`. */
  readonly tail: BuildLog["tail"];
}

/**
 * The rows to draw: the note about earlier output, the held rows, and the tail marker.
 *
 * @param buffer The held rows.
 * @param frame What goes around them.
 * @returns The rows, top to bottom. The buffer's own array when there is nothing to add, so a
 *   pane comparing by identity sees no change where there was none.
 */
export function logRows(buffer: LogBuffer, frame: LogFrame): readonly LogRow[] {
  if (frame.earlier === null && frame.tail === null) return buffer.lines;

  const earlier: LogRow[] =
    frame.earlier === null ? [] : [{ key: EARLIER_KEY, kind: "note", text: frame.earlier }];
  const tail: LogRow[] =
    frame.tail === null ? [] : [{ key: TAIL_KEY, kind: "gap", text: tailLabel(frame.tail) }];

  // A spread into a literal, not into `push`'s arguments: a full log holds more rows than a call
  // may take arguments.
  return [...earlier, ...buffer.lines, ...tail];
}
