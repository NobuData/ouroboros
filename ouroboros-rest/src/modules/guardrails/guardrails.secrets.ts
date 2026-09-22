/**
 * The secrets scan — the embedded ruleset run over a change-set's reported diff hunks.
 *
 * AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)), option **3-A**. Three rules
 * shape this file, and each is a place a well-meaning change could quietly break the guarantee.
 *
 * **1. Only added lines are scanned.** A hunk's `ctx` lines were already in the repository and
 * its `del` lines are leaving it; neither is something *this run* introduced, and a verdict that
 * failed a run for a credential it deleted would be a verdict telling somebody to undo the fix.
 *
 * **2. A finding is a place and a rule — never a value.** {@link SecretFinding} has no field a
 * match could be put in: the scanner reads the matched text only to decide whether it is a
 * placeholder, and returns `{path, line, ruleId}`. Decision **R5** and V048's constraints are the
 * backstop; this is the first line.
 *
 * **3. Hunks are scanned in memory and stored nowhere.** They arrive on the change-set report,
 * are read here, and are dropped with the request. The receipt that makes the report idempotent
 * stores a SHA-256 of the body and the *answer*, and the answer carries counts.
 *
 * ---------------------------------------------------------------------------
 * **Line numbers.** A hunk reports `newStart` — the line in the *new* file its first line sits
 * at — and the scan counts forward through it: `ctx` and `add` lines occupy a line of the new
 * file and advance the counter, `del` lines do not exist there and do not. That is `git diff`'s
 * own arithmetic, so the line an evidence row names is the line an editor opens at.
 *
 * **Speed.** The ≤ 50 ms criterion is a statement about a whole report, and roughly 150 rules
 * over every added line would miss it. So each file's added text is lower-cased **once** and
 * each rule's keywords are checked against it first; a rule none of whose keywords appear in the
 * file never runs a regular expression at all, which is almost every rule for almost every file.
 */

import type { GuardrailFile, GuardrailHunk, GuardrailHunkLine } from "../ingest/ingest.guardrails";
import {
  PROXIMITY_WINDOW,
  SECRET_RULES,
  isCandidateValue,
  type SecretRule,
} from "./guardrails.ruleset";

/**
 * The change-set's shapes, as the scan reads them — the ingestion seam's own types, named for
 * what this file does with them.
 */
export type ScannedLine = GuardrailHunkLine;
/** One reported hunk. */
export type ScannedHunk = GuardrailHunk;
/** One file of a change-set. Absent or empty `hunks` is *nothing to scan*, not *clean*. */
export type ScannedFile = GuardrailFile;

/** Where a rule fired. **Never what it matched.** */
export interface SecretFinding {
  /** The file. */
  readonly path: string;
  /** The new-file line, from 1. */
  readonly line: number;
  /** The rule's id — the evidence's `rule_id`. */
  readonly ruleId: string;
}

/** What scanning a change-set produced. */
export interface SecretScan {
  /**
   * Whether any file carried hunks at all.
   *
   * `false` is the difference between *"scanned, found nothing"* and *"had nothing to scan"* —
   * the second is `not_applicable`, because a pass on a change-set whose content was never seen
   * would be a green tick for a scan that did not happen.
   */
  readonly scanned: boolean;
  /** How many added lines were read. */
  readonly linesScanned: number;
  /** Every finding, ordered by path, then line, then rule id. At most one per rule per line. */
  readonly findings: readonly SecretFinding[];
}

/** One added line, with the new-file line number it sits at. */
interface AddedLine {
  readonly line: number;
  readonly text: string;
}

/**
 * The added lines of a file's hunks, numbered.
 *
 * @param hunks - The file's hunks.
 * @returns Every `add` line with its new-file line number.
 */
export function addedLines(hunks: readonly ScannedHunk[]): AddedLine[] {
  const added: AddedLine[] = [];

  for (const hunk of hunks) {
    let line = hunk.newStart;

    for (const entry of hunk.lines) {
      if (entry.kind === "del") {
        continue;
      }

      if (entry.kind === "add") {
        added.push({ line, text: entry.text });
      }

      line += 1;
    }
  }

  return added;
}

/**
 * Does a line contain one of a rule's keywords within the proximity window before a match?
 *
 * @param lowered - The line, lower-cased.
 * @param index - Where the match starts.
 * @param keywords - The rule's keywords, lower-case.
 * @returns `true` when a keyword starts within {@link PROXIMITY_WINDOW} characters before the
 *   match (or overlaps its start).
 */
function keywordNear(lowered: string, index: number, keywords: readonly string[]): boolean {
  const window = lowered.slice(Math.max(0, index - PROXIMITY_WINDOW), index + 1);

  return keywords.some((keyword) => window.includes(keyword));
}

/**
 * Does one rule fire on one line?
 *
 * @param rule - The rule.
 * @param text - The line.
 * @param lowered - The line, lower-cased once by the caller.
 * @returns `true` at the first qualifying match. The match itself is read only to test
 *   proximity and placeholders, and is not returned.
 */
function ruleFires(rule: SecretRule, text: string, lowered: string): boolean {
  if (!rule.keywords.some((keyword) => lowered.includes(keyword))) {
    return false;
  }

  // A fresh iterator per call: `pattern` is global, and sharing its `lastIndex` across lines
  // would make a match on one line skip the start of the next.
  for (const match of text.matchAll(rule.pattern)) {
    if (rule.proximity && !keywordNear(lowered, match.index, rule.keywords)) {
      continue;
    }

    if (rule.valueGroup !== undefined) {
      const value = match[rule.valueGroup];

      if (value === undefined || !isCandidateValue(value)) {
        continue;
      }
    }

    return true;
  }

  return false;
}

/**
 * Scan a change-set's reported hunks with the embedded ruleset.
 *
 * @param files - The change-set. Files without hunks are skipped.
 * @param rules - The ruleset. Defaults to {@link SECRET_RULES}; a parameter so the spec can
 *   drive a rule in isolation.
 * @returns Whether anything was scanned, how much, and every finding — as places and rule ids.
 */
export function scanChangeSet(
  files: readonly ScannedFile[],
  rules: readonly SecretRule[] = SECRET_RULES,
): SecretScan {
  const findings: SecretFinding[] = [];
  let scanned = false;
  let linesScanned = 0;

  for (const file of files) {
    if (file.hunks === undefined || file.hunks.length === 0) {
      continue;
    }

    scanned = true;
    const added = addedLines(file.hunks);
    linesScanned += added.length;

    // The prefilter: one lower-cased copy of the file's added text, and only the rules one of
    // whose keywords it contains are run line by line.
    const fileText = added
      .map((entry) => entry.text)
      .join("\n")
      .toLowerCase();
    const candidates = rules.filter((rule) =>
      rule.keywords.some((keyword) => fileText.includes(keyword)),
    );

    if (candidates.length === 0) {
      continue;
    }

    for (const entry of added) {
      const lowered = entry.text.toLowerCase();

      for (const rule of candidates) {
        if (ruleFires(rule, entry.text, lowered)) {
          findings.push({ path: file.path, line: entry.line, ruleId: rule.id });
        }
      }
    }
  }

  findings.sort(
    (a, b) => compare(a.path, b.path) || a.line - b.line || compare(a.ruleId, b.ruleId),
  );

  return { scanned, linesScanned, findings };
}

/**
 * Order two strings by code unit — locale-independent, so the order is the same everywhere.
 *
 * @param a - One.
 * @param b - The other.
 * @returns Negative, zero or positive.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
