/**
 * The acceptance criteria matrix, as data ([#366](https://github.com/NobuData/ouroboros/issues/366))
 * — mockup 12's claims-to-evidence grid, decided here and drawn by `criteria-card.tsx`.
 *
 * ```
 * DOES THE PR DO WHAT THE TICKET SAYS?                                        Issue #482 →
 * “Telemetry frames must arrive in ISR order under load”
 *     test_frame_order_under_load (10⁶ frames, 0 reordered) · hunk telemetry_buf.c:41–66   ✓ verified
 * “Flake must not reappear across temperature range”
 *     rig runs at 22°C only — thermal chamber not in bench          waived · annotated on PR ↗
 * [+ Add claim] [Import from plan]
 * ```
 *
 * **It formats; it composes nothing.** An evidence line is the service's `displayText`, as stored
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)). What this adds is where each line
 * *leads*, from its typed reference — because a matrix nobody can drill into is a matrix nobody
 * can check.
 *
 * **A link is drawn only where it leads somewhere real.** A test or a measurement is linked only
 * for a PR a loop opened, since its results are the loop's; a hunk only when the reference names
 * a whole range; a waived pill only when the host said where its comment is.
 *
 * **Provenance stays visible.** Every row says where its claim came from — `manual`, `plan`, or
 * `extracted`, which is reserved for claim extraction
 * ([#372](https://github.com/NobuData/ouroboros/issues/372)) and labelled so.
 *
 * **Verification is gated on evidence.** *Verify* is offered on an unverified claim and stays
 * inert, with the reason, until at least one evidence row is attached.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  CriteriaImport,
  CriteriaMatrix,
  PrCriterion,
  PrCriterionWaived,
  PrEvidence,
  PrRevision,
  PullRequestPage,
} from "@/app/api/pull-requests";
import { prEvidencePath } from "@/app/paths";
import { artifactUrl } from "@/app/test-results/artifacts";
import type { ChipDot, ChipTone } from "@/app/ui";

import { type Hunk, hunkRange, isHunk, withHunk } from "./hunk";
import { isFinished } from "./view";

/** The card's title — the mockup's `DOES THE PR DO WHAT THE TICKET SAYS?`. */
export const CRITERIA_TITLE = "Does the PR do what the ticket says?";

/** The element id the changed files sit at — what a hunk reference is addressed to. */
export const FILES_ID = "files";

/** What the card says when the matrix has no claim. */
export const NO_CRITERIA = "No claim has been written for this PR yet.";

/** *Add claim*. */
export const ADD_CLAIM_LABEL = "+ Add claim";

/** *Import from plan*. */
export const IMPORT_LABEL = "Import from plan";

/** A row's *Attach evidence*. */
export const ATTACH_LABEL = "Attach evidence";

/** A row's *Verify*. */
export const VERIFY_LABEL = "Verify";

/** A row's *Waive*. */
export const WAIVE_LABEL = "Waive";

/** A waived row's *Waive* — the retry, and the way to restate the reason. */
export const WAIVE_AGAIN_LABEL = "Waive again";

/** Why *Verify* waits on a claim with no evidence. */
export const VERIFY_NEEDS_EVIDENCE =
  "Attach evidence first — a claim is verified by what is cited for it.";

/** Why the card's buttons wait while something is in flight. */
export const CRITERIA_SENDING = "The last change is being sent.";

/** The verified pill — the mockup's `✓ verified`. */
export const VERIFIED_PILL = "✓ verified";

/** The unverified pill. */
export const UNVERIFIED_PILL = "unverified";

/** The waived pill once the host holds the comment — the mockup's. */
export const WAIVED_ANNOTATED_PILL = "waived · annotated on PR";

/** The waived pill while the host refused the comment. */
export const WAIVED_FAILED_PILL = "waived · annotation failed";

/** The waived pill for a waiver nothing has tried to annotate. */
export const WAIVED_PENDING_PILL = "waived · not annotated";

/** What is said beneath a waived row the host refused to annotate. */
export const ANNOTATION_FAILED_NOTE =
  "The host refused the annotation, so the waiver is not on the PR. Waiving again retries it.";

