/**
 * A suggestion as a ticket draft (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514),
 * decision A5) — the title and body an AK draft batch stores, built only from what the composer
 * stored: the evidence line goes into the body verbatim and every evidence reference the cited
 * findings carry is listed so a reader can resolve it.
 *
 * A **spike** drafts an investigation, not an implementation: its body states what the analyzer
 * could not quantify and why, and asserts no impact — *"the honest output is a spike, not a smaller
 * number"* (V081).
 *
 * The body is the only place a draft keeps its evidence — a draft is a title and a body — so the
 * drafted-tickets card (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519)) reads it
 * back with {@link draftEvidence}, which undoes exactly what {@link ticketDraftOf} writes.
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

/** What the evidence line is written after — and what {@link draftEvidence} finds it by. */
const EVIDENCE_LABEL = "**Evidence:**";

/** The heading the references are listed under — and what {@link draftEvidence} finds them by. */
const REFERENCES_LABEL = "**References:**";

/** One listed reference: `- build \`<id>\``. */
const REFERENCE = /^- ([a-z][a-z_]{0,63}) `([^`\s]+)`$/;

/** A uuid — what every reference but a merge's is. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A commit sha, whole or abbreviated — what a `merge` reference is (V081). */
const SHA = /^[0-9a-f]{7,40}$/i;

/**
 * References in the order a draft lists them — by kind, then by id.
 *
 * @param refs - The references.
 * @returns A sorted copy.
 */
export function listedRefs(
  refs: readonly { kind: string; id: string }[],
): { kind: string; id: string }[] {
  return [...refs].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/**
 * The evidence section: one line per reference, `kind id`, in a stable order.
 *
 * @param suggestion - The suggestion.
 * @returns Markdown lines, or a line saying there are none.
 */
function references(suggestion: SuggestionRow): string[] {
  const refs = listedRefs(suggestion.evidence_refs);
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
        `${EVIDENCE_LABEL} ${suggestion.evidence_line}`,
        "",
        REFERENCES_LABEL,
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
      `${EVIDENCE_LABEL} ${suggestion.evidence_line}`,
      "",
      REFERENCES_LABEL,
      ...references(suggestion),
      "",
      provenance,
    ].join("\n"),
  };
}

/** What a draft's body says its evidence is — see {@link draftEvidence}. */
export interface DraftEvidence {
  /** The evidence line; null when the body carries none. */
  line: string | null;
  /** The references listed under **References:**, each once, in the body's order. */
  refs: { kind: string; id: string }[];
}

/**
 * Read a draft's evidence back out of its body — the inverse of what {@link ticketDraftOf} wrote
 * (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519)).
 *
 * The body is what a push files, and a person may have edited it since, so this reads what is
 * **there now**: the first `**Evidence:**` line, and the `- kind \`id\`` lines directly under
 * `**References:**` up to the first blank line. A body rewritten without them has no evidence, and
 * a line that is not a well-formed reference — an id that is neither a uuid nor, for a `merge`, a
 * commit sha — is prose, not a reference: nothing a person typed is ever sent to a typed lookup.
 *
 * @param body - The draft's body, or null for a draft with none.
 * @returns The evidence line and the references, as the body states them.
 */
export function draftEvidence(body: string | null): DraftEvidence {
  const lines = (body ?? "").split(/\r?\n/).map((line) => line.trimEnd());
  const stated = lines.find((line) => line.startsWith(`${EVIDENCE_LABEL} `));
  const line = stated?.slice(EVIDENCE_LABEL.length).trim() ?? "";

  const refs: { kind: string; id: string }[] = [];
  const seen = new Set<string>();
  const heading = lines.indexOf(REFERENCES_LABEL);

  for (const entry of heading === -1 ? [] : lines.slice(heading + 1)) {
    if (entry === "") {
      break;
    }

    const [, kind, id] = REFERENCE.exec(entry) ?? [];
    if (kind === undefined || id === undefined) {
      continue;
    }
    if (!(kind === "merge" ? SHA : UUID).test(id) || seen.has(`${kind} ${id}`)) {
      continue;
    }

    seen.add(`${kind} ${id}`);
    refs.push({ kind, id });
  }

  return { line: line === "" ? null : line, refs };
}
