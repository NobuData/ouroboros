/**
 * What `PATCH /api/v1/settings/retention` refuses with (BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482)). Both codes are documented in
 * `openapi.yaml` beside the operation.
 */

import { InvalidRequestError } from "../errors/error.envelope";
import { VALIDATION_FAILED, VALIDATION_MESSAGE } from "../errors/validation";
import type { RetentionRefusal } from "./retention.policy";

/** The stable codes. */
export const RETENTION_ERRORS = {
  /** A tier is below its class's floor, above its ceiling, or not whole days. */
  outOfBounds: "retention_out_of_bounds",
} as const;

/**
 * `422 retention_out_of_bounds` — one or more tiers fall outside their class's bounds. Nothing is
 * stored. `details.refusals` carries each refusal's class, value, reason code
 * (`below_floor | above_ceiling | not_whole_days`), bounds and message, and `details.fields` binds
 * each message to the input that sent it (`loopDays`, or `classes.<class>`).
 *
 * @param refusals - Every refused tier, at least one.
 * @param bind - The request field each refusal came from, and the message shown beside it.
 * @returns The error to throw.
 */
export function retentionOutOfBounds(
  refusals: readonly RetentionRefusal[],
  bind: (refusal: RetentionRefusal) => { readonly field: string; readonly message: string },
): InvalidRequestError {
  const fields: Record<string, string[]> = {};
  for (const refusal of refusals) {
    const { field, message } = bind(refusal);
    // The simple select refuses one value three times over; say it once.
    if (fields[field]?.includes(message) !== true) {
      fields[field] = [...(fields[field] ?? []), message];
    }
  }

  return new InvalidRequestError(RETENTION_ERRORS.outOfBounds, bind(refusals[0]).message, {
    refusals,
    fields,
  });
}

/**
 * `422 validation_failed` — the body is not a shape the card sends: both `loopDays` and
 * `classes`, an unknown class, or a value that is not a number.
 *
 * @param fields - The message for each offending field.
 * @returns The error to throw.
 */
export function retentionBodyInvalid(fields: Record<string, string[]>): InvalidRequestError {
  return new InvalidRequestError(VALIDATION_FAILED, VALIDATION_MESSAGE, { fields });
}
