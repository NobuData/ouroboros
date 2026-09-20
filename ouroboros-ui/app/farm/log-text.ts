/**
 * What a build printed, made safe to draw (AI.6,
 * [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * Build output is written for a terminal: colour escapes from a compiler, a window title from a
 * shell prompt, a progress line rewritten over itself with a carriage return, the odd `NUL` or
 * backspace. The log pane is not a terminal and must not pretend to be one, so everything a
 * terminal would *interpret* is removed and only what it would *print* is kept. React draws the
 * result as text, so markup in a log is never markup on the page — what this module adds is that
 * an escape sequence is never **noise** on the page either, and never reaches a surface (a
 * clipboard, a real terminal it is pasted into) that would act on it.
 *
 * | In the stream | Drawn |
 * |---|---|
 * | CSI sequences — colours, cursor moves, `ESC [ K` | nothing |
 * | OSC, DCS, SOS, PM and APC strings — titles, hyperlinks | nothing, payload included |
 * | any other escape — charset selection, `ESC c` | nothing |
 * | an escape cut short by the end of the text | nothing, until the rest arrives |
 * | C0 controls but tab, `DEL`, and the C1 controls | nothing |
 * | `\r` before more text | the line starts again ({@link resolveCarriage}) |
 * | tab | tab — the pane sets its width |
 *
 * **Every character here is built from its code**, never typed: a raw `ESC` in a source file is
 * invisible in review, and a pattern that silently lost one would be a sanitizer that passes
 * escapes through.
 *
 * **Framework-free and pure.**
 */

/** `ESC` and the 8-bit `CSI`, as they are written inside a pattern. */
const ESC = "\\x1b";
const CSI_8BIT = "\\x9b";

/** A CSI sequence's body: parameter bytes, then intermediate bytes. */
const CSI_BODY = "[\\x30-\\x3f]*[\\x20-\\x2f]*";

/** The introducers of the string sequences: OSC `]`, DCS `P`, SOS `X`, PM `^`, APC `_`. */
const STRING_INTRODUCER = "[\\]PX^_]";

/** What ends a string sequence: `BEL`, or `ST` (`ESC \`). */
const STRING_END = `\\x07|${ESC}\\\\`;

/**
 * The three kinds of escape sequence, **complete** — each with the byte that ends it. The order
 * matters: `ESC [` and `ESC ]` would each also read as a two-character escape.
 */
const COMPLETE_SEQUENCES = [
  `(?:${ESC}\\[|${CSI_8BIT})${CSI_BODY}[\\x40-\\x7e]`,
  `${ESC}${STRING_INTRODUCER}[^\\x07\\x1b]*(?:${STRING_END})`,
  `${ESC}[\\x20-\\x2f]*[\\x30-\\x7e]`,
];

/**
 * The same three, **or cut short** — by the end of the text, or, for a string sequence, by the
 * next escape. A sequence that never ends therefore costs the rest of its line and nothing more.
 */
const ANY_SEQUENCES = [
  `(?:${ESC}\\[|${CSI_8BIT})${CSI_BODY}(?:[\\x40-\\x7e]|$)`,
  `${ESC}${STRING_INTRODUCER}[^\\x07\\x1b]*(?:${STRING_END}|(?=${ESC})|$)`,
  `${ESC}[\\x20-\\x2f]*(?:[\\x30-\\x7e]|$)`,
];

/** Every escape sequence in a text, whole or cut short. */
const ESCAPES = new RegExp(ANY_SEQUENCES.join("|"), "g");

/** One whole escape sequence, at exactly the position asked about. */
const WHOLE_ESCAPE = new RegExp(COMPLETE_SEQUENCES.join("|"), "y");

/** Where an escape sequence can begin. */
const INTRODUCER = new RegExp(`[${ESC}${CSI_8BIT}]`, "g");

/** The controls that print nothing: C0 but tab, `DEL`, and C1. A line holds no `\n` by now. */
const CONTROLS = new RegExp("[\\x00-\\x08\\x0a-\\x1f\\x7f-\\x9f]", "g");

