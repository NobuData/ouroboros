/**
 * Every way the job-scoped artifact upload refuses (#330).
 *
 * **One opaque refusal for every token failure.** An upload's caller holds nothing but a token, so
 * a token that never existed, one for a different job, an expired one and one re-minted by a later
 * offer all answer {@link uploadRefused} — `farm.errors.ts`'s argument for enrollment, one route
 * on: telling them apart would tell somebody spraying tokens which of their guesses was nearly
 * right.
 *
 * **A spent token is the one exception, and it is safe to be.** {@link uploadClosed} answers only a
 * caller who presented the *right* token for the job, so it tells nobody anything they did not
 * already hold — and it is what lets an agent whose first response was lost learn that its upload
 * was recorded, rather than retrying into a refusal it cannot interpret. Either way a replay
 * writes nothing.
 *
 * The rest are the caller's own mistakes and say what they were: a manifest that is not one, a
 * file whose bytes disagree with its checksum (a corrupted transfer — the agent retries it), and a
 * file or upload past the caps the offer carried.
 */

import {
  ConflictError,
  InvalidRequestError,
  PayloadTooLargeError,
  UnauthenticatedError,
} from "../../errors/error.envelope";

/** The codes, as one object — `upload.errors.spec.ts` holds each to `openapi.yaml`. */
export const ARTIFACT_ERRORS = {
  /** The token is missing, wrong, for another job, expired or superseded. */
  uploadRefused: "farm_artifact_upload_refused",
  /** The right token, for an upload already closed: single use. */
  uploadClosed: "farm_artifact_upload_closed",
  /** The job is attributed to no run, so there is no attempt to fill. */
  jobUnattributed: "farm_artifact_job_unattributed",
  /** The body is not a manifest followed by the files it lists. */
  manifestInvalid: "farm_artifact_manifest_invalid",
  /** A file's bytes do not hash to the checksum its manifest entry declared. */
  checksumMismatch: "farm_artifact_checksum_mismatch",
  /** A file, or the upload, is past a cap the offer carried. */
  tooLarge: "farm_artifact_too_large",
} as const;

/**
 * The one refusal for every token failure.
 *
 * @returns The `401`.
 */
export function uploadRefused(): UnauthenticatedError {
  return new UnauthenticatedError(
    ARTIFACT_ERRORS.uploadRefused,
    "This upload token is not valid for this job.",
  );
}

/**
 * The right token, presented again after its upload closed.
 *
 * @returns The `409`.
 */
export function uploadClosed(): ConflictError {
  return new ConflictError(
    ARTIFACT_ERRORS.uploadClosed,
    "This job's artifacts were already uploaded; an upload token is single use.",
  );
}

/**
 * The job has no run to hold its results.
 *
 * @returns The `409`.
 */
export function jobUnattributed(): ConflictError {
  return new ConflictError(
    ARTIFACT_ERRORS.jobUnattributed,
    "This build job is attributed to no run, so there is no attempt for its results.",
  );
}

/**
 * The body is not a manifest and its files.
 *
 * @param reason - What was wrong, in one sentence.
 * @param file - The file it concerns, when it concerns one.
 * @returns The `422`.
 */
export function manifestInvalid(reason: string, file?: string): InvalidRequestError {
  return new InvalidRequestError(
    ARTIFACT_ERRORS.manifestInvalid,
    `The upload is not a valid manifest and its files: ${reason}`,
    file === undefined ? {} : { file },
  );
}

/**
 * A file's bytes do not hash to its declared checksum — a corrupted transfer.
 *
 * @param file - The manifest name.
 * @param declared - What the manifest said.
 * @param actual - What the bytes hash to.
 * @returns The `422`.
 */
export function checksumMismatch(
  file: string,
  declared: string,
  actual: string,
): InvalidRequestError {
  return new InvalidRequestError(
    ARTIFACT_ERRORS.checksumMismatch,
    `${file} does not match its checksum; nothing from this upload was kept.`,
    { file, declared, actual },
  );
}

/**
 * A file or the upload is past a cap.
 *
 * @param what - Which cap, in words — "the per-file cap".
 * @param capBytes - The cap.
 * @param file - The file, when one file is the problem.
 * @returns The `413`.
 */
export function tooLarge(what: string, capBytes: number, file?: string): PayloadTooLargeError {
  return new PayloadTooLargeError(
    ARTIFACT_ERRORS.tooLarge,
    `${file ?? "The upload"} is larger than ${what} of ${String(capBytes)} bytes.`,
    file === undefined ? { capBytes } : { file, capBytes },
  );
}
