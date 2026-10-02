"use server";

/**
 * The server hop for the interventions card's re-categorization
 * (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
 *
 * `app/registry/switch-actions.ts` states the rule this exists under: the browser cannot reach
 * REST, so the card's Client Component calls these Server Actions, which call it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The events are the workspace the
 *   caller's own session is acting in, resolved by `ouroboros-rest` from the cookie this request
 *   carries; another workspace's event is the service's `404`, never a write.
 * - **The role gate is the service's.** `owner`, `admin` or `member`. The card draws no control
 *   for a viewer, but that is presentation: a viewer who calls {@link recategorizeEvent} anyway
 *   gets the service's `403` and changes nothing, handed back here as a sentence.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a sentence the panel draws, because the page is still the reader's to
 * read. The one throw that travels is Next.js's redirect signal, for an expired session.
 */

import { isApiError } from "@/app/api/errors";
import {
  type InsightsRange,
  type Intervention,
  type InterventionCause,
  type InterventionList,
  insights,
} from "@/app/api/insights";

import {
  EVENTS_UNREADABLE,
  RECATEGORIZE_FAILED,
  RECATEGORIZE_FORBIDDEN,
  RECATEGORIZE_GONE,
  RECATEGORIZE_INVALID,
  RECATEGORIZE_UNCHANGED,
} from "./bars-view";

/** What a list or a write produced: the value, or why not as a sentence for a person. */
export type InterventionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** The service's codes, and the sentence each becomes. */
const WRITE_REFUSALS: Readonly<Record<string, string>> = {
  forbidden: RECATEGORIZE_FORBIDDEN,
  intervention_not_found: RECATEGORIZE_GONE,
  intervention_cause_unchanged: RECATEGORIZE_UNCHANGED,
  validation_failed: RECATEGORIZE_INVALID,
};

/**
 * The events behind one bar.
 *
 * @param range The page's range.
 * @param cause The bar's cause.
 * @returns The list, or why not.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function listCauseEvents(
  range: InsightsRange,
  cause: InterventionCause,
): Promise<InterventionOutcome<InterventionList>> {
  try {
    return { ok: true, value: await insights.interventions(range, cause) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: EVENTS_UNREADABLE };
  }
}

/**
 * Re-categorize one event.
 *
 * @param id The event.
 * @param cause The cause the person says it was.
 * @param reason Why. Trimmed; a blank one is refused here without a call, as the service would.
 * @returns The corrected event, or why not.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function recategorizeEvent(
  id: string,
  cause: InterventionCause,
  reason: string,
): Promise<InterventionOutcome<Intervention>> {
  const why = reason.trim();

  if (why === "") return { ok: false, reason: RECATEGORIZE_INVALID };

  try {
    return { ok: true, value: await insights.recategorize(id, cause, why) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: WRITE_REFUSALS[error.code] ?? RECATEGORIZE_FAILED };
  }
}
