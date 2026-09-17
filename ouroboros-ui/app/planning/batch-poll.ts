/**
 * The generator card's poll — `app/poll.ts`'s loop over one planning batch
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * `app/issues/detail-poll.ts` is the same file for one issue, and the argument is the same one:
 * *"Draft tickets ⟳ → batch creation with per-row sizing progress"* is the browser asking, while
 * the estimator works behind the answer, for the batch the card has open, and drawing the last
 * answer — so `sizing…` flips to an effort chip, and `✓ all sized` appears, without a reload.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`; the card meets it
 * through `app/issues/use-keyed-poll.ts`.
 *
 * ### The cadence is the batch's
 *
 * The route handler (`app/api/planning/batches/[id]/route.ts`) answers with
 * {@link SETTLING_POLL_SECONDS} while some draft still waits on the estimator and
 * {@link SETTLED_POLL_SECONDS} once none does — so a batch being sized is watched closely and a
 * settled one costs the contract's ordinary interval.
 */

import type { PlanningBatch } from "@/app/api/planning";
import {
  DEFAULT_POLL_SECONDS,
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

/** Where the browser asks — this origin. The batch's id is the last segment. */
export const BATCH_ENDPOINT = "/api/planning/batches";

/** What is said when something answered and this client could not read it as a batch. */
export const UNREADABLE_BATCH = "The batch could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_BATCH = "The batch could not be reached.";

/** The interval while a draft is still being sized. */
export const SETTLING_POLL_SECONDS = 3;

/** The interval once nothing is waiting on the estimator — the contract's default. */
export const SETTLED_POLL_SECONDS = DEFAULT_POLL_SECONDS;

/** One read of the batch, as the loop needs it. Replaced wholesale in tests. */
export type BatchReader = PollReader<PlanningBatch>;

/** How to build the card's poll. Everything is optional; production supplies none of it. */
export interface BatchPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestBatch} over the poll's address. */
  read?: BatchReader;
}

/**
 * The address the card polls for one batch.
 *
 * @param id The batch's id.
 * @returns {@link BATCH_ENDPOINT} with the id as its last segment, encoded.
 */
export function batchUrl(id: string): string {
  return `${BATCH_ENDPOINT}/${encodeURIComponent(id)}`;
}

/**
 * Whether a batch is still settling — some draft waits on the estimator.
 *
 * @param batch The batch.
 * @returns `true` when auto-size is on and a draft has no estimate yet.
 */
export function isSettling(batch: PlanningBatch): boolean {
  return batch.autoSize && batch.drafts.some((draft) => draft.estimate === null);
}

/**
 * The interval a batch asks to be polled at.
 *
 * @param batch The batch.
 * @returns {@link SETTLING_POLL_SECONDS} while it settles, else {@link SETTLED_POLL_SECONDS}.
 */
export function batchPollSeconds(batch: PlanningBatch): number {
  return isSettling(batch) ? SETTLING_POLL_SECONDS : SETTLED_POLL_SECONDS;
}

/**
 * Whether a parsed body is a planning batch.
 *
 * Structural rather than exhaustive: the rows reach for `drafts`, the footer for `summary`, the
 * controls for `id`, `status` and `autoSize`, and a body carrying those is the batch for every
 * purpose this card has.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link PlanningBatch}.
 */
export function isPlanningBatch(value: unknown): value is PlanningBatch {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<PlanningBatch>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.autoSize === "boolean" &&
    Array.isArray(candidate.drafts) &&
    typeof candidate.summary === "object" &&
    candidate.summary !== null
  );
}

/**
 * A reader of one address, from the browser.
 *
 * @param url Where to ask — {@link batchUrl}'s answer.
 * @returns The reader. It does not throw, for the reason `requestPayload` gives.
 */
export function requestBatch(url: string): BatchReader {
  return (etag) =>
    requestPayload(url, etag, isPlanningBatch, {
      unreachable: UNREACHABLE_BATCH,
      unreadable: UNREADABLE_BATCH,
    });
}

/**
 * Build the card's loop over one address.
 *
 * @param url Where to ask. Ignored when `options.read` is given.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createBatchPoll(url: string, options: BatchPollOptions = {}): Poll<PlanningBatch> {
  return createPoll(options.read ?? requestBatch(url), options);
}