/** What is said beneath a waived row nothing has tried to annotate. */
export const ANNOTATION_PENDING_NOTE =
  "This waiver was recorded without an annotation on the PR. Waiving again posts one.";

/** What the mark after an outward link is announced as. */
export const OPENS_HOST = "opens on the host";

/** What is said once a claim has been added. */
export const CLAIM_ADDED = "Claim added — unverified until evidence is cited and it is verified.";

/** What is said once evidence has been attached. */
export const EVIDENCE_ATTACHED = "Evidence attached.";

/** What is said once a claim has been verified. */
export const CLAIM_VERIFIED = "Verified.";

// --- provenance ----------------------------------------------------------------------------

/** Where a claim came from. */
export type CriterionSource = PrCriterion["source"];

/** A row's provenance label. */
export interface SourceView {
  /** `manual`, `plan`, or `extracted · reserved`. */
  readonly label: string;
  /** What the label means, as its tooltip. */
  readonly title: string;
  /** Whether the provenance is reserved for a later ticket. */
  readonly reserved: boolean;
}

/** Each provenance, as the row states it. */
export const SOURCES: Readonly<Record<CriterionSource, SourceView>> = {
  manual: { label: "manual", title: "Written by a person on this page.", reserved: false },
  plan: {
    label: "plan",
    title: "Imported from the acceptance criteria the ticket's plan states.",
    reserved: false,
  },
  extracted: {
    label: "extracted · reserved",
    title: "Extracted from the ticket — reserved for claim extraction (#372).",
    reserved: true,
  },
};

// --- the evidence --------------------------------------------------------------------------

/** Where an evidence line leads. */
export type EvidenceTarget =
  /** Another page of this product — a test, a measurement, an artifact. */
  | { readonly kind: "link"; readonly href: string }
  /** The page's own changed files, brought to a range. */
  | { readonly kind: "hunk"; readonly hunk: Hunk; readonly href: string; readonly where: string }
  /** Nowhere else: the note is the evidence, and it opens in place. */
  | { readonly kind: "note"; readonly readOn: string | null }
  /** Nowhere honest to lead. */
  | { readonly kind: "none" };

/** One evidence line, ready to draw. */
export interface EvidenceView {
  /** The citation's id. */
  readonly id: string;
  /** The composed mono line, as stored. */
  readonly text: string;
  readonly target: EvidenceTarget;
}

/** What an evidence line's target is decided from. */
export interface EvidenceInput {
  /** The PR page. */
  readonly page: PullRequestPage;
  /** The module the page was opened from. */
  readonly originId: string;
  /** The page's current query, `?…` or empty — a hunk's address keeps the rest of it. */
  readonly search: string;
}

/**
 * A revision's name, for a line that says what was read.
 *
 * @param revisions The PR's revisions.
 * @param revisionId The revision cited, or `null`.
 * @returns `revision 2 · b7e41d0`, or `null` when none is cited or the PR has no such revision.
 */
export function revisionLine(
  revisions: readonly PrRevision[],
  revisionId: string | null,
): string | null {
  const revision = revisions.find((each) => each.id === revisionId);

  return revision === undefined ? null : `revision ${revision.seq} · ${revision.headSha}`;
}

/**
 * Where an evidence line leads.
 *
 * | Kind              | Leads to                                                               |
 * |-------------------|------------------------------------------------------------------------|
 * | `test_case`       | the test-results page, on the attempt that ran it, its suite selected  |
 * | `hil_measurement` | the same page's physical card, its case selected                       |
 * | `build_artifact`  | the artifact's file                                                    |
 * | `hunk`            | this page's changed files, at the range                                |
 * | `analysis_note`   | nowhere — it opens in place                                            |
 *
 * A test or a measurement names a row and not the attempt it ran in, so its address
 * (`prEvidencePath`) is resolved on the server when followed.
 *
 * @param evidence The citation.
 * @param input See {@link EvidenceInput}.
 * @returns The target — `none` for a test or a measurement of a PR no loop opened, and for a
 *   reference that lacks what its kind requires.
 */
