/**
 * The rule-file import's refusals ([#413](https://github.com/NobuData/ouroboros/issues/413)), each
 * a code `openapi.yaml` publishes. A repository nothing can probe is detection's
 * `409 detection_source_missing` — the same machinery, the same answer.
 */

import {
  ConflictError,
  InvalidRequestError,
  TooManyRequestsError,
  UpstreamError,
} from "../errors/error.envelope";

/** The codes, as one object. */
export const RULE_IMPORT_ERRORS = {
  /** The plan changed since the preview: a file, a fact or a slug moved underneath it. */
  previewStale: "knowledge_import_preview_stale",
  /** The files would create more than one import may. */
  tooLarge: "knowledge_import_too_large",
  /** The host's rate guard refused a probe. */
  rateLimited: "knowledge_import_rate_limited",
  /** The host refused a probe for any other reason. */
  sourceFailed: "knowledge_import_source_failed",
} as const;

/** The most skill drafts one import writes (creates and updates together). */
export const MAX_IMPORT_SKILLS = 100;

/** The most fact candidates one import writes. */
export const MAX_IMPORT_FACTS = 500;

/**
 * `409` — the apply's re-plan differs from the preview's. Nothing was written; preview again.
 *
 * @param repo - `owner/name`.
 * @param expected - The fingerprint the caller previewed.
 * @param actual - The fingerprint the files and workspace give now.
 * @returns The error.
 */
export function previewStale(repo: string, expected: string, actual: string): ConflictError {
  return new ConflictError(
    RULE_IMPORT_ERRORS.previewStale,
    `The rules files of ${repo} or this workspace changed since the preview. Preview again.`,
    { repo, expected, actual },
  );
}

/**
 * `422` — the files would flood the review queues. Split the file, or import by hand.
 *
 * @param repo - `owner/name`.
 * @param skills - The skill drafts the plan holds.
 * @param facts - The fact candidates the plan holds.
 * @returns The error.
 */
export function tooLarge(repo: string, skills: number, facts: number): InvalidRequestError {
  return new InvalidRequestError(
    RULE_IMPORT_ERRORS.tooLarge,
    `The rules files of ${repo} would import ${String(skills)} skill drafts and ` +
      `${String(facts)} fact candidates; one import holds at most ` +
      `${String(MAX_IMPORT_SKILLS)} and ${String(MAX_IMPORT_FACTS)}.`,
    { repo, skills, facts, maxSkills: MAX_IMPORT_SKILLS, maxFacts: MAX_IMPORT_FACTS },
  );
}

/**
 * `429` — the connection's rate guard is holding its budget back for the backlog sync.
 *
 * @param repo - `owner/name`.
 * @returns The error.
 */
export function rateLimited(repo: string): TooManyRequestsError {
  return new TooManyRequestsError(
    RULE_IMPORT_ERRORS.rateLimited,
    `The source is rate-limited, so ${repo} could not be read. Try again later.`,
    { repo },
  );
}

/**
 * `502` — the host refused a probe. The class is named; the host's own words are not.
 *
 * @param repo - `owner/name`.
 * @param errorClass - The `TicketSourceError` class.
 * @returns The error.
 */
export function sourceFailed(repo: string, errorClass: string): UpstreamError {
  return new UpstreamError(
    RULE_IMPORT_ERRORS.sourceFailed,
    `The source refused to read ${repo} (${errorClass}).`,
    { repo, errorClass },
  );
}
