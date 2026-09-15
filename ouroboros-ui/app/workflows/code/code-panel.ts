/**
 * Every decision the code view's right panel makes — V.5
 * ([#173](https://github.com/NobuData/ouroboros/issues/173)): mockup 05's `.rp`, with its **Loop
 * Checks**, its **Types** card and its **Outline**.
 *
 * ```
 * LOOP CHECKS  ✓ Graph acyclic except declared gate loop
 *              ✓ All task routes resolve   models configured for …
 * TYPES        route.task(name: TaskKind): ModelRoute        ← the symbol at the cursor, or nothing
 * OUTLINE      01 ▸ issue-queued … 11 ⟲ checks-green  back-edge → 07 · 12 ▸ open-pr
 * ```
 *
 * ### Nothing is drawn that was not observed
 *
 * - **Loop Checks are W.2's rows, and only the rows this module knows** ({@link LOOP_CHECK_IDS}).
 *   Mockup 05's third row, *pool-a has 1 runner offline*, reports build-farm state no subsystem here
 *   observes, so it is omitted rather than faked (decision **C7**). The service cannot build such a
 *   row, and should one ever arrive the panel still drops it: an infra row joins deliberately, with
 *   mockup 08's subsystem, by adding its id here.
 * - **The Types card is W.1's table or nothing.** The caller resolves the cursor with `hoverAt`; a
 *   symbol the table does not describe draws no card.
 * - **The outline is the file's own span map.** One row per stage call, in the document's node order,
 *   numbered from `01`. A stage whose call declares `onFail` — the loop edge, mockup 05's
 *   `gate.onFail` back-edge — is a loopback row whose note names the row each loop edge returns to.
 *
 * **Framework-free and pure**, like `code-view.ts`.
 */

import type { LoopCheckRow, NodeSpan, WorkflowCodeChecks } from "@/app/api/workflows";

import { type RevealRequest, lineStarts } from "./code-diagnostics";

/* ------------------------------------------------------------------ words */

/** The panel's accessible name — the mockup's `aria-label`. */
export const PANEL_LABEL = "Loop checks and outline";

/** The Loop Checks section's head. */
export const CHECKS_HEAD = "Loop Checks";

/** The Types section's head. */
export const TYPES_HEAD = "Types";

/** The Outline section's head. */
export const OUTLINE_HEAD = "Outline";

/** The narrow viewport's toggle, which shows and hides the panel below 1000px. */
export const PANEL_TOGGLE_LABEL = "Checks & outline";

/** The Loop Checks section when the rows could not be read. */
export const CHECKS_FAILED_TITLE = "Loop checks could not be read.";

/** The Loop Checks section when the service checked nothing it could report. */
export const CHECKS_EMPTY_NOTE = "Nothing was checked for this file.";

/** Said under the rows once the file has been saved since they were read. */
export const CHECKS_STALE_NOTE = "Checked before the latest save. Reload the page to check again.";

/** The Types section when the symbol table could not be read. */
export const SYMBOLS_FAILED_NOTE = "The symbol table could not be read.";

/** The Outline section for a file with no stage calls. */
export const OUTLINE_EMPTY_NOTE = "No stages in this file.";

/** What a check's glyph says to a screen reader, so hue and shape are never the only signal. */
export const CHECK_STATUS_WORDS: Readonly<Record<LoopCheckRow["status"], string>> = {
  ok: "passed",
  warn: "warning",
  err: "failed",
};

/** A normal outline row's glyph. */
export const STAGE_GLYPH = "▸";

/** A loopback row's glyph. */
export const LOOPBACK_GLYPH = "⟲";

/**
 * An outline row's tooltip.
 *
 * @param node The stage's id.
 * @returns `Go to analyze in the file`.
 */
export function jumpToStageTitle(node: string): string {
  return `Go to ${node} in the file`;
}

/* ------------------------------------------------------------------ loop checks */

/** Every Loop Checks row the panel draws, in the service's order. No infra row (decision C7). */
export const LOOP_CHECK_IDS: readonly LoopCheckRow["id"][] = ["graph", "references"];

/**
 * The rows the panel draws.
 *
 * @param checks The service's Loop Checks.
 * @returns Its rows whose id is one of {@link LOOP_CHECK_IDS}, in its order. Any other row — an infra
 *   row above all — is dropped rather than drawn (C7).
 */
export function drawnCheckRows(checks: WorkflowCodeChecks): readonly LoopCheckRow[] {
  return checks.rows.filter((row) => LOOP_CHECK_IDS.includes(row.id));
}

/**
 * Whether the rows are about an older file than the draft the page now holds.
 *
 * @param checks The service's Loop Checks.
 * @param etag The draft's etag as the page last knew it — the read's, then each save's.
 * @returns `true` once a save has moved the draft past the file the rows were derived from.
 */
export function checksStale(checks: WorkflowCodeChecks, etag: string | null): boolean {
  return etag !== null && checks.etag !== etag;
}