export function evidenceTarget(evidence: PrEvidence, input: EvidenceInput): EvidenceTarget {
  const { page, originId, search } = input;
  const { ref } = evidence;
  const prId = page.pullRequest.id;

  switch (evidence.kind) {
    case "test_case":
      return page.pullRequest.run === null || ref.testCaseId === null
        ? { kind: "none" }
        : { kind: "link", href: prEvidencePath(prId, evidence.id, originId) };
    case "hil_measurement":
      return page.pullRequest.run === null || ref.hilMeasurementId === null
        ? { kind: "none" }
        : { kind: "link", href: prEvidencePath(prId, evidence.id, originId) };
    case "build_artifact":
      return ref.testArtifactId === null
        ? { kind: "none" }
        : { kind: "link", href: artifactUrl(ref.testArtifactId) };
    case "hunk": {
      const hunk = { path: ref.path, lineStart: ref.lineStart, lineEnd: ref.lineEnd };
      if (!isHunk(hunk)) return { kind: "none" };

      const read = revisionLine(page.revisions, ref.revisionId);

      return {
        kind: "hunk",
        hunk,
        href: `${withHunk(search, hunk)}#${FILES_ID}`,
        where: `${hunk.path} · ${hunkRange(hunk)}${read === null ? "" : ` · ${read}`}`,
      };
    }
    case "analysis_note":
      return { kind: "note", readOn: revisionLine(page.revisions, ref.revisionId) };
    default:
      return { kind: "none" };
  }
}

// --- the status ----------------------------------------------------------------------------

/** A row's status pill. */
export interface StatusView {
  /** `verified`, `waived` or `unverified`. */
  readonly status: PrCriterion["status"];
  /** The pill's words. */
  readonly label: string;
  readonly tone: ChipTone;
  /** A ring for a claim nobody has answered, otherwise none. */
  readonly dot: ChipDot | null;
  /** The host comment the waive posted, or `null`. */
  readonly href: string | null;
  /** What is said beneath the row about its annotation, or `null`. */
  readonly note: string | null;
}

/**
 * A row's status pill.
 *
 * @param criterion The claim.
 * @returns The pill. A waived claim links to the host comment only when the host holds it and
 *   said where; a waiver the host refused says so and names the retry.
 */
export function statusView(criterion: PrCriterion): StatusView {
  if (criterion.status === "verified") {
    return {
      status: "verified",
      label: VERIFIED_PILL,
      tone: "ok",
      dot: null,
      href: null,
      note: null,
    };
  }

  if (criterion.status === "unverified") {
    return {
      status: "unverified",
      label: UNVERIFIED_PILL,
      tone: "neutral",
      dot: "ring",
      href: null,
      note: null,
    };
  }

  const annotation = criterion.waiver?.annotation ?? null;
  const waived = { status: "waived", tone: "warn", dot: null } as const;

  if (annotation?.state === "annotated") {
    return { ...waived, label: WAIVED_ANNOTATED_PILL, href: annotation.url, note: null };
  }

  return annotation?.state === "failed"
    ? { ...waived, label: WAIVED_FAILED_PILL, href: null, note: ANNOTATION_FAILED_NOTE }
    : { ...waived, label: WAIVED_PENDING_PILL, href: null, note: ANNOTATION_PENDING_NOTE };
}

// --- the rows ------------------------------------------------------------------------------

/** What a row's *Verify* is. */
export interface VerifyOffer {
  /** Why it cannot act yet, or `undefined` when it can. */
  readonly reason: string | undefined;
}

/** One claim, ready to draw. */
export interface CriterionRowView {
  /** The claim's id. */
  readonly id: string;
  /** The claim, without its quotation marks — the sheet draws those. */
  readonly claim: string;
  readonly source: SourceView;
  /** The evidence lines, oldest first. */
  readonly evidence: readonly EvidenceView[];
  /** Why the claim was waived — the waived row's own line — or `null`. */
  readonly waiverReason: string | null;
  readonly status: StatusView;
  /** Whether the reader may cite evidence for it. */
  readonly attach: boolean;
  /** *Verify*, or `null` when it is not offered. */
  readonly verify: VerifyOffer | null;
  /** *Waive*'s label, or `null` when it is not offered. */
  readonly waive: string | null;
}

/** The card's link to the ticket. */
export interface TicketLink {
  /** `Issue #482 →`. */
  readonly label: string;
  /** The ticket on its tracker. */
  readonly href: string;
}

