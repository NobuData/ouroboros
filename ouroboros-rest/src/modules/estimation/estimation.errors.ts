/**
 * Every code the re-estimation endpoints answer with, and the errors that carry them.
 *
 * L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108)). Codes live beside the
 * operation that produces them rather than in a service-wide registry, and `openapi.yaml` is
 * where the two are published together — the document is the registry a client reads.
 * `estimation.errors.spec.ts` holds this file to it in both directions.
 *
 * **{@link issueNotFound} has a second caller since M.2**
 * ([#111](https://github.com/NobuData/ouroboros/issues/111)): `backlog/detail.service.ts` refuses
 * `GET /api/v1/backlog/{id}` with it. That is reuse rather than a leak of this module's
 * vocabulary — *this workspace has no issue with that id* is one condition with one status, one
 * message and one `details.issueId`, and a second definition of it would be two sentences a
 * client renders for the same fact, drifting on the day one of them is reworded. Rewording this
 * one therefore rewords both, which is the point.
 *
 * ---------------------------------------------------------------------------
 * **Three refusals, three statuses, and the differences are the design.**
 *
 *   * `404 issue_not_found` — the workspace has no such issue, *or* it belongs to another one.
 *     Deliberately one answer, because a `403` would confirm that an id names a real issue
 *     somewhere; `error.envelope.ts` and `provider-connections.errors.ts` make the same call.
 *   * `409 issue_already_estimating` — the thing you asked for is already happening. Nothing
 *     about the request is wrong and retrying it unchanged gets the same answer, which is
 *     `ConflictError`'s own definition.
 *   * `429 estimation_rate_limited` — you may do this, and you have done it too often. **This
 *     one is a `429` where M.4's re-sync guard is a `409`
 *     ([#113](https://github.com/NobuData/ouroboros/issues/113)), and the difference is real
 *     rather than a matter of taste**: that guard protects a *shared background loop* the
 *     caller does not own, and refuses a person who has clicked nothing; this one counts what
 *     *this workspace* asked for and becomes a `202` by waiting exactly as long as
 *     `details.retryAfterSeconds` says.
 */

import { ConflictError, NotFoundError, TooManyRequestsError } from "../errors/error.envelope";
import type { SizingStatus } from "../db/schema";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type: a helper below cannot be handed a string
 * that nearly matches, and the specification's copy is checked against these.
 */
export const ESTIMATION_ERRORS = {
  /** `404` — no such issue in this workspace, or none this caller may know about. */
  issueNotFound: "issue_not_found",
  /** `409` — that issue is already being estimated; the running one will finish. */
  alreadyEstimating: "issue_already_estimating",
  /** `409` — every issue in the backlog is already being estimated. */
  backlogEstimating: "backlog_already_estimating",
  /** `429` — this workspace has asked for too many estimates in the last minute. */
  rateLimited: "estimation_rate_limited",
} as const;

/** One of {@link ESTIMATION_ERRORS}' values. */
export type EstimationErrorCode = (typeof ESTIMATION_ERRORS)[keyof typeof ESTIMATION_ERRORS];

/**
 * `404` — this workspace has no issue with that id.
 *
 * The same answer for an id that names nothing and for one that names an issue in another
 * workspace, which is the ticket's *cross-org id → 404* criterion. `details.issueId` echoes
 * the value the caller sent — their own — so a client holding several requests open knows
 * which one failed, and nothing is disclosed that they did not already have.
 *
 * @param issueId - What the path named.
 * @returns The error to throw.
 */
export function issueNotFound(issueId: string): NotFoundError {
  return new NotFoundError(ESTIMATION_ERRORS.issueNotFound, "No such issue in this workspace.", {
    issueId,
  });
}

/**
 * `409` — that issue is already being estimated.
 *
 * The idempotence the ticket asks for, as an answer rather than as a silent no-op: a second
 * press queues nothing, and the caller is told which state the issue is in instead of being
 * given a `202` that promises work nobody is going to do twice.
 *
 * @param status - The issue's current status, which is always `estimating` here. Echoed rather
 *   than assumed by the caller, because it is the field the ticket's own diagram names —
 *   `409 {status: "estimating"}` — and a client renders the pill from it.
 * @returns The error to throw.
 */
export function alreadyEstimating(status: SizingStatus): ConflictError {
  return new ConflictError(
    ESTIMATION_ERRORS.alreadyEstimating,
    "That issue is already being estimated. The estimate in flight will finish on its own.",
    { status },
  );
}

/**
 * `409` — every issue in this backlog is already being estimated.
 *
 * *Re-estimate all*, pressed twice. The first press claimed every eligible row, so the second
 * has nothing to take — and answering `202 {enqueued: 0}` would report *accepted* for a request
 * that started nothing. A workspace that mirrors **no** issues is not this: it gets a `202`
 * with zeros, because *your backlog is empty* and *your backlog is busy* are different things
 * and a dialog should be able to say which.
 *
 * @param estimating - How many issues are in flight. In `details` because it is the number the
 *   head's confirmation dialog would render to say what is already happening.
 * @returns The error to throw.
 */
export function backlogAlreadyEstimating(estimating: number): ConflictError {
  return new ConflictError(
    ESTIMATION_ERRORS.backlogEstimating,
    "Every issue in this backlog is already being estimated.",
    { estimating },
  );
}

/**
 * `429` — this workspace has asked for too many estimates.
 *
 * @param retryAfterSeconds - How long until the window has room, rounded up to a whole second.
 *   Never zero: a refusal that says *retry now* would be inviting the request it just refused.
 *   A number in the envelope rather than a `Retry-After` header, for the reason
 *   {@link TooManyRequestsError} documents — this service's contract is the envelope.
 * @returns The error to throw.
 */
export function estimationRateLimited(retryAfterSeconds: number): TooManyRequestsError {
  return new TooManyRequestsError(
    ESTIMATION_ERRORS.rateLimited,
    "This workspace has asked for too many estimates. Wait before trying again.",
    { retryAfterSeconds },
  );
}
