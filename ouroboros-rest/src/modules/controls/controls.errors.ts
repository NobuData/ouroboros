/**
 * Every way the control queue says no — AP.4
 * ([#306](https://github.com/NobuData/ouroboros/issues/306)).
 *
 * The same contract `runs.errors.ts` keeps: the string in the specification and the string in
 * the answer come from one constant, and `controls.errors.spec.ts` holds the two together.
 *
 * Three refusals are deliberately **not** here, because they already have a word:
 *
 *   * **A role that may not press this button** is the roles guard's `403 forbidden`
 *     (`tenancy.errors.ts`), with the role held and the roles required. One refusal for *"your
 *     role is too low"*, wherever it is decided.
 *   * **No such run** is `404 run_not_found` (`runs.errors.ts`), which covers another
 *     workspace's run too, indistinguishably.
 *   * **Steering a finished run** is not an error at all. The control is written as
 *     `rejected`, with a reason, so it is audited and the console can display the reason.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { RunControlKind, RunControlState } from "../db/schema";

/** The codes, as one object — see `tenancy.errors.ts` for why `as const` matters. */
export const CONTROLS_ERRORS = {
  /** An abort whose typed confirmation does not name the run's loop number. */
  abortConfirmationInvalid: "abort_confirmation_invalid",

  /** A payload or flag that belongs to another kind: a steer without text, a pause with some. */
  controlPayloadInvalid: "control_payload_invalid",

  /** An idempotency key already used for a different control on this run. */
  controlKeyReused: "control_key_reused",

  /** No such control on this run. */
  controlNotFound: "control_not_found",

  /** A control that is not `delivered`, so there is nothing to acknowledge. */
  controlNotDelivered: "control_not_delivered",
} as const;

/**
 * `422` — the abort's typed confirmation does not match the run.
 *
 * The expected value is not echoed. The console already shows the loop number, and a refusal
 * that repeated it would make the confirmation a formality a script could copy.
 *
 * @returns The error to throw.
 */
export function abortConfirmationInvalid(): InvalidRequestError {
  return new InvalidRequestError(
    CONTROLS_ERRORS.abortConfirmationInvalid,
    "Type the loop number to confirm the abort.",
    { kind: "abort" },
  );
}

/**
 * `422` — the payload or the remember flag does not belong to this kind.
 *
 * @param kind - The kind that was asked for.
 * @param field - `payload` or `remember`.
 * @param reason - What is wrong with it, in a sentence.
 * @returns The error to throw.
 */
export function controlPayloadInvalid(
  kind: RunControlKind,
  field: "payload" | "remember",
  reason: string,
): InvalidRequestError {
  return new InvalidRequestError(CONTROLS_ERRORS.controlPayloadInvalid, reason, { kind, field });
}

/**
 * `409` — this idempotency key already named a different control on this run.
 *
 * @param idempotencyKey - The key. Echoed, because the caller sent it and needs to know which
 *   of its submissions collided.
 * @returns The error to throw.
 */
export function controlKeyReused(idempotencyKey: string): ConflictError {
  return new ConflictError(
    CONTROLS_ERRORS.controlKeyReused,
    "That idempotency key was already used for a different control on this run.",
    { idempotencyKey },
  );
}

/**
 * `404` — no such control on this run.
 *
 * @param runId - The run the request named.
 * @param controlId - The control it named.
 * @returns The error to throw.
 */
export function controlNotFound(runId: string, controlId: string): NotFoundError {
  return new NotFoundError(CONTROLS_ERRORS.controlNotFound, "No such control on this run.", {
    runId,
    controlId,
  });
}

/**
 * `409` — the control is not waiting for an acknowledgment.
 *
 * The state is echoed because it is the whole of what the executor needs to decide. `acked`
 * is a lost response it can stop retrying. `expired` means it answered too late, and
 * `pending` means it never fetched the control.
 *
 * @param controlId - The control.
 * @param state - Where it stands.
 * @returns The error to throw.
 */
export function controlNotDelivered(controlId: string, state: RunControlState): ConflictError {
  return new ConflictError(
    CONTROLS_ERRORS.controlNotDelivered,
    `This control is ${state}, so there is nothing to acknowledge.`,
    { controlId, state },
  );
}