/* ------------------------------------------------------------------ the outline */

/** Where one loop edge returns to. */
export interface LoopTarget {
  /** The stage id `onFail` names. */
  readonly node: string;
  /** That stage's row number, or `null` when no stage call in the file has that id. */
  readonly number: string | null;
}

/** One row of the outline. */
export interface OutlineRow {
  /** Its position, two digits from `01`. */
  readonly number: string;
  /** The stage's id. */
  readonly node: string;
  /** The 1-based line its call opens on, in the text the spans were counted in. */
  readonly startLine: number;
  /** Where its loop edges return to, or `null` for a stage that declares none. */
  readonly loop: readonly LoopTarget[] | null;
}

/** A span map, with the text it was counted in. */
export interface AnchoredOutline {
  /** The text the spans' lines count. */
  readonly anchor: string;
  /** Each stage call's lines, in the document's node order. */
  readonly spans: readonly NodeSpan[];
}

/** An option line `onFail:` opens, with the indentation before it and what follows it. */
const ON_FAIL_LINE = /^(\s*)onFail:\s*(.*)$/;

/** The first identifier-in-quotes of `onFail: "implement",`. */
const QUOTED_ID = /^"([^"]*)"/;

/** Each `to: "id"` of `onFail: [{ to: "a" }, …]`. */
const TO_ID = /\bto:\s*"([^"]*)"/g;

/**
 * A row number.
 *
 * @param index The row's position, from 0.
 * @returns `01` for 0, `12` for 11, `100` for 99.
 */
export function rowNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * The stage ids a stage call's loop edges return to.
 *
 * The printer writes every option of a call on its own line, two spaces deeper than the call, and
 * `onFail` last (`docs/WORKFLOW_CODE_DSL.md` §7): `onFail: "implement",` for the one idiomatic loop
 * edge, or a list of `{ to: "id" }` entries. **Only a line at the option depth counts**, so a prompt
 * whose text happens to hold `onFail:` — a template literal's lines keep no indentation of their own —
 * declares nothing.
 *
 * @param lines The file's lines.
 * @param span The stage call's lines.
 * @returns The ids, in the order written; empty for a stage with no loop edge.
 */
export function loopTargetsIn(lines: readonly string[], span: NodeSpan): readonly string[] {
  const first = Math.max(span.startLine, 1) - 1;
  const last = Math.min(span.endLine, lines.length) - 1;
  if (first > last) return [];

  const callIndent = /^\s*/.exec(lines[first] ?? "")?.[0].length ?? 0;

  for (let index = last; index > first; index -= 1) {
    const match = ON_FAIL_LINE.exec(lines[index] ?? "");
    if (match === null || match[1].length !== callIndent + 2) continue;

    const single = QUOTED_ID.exec(match[2]);
    if (single !== null) return [single[1]];

    const rest = [match[2], ...lines.slice(index + 1, last + 1)].join("\n");
    return [...rest.matchAll(TO_ID)].map((entry) => entry[1]);
  }

  return [];
}

/**
 * The outline of a file.
 *
 * @param outline The file's span map and the text it was counted in.
 * @returns One row per span, in its order.
 */
export function outlineRows(outline: AnchoredOutline): readonly OutlineRow[] {
  const lines = outline.anchor.split("\n");
  // A repeated id keeps its first row, as the symbol index keeps a symbol's first entry.
  const numbers = new Map<string, string>();
  outline.spans.forEach((span, index) => {
    if (!numbers.has(span.node)) numbers.set(span.node, rowNumber(index));
  });

  return outline.spans.map((span, index) => {
    const targets = loopTargetsIn(lines, span);

    return {
      number: rowNumber(index),
      node: span.node,
      startLine: span.startLine,
      loop:
        targets.length === 0
          ? null
          : targets.map((node) => ({ node, number: numbers.get(node) ?? null })),
    };
  });
}

/**
 * A loopback row's note.
 *
 * @param targets Where its loop edges return to.
 * @returns `back-edge → 07`; `back-edge → 07 · 09` for two; a target no row has is named by its id.
 */
export function backEdgeNote(targets: readonly LoopTarget[]): string {
  return `back-edge → ${targets.map((target) => target.number ?? target.node).join(" · ")}`;
}

/**
 * The request that puts the cursor at the start of a stage call and scrolls it into view.
 *
 * @param outline The span map the row was drawn from.
 * @param row The row.
 * @returns A new request — the editor acts on each request object once — at the call's first
 *   column, counted in the outline's text and placed by the editor in the text on screen.
 */
export function stageReveal(outline: AnchoredOutline, row: OutlineRow): RevealRequest {
  const line = Math.min(Math.max(row.startLine, 1), lineStarts(outline.anchor).length);

  return { anchor: outline.anchor, range: { line, column: 1, endLine: line, endColumn: 1 } };
}
