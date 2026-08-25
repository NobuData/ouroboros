/**
 * A tracked pull as the contract publishes it
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)).
 *
 * `providers/provider.pulls.ts` is the tracker — the half AC.4 ([#219](https://github.com/NobuData/ouroboros/issues/219))
 * built so that *reload the page mid-pull and it is still at 61%* is a property of where the
 * progress lives. This is the other half: the shape a page polls, which is the tracker's record
 * with its dates as strings and nothing added. There is nothing to add — every field a
 * pull-list row draws is already the tracker's, and a resource that computed a second opinion
 * about a percentage would be the drift `pullPercent` exists to prevent.
 */

import type { ModelPullRecord, ModelPullState } from "../providers/provider.pulls";
import type { ProviderErrorClass } from "../providers/provider.errors";

/** One pull, as a page reads it. */
export interface ModelPullResource {
  /** The connection the pull is on. */
  readonly connectionId: string;
  /** The model, in the daemon's own spelling. */
  readonly modelId: string;
  /** `queued`, `running`, `succeeded` or `failed`. */
  readonly state: ModelPullState;
  /** What is happening, in the daemon's own words — `pulling manifest`, `downloading`. */
  readonly status: string;
  /** Bytes transferred so far, or null while the daemon has not said. */
  readonly completedBytes: number | null;
  /** Bytes in total, or null while the daemon has not said. */
  readonly totalBytes: number | null;
  /** Whole percent complete, or null while it is not known — an indeterminate bar, never `0%`. */
  readonly percent: number | null;
  /** When it was asked for, ISO 8601. */
  readonly queuedAt: string;
  /** When it became the connection's active pull, or null while queued. */
  readonly startedAt: string | null;
  /** When it reached a terminal state, or null until it has. */
  readonly finishedAt: string | null;
  /** The taxonomy's class behind a failure, or null — including on a failure this service caused. */
  readonly errorClass: ProviderErrorClass | null;
  /** The sentence a failure renders as, or null. */
  readonly detail: string | null;
}

/** Every pull known for one connection. */
export interface ModelPullsResource {
  /** The connection. */
  readonly connectionId: string;
  /** The pulls, oldest request first. Empty for a connection nothing has pulled on. */
  readonly pulls: readonly ModelPullResource[];
}

/**
 * One record as a resource.
 *
 * @param record - The tracker's snapshot.
 * @returns The resource.
 */
export function pullResource(record: ModelPullRecord): ModelPullResource {
  return {
    connectionId: record.connectionId,
    modelId: record.modelId,
    state: record.state,
    status: record.status,
    completedBytes: record.completedBytes,
    totalBytes: record.totalBytes,
    percent: record.percent,
    queuedAt: record.queuedAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    errorClass: record.errorClass,
    detail: record.detail,
  };
}

/**
 * A connection's pulls as one payload.
 *
 * @param connectionId - The connection.
 * @param records - The tracker's records, in its order.
 * @returns The resource.
 */
export function pullsResource(
  connectionId: string,
  records: readonly ModelPullRecord[],
): ModelPullsResource {
  return { connectionId, pulls: records.map(pullResource) };
}
