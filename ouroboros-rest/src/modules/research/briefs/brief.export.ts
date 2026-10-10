/**
 * **Export brief ↗** — a brief as one Markdown document (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)).
 *
 * The export is a second surface with the first one's obligations: it is rendered from the same
 * {@link BriefDocument} the card is, so every marker in its body is the label the panel shows,
 * and every label has a numbered source below it with its locator and when it was retrieved.
 *
 *   # RS-127 — Autonomous docking vs. Skylink / AeroMesh / Novum
 *   ## Brief                    paragraphs; markers inline — `…published spec.[07]`
 *   ### Open questions          what could not be cited, listed apart from the findings
 *   ## Capability matrix        a table, each cell with its markers; then every gap's derivation
 *   ## Proposed from gaps       the epic and the ticket stubs
 *   ## Sources                  - [07] Title — `locator` — retrieved 2026-10-07T12:07:00.000Z
 *   ---
 *   _Provenance: investigation RS-127 · researcher loop-v1 · alias … · brief v1 · 2026-10-07_
 *
 * **It is machine input too** (#624 feeds it to the `create-roadmap` skill), so the two things a
 * reader has to find are fixed: a marker is `[` label `]`, and a source is one list line under
 * `## Sources` in the shape above. {@link readBriefExport} reads them back, and the suite holds
 * the pair to a round trip.
 *
 * Nothing here depends on when it runs: the footer's date is the brief's, not the clock's, so
 * exporting twice yields the same bytes.
 */

import type { ParagraphResource, SpanResource } from "./brief.read-model";
import type { BriefDocument, MatrixResource } from "./brief.resources";
import type { GapProposals } from "./gap-proposals";

/** The media type the export is served as. */
export const BRIEF_EXPORT_MEDIA_TYPE = "text/markdown; charset=utf-8";

/** The heading the numbered source list sits under. */
export const SOURCES_HEADING = "## Sources";

/** A source line of an export, read back. */
export interface ExportedSource {
  /** `[07]`. */
  readonly label: string;
  readonly title: string;
  readonly locator: string;
  /** ISO 8601. */
  readonly retrievedAt: string;
}

/** What {@link readBriefExport} finds in an export. */
export interface ExportedCitations {
  /** Every marker outside the source list, in reading order, repeats included. */
  readonly markers: readonly string[];
  readonly sources: readonly ExportedSource[];
}

const MARKER = /\[(?:\d{2,}|[A-Za-z][A-Za-z0-9_-]*)\]/g;
const SOURCE_LINE = /^- (\[[^\]]+\]) (.*) — `([^`]+)` — retrieved (\S+)$/;

/**
 * The file name an export downloads as.
 *
 * @param displayId - `RS-127`.
 * @returns `RS-127-brief.md`.
 */
export function exportFilename(displayId: string): string {
  return `${displayId}-brief.md`;
}

/**
 * Render a brief as Markdown.
 *
 * @param document - The brief and its whole ledger.
 * @returns The document, ending in a newline.
 */
export function exportBrief(document: BriefDocument): string {
  const { brief, ledger } = document;
  const { investigation } = brief;

  const lines: string[] = [
    `# ${investigation.displayId} — ${inline(investigation.question)}`,
    "",
    `> ${investigation.kindLabel} · ${investigation.depth.replaceAll("_", " ")} · ` +
      `${brief.sources.cited.toString()} sources · brief v${brief.brief.version.toString()}`,
    "",
    "## Brief",
    "",
    ...bodyLines(brief.brief.paragraphs),
  ];

  if (brief.matrix !== null) lines.push(...matrixLines(brief.matrix));
  if (brief.proposed !== null) lines.push(...proposedLines(brief.proposed));

  lines.push(SOURCES_HEADING, "");
  for (const source of ledger) {
    lines.push(
      `- ${source.label} ${inline(source.title).replaceAll("`", "'")} — ` +
        `\`${source.locator.replaceAll("`", "%60")}\` — retrieved ${source.retrievedAt}`,
    );
  }

  lines.push(
    "",
    "---",
    "",
    `_Provenance: investigation ${investigation.displayId} · ` +
      `researcher ${brief.provenance.researcher ?? "unknown"} · ` +
      `alias ${brief.provenance.alias ?? "unknown"} · ` +
      `brief v${brief.brief.version.toString()} · ${brief.brief.createdAt.slice(0, 10)}_`,
    "",
  );

  return lines.join("\n");
}

