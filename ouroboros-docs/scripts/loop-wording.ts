/**
 * The loop-wording guard (DG.4, #1322): the loop runs for real, so a page may say "simulated"
 * only where `loop-wording.allow.json` says it may — the run simulator (a test tool), the data
 * origin it stamps, or a feature that really does simulate (a workflow dry run). This module
 * reads and compares; `scripts/check-loop-wording.ts` is the command.
 *
 * An allow-list entry is a phrase and the pages it may appear on. An occurrence of the word is
 * allowed when it lies inside one of those phrases on its own line — so a line that names the
 * simulator once and the loop "simulated" again still fails on the second. An entry that matches
 * nothing on one of its pages is stale and fails too, so the list cannot outlive its reasons.
 */

/** The word the guard looks for, in any case. */
export const WORD = /simulated/gi;

/** One allow-list entry. */
export interface AllowEntry {
  /** The phrase an occurrence must lie inside, matched exactly (case included). */
  text: string;
  /** Page paths under `docs/` the phrase may appear on. */
  files: string[];
  /** Why the phrase is true — required, so an exception explains itself in review. */
  reason: string;
}

/** An occurrence the allow-list does not cover. */
export interface Occurrence {
  /** Page path under `docs/`. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The line's text. */
  text: string;
}

/**
 * Parses and validates the allow-list file.
 *
 * @param raw the file's JSON text.
 * @returns the entries.
 * @throws Error naming the first malformed entry.
 */
export function parseAllowList(raw: string): AllowEntry[] {
  const parsed = JSON.parse(raw) as { entries?: unknown };
  if (!Array.isArray(parsed.entries)) throw new Error('the allow-list has no "entries" array');
  return parsed.entries.map((e: unknown, i) => {
    const entry = e as Partial<AllowEntry>;
    const ok =
      typeof entry.text === "string" &&
      WORD.test(entry.text) &&
      Array.isArray(entry.files) &&
      entry.files.length > 0 &&
      entry.files.every((f) => typeof f === "string" && f.length > 0) &&
      typeof entry.reason === "string" &&
      entry.reason.trim().length > 0;
    WORD.lastIndex = 0;
    if (!ok) {
      throw new Error(
        `allow-list entry ${String(i + 1)} needs a "text" containing the word, a non-empty "files" list and a "reason"`,
      );
    }
    return entry as AllowEntry;
  });
}

/**
 * Every index range on a line covered by an entry's phrase.
 *
 * @param line the line's text.
 * @param phrases the phrases allowed on this line's page.
 * @returns `[start, end)` ranges.
 */
function coveredRanges(line: string, phrases: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const phrase of phrases) {
    for (let at = line.indexOf(phrase); at !== -1; at = line.indexOf(phrase, at + 1)) {
      ranges.push([at, at + phrase.length]);
    }
  }
  return ranges;
}

/**
 * Compares the pages with the allow-list.
 *
 * @param pages page path under `docs/` → its text.
 * @param entries the allow-list.
 * @returns the occurrences no entry covers, and each `file: text` pair that matched nothing.
 */
export function checkWording(
  pages: Map<string, string>,
  entries: AllowEntry[],
): { occurrences: Occurrence[]; stale: string[] } {
  const used = new Set<string>();
  const occurrences: Occurrence[] = [];
  for (const [file, content] of pages) {
    const mine = entries.filter((e) => e.files.includes(file));
    content.split("\n").forEach((text, i) => {
      for (const e of mine) if (text.includes(e.text)) used.add(`${file}: ${e.text}`);
      const ranges = coveredRanges(
        text,
        mine.map((e) => e.text),
      );
      for (const match of text.matchAll(WORD)) {
        const start = match.index;
        const end = start + match[0].length;
        if (!ranges.some(([a, b]) => a <= start && end <= b)) {
          occurrences.push({ file, line: i + 1, text: text.trim() });
          break;
        }
      }
    });
  }
  const stale = entries.flatMap((e) =>
    e.files.map((f) => `${f}: ${e.text}`).filter((pair) => !used.has(pair)),
  );
  return { occurrences, stale };
}
