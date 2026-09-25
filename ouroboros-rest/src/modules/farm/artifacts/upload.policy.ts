/**
 * The fixed numbers and vocabularies of the job-scoped artifact upload (AT.2,
 * [#330](https://github.com/NobuData/ouroboros/issues/330)). What an operator may tune — the store,
 * the caps, the quota and the retention — is configuration (`OURO_ARTIFACT_*`); what is here is the
 * shape of the contract.
 */

import type { TestArtifactKind } from "../../db/schema";

/**
 * What every build collects, whatever its pool — the result formats AT.1's parsers read
 * (`docs/TEST_RESULTS_INGEST.md` § 3). A pool adds rig captures and serial logs on top.
 */
export const BUILT_IN_ARTIFACT_GLOBS: readonly string[] = [
  "**/junit*.xml",
  "**/ouro-hil-results*.json",
  "**/lcov*.info",
  "**/coverage*.xml",
  "**/cobertura*.xml",
];

/** The protocol's ceiling on `job.offer.upload.globs`. */
export const OFFER_GLOBS_MAX = 128;

/** The most files one upload carries — `job.offer.upload.max_files`. */
export const UPLOAD_MAX_FILES = 256;

/** The most skipped entries one manifest may list — so a glob matching a million files is bounded. */
export const MANIFEST_MAX_SKIPPED = 1000;

/** The largest manifest part accepted, in bytes. */
export const MANIFEST_MAX_BYTES = 1_048_576;

/** The longest artifact name — V055's `test_artifacts_name_present`. */
export const ARTIFACT_NAME_MAX_LENGTH = 255;

/**
 * How long an upload token outlives its job's wall-clock budget: time for the results to leave
 * after the command ends — an hour, since a slow link and a 256 MiB job cap is minutes, not seconds.
 */
export const UPLOAD_TOKEN_GRACE_MS = 3_600_000;

/** How much of a file's head is kept for format detection — AT.1's `detect` reads 4 KB. */
export const DETECT_HEAD_BYTES = 4096;

/** Where the upload answers, below `/api/v1`. The `:id` is the build job's uuid. */
export const UPLOAD_ROUTE = "farm/jobs/:id/artifacts";

/**
 * The path a `job.offer` names — what the agent resolves against the origin it already dials.
 *
 * @param jobId - The build job's uuid.
 * @returns `/api/v1/farm/jobs/<id>/artifacts`.
 */
export function uploadPath(jobId: string): string {
  return `/api/v1/${UPLOAD_ROUTE.replace(":id", jobId)}`;
}

/**
 * The globs an offer carries: the built-in set, then the job's own snapshot, without repeats.
 *
 * @param jobGlobs - `build_jobs.artifact_globs`, as the driver returned it.
 * @returns At most {@link OFFER_GLOBS_MAX} globs.
 */
export function offerGlobs(jobGlobs: unknown): string[] {
  const own = Array.isArray(jobGlobs)
    ? jobGlobs.filter((glob): glob is string => typeof glob === "string")
    : [];

  return [...new Set([...BUILT_IN_ARTIFACT_GLOBS, ...own])].slice(0, OFFER_GLOBS_MAX);
}

/** Extensions a rig or a bench writes its captures in. */
const CAPTURE_EXTENSIONS = new Set(["csv", "pcap", "pcapng", "vcd", "sal", "bin", "dat", "can"]);

/** Extensions of plain logs. */
const LOG_EXTENSIONS = new Set(["log", "txt", "out"]);

/**
 * What an uploaded file is, as `test_artifacts.kind` records it.
 *
 * A file an AT.1 parser read is what that parser reads it as — except a coverage report that gave
 * no line counts, which V059 cannot register as `coverage` (a coverage row carries its counts) and
 * is therefore `other`, with the parser's `coverage_unreadable` warning saying why. Anything no
 * parser recognised is a log, a capture or other, by its extension.
 *
 * @param name - The manifest name.
 * @param parsedBy - The parser that recognised it, or null.
 * @param hasCoverageCounts - Whether the parse returned counts for it.
 * @returns The kind.
 */
export function artifactKind(
  name: string,
  parsedBy: string | null,
  hasCoverageCounts: boolean,
): TestArtifactKind {
  if (parsedBy === "junit" || parsedBy === "hil") return parsedBy;
  if (parsedBy === "coverage") return hasCoverageCounts ? "coverage" : "other";

  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  if (LOG_EXTENSIONS.has(extension)) return "log";
  if (CAPTURE_EXTENSIONS.has(extension)) return "capture";
  return "other";
}

/**
 * Whether a manifest name is one the registry can hold and the store can key: a relative path of
 * 1–255 characters, no `.`/`..` or empty segment, no leading `/`, no backslash, no control
 * character.
 *
 * @param name - The candidate.
 * @returns True when it is.
 */
export function isArtifactName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= ARTIFACT_NAME_MAX_LENGTH &&
    name.trim() === name &&
    !/[\\\p{Cc}]/u.test(name) &&
    name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}