/** The card, ready to draw. */
export interface CriteriaCardView {
  /** The ticket on its tracker, or `null` for a PR with none. */
  readonly ticket: TicketLink | null;
  /** The sentence beneath the head. */
  readonly intro: string;
  /** `4 verified · 1 waived · 0 unverified`, or `null` with no claim. */
  readonly counts: string | null;
  /** The rows, in the matrix's order. */
  readonly rows: readonly CriterionRowView[];
  /** Whether *Add claim* is offered. */
  readonly addClaim: boolean;
  /** Whether *Import from plan* is offered. */
  readonly importPlan: boolean;
}

/** What the card is decided from. */
export interface CriteriaCardInput extends EvidenceInput {
  /** The claims on screen — the page's, with what this page just changed (`withLocal`). */
  readonly criteria: readonly PrCriterion[];
  /** Whether the reader may author, cite and verify — owner, admin or member (#359). */
  readonly mayContribute: boolean;
  /** Whether the reader may waive — owner or admin (#359). */
  readonly mayWaive: boolean;
}

/**
 * One claim's row.
 *
 * @param criterion The claim.
 * @param input See {@link CriteriaCardInput}.
 * @returns The row. *Verify* is offered on an unverified claim to a reader who may contribute,
 *   inert with {@link VERIFY_NEEDS_EVIDENCE} while nothing is cited. *Waive* is offered to a
 *   reader who may waive — again on a waived claim, which is the retry. Nothing is offered on a
 *   PR that has merged or closed (#370): the matrix is then what was claimed and shown.
 */
export function criterionRow(criterion: PrCriterion, input: CriteriaCardInput): CriterionRowView {
  const open = !isFinished(input.page.pullRequest.state);
  const mayContribute = open && input.mayContribute;
  const mayWaive = open && input.mayWaive;

  return {
    id: criterion.id,
    claim: criterion.claim,
    source: SOURCES[criterion.source],
    evidence: criterion.evidence.map((evidence) => ({
      id: evidence.id,
      text: evidence.displayText,
      target: evidenceTarget(evidence, input),
    })),
    waiverReason: criterion.status === "waived" ? (criterion.waiver?.reason ?? null) : null,
    status: statusView(criterion),
    attach: mayContribute,
    verify:
      mayContribute && criterion.status === "unverified"
        ? { reason: criterion.evidence.length === 0 ? VERIFY_NEEDS_EVIDENCE : undefined }
        : null,
    waive: !mayWaive ? null : criterion.status === "waived" ? WAIVE_AGAIN_LABEL : WAIVE_LABEL,
  };
}

/**
 * The sentence beneath the card's head.
 *
 * @param ticketKey The ticket's key on its tracker — `#482` — or `null`.
 * @returns The mockup's sentence, naming the ticket when there is one.
 */
export function criteriaIntro(ticketKey: string | null): string {
  return ticketKey === null
    ? "Each claim is mapped to concrete evidence in this PR."
    : `Each claim from issue ${ticketKey} is mapped to concrete evidence in this PR.`;
}

/**
 * How the claims stand.
 *
 * @param criteria The claims on screen.
 * @returns `4 verified · 1 waived · 0 unverified`, or `null` with no claim. Counted from the
 *   rows on screen rather than read from the payload, so it never disagrees with them.
 */
export function countsLine(criteria: readonly PrCriterion[]): string | null {
  if (criteria.length === 0) return null;

  const count = (status: PrCriterion["status"]): number =>
    criteria.filter((each) => each.status === status).length;

  return `${count("verified")} verified · ${count("waived")} waived · ${count("unverified")} unverified`;
}

/**
 * The card.
 *
 * @param input See {@link CriteriaCardInput}.
 * @returns The card. *Import from plan* is offered only when the payload says there is a plan to
 *   read (`planContext`), and only to a reader who may contribute. A PR that has merged or closed
 *   is offered neither that nor *Add claim* (#370).
 */
