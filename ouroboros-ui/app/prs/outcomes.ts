/**
 * What the head's Server Actions (`head-actions.ts`) answer, and the sentences they answer with
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * Kept apart from the actions because a `"use server"` module may export async functions only,
 * and the page and its tests need to name these too.
 */

import type { PrReviewOutcome, ReturnToLoop } from "@/app/api/pull-requests";

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
