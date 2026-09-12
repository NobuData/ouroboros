/**
 * The draft etag, and what `If-Match` is allowed to say about it — P.3's conflict guard
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * The ticket's own sentence for why this file exists: *a second tab open on the same workflow
 * must not silently clobber the first*. Autosave is debounced and frequent, two tabs on one
 * canvas is the ordinary case rather than the exotic one, and last-write-wins would lose an
 * edit without anybody being told. So every draft write carries the etag of the draft it was
 * based on, and one that no longer matches is a `409` — the reload dialog S.6 draws — rather
 * than an overwrite.
 *
 * ---------------------------------------------------------------------------
 * ## The etag is a digest of the draft's identity *and its content*
 *
 * Not `updated_at` alone, and the reason is arithmetic rather than taste: `updated_at` is a
 * `timestamptz` that reaches this service as a `Date`, whose resolution is a millisecond, and
 * two autosaves a millisecond apart would then share an etag. Two writers would both be
 * "current" and one edit would be lost — which is the exact failure this file exists to make
 * impossible, reintroduced by the choice of input.
 *
 * Hashing the definition instead makes *stale* mean what a person means by it: **the document
 * you edited is not the document that is stored**. Two saves of identical content produce one
 * etag, which is correct — a writer whose base is byte-identical to what is stored is not
 * clobbering anything. The row's id and stamp are in the digest beside it so that a draft
 * deleted and written again is a different draft even when its content is the same.
 *
 * ## *There is no draft* is a state with an etag of its own
 *
 * A workflow can have no draft row at all — one seeded by #136, or one whose draft was
 * consumed by something other than this API. {@link NO_DRAFT} is that state's etag, so the
 * slot always has one and a client never has to special-case the first write of its life: read
 * the workflow, send back whatever `draftEtag` it was given, and the guard holds either way.
 * Two tabs both holding {@link NO_DRAFT} do not both create a draft — `workflow_versions_one_draft_idx`
 * refuses the second, which `workflows.service.ts` reports as the same `409`.
 *
 * ## The etag is a body field, and `If-Match` is a header
 *
 * That asymmetry is deliberate. `If-Match` is a header because the ticket and the roadmap both
 * name it as one, and because a precondition belongs where an intermediary can read it. The
 * *answer* carries `draftEtag` in the body for `error.envelope.ts`' stated reason — this
 * service's contract is the body, and a client that already reads one should not need a second
 * reader for the one fact that makes the next write safe.
 */

import { createHash } from "node:crypto";

/**
 * The etag of a workflow that has no draft.
 *
 * A constant rather than a digest of the workflow id: the id is already in the path, so
 * nothing is gained by it being in the token, and a constant is one fewer thing a reader has
 * to compute to know what they are looking at in a log.
 */
export const NO_DRAFT = "none";

/** The parts of a draft row an etag is computed from. */
export interface DraftIdentity {
  /** `workflow_versions.id` — which row, so a re-created draft is a different one. */
  readonly id: string;
  /** `workflow_versions.updated_at` — the mockup's *Last edited*. */
  readonly updated_at: Date;
  /** The stored document, as `pg` hands it back parsed. */
  readonly definition: unknown;
}

/**
 * The etag of a draft slot.
 *
 * @param draft - The draft row, or `undefined` when the workflow has none.
 * @returns {@link NO_DRAFT} for an empty slot, and otherwise a 64-character hex digest.
 *   Opaque to every caller: nothing outside this file may take it apart, and a client that
 *   compared two of them for anything but equality would be reading a hash as a clock.
 */
export function draftEtag(draft: DraftIdentity | undefined): string {
  if (draft === undefined) return NO_DRAFT;

  return createHash("sha256")
    .update(draft.id)
    .update("\n")
    .update(draft.updated_at.toISOString())
    .update("\n")
    .update(JSON.stringify(draft.definition) ?? "null")
    .digest("hex");
}

/**
 * Whether an `If-Match` header admits the etag a draft slot actually has.
 *
 * Lenient about spelling and strict about meaning. RFC 9110 writes an entity tag quoted and
 * allows a comma-separated list, so both are accepted; a bare token is accepted too, because
 * {@link draftEtag} publishes an unquoted value and a client echoing it verbatim is doing the
 * obvious thing rather than a wrong thing. `W/` is stripped for the same reason — this service
 * has one etag per draft and no notion of a weak comparison for it to change the meaning of.
 *
 * `*` is admitted and means *whatever is there now*, which is RFC 9110's own reading of it.
 * That is an opt-out of the guard and the only one there is: a client that sends it has said
 * so in as many characters, which is the difference between overwriting deliberately and
 * overwriting by forgetting a header.
 *
 * @param header - The `If-Match` header, or `undefined` when the request carried none.
 * @param current - The etag the slot has now, from {@link draftEtag}.
 * @returns `true` when the write may proceed. `false` for a header that names other etags —
 *   and for an *absent* header, which the caller answers with `workflow_draft_etag_required`
 *   rather than with a conflict, because the two are different mistakes.
 */
export function ifMatchAdmits(header: string | undefined, current: string): boolean {
  if (header === undefined) return false;

  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || normalizeEtag(candidate) === current);
}

/**
 * One entity tag, reduced to the opaque string inside it.
 *
 * @param candidate - One comma-separated element of an `If-Match` header, already trimmed.
 * @returns The tag with a `W/` prefix and surrounding quotes removed. A value with neither is
 *   returned unchanged, which is what makes an echoed `draftEtag` work.
 */
function normalizeEtag(candidate: string): string {
  const unweighted = candidate.startsWith("W/") ? candidate.slice(2) : candidate;

  return unweighted.startsWith('"') && unweighted.endsWith('"') && unweighted.length >= 2
    ? unweighted.slice(1, -1)
    : unweighted;
}
