/**
 * Every code the pricing API can answer with, and the errors that carry them.
 *
 * The same shape and the same argument as `tenancy/tenancy.errors.ts`: a code is only
 * meaningful beside the operation that produces it, `openapi.yaml` is where the two are
 * published together, and this file's job is to make sure the string in the specification and
 * the string in the answer come from one constant.
 *
 * There is only one, which is itself worth stating. Everything else this module can refuse is
 * refused by something that already has a word for it — a session that names no workspace is
 * the tenancy module's `organization_required`, a role too low is its `forbidden`, and a body
 * that contradicts V012's amount rules is the validation pipe's `validation_failed` with an
 * entry per field. Inventing a second vocabulary for any of those would be drift dressed as
 * precision.
 */

import { NotFoundError } from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `pricing.errors.spec.ts` can hold
 * the specification's copy to these.
 */
export const PRICING_ERRORS = {
  /**
   * This workspace has no correction recorded for that model.
   *
   * Answerable by `DELETE /api/v1/registry/prices` and by nothing else, and it is deliberately
   * not a silent success. *Withdraw my correction* and *there was no correction* are different
   * outcomes, and a client that believed it had removed one needs to learn that the price it
   * is now looking at was already the catalog's.
   *
   * It says nothing about whether the *catalog* prices the model. A `404` here means only that
   * this workspace never overrode it — the bundled row, if there is one, is not this
   * operation's to remove and its existence is not a secret worth withholding either.
   */
  overrideNotFound: "price_override_not_found",
} as const;

/** One of {@link PRICING_ERRORS}' values. */
export type PricingErrorCode = (typeof PRICING_ERRORS)[keyof typeof PRICING_ERRORS];

/**
 * `404` — this workspace has not overridden that model's price.
 *
 * @param connectionKind - The provider kind that was addressed, folded exactly as the lookup
 *   folded it. Echoed because the caller sent it and because a client that spelled the kind
 *   differently needs to see which spelling was looked for.
 * @param modelId - The model identifier that was addressed.
 * @returns The error to throw.
 */
export function overrideNotFound(connectionKind: string, modelId: string): NotFoundError {
  return new NotFoundError(
    PRICING_ERRORS.overrideNotFound,
    "This workspace has no price override for that model.",
    { connectionKind, modelId },
  );
}
