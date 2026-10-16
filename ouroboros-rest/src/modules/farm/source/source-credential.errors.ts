/**
 * The one refusal the source-credential redemption answers with (AG.7, #991).
 *
 * Every ticket failure — missing, wrong, for another job, expired, already redeemed, a job
 * that is not being run — is the same detail-free `401`, for the artifact upload's reason
 * (`../artifacts/upload.errors.ts`): a caller learns nothing about which it was, and so
 * nothing about the ledger. `source-credential.errors.spec.ts` holds the code to
 * `openapi.yaml`.
 */

import { UnauthenticatedError } from "../../errors/error.envelope";

/** The codes, as one object. */
export const SOURCE_CREDENTIAL_ERRORS = {
  /** The ticket is missing, wrong, for another job, expired, redeemed, or the job is not running. */
  refused: "farm_source_credential_refused",
} as const;

/**
 * The one refusal for every ticket failure.
 *
 * @returns The `401`.
 */
export function sourceCredentialRefused(): UnauthenticatedError {
  return new UnauthenticatedError(
    SOURCE_CREDENTIAL_ERRORS.refused,
    "This source-credential ticket is not valid for this job.",
  );
}