/**
 * Read an export's citations back.
 *
 * @param markdown - A document {@link exportBrief} rendered.
 * @returns The markers its body and matrix carry, and its numbered sources.
 */
export function readBriefExport(markdown: string): ExportedCitations {
  const at = markdown.indexOf(`\n${SOURCES_HEADING}\n`);
  const before = at < 0 ? markdown : markdown.slice(0, at);
  const after = at < 0 ? "" : markdown.slice(at);

  const sources: ExportedSource[] = [];
  for (const line of after.split("\n")) {
    const match = SOURCE_LINE.exec(line);
    if (match === null) continue;
    sources.push({ label: match[1], title: match[2], locator: match[3], retrievedAt: match[4] });
  }

  return { markers: before.match(MARKER) ?? [], sources };
}

/**
 * @param paragraphs - The brief's paragraphs.
 * @returns The findings as paragraphs, then the open questions as a list of their own.
 */
function bodyLines(paragraphs: readonly ParagraphResource[]): string[] {
  const lines: string[] = [];
  const questions: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.kind === "open_questions") {
      questions.push(...paragraph.spans.map((span) => `- ${spanText(span).trim()}`));
      continue;
    }
    const text = paragraph.spans
      .map((span) =>
        span.claim?.type === "open_question"
          ? `${spanText(span)} _(open question)_`
          : spanText(span),
      )
      .join("");
    lines.push(text.trim(), "");
  }

  if (questions.length > 0) lines.push("### Open questions", "", ...questions, "");
  return lines;
}

/**
 * @param span - A span.
 * @returns Its text — code references in backticks — followed by its markers.
 */
function spanText(span: SpanResource): string {
  const text = span.segments
    .map((segment) =>
      segment.kind === "code" ? `\`${segment.text}\`` : inline(segment.text, false),
    )
    .join("");

  return text + span.cites.map((cite) => cite.label).join("");
}

/**
 * @param matrix - The matrix.
 * @returns A table — each cell with its markers — and every gap's derivation below it.
 */
function matrixLines(matrix: MatrixResource): string[] {
  const head = [
    "Capability",
    ...matrix.columns.map((column) => (column.us ? `${column.label} (us)` : column.label)),
    "Gap",
  ];

  return [
    "## Capability matrix",
    "",
    `**${inline(matrix.title)}**`,
    "",
    `| ${head.map(cell).join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...matrix.rows.map(
      (row) =>
        `| ${[
          row.capability,
          ...row.cells.map((value) =>
            [`${value.glyph} ${value.label}`, value.cites.map((cite) => cite.label).join("")]
              .filter((part) => part !== "")
              .join(" "),
          ),
          row.gap.label,
        ]
          .map(cell)
          .join(" | ")} |`,
    ),
    "",
    "### How each gap was derived",
    "",
    ...matrix.rows.map(
      (row) => `- **${inline(row.capability)} — ${row.gap.label}.** ${inline(row.gap.derivation)}`,
    ),
    "",
  ];
}

/**
 * @param proposed - The proposal.
 * @returns The epic and every ticket stub, each with the gap it closes.
 */
function proposedLines(proposed: GapProposals): string[] {
  const effort = proposed.effort === null ? "" : ` — effort ${proposed.effort.toUpperCase()}`;

  return [
    "## Proposed from gaps",
    "",
    `- ${inline(proposed.epic.label)}${effort}`,
    ...proposed.tickets.map(
      (ticket) =>
        `- ${inline(ticket.label)} — closes “${inline(ticket.capability)}” ` +
        `(${ticket.severity.toUpperCase()})` +
        (ticket.effort === null ? "" : ` — ${ticket.effort.toUpperCase()}`),
    ),
    "",
  ];
}

/**
 * @param text - Text bound for one Markdown line.
 * @param trim - Whether to drop leading and trailing whitespace too.
 * @returns It, with every run of whitespace — line breaks included — as one space.
 */
function inline(text: string, trim = true): string {
  const collapsed = text.replace(/\s+/g, " ");
  return trim ? collapsed.trim() : collapsed;
}

/**
 * @param text - A table cell's text.
 * @returns It on one line, with the column separator escaped.
 */
function cell(text: string): string {
  return inline(text).replaceAll("|", "\\|");
}
