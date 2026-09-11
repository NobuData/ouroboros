"use server";

/**
 * The server hops for the intake page head's two actions
 * ([#115](https://github.com/NobuData/ouroboros/issues/115)) — the calls its Client Components
 * cannot make themselves.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/dashboard/pulse-actions.ts` is the
 * same seam for the dashboard's switch: the browser cannot reach REST — `OURO_REST_URL` has no
 * `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so a Client Component that needs to
 * write calls a Server Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in either call and no person.** The backlog belongs to the workspace
 *   the caller's own session is acting in, resolved by `ouroboros-rest` from the cookie this request
 *   carries; an issue id from another workspace is the service's `404`, never a write.
 * - **The role gates are the service's.** Re-estimating everything is `owner` or `admin`, queueing
 *   is `owner`, `admin` or `member`. The head hides the first control and inerts the second for the
 *   roles that may not press them, but that is presentation: a press that goes around it gets the
 *   service's `403`, handed back here as the sentence the control would have shown.
 * - **The selection's shape is checked before it is sent.** Types do not survive a forged POST, so
 *   `queueSelected` refuses anything that is not a non-empty list of strings instead of spreading a
 *   value that is not a list into a request. Everything past the shape — uuids, the ceiling of a
 *   hundred, duplicates, ids from another workspace — is the service's to refuse, and it refuses by
 *   writing nothing.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a sentence the head draws under the button, because the page is one the
 * reader is still entitled to be on. The one throw that must travel is Next.js's redirect signal,
 * for a session that expired since the page rendered.
 *
 * **Every value this module needs is imported rather than declared**: a `"use server"` module may
 * export nothing but async functions, so the sentences and the outcome type live in
 * `app/issues/view.ts`, and the contract's codes in `app/api/backlog.ts`.
 */

import {
  BACKLOG_ALREADY_ESTIMATING_CODE,
  ESTIMATION_RATE_LIMITED_CODE,
  FORBIDDEN_CODE,
  backlog,
} from "@/app/api/backlog";
import { isApiError } from "@/app/api/errors";

import {
  type HeadOutcome,
  QUEUE_NOTHING_SELECTED,
  QUEUE_ROLE_REASON,
  REESTIMATE_BUSY,
  REESTIMATE_FAILED,
  REESTIMATE_ROLE_REASON,
  fanoutOutcome,
  queueRefusal,
  queuedOutcome,
  reestimateRateLimited,
} from "./view";

/**
 * Re-estimate every issue the workspace mirrors that is not already being estimated.
 *
 * @returns How many issues it started, as a sentence — or why it started none.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function reestimateAll(): Promise<HeadOutcome> {
  try {
    return { ok: true, message: fanoutOutcome(await backlog.estimateAll()) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    switch (error.code) {
      case FORBIDDEN_CODE:
        return { ok: false, reason: REESTIMATE_ROLE_REASON };
      case BACKLOG_ALREADY_ESTIMATING_CODE:
        return { ok: false, reason: REESTIMATE_BUSY };
      case ESTIMATION_RATE_LIMITED_CODE:
        return { ok: false, reason: reestimateRateLimited(error.details.retryAfterSeconds) };
      default:
        return { ok: false, reason: error.message === "" ? REESTIMATE_FAILED : error.message };
    }
  }
}

/**
 * Queue the selected issues, each under the workflow its own estimate suggested.
 *
 * @param issueIds The issues' `github_issues.id`s, in the order they were selected — the order the
 *   queue appends them in.
 * @returns How many issues were queued, as a sentence — or why none were.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function queueSelected(issueIds: readonly string[]): Promise<HeadOutcome> {
  if (!isIdList(issueIds)) return { ok: false, reason: queueRefusal("") };
  if (issueIds.length === 0) return { ok: false, reason: QUEUE_NOTHING_SELECTED };

  try {
    return { ok: true, message: queuedOutcome(await backlog.queue({ issueIds: [...issueIds] })) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === FORBIDDEN_CODE) return { ok: false, reason: QUEUE_ROLE_REASON };

    return { ok: false, reason: queueRefusal(error.message) };
  }
}

/**
 * Whether a value that arrived over the wire is a list of ids at all.
 *
 * @param value What the caller sent, whatever its declared type.
 * @returns `true` for an array holding only strings, the empty array included.
 */
function isIdList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}
