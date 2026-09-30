/**
 * The deterministic text rules the proposers share (BF.3,
 * [#412](https://github.com/NobuData/ouroboros/issues/412), decision **K5**): **lead-instruction
 * extraction** with **inline-code spans preserved verbatim**.
 *
 * A correction note, a waiver reason and a steer are written for a moment — *"Team prefers
 * `k_msgq` over `k_fifo` in ISR paths. Keep the `k_msgq`, but move PID sampling out of the ISR."*
 * — and the fact worth keeping is the lead instruction, stripped of the conversational wrapping
 * around it. The rule, in order:
 *
 * ```
 * 1. split into prose and inline-code spans (`…`, any backtick run, CommonMark's pairing)
 * 2. the lead: everything before the first sentence break in prose — `.` `!` `?` `;` followed by
 *    whitespace or the end, or a line break — never one inside a code span, and never the dot of
 *    a common abbreviation (e.g. i.e. etc. vs.)
 * 3. drop a leading list marker and conversational filler (please, note:, fyi:, remember to,
 *    we should, you should …) — the imperative is what is left
 * 4. collapse whitespace in prose; code spans are copied byte for byte
 * 5. capitalise the first prose letter; drop trailing punctuation
 * 6. refuse what cannot be a fact: nothing left, one word, or longer than {@link MAX_CANDIDATE_LENGTH}
 * ```
 *
 * Nothing here guesses intent: the rule is the same for every source, and a note that does not
 * lead with its point yields a candidate a person rejects — which is the review queue working.
 */

/** The longest candidate a proposer offers — the import's own bullet cap (BF.4). */
export const MAX_CANDIDATE_LENGTH = 200;

/** The fewest words a candidate may have — one word is a label, not a fact. */
export const MIN_CANDIDATE_WORDS = 2;

/** Why a text yields no candidate. */
export type ExtractionRefusal = "empty" | "too_short" | "too_long";

/** What {@link extractLeadInstruction} answers. */
export type Extraction =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly refusal: ExtractionRefusal };

/** One piece of a text: prose, or an inline-code span kept verbatim (backticks included). */
export interface TextSegment {
  readonly code: boolean;
  readonly text: string;
}

/**
 * Conversational filler before the instruction, matched case-insensitively at the very start,
 * repeatedly (*"Note: please …"*). Each is a whole-word prefix; what follows is the imperative.
 */
const FILLER: readonly RegExp[] = [
  /^(?:please|pls|kindly)\b[\s,]*/i,
  /^(?:note|nb|n\.b\.|fyi|tip|hint|heads[ -]up|correction|fix|reminder|remember|important)\s*[:\-–—]\s*/i,
  /^remember\s+(?:that|to)\s+/i,
  /^(?:i|we)\s+(?:think|believe|feel)\s+(?:that\s+)?/i,
  /^(?:we|you)\s+(?:should|must|need\s+to|have\s+to|ought\s+to)\s+/i,
  /^(?:going\s+forward|from\s+now\s+on|in\s+future|in\s+the\s+future)\s*,?\s*/i,
];

/** A leading bullet or ordinal: `- `, `* `, `• `, `1. `, `2) `. */
const LIST_MARKER = /^(?:[-*•+]|\d{1,3}[.)])\s+/;

/** Abbreviations whose dot is not a sentence break. Lower-case, dot included. */
const ABBREVIATIONS: readonly string[] = ["e.g.", "i.e.", "etc.", "vs.", "cf.", "approx.", "n.b."];

/**
 * Split a text into prose and inline-code spans. A span opens with a run of backticks and closes
 * at the next run of the same length (CommonMark); an unclosed run is prose.
 *
 * @param text - Any text.
 * @returns The segments, in order; concatenated they are the input exactly.
 */
export function splitCodeSpans(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let prose = "";
  let index = 0;

  while (index < text.length) {
    if (text[index] !== "`") {
      prose += text[index];
      index += 1;
      continue;
    }

    const run = /^`+/.exec(text.slice(index))?.[0] ?? "`";
    const close = findClosingRun(text, index + run.length, run.length);

    if (close === -1) {
      prose += run;
      index += run.length;
      continue;
    }

    if (prose !== "") segments.push({ code: false, text: prose });
    prose = "";
    segments.push({ code: true, text: text.slice(index, close + run.length) });
    index = close + run.length;
  }

  if (prose !== "") segments.push({ code: false, text: prose });

  return segments;
}

