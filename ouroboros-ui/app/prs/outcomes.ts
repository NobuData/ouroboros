/**
 * What the head's Server Actions (`head-actions.ts`) answer, and the sentences they answer with
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)) — the gates card's approval
 * ([#365](https://github.com/NobuData/ouroboros/issues/365)), and the criteria matrix's actions
 * (`criteria-actions.ts`, [#366](https://github.com/NobuData/ouroboros/issues/366)) and the
 * review thread's (`thread-actions.ts`, [#368](https://github.com/NobuData/ouroboros/issues/368)).
 *
 * Kept apart from the actions because a `"use server"` module may export async functions only,
 * and the page and its tests need to name these too.
 */

import type {
  ApprovalDecision,
  CriteriaImport,
  PrCriterion,
  PrCriterionWaived,
  PrReviewOutcome,
  PrThreadResolution,
  ReturnToLoop,
} from "@/app/api/pull-requests";

import type { EvidenceOptions } from "./evidence-options";

/** The code a refusal made before calling out carries. */
export const ACTION_INVALID_CODE = "validation_failed";

/** What is said for a request that could not have come from the page. */
export const ACTION_INVALID = "That request could not be understood.";

/** The code a dropped connection is answered with. */
export const ACTION_UNREACHABLE_CODE = "pull_request_unreachable";

/** What is said when the service could not be reached. */
export const ACTION_UNREACHABLE = "The request could not be sent — the service did not answer.";

/** The most gates one return sends — the service's `MAX_RETURNED_GATES`. */
export const MAX_RETURNED_GATES = 64;

/** The longest replay key a return carries. */
export const MAX_REPLAY_KEY_LENGTH = 128;

/** A gate key as the service accepts one — a built-in key or `custom:<name>` (V056). */
export const GATE_KEY_PATTERN =
  /^(build|test_suite|physical_hil|diff_vs_plan|secrets_license|model_review|human_approval|custom:[a-z0-9][a-z0-9_.-]{0,62})$/;

/** The longest note an approval carries — the service's `MAX_APPROVAL_NOTE_LENGTH` (V065). */
export const MAX_APPROVAL_NOTE_LENGTH = 2000;

/** A refusal: the status and code to branch on, and the sentence to draw. */
export interface ActionRefusal {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly reason: string;
}

/** What became of *Request human review*. */
export type ReviewRequestOutcome =
  | { readonly ok: true; readonly outcome: PrReviewOutcome }
  | ActionRefusal;

/** What became of an approval or a decline — the slot as answered, and the gate re-evaluated. */
export type ApprovalOutcome = ReviewRequestOutcome;

/** What an approval slot is answered with. */
export interface ApprovalAnswer {
  /** `approve` or `decline`. */
  readonly decision: ApprovalDecision;
  /** Why — required on a decline, optional on an approve. Never empty or padded. */
  readonly note?: string;
}

/** What became of *Return to loop*. */
export type ReturnOutcome = { readonly ok: true; readonly answer: ReturnToLoop } | ActionRefusal;

/** What *Return to loop* is sent with. */
export interface ReturnSelection {
  /** The red gates selected, by key. */
  readonly gates: readonly string[];
  /** The revision they were selected on. */
  readonly revisionId: string;
  /** A key that makes a retry of the same press answer the first control. */
  readonly replayKey?: string;
}

// --- the criteria matrix (#366) ------------------------------------------------------------

/** The longest claim — the service's `MAX_CLAIM_LENGTH`. */
export const MAX_CLAIM_LENGTH = 1024;

/** The longest waiver reason — the service's `MAX_REASON_LENGTH`. */
export const MAX_WAIVE_REASON_LENGTH = 4096;

/** What an action of the matrix answers: what the service answered, or the refusal. */
export type CriteriaAnswer<T> = { readonly ok: true; readonly answer: T } | ActionRefusal;

/** What became of *Add claim*, *Attach evidence* and *Verify* — the claim. */
export type CriterionOutcome = CriteriaAnswer<PrCriterion>;

/** What became of *Import from plan*. */
export type ImportOutcome = CriteriaAnswer<CriteriaImport>;

/** What became of *Waive* — the claim, and what the host did with the annotation. */
export type WaiveOutcome = CriteriaAnswer<PrCriterionWaived>;

/** What became of the picker's read. */
export type OptionsOutcome = CriteriaAnswer<EvidenceOptions>;

// --- the review thread (#368) --------------------------------------------------------------

/** The longest resolving reply — the service's `MAX_THREAD_REPLY_LENGTH` (V057). */
export const MAX_THREAD_REPLY_LENGTH = 8192;

/** What *Reply & resolve* is sent with. */
export interface ThreadResolveRequest {
  /** The resolving reply, neither empty nor padded — or absent, to resolve without one. */
  readonly reply?: string;
  /** Whether to post the reply on the host PR too. Needs a reply. */
  readonly mirror: boolean;
}

/** What became of *Reply & resolve* — the entry, and what the host did with the mirror. */
export type ThreadResolveOutcome = CriteriaAnswer<PrThreadResolution>;