/** Carriage returns at the end of a text — a `\r\n` whose `\n` has already been taken. */
const TRAILING_RETURNS = /\r+$/;

/**
 * Remove everything a terminal would interpret rather than print.
 *
 * @param text One line of output, with its carriage returns already resolved.
 * @returns The line as a pane may draw it.
 */
export function sanitize(text: string): string {
  return text.replace(ESCAPES, "").replace(CONTROLS, "");
}

/**
 * What a line shows after its carriage returns: the text after the last one that had text after
 * it.
 *
 * A progress line is rewritten by returning to the start and printing again, so what a reader of
 * a terminal sees is the last rewrite. **This keeps the last rewrite whole** rather than
 * overlaying it on the one before — a terminal would leave the tail of a longer earlier text
 * showing, and tools that rewrite lines clear them first precisely so that it does not.
 *
 * @param text A line as it arrived, without its `\n`.
 * @returns The line as it stands. A trailing `\r` — the first half of a `\r\n` — is dropped.
 */
export function resolveCarriage(text: string): string {
  const settled = text.replace(TRAILING_RETURNS, "");
  const at = settled.lastIndexOf("\r");

  return at === -1 ? settled : settled.slice(at + 1);
}

/**
 * The same, for a line **that is still being written**: a trailing `\r` is kept, because whether
 * it begins a rewrite or is half of a `\r\n` is not known until the next character arrives.
 *
 * @param text The open line, as it has arrived so far.
 * @returns The least of it that still resolves to the same thing — which is what keeps a
 *   spinner that rewrites itself for an hour from growing the line for an hour.
 */
export function compactCarriage(text: string): string {
  const settled = resolveCarriage(text);

  return settled.length === text.length || !text.endsWith("\r") ? settled : `${settled}\r`;
}

/** How far back from a cut an escape sequence is looked for. Longer ones are titles, not colours. */
const ESCAPE_REACH = 256;

/**
 * Where a text may be cut so that no escape sequence and no surrogate pair is split.
 *
 * A line longer than the pane will hold is broken into rows, and a break inside `ESC [ 3 1 m`
 * would leave `1m` printed at the start of the next row — the sanitizer sees each row on its own.
 *
 * @param text The text to cut.
 * @param at Where the cut is wanted.
 * @returns `at`, or the nearest earlier position that splits nothing — never `0`, so a cut
 *   always makes progress — and the text's length for an `at` that is not inside it.
 */
export function safeCut(text: string, at: number): number {
  // A position outside the text cuts nothing off it.
  if (at <= 0 || at >= text.length) return text.length;

  let cut = at;

  // A high surrogate directly before the cut has its low half directly after it.
  if (isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;

  const from = Math.max(0, cut - ESCAPE_REACH);
  const start = lastIntroducer(text, from, cut);

  if (start !== -1) {
    WHOLE_ESCAPE.lastIndex = start;
    const whole = WHOLE_ESCAPE.exec(text);

    // No whole sequence ends at or before the cut: it would be split, so cut in front of it.
    if (whole === null || start + whole[0].length > cut) cut = start;
  }

  return cut > 0 ? cut : at;
}

/**
 * The last position in a range where an escape sequence could begin.
 *
 * @param text The text.
 * @param from The start of the range.
 * @param to Its end, exclusive.
 * @returns The position, or `-1`.
 */
function lastIntroducer(text: string, from: number, to: number): number {
  let last = -1;

  INTRODUCER.lastIndex = from;
  for (let found = INTRODUCER.exec(text); found !== null; found = INTRODUCER.exec(text)) {
    if (found.index >= to) break;
    last = found.index;
  }

  return last;
}

/**
 * Whether a UTF-16 code unit is the first half of a surrogate pair.
 *
 * @param unit The code unit; `NaN` reads as no.
 * @returns `true` for `0xD800`–`0xDBFF`.
 */
export function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}
