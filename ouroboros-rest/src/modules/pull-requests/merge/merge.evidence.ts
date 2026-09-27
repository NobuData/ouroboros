/**
 * The evidence summary the merge executor publishes on the host PR — decision **V9**: *the plane
 * must not be a silo*.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)). Reviewers live on the host, so
 * what Ouroboros knows about the PR — the gate table, the criteria matrix and the spend — goes
 * there as one comment:
 *
 * ```
 * ### Ouroboros evidence summary
 * Revision 2 · `c81d3e4` · 7 of 7 required gates satisfied
 *
 * | Gate | Verdict | Evidence |
 * |---|---|---|
 * | Build | green | forge-01 · flash 187.2 KB / 256 KB |
 * …
 *
 * **Acceptance criteria** — 4 verified · 1 waived · 0 unverified
 * - verified — Frames arrive in the order they were queued
 * - waived — Flake must not reappear across temperature range (rig runs at 22°C only)
 *
 * **Spend** — 412,301 tokens in · 38,112 out · $4.12
 * **Ticket** — #482 closed
 * **Merged** — squash · `9a1f0c2` · as `ken-s`
 *
 * <!-- ouroboros:pr-comment evidence-summary -->   ← added by the SPI
 * ```
 *
 * **Edited, not re-posted.** Every publish uses {@link EVIDENCE_COMMENT_KEY}, so the SPI's
 * `commentPR` edits the one comment its marker finds (AX.1's discipline, #357) — a PR carries one
 * evidence summary, however often it is republished.
 *
 * **No line of it can be a marker.** Everything a person or a provider wrote is folded onto one
 * line and sits after a fixed prefix — a table cell's `| `, a list item's `- ` — so no line can
 * equal another key's marker and hijack its comment. Cells escape `|` so a claim cannot break the
 * table. The criteria list is bounded, so a PR with hundreds of claims cannot exceed the host's
 * comment limit.
 *
 * Pure.
 */

import type { PrCriterionStatus, PrGateVerdict } from "../../db/schema";
import type { SpendTotals } from "../../runs/run.spend";
import type { TicketClosure } from "./merge.actions";

/** The comment key — one evidence summary per PR. */
export const EVIDENCE_COMMENT_KEY = "evidence-summary";

/** How many criteria the summary lists before saying how many more there are. */
export const MAX_LISTED_CRITERIA = 50;

/** The longest a cell or list item is allowed to be. */
export const MAX_SUMMARY_TEXT = 200;

/** One row of the gate table. */
export interface SummaryGate {
  /** The card's label — `Physical HIL`. */
  readonly label: string;
  /** Whether it is required. */
  readonly required: boolean;
  /** The latest verdict on the revision, or null when never evaluated. */
  readonly verdict: PrGateVerdict | null;
  /** Its evidence line, or null. */
  readonly evidence: string | null;
}

/** One criterion. */
export interface SummaryCriterion {
  /** The quoted claim. */
  readonly claim: string;
  /** Where it stands. */
  readonly status: PrCriterionStatus;
  /** Why it was waived, when it was. */
  readonly waiverReason: string | null;
}

/** How the merge landed, once it has. */
export interface SummaryMerge {
  /** `squash`, `merge` or `rebase`. */
  readonly strategy: string;
  /** The merge commit. */
  readonly sha: string;
  /** Who the host recorded. */
  readonly identity: string;
}

/** Everything one summary says. */
export interface EvidenceSummary {
  /** The revision summarized. */
  readonly revision: { readonly seq: number; readonly headSha: string };
  /** The gate table, in card order. */
  readonly gates: readonly SummaryGate[];
  /** The criteria matrix, in matrix order. */
  readonly criteria: readonly SummaryCriterion[];
  /** The run's spend, or null for a PR no run opened. */
  readonly spend: SpendTotals | null;
  /** The canonical ticket's closure, or null for a PR without one. */
  readonly ticket: TicketClosure | null;
  /** The merge, or null before one. */
  readonly merge: SummaryMerge | null;
}

/** The verdicts that satisfy a required gate — V056's aggregate. */
const SATISFYING: ReadonlySet<PrGateVerdict> = new Set(["green", "waived", "not_required"]);

/**
 * The summary's Markdown, without the marker — the SPI appends it.
 *
 * @param summary - What to say.
 * @returns The body.
 */
