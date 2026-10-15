/**
 * The errors live-run admission answers with (DI.4, #1312) — the member-facing routes'. The
 * claim's own refusals are `ingest.errors.ts`', beside the claim.
 */

import { InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** The codes. Stable: the UI keys copy on them. */
export const ADMISSION_ERRORS = {
  queueItemNotFound: "queue_item_not_found",
  liveCeilingAboveMax: "live_ceiling_above_max",
} as const;

/**
 * `404` — this workspace's queue holds no such item; one of another workspace is the same
 * answer.
 *
 * @param itemId - The id that was named.
 * @returns The error to throw.
 */
export function queueItemNotFound(itemId: string): NotFoundError {
  return new NotFoundError(
    ADMISSION_ERRORS.queueItemNotFound,
    "The queue holds no such item. It may already have started.",
    { id: itemId },
  );
}

/**
 * `422` — the requested ceiling is above what this deployment allows.
 *
 * @param requested - The ceiling asked for.
 * @param maximum - `OURO_LIVE_RUN_CEILING_MAX`.
 * @returns The error to throw.
 */
export function liveCeilingAboveMax(requested: number, maximum: number): InvalidRequestError {
  return new InvalidRequestError(
    ADMISSION_ERRORS.liveCeilingAboveMax,
    `This deployment allows at most ${maximum} live runs at once per workspace (OURO_LIVE_RUN_CEILING_MAX).`,
    { requested, maximum },
  );
}
