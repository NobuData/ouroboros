/**
 * The drafted-tickets card, as the API answers it (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519)).
 *
 * A drafted ticket **is** an ordinary planning draft, so a batch is answered as planning answers
 * it — `BatchResource`, with its drafts' checkboxes, estimates and push states and its
 * estimator-summed footer — and this read adds only what planning does not know: what each
 * draft's body says its evidence is, with every reference resolved to the surface it opens on.
 *
 * ```
 * draft body ──draftEvidence──▶ line + {kind, id}… ──EvidenceRepository──▶ label + surface
 * ```
 *
 * **The evidence is read from the body, not remembered from the suggestion**: the body is what a
 * push files, and a person may have edited it. So the card shows what a ticket will carry — and a
 * draft whose body no longer states its evidence shows none.
 */

import type { BatchResource } from "../../planning/planning.resources";
import { draftEvidence, listedRefs } from "../actions/ticket.drafts";
import type { ResolvedEvidence } from "../evidence/evidence.repository";
import { evidenceResource, refsOf, type EvidenceResource } from "../evidence/evidence.resources";
import { EVIDENCE_LIMIT } from "../suggestions/suggestions.resources";
import type { UndraftedTicketRow } from "./tickets.repository";

/** A ticket suggestion nobody has drafted yet. */
export interface UndraftedTicketResource {
  /** The suggestion — what `POST /analyzer/suggestions/draft` takes. */
  id: string;
  title: string;
  /** The composed evidence line. */
  evidenceLine: string;
  /** 0–100. */
  confidence: number;
  /** The first {@link EVIDENCE_LIMIT} references its draft will list, in that order, resolved. */
  evidence: EvidenceResource[];
  /** How many references its draft will list in all. */
  evidenceTotal: number;
}

/** What one draft's body says its evidence is. */
export interface DraftedTicketResource {
  /** The draft's key within its batch — `BA-2`. */
  localKey: string;
  /** The body's evidence line; null when the body states none. */
  evidenceLine: string | null;
  /** The first {@link EVIDENCE_LIMIT} references the body lists, in its order, resolved. */
  evidence: EvidenceResource[];
  /** How many references the body lists in all. */
  evidenceTotal: number;
}

/** One planning batch on the card. */
export interface TicketBatchResource {
  /** The batch, exactly as `GET /planning/batches/{batch}` answers it. */
  batch: BatchResource;
  /** Each draft's evidence, in the batch's draft order. */
  drafts: DraftedTicketResource[];
}

/** A repository's drafted-tickets card. */
export interface TicketsResource {
  /** The repository, `owner/name`. */
  repo: string;
  /** The ticket suggestions still open, most confident first. */
  undrafted: UndraftedTicketResource[];
  /** The batches the rest were drafted into, newest first. */
  batches: TicketBatchResource[];
}

/**
 * The references an un-drafted suggestion's draft will list, in the draft's order.
 *
 * @param row - The suggestion.
 * @returns The references.
 */
function willList(row: UndraftedTicketRow): { kind: string; id: string }[] {
  return listedRefs(refsOf(row));
}

/**
 * Every reference the read answers — each suggestion's and each draft's first
 * {@link EVIDENCE_LIMIT} — so only those are resolved, not a finding's hundreds.
 *
 * @param undrafted - The suggestions nobody has drafted.
 * @param batches - The batches on the card.
 * @returns The references to resolve.
 */
export function answeredTicketRefs(
  undrafted: readonly UndraftedTicketRow[],
  batches: readonly BatchResource[],
): { kind: string; id: string }[] {
  return [
    ...undrafted.flatMap((row) => willList(row).slice(0, EVIDENCE_LIMIT)),
    ...batches.flatMap((batch) =>
      batch.drafts.flatMap((draft) => draftEvidence(draft.body).refs.slice(0, EVIDENCE_LIMIT)),
    ),
  ];
}

/**
 * The batches in the card's order.
 *
 * @param batches - The batches.
 * @returns A copy, newest first; two drafted in the same instant by id, so the order is stable.
 */
function newestFirst(batches: readonly BatchResource[]): BatchResource[] {
  return [...batches].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * The card.
 *
 * @param repo - The repository.
 * @param undrafted - The suggestions nobody has drafted, in their order.
 * @param batches - The batches the rest were drafted into.
 * @param resolved - What the answered references name.
 * @returns The resource.
 */
export function ticketsResource(
  repo: string,
  undrafted: readonly UndraftedTicketRow[],
  batches: readonly BatchResource[],
  resolved: ResolvedEvidence,
): TicketsResource {
  return {
    repo,
    undrafted: undrafted.map((row) => {
      const refs = willList(row);

      return {
        id: row.id,
        title: row.title,
        evidenceLine: row.evidence_line,
        confidence: row.confidence,
        evidence: refs.slice(0, EVIDENCE_LIMIT).map((ref) => evidenceResource(ref, resolved)),
        evidenceTotal: refs.length,
      };
    }),
    batches: newestFirst(batches).map((batch) => ({
      batch,
      drafts: batch.drafts.map((draft) => {
        const stated = draftEvidence(draft.body);

        return {
          localKey: draft.localKey,
          evidenceLine: stated.line,
          evidence: stated.refs
            .slice(0, EVIDENCE_LIMIT)
            .map((ref) => evidenceResource(ref, resolved)),
          evidenceTotal: stated.refs.length,
        };
      }),
    })),
  };
}