export function criteriaCard(input: CriteriaCardInput): CriteriaCardView {
  const { page, criteria } = input;
  const mayContribute = input.mayContribute && !isFinished(page.pullRequest.state);
  const ticket = page.pullRequest.ticket;

  return {
    ticket: ticket === null ? null : { label: `Issue ${ticket.key} →`, href: ticket.url },
    intro: criteriaIntro(ticket?.key ?? null),
    counts: countsLine(criteria),
    rows: criteria.map((criterion) => criterionRow(criterion, input)),
    addClaim: mayContribute,
    importPlan: mayContribute && page.criteria.planContext,
  };
}

// --- what this page just changed -----------------------------------------------------------

/** A claim as an answer on this page stated it, and when. */
export interface LocalCriterion {
  readonly criterion: PrCriterion;
  /** When the answer arrived, in epoch milliseconds. */
  readonly at: number;
}

/**
 * The locals still standing.
 *
 * @param locals What this page's answers stated.
 * @param readAt When the page was last read, in epoch milliseconds, or `null` before the poll's
 *   first answer.
 * @returns The locals no read has caught up with: a read made after an answer has seen what the
 *   answer wrote, so the read is then the newer statement.
 */
export function standing<T extends { readonly at: number }>(
  locals: readonly T[],
  readAt: number | null,
): readonly T[] {
  return readAt === null ? locals : locals.filter((local) => local.at >= readAt);
}

/**
 * The claims on screen: the page's matrix, with what this page just changed.
 *
 * @param matrix The page's matrix.
 * @param locals What this page's answers stated, oldest first.
 * @param readAt When the page was last read, or `null`.
 * @returns The matrix's rows in order, each replaced by its standing local when it has one, and
 *   after them the standing locals the matrix does not hold yet — a claim just added.
 */
export function withLocal(
  matrix: CriteriaMatrix,
  locals: readonly LocalCriterion[],
  readAt: number | null,
): readonly PrCriterion[] {
  const newest = new Map<string, PrCriterion>();
  for (const local of standing(locals, readAt)) newest.set(local.criterion.id, local.criterion);

  const held = new Set(matrix.criteria.map((each) => each.id));

  return [
    ...matrix.criteria.map((each) => newest.get(each.id) ?? each),
    ...[...newest.values()].filter((each) => !held.has(each.id)),
  ];
}

// --- what an answer did --------------------------------------------------------------------

/** What became of a press, said on the card. */
export interface CriteriaOutcome {
  readonly text: string;
  readonly failed: boolean;
}

/**
 * What an import did.
 *
 * @param answer The import's answer.
 * @returns `Imported 3 claims from the plan · 1 already present · 1 too long to be a claim` — each
 *   part only when it has something to say, and *nothing new* when nothing was written.
 */
export function importOutcome(answer: CriteriaImport): CriteriaOutcome {
  const written = answer.imported.length;
  const parts = [
    written === 0
      ? "Nothing new to import from the plan"
      : `Imported ${written} ${written === 1 ? "claim" : "claims"} from the plan`,
  ];

  if (answer.alreadyPresent.length > 0) parts.push(`${answer.alreadyPresent.length} already present`);
  if (answer.tooLong.length > 0) parts.push(`${answer.tooLong.length} too long to be a claim`);

  return { text: `${parts.join(" · ")}.`, failed: false };
}

/** What is said once the host holds the annotation, by what the host did with it. */
export const ANNOTATED: Readonly<Record<NonNullable<PrCriterionWaived["annotation"]["mode"]>, string>> =
  {
    created: "Waived — a comment on the PR says so.",
    edited: "Waived — the comment on the PR was updated; no second comment was posted.",
    unchanged: "Waived — the comment on the PR already says so; no second comment was posted.",
  };

/**
 * What a waive did.
 *
 * @param answer The waive's answer.
 * @returns That the PR was annotated — a comment posted, or the same comment edited on a waive
 *   again — or, as a failure, that the claim is waived and the host refused the annotation, in
 *   the host's own words.
 */
export function waiveOutcome(answer: PrCriterionWaived): CriteriaOutcome {
  const { annotation } = answer;

  if (annotation.state === "failed") {
    const why = annotation.error?.message ?? "the host gave no reason";

    return {
      text: `Waived, but the PR was not annotated — ${why}. Waiving again retries it.`,
      failed: true,
    };
  }

  return { text: ANNOTATED[annotation.mode ?? "created"], failed: false };
}
