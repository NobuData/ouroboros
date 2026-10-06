/**
 * The detection card's poll (BC.2, [#391](https://github.com/NobuData/ouroboros/issues/391)) — the
 * I.8 poll family over `GET /api/onboarding/detection?repo=`, which forwards BB.1's read (#384).
 *
 * The poll is what makes a re-scan honest: the card keeps drawing the stored scan's rows while the
 * new scan runs (its progress rides on the same answer), and swaps them only when the service
 * stores the new scan under the next `scanSeq`.
 */

import type { RepoDetection } from "@/app/api/detection";
import { type Poll, type PollOptions, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_DETECTION, UNREADABLE_DETECTION } from "./detection-view";
import { REPO_PARAM } from "./view";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const DETECTION_ENDPOINT = "/api/onboarding/detection";

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface DetectionPollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestDetection}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<typeof requestDetection>;
}

/**
 * The endpoint for one repository's card.
 *
 * @param repo `owner/name`.
 * @returns `/api/onboarding/detection?repo=owner%2Fname`.
 */
export function detectionEndpoint(repo: string): string {
  return `${DETECTION_ENDPOINT}?${REPO_PARAM}=${encodeURIComponent(repo)}`;
}

/**
 * Whether a payload is shaped like the card — enough to draw its rows and its progress.
 *
 * @param value What arrived.
 * @returns True for a detection.
 */
export function isDetection(value: unknown): value is RepoDetection {
  if (typeof value !== "object" || value === null) return false;

  const { repo, scan, rows, protectedPaths, progress } = value as Partial<
    Record<keyof RepoDetection, unknown>
  >;

  return (
    typeof repo === "string" &&
    (scan === null ||
      (typeof scan === "object" && typeof (scan as { scanSeq?: unknown }).scanSeq === "number")) &&
    Array.isArray(rows) &&
    rows.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as { rowKey?: unknown }).rowKey === "string" &&
        typeof (row as { value?: unknown }).value === "string" &&
        typeof (row as { evidence?: unknown }).evidence === "object",
    ) &&
    Array.isArray(protectedPaths) &&
    (progress === null ||
      (typeof progress === "object" && typeof (progress as { state?: unknown }).state === "string"))
  );
}

/**
 * One read of a repository's card on this origin.
 *
 * @param endpoint The endpoint, with its repository.
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestDetection(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isDetection, {
    unreachable: UNREACHABLE_DETECTION,
    unreadable: UNREADABLE_DETECTION,
  });
}

/**
 * Build the poll for one repository's card.
 *
 * @param endpoint The endpoint.
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createDetectionPoll(
  endpoint: string,
  options: DetectionPollOptions = {},
): Poll<RepoDetection> {
  const read = options.read ?? requestDetection;

  return createPoll((etag) => read(endpoint, etag), options);
}
