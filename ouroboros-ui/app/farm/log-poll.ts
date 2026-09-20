/**
 * One read of a build's log, from the browser — the reader under the live log card's stream
 * (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * `app/farm/farm-poll.ts` is the same seam for the page: where the browser asks, the guard that
 * decides whether what answered is the payload at all, and the two sentences a failed ask
 * carries. What differs is that **this read has an argument** — the offset the reader has
 * reached — so the address is built per ask (`logEndpoint`) rather than being a constant, and the
 * loop that owns the offset is `app/farm/log-stream.ts`.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`.
 */

import type { BuildLog } from "@/app/api/farm";
import { type PollAnswer, requestPayload } from "@/app/poll";

/** What is said when something answered and this client could not read it as a log page. */
export const UNREADABLE_LOG = "The build log could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_LOG = "The build log could not be reached.";

/** What is said about an `after` that is not an offset — this origin's own refusal. */
export const BAD_LOG_OFFSET = "A build log is read from a whole, non-negative offset.";

/** One read of one page, as the stream needs it. Replaced wholesale in tests. */
export type LogReader = (jobId: string, after: number) => Promise<PollAnswer<BuildLog>>;

/**
 * Where the browser asks for a page — **this origin**, not `ouroboros-rest`, for the reason
 * `app/dashboard/summary.ts` gives for its own endpoint.
 *
 * @param jobId The build job.
 * @param after The offset to read from.
 * @returns The address, with the id escaped — it arrives from a payload, and a path is not the
 *   place to trust one.
 */
export function logEndpoint(jobId: string, after: number): string {
  return `/api/farm/jobs/${encodeURIComponent(jobId)}/log?after=${String(after)}`;
}

/**
 * Read `?after=` off a poll's address.
 *
 * @param raw The parameter as it arrived, or `null` when the address carried none.
 * @returns The offset — `0` for an absent one, which is how a log is read from its start — or
 *   `null` for anything that is not a whole, non-negative number.
 */
export function readAfter(raw: string | null): number | null {
  if (raw === null || raw === "") return 0;
  if (!/^\d+$/.test(raw)) return null;

  const after = Number(raw);

  return Number.isSafeInteger(after) ? after : null;
}

/**
 * Whether a parsed body is a page of a build log.
 *
 * Structural, the way `isFarmPage` is, and as deep as what reads it: the stream does arithmetic
 * on the three offsets and walks `elisions`, so each of those must be what the contract says
 * before any of it is folded into a buffer a reader is looking at.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link BuildLog}.
 */
export function isBuildLog(value: unknown): value is BuildLog {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const page = value as Record<string, unknown>;

  return (
    typeof page.jobId === "string" &&
    isOffset(page.offset) &&
    isOffset(page.nextOffset) &&
    isOffset(page.end) &&
    page.nextOffset >= page.offset &&
    typeof page.bytes === "string" &&
    typeof page.live === "boolean" &&
    typeof page.retained === "boolean" &&
    Array.isArray(page.elisions) &&
    page.elisions.every(isElision) &&
    (page.tail === null || isElided(page.tail))
  );
}

/**
 * Whether a value is a position in a byte stream.
 *
 * @param value Anything.
 * @returns `true` for a whole, non-negative number.
 */
function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Whether a value counts what was elided — the two figures a marker and the tail share.
 *
 * @param value Anything.
 * @returns `true` when it carries `bytes` and `missingChunks`.
 */
function isElided(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  const elided = value as Record<string, unknown>;

  return isOffset(elided.bytes) && isOffset(elided.missingChunks);
}

/**
 * Whether a value is one elision marker.
 *
 * @param value Anything.
 * @returns `true` when it has a position as well as its two counts.
 */
function isElision(value: unknown): boolean {
  return isElided(value) && isOffset((value as Record<string, unknown>).offset);
}

/**
 * Read one page, from the browser.
 *
 * @param jobId The build job.
 * @param after The offset to read from.
 * @returns The answer. **It does not throw**, for the reason `requestPayload` gives. The log
 *   answers no `ETag`, so no tag is sent and a `304` is never expected.
 */
export const requestLog: LogReader = (jobId, after) =>
  requestPayload(logEndpoint(jobId, after), null, isBuildLog, {
    unreachable: UNREACHABLE_LOG,
    unreadable: UNREADABLE_LOG,
  });