/**
 * Where a run of exactly `length` backticks starts, at or after `from`.
 *
 * @param text - The text.
 * @param from - Where to look from.
 * @param length - The opening run's length.
 * @returns The index, or -1.
 */
function findClosingRun(text: string, from: number, length: number): number {
  let index = from;

  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }

    const run = /^`+/.exec(text.slice(index))?.[0] ?? "`";

    if (run.length === length) return index;
    index += run.length;
  }

  return -1;
}

/**
 * The inline-code spans of a text, verbatim — what a candidate must carry unchanged.
 *
 * @param text - Any text.
 * @returns Every closed span, backticks included, in order.
 */
export function codeSpansOf(text: string): string[] {
  return splitCodeSpans(text)
    .filter((segment) => segment.code)
    .map((segment) => segment.text);
}

/**
 * The lead instruction of a note, a reason or a steer — the rule in this file's header.
 *
 * @param raw - The source's text, as a person wrote it.
 * @returns The candidate text, or why there is none.
 */
export function extractLeadInstruction(raw: string): Extraction {
  const lead = stripFiller(leadSentence(splitCodeSpans(raw.trim())));
  const text = finish(lead);

  if (text === "") return { ok: false, refusal: "empty" };
  if (wordCount(text) < MIN_CANDIDATE_WORDS) return { ok: false, refusal: "too_short" };
  if (text.length > MAX_CANDIDATE_LENGTH) return { ok: false, refusal: "too_long" };

  return { ok: true, text };
}

/**
 * The segments before the first sentence break in prose.
 *
 * @param segments - The whole text's segments.
 * @returns The lead's segments.
 */
function leadSentence(segments: readonly TextSegment[]): TextSegment[] {
  const lead: TextSegment[] = [];

  for (const segment of segments) {
    if (segment.code) {
      lead.push(segment);
      continue;
    }

    const cut = sentenceBreak(segment.text);

    if (cut === -1) {
      lead.push(segment);
      continue;
    }

    lead.push({ code: false, text: segment.text.slice(0, cut) });
    return lead;
  }

  return lead;
}

/**
 * Where the first sentence ends in a run of prose: a line break, or `. ! ? ;` followed by
 * whitespace or the end — not an abbreviation's dot, and not a break at the very start.
 *
 * @param prose - Prose only.
 * @returns The index the lead ends at (exclusive of the terminator), or -1.
 */
function sentenceBreak(prose: string): number {
  const pattern = /\r?\n|[.!?;](?=\s|$)/g;

  for (let match = pattern.exec(prose); match !== null; match = pattern.exec(prose)) {
    const before = prose.slice(0, match.index + 1).toLowerCase();

    if (match[0] === "." && ABBREVIATIONS.some((abbreviation) => before.endsWith(abbreviation))) {
      continue;
    }
    if (prose.slice(0, match.index).trim() === "") continue;

    return match.index;
  }

  return -1;
}

/**
 * Drop a leading list marker and conversational filler, repeatedly, from the first prose segment.
 *
 * @param segments - The lead's segments.
 * @returns The segments, the first prose one trimmed of its wrapping.
 */
function stripFiller(segments: readonly TextSegment[]): TextSegment[] {
  const [first, ...rest] = segments;

  if (first === undefined || first.code) return [...segments];

  let text = first.text.trimStart();

  for (let changed = true; changed;) {
    changed = false;
    for (const pattern of [LIST_MARKER, ...FILLER]) {
      const next = text.replace(pattern, "");

      if (next !== text) {
        text = next.trimStart();
        changed = true;
      }
    }
  }

  return text === "" ? rest : [{ code: false, text }, ...rest];
}

/**
 * Collapse prose whitespace, capitalise the first prose letter, drop trailing punctuation — and
 * copy every code span byte for byte.
 *
 * @param segments - The lead's segments.
 * @returns The candidate text.
 */
function finish(segments: readonly TextSegment[]): string {
  const pieces = segments.map((segment) =>
    segment.code ? segment.text : segment.text.replace(/\s+/g, " "),
  );
  let text = pieces.join("").trim();

  if (segments[0] !== undefined && !segments[0].code) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Trailing punctuation only when the text does not end inside a code span.
  const last = segments[segments.length - 1];

  if (last === undefined || !last.code || !text.endsWith(last.text)) {
    text = text.replace(/[\s.;:!?,]+$/, "");
  }

  return text;
}

/**
 * @param text - A candidate.
 * @returns How many whitespace-separated words it has.
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}
