/**
 * The refusals of the test-results reads and artifact serving (AT.5,
 * [#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * A run, an attempt and a case reuse the codes their own services already answer with
 * (`run_not_found`, `test_run_not_found`, `test_case_not_found`), so a client has one code per
 * thing whichever route it asked. Everything of another workspace is a `404` like an absent one.
 */

import { GoneError, NotFoundError } from "../errors/error.envelope";

export const RESULTS_ERRORS = {
  /** The case passed or was skipped, so it carries no failure payload. */
  testCaseFailureNotFound: "test_case_failure_not_found",

  /** No such artifact in this workspace. */
  artifactNotFound: "artifact_not_found",

  /** The retention sweep removed its bytes; the row is a tombstone. */
  artifactExpired: "artifact_expired",

  /** The row is live but the configured store does not hold its bytes. */
  artifactContentUnavailable: "artifact_content_unavailable",
} as const;

/**
 * @param testRunId - The attempt.
 * @param caseId - The case.
 * @returns `404 test_case_failure_not_found`.
 */
export function testCaseFailureNotFound(testRunId: string, caseId: string): NotFoundError {
  return new NotFoundError(
    RESULTS_ERRORS.testCaseFailureNotFound,
    "This case did not fail, so it has no failure detail.",
    { testRunId, caseId },
  );
}

/**
 * @param artifactId - The artifact asked for.
 * @returns `404 artifact_not_found`.
 */
export function artifactNotFound(artifactId: string): NotFoundError {
  return new NotFoundError(RESULTS_ERRORS.artifactNotFound, "No such artifact in this workspace.", {
    artifactId,
  });
}

/**
 * @param artifactId - The artifact.
 * @param expiredAt - When the sweep removed it.
 * @returns `410 artifact_expired`.
 */
export function artifactExpired(artifactId: string, expiredAt: Date): GoneError {
  return new GoneError(
    RESULTS_ERRORS.artifactExpired,
    "This artifact expired under the workspace's retention policy and its file was removed.",
    { artifactId, expiredAt: expiredAt.toISOString() },
  );
}

/**
 * The file should be there and is not — never a storage path or a driver name in the answer.
 *
 * @param artifactId - The artifact.
 * @returns `404 artifact_content_unavailable`.
 */
export function artifactContentUnavailable(artifactId: string): NotFoundError {
  return new NotFoundError(
    RESULTS_ERRORS.artifactContentUnavailable,
    "This artifact's file is not available from the artifact store.",
    { artifactId },
  );
}