export function evidenceSummaryBody(summary: EvidenceSummary): string {
  const required = summary.gates.filter((gate) => gate.required);
  const satisfied = required.filter(
    (gate) => gate.verdict !== null && SATISFYING.has(gate.verdict),
  ).length;
  const lines = [
    "### Ouroboros evidence summary",
    `Revision ${String(summary.revision.seq)} · \`${summary.revision.headSha.slice(0, 7)}\` · ` +
      `${String(satisfied)} of ${String(required.length)} required gates satisfied`,
    "",
    ...gateTable(summary.gates),
    "",
    ...criteriaLines(summary.criteria),
    "",
    `**Spend** — ${spendLine(summary.spend)}`,
  ];

  if (summary.ticket !== null) {
    lines.push(
      `**Ticket** — ${
        summary.ticket.closed
          ? `${cell(summary.ticket.key)} closed`
          : `${cell(summary.ticket.key)} not closed: ${cell(summary.ticket.detail ?? "")}`
      }`,
    );
  }

  if (summary.merge !== null) {
    lines.push(
      `**Merged** — ${cell(summary.merge.strategy)} · \`${summary.merge.sha.slice(0, 7)}\` · ` +
        `as \`${cell(summary.merge.identity).replace(/`/g, "'")}\``,
    );
  }

  return lines.join("\n");
}

/**
 * @param gates - The gates.
 * @returns The table's lines.
 */
function gateTable(gates: readonly SummaryGate[]): string[] {
  if (gates.length === 0) {
    return ["_No gates are defined for this PR yet._"];
  }

  return [
    "| Gate | Verdict | Evidence |",
    "|---|---|---|",
    ...gates.map(
      (gate) =>
        `| ${cell(gate.label)}${gate.required ? "" : " (advisory)"} | ` +
        `${gate.verdict ?? "not evaluated"} | ${cell(gate.evidence ?? "—")} |`,
    ),
  ];
}

/**
 * @param criteria - The criteria.
 * @returns The heading line and one line per listed criterion.
 */
function criteriaLines(criteria: readonly SummaryCriterion[]): string[] {
  const count = (status: PrCriterionStatus): number =>
    criteria.filter((criterion) => criterion.status === status).length;
  const heading =
    `**Acceptance criteria** — ${String(count("verified"))} verified · ` +
    `${String(count("waived"))} waived · ${String(count("unverified"))} unverified`;

  if (criteria.length === 0) {
    return ["**Acceptance criteria** — none recorded"];
  }

  const listed = criteria.slice(0, MAX_LISTED_CRITERIA).map((criterion) => {
    const reason =
      criterion.status === "waived" && criterion.waiverReason !== null
        ? ` (${cell(criterion.waiverReason)})`
        : "";

    return `- ${criterion.status} — ${cell(criterion.claim)}${reason}`;
  });
  const more = criteria.length - listed.length;

  return [heading, ...listed, ...(more > 0 ? [`- … and ${String(more)} more`] : [])];
}

/**
 * The spend line — tokens, and the cost only when something was priced (decisions M7/N10:
 * unpriced is not free).
 *
 * @param spend - The run's totals, or null.
 * @returns The line.
 */
export function spendLine(spend: SpendTotals | null): string {
  if (spend === null) {
    return "no run is attributed to this PR";
  }

  const tokens =
    `${spend.tokensIn.toLocaleString("en-US")} tokens in · ` +
    `${spend.tokensOut.toLocaleString("en-US")} out`;

  if (spend.costCents === null) {
    return `${tokens} · not priced`;
  }

  const dollars = `$${(Number(spend.costCents) / 100).toFixed(2)}`;
  const unpriced =
    spend.unpricedEvents > 0
      ? ` (at least — ${String(spend.unpricedEvents)} unpriced ${
          spend.unpricedEvents === 1 ? "event" : "events"
        })`
      : "";

  return `${tokens} · ${dollars}${unpriced}`;
}

/**
 * Text fit for one table cell or list item: one line, pipes escaped, bounded.
 *
 * @param text - What a person or provider wrote.
 * @returns The text, folded.
 */
function cell(text: string): string {
  const folded = text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");

  return folded.length <= MAX_SUMMARY_TEXT ? folded : `${folded.slice(0, MAX_SUMMARY_TEXT - 1)}…`;
}
