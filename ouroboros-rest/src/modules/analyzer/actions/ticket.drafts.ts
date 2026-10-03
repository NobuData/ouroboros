/**
 * A suggestion as a ticket draft (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514),
 * decision A5) — the title and body an AK draft batch stores, built only from what the composer
 * stored: the evidence line goes into the body verbatim and every evidence reference the cited
 * findings carry is listed so a reader can resolve it.
 *
 * A **spike** drafts an investigation, not an implementation: its body states what the analyzer
 * could not quantify and why, and asserts no impact — *"the honest output is a spike, not a smaller
 * number"* (V081).
 */

import type { SuggestionRow } from "./actions.repository";

/** A draft as `BatchesService.compose` takes it. */
export interface TicketDraft {
  localKey: string;
  title: string;
  body: string;
}

/** The longest title V034 stores. */
const TITLE_MAX = 512;

/** Each draft's key in the batch: `BA-1`, `BA-2` — mockup 18's drafted-tickets card. */
export const DRAFT_KEY_PREFIX = "BA";

/**
 * The evidence section: one line per reference, `kind id`, in a stable order.
 *
 * @param suggestion - The suggestion.
 * @returns Markdown lines, or a line saying there are none.
 */
function references(suggestion: SuggestionRow): string[] {
  const refs = [...suggestion.evidence_refs].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
  return refs.length === 0
    ? ["- (the cited findings carry no references)"]
    : refs.map((ref) => `- ${ref.kind} \`${ref.id}\``);
}

/**
 * Draft one suggestion.
 *
 * @param suggestion - A ticket-draft or spike suggestion.
 * @param ordinal - Its 1-based place in the batch.
 * @returns The draft.
 */
export function ticketDraftOf(suggestion: SuggestionRow, ordinal: number): TicketDraft {
  const provenance =
    `Drafted by the Build Analyzer from suggestion \`${suggestion.id}\` ` +
    `(confidence ${String(suggestion.confidence)}%) over ${suggestion.repo_ref}` +
    (suggestion.last_run_id === null ? "." : `, analysis run \`${suggestion.last_run_id}\`.`);

  if (suggestion.needs_spike) {
    const basis = suggestion.impact?.basis.description ?? "the analyzer did not say";
    return {
      localKey: `${DRAFT_KEY_PREFIX}-${String(ordinal)}`,
      title: `Spike: ${suggestion.title}`.slice(0, TITLE_MAX),
      body: [
        "**Investigate before building.** The analyzer could not put a number on this change, so",
        "this ticket asserts no impact — finding out whether it pays off, and by how much, is the work.",
        "",
        `**What is uncertain:** ${basis}.`,
        "",
        `**Evidence:** ${suggestion.evidence_line}`,
        "",
        "**References:**",
        ...references(suggestion),
        "",
        provenance,
      ].join("\n"),
    };
  }

  return {
    localKey: `${DRAFT_KEY_PREFIX}-${String(ordinal)}`,
    title: suggestion.title.slice(0, TITLE_MAX),
    body: [
      `**Evidence:** ${suggestion.evidence_line}`,
      "",
      "**References:**",
      ...references(suggestion),
      "",
      provenance,
    ].join("\n"),
  };
}
