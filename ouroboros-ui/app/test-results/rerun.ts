/**
 * What the re-run Server Action (`rerun-actions.ts`) answers, and the sentences it answers with
 * ([#335](https://github.com/NobuData/ouroboros/issues/335)).
 *
 * Kept apart from the action because a `"use server"` module may export async functions only,
 * and the page and its tests need to name these too.
 */

import type { Rerun } from "@/app/api/test-results";

/** The code a refusal made before calling out carries. */
export const RERUN_INVALID_CODE = "validation_failed";

/** What is said for an id or a scope that could not have come from the page. */
export const RERUN_INVALID = "That re-run could not be understood.";

/** The code a dropped connection is answered with. */
export const RERUN_UNREACHABLE_CODE = "rerun_unreachable";

/** What is said when the service could not be reached. */
export const RERUN_UNREACHABLE = "The re-run could not be sent — the service did not answer.";

/** What became of a press. */
export type RerunOutcome =
  | { readonly ok: true; readonly rerun: Rerun }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly reason: string };
