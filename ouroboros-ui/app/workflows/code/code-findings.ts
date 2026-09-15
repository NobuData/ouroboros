/**
 * Publish findings, anchored in the code view — V.6 ([#174](https://github.com/NobuData/ouroboros/issues/174)).
 *
 * A refused publish answers S.6's `WorkflowFinding`s, anchored to stages — the canvas's vocabulary. The code
 * view has no canvas to select a stage on, so it anchors them in the file, through the one fact both share:
 * the file's span map, one entry per stage call in the document's node order.
 *
 * - **The shared dialog's list** reads each finding's stage with `publish.ts`' `findingAnchor`, over a
 *   definition holding only the file's stage ids ({@link outlineDefinition}) — all the anchor reads.
 * - **Selecting a finding** puts the editor's cursor on that stage ({@link stageRevealOf}).
 * - **Every finding is drawn in the editor** on its stage's lines ({@link findingDiagnostics}), placed as
 *   `ouroboros-rest`'s `code.diagnostics.ts` places **Validate**'s: from the stage call's first non-blank
 *   character to the end of its last line, and a finding about no stage on the `defineLoop(` line. So a
 *   refused publish and a validation underline the same lines.
 *
 * **Framework-free and pure**, like `code-panel.ts`.
 */

import type { CodeDiagnostic, WorkflowDefinition, WorkflowFinding } from "@/app/api/workflows";

import { findingAnchor } from "../publish";
import type { AnchoredDiagnostics, DiagnosticRange, RevealRequest } from "./code-diagnostics";
import { type AnchoredOutline, stageReveal } from "./code-panel";

/** How the printer opens every workflow file's one call. */
const DEFINE_LOOP = "export default defineLoop(";

/**
 * A definition carrying only what anchoring a finding reads: the stage ids, in node order.
 *
 * @param outline The file's span map and the text it counts, or `null` for a file with none.
 * @returns `{ nodes: [{ id }, …] }` — one node per span, so a `/nodes/N` pointer names the N-th stage call.
 */
export function outlineDefinition(outline: AnchoredOutline | null): WorkflowDefinition {
  return { nodes: (outline?.spans ?? []).map((span) => ({ id: span.node })) };
}

/**
 * The range a run of lines covers, clamped to the text.
 *
 * @param lines The text's lines.
 * @param startLine The first line, 1-based.
 * @param endLine The last line, 1-based.
 * @returns From the first line's first non-blank character to the end of the last line.
 */
function linesRange(lines: readonly string[], startLine: number, endLine: number): DiagnosticRange {
  const last = Math.max(lines.length, 1);
  const line = Math.min(Math.max(startLine, 1), last);
  const end = Math.min(Math.max(endLine, line), last);
  const indent = (lines[line - 1] ?? "").search(/\S/);

  return {
    line,
    column: indent === -1 ? 1 : indent + 1,
    endLine: end,
    endColumn: (lines[end - 1] ?? "").length + 1,
  };
}

/**
 * A refused publish's findings, as diagnostics on the lines of the stages they are about.
 *
 * @param findings The findings, in the service's order.
 * @param outline The file's span map, with the text its lines count.
 * @returns One `error` per finding, kept with the text it was placed in.
 */
export function findingDiagnostics(
  findings: readonly WorkflowFinding[],
  outline: AnchoredOutline,
): AnchoredDiagnostics {
  const definition = outlineDefinition(outline);
  const lines = outline.anchor.split("\n");
  const loop = lines.findIndex((text) => text.startsWith(DEFINE_LOOP));
  const loopLine = loop === -1 ? 1 : loop + 1;

  return {
    anchor: outline.anchor,
    items: findings.map((finding): CodeDiagnostic => {
      const node = findingAnchor(finding, definition);
      const span = node === null ? undefined : outline.spans.find((entry) => entry.node === node);

      return {
        severity: "error",
        range:
          span === undefined ? linesRange(lines, loopLine, loopLine) : linesRange(lines, span.startLine, span.endLine),
        code: finding.code,
        message: finding.message,
        ...(node === null ? {} : { node }),
      };
    }),
  };
}

/**
 * The request that puts the editor's cursor on a stage — a finding the reader selected.
 *
 * @param outline The file's span map, with the text its lines count.
 * @param node The stage's id.
 * @returns A new request at the stage call's first line, or `null` when no stage call has that id.
 */
export function stageRevealOf(outline: AnchoredOutline, node: string): RevealRequest | null {
  const span = outline.spans.find((entry) => entry.node === node);

  return span === undefined
    ? null
    : stageReveal(outline, { number: "", node, startLine: span.startLine, loop: null });
}
