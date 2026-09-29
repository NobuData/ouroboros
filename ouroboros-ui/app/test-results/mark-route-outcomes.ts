/**
 * What the Mark & Route Server Actions (`mark-route-actions.ts`) answer, and the sentences they
 * answer with ([#340](https://github.com/NobuData/ouroboros/issues/340)).
 *
 * Kept apart from the actions because a `"use server"` module may export async functions only,
 * and the card and its tests need to name these too.
 */

import type {
  ClassifyResult,
  FailureClass,
  RunPrIntents,
  Waiver,
} from "@/app/api/test-results";

import type { ToggleField } from "./mark-route";

/** The code a refusal made before calling out carries. */
export const ROUTE_INVALID_CODE = "validation_failed";

/** What is said for a request that could not have come from the card. */
export const ROUTE_INVALID = "That could not be understood, so nothing was sent.";

/** The code a dropped connection is answered with. */
export const ROUTE_UNREACHABLE_CODE = "route_unreachable";

/** What is said when the service could not be reached. */
export const ROUTE_UNREACHABLE = "It could not be sent — the service did not answer.";

/** A decision as the card sends it: the class, and the note trimmed — or `null` for none. */
export interface Decision {
  readonly class: FailureClass;
  readonly note: string | null;
}

/** One toggle, set. */
export interface ToggleChange {
  readonly field: ToggleField;
  readonly value: boolean;
}

/** Why nothing was done. */
export interface RouteRefusal {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly reason: string;
}

/** What became of *Queue correction round* and its siblings. */
export type ClassifyOutcome =
  | { readonly ok: true; readonly result: ClassifyResult }
  | RouteRefusal;

/** What became of *Waive & annotate PR*. */
export type WaiveOutcome = { readonly ok: true; readonly waiver: Waiver } | RouteRefusal;

/** What became of a toggle's press. */
export type IntentsOutcome = { readonly ok: true; readonly intents: RunPrIntents } | RouteRefusal;
