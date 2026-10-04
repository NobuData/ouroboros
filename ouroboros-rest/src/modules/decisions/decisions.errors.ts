/**
 * The decision registry's refusals — each a `DomainError` with a stable code.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)). These are raised to the
 * *plane* that emitted, not to a browser: no route files a decision. They carry a code and the
 * violations so an emitter's log line says which fact was wrong, and so BN.5's suites can assert on
 * the reason rather than on a message.
 */

import { InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { DecisionViolation } from "./decision.validation";

/** Every code this module answers with. */
export const DECISION_ERRORS = {
  kindNotDeclared: "decision_kind_not_declared",
  emissionInvalid: "decision_emission_invalid",
} as const;

/**
 * The kind has no published declaration.
 *
 * @param kindId - The kind asked for.
 * @returns The error.
 */
export function decisionKindNotDeclared(kindId: string): NotFoundError {
  return new NotFoundError(
    DECISION_ERRORS.kindNotDeclared,
    `No decision kind ${kindId} is declared.`,
    { kindId },
  );
}

/**
 * The emission failed its kind's payload schema, ref shape or key grammar. Nothing was filed.
 *
 * @param kindId - The kind.
 * @param violations - Every problem, each naming its field.
 * @returns The error.
 */
export function decisionEmissionInvalid(
  kindId: string,
  violations: readonly DecisionViolation[],
): InvalidRequestError {
  const first = violations[0];

  return new InvalidRequestError(
    DECISION_ERRORS.emissionInvalid,
    `A ${kindId} decision was refused and nothing was filed: ${first.field} ${first.message}`,
    { kindId, violations: violations.map((violation) => ({ ...violation })) },
  );
}
