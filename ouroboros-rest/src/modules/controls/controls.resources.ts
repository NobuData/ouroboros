/**
 * What the control queue answers with — the console's chip, and the executor's work item (AP.4,
 * [#306](https://github.com/NobuData/ouroboros/issues/306)).
 *
 * Two shapes, because the two readers are entitled to different things:
 *
 *   * **{@link RunControlResource}** is the console's. It carries everything the ack chip draws
 *     (state, the three instants, the expiry and the detail) and **not the steer text**. The
 *     text is already in the transcript as the `user` entry this control wrote, and a second
 *     copy in every listing would be a second place for it to leak from.
 *   * **{@link PendingControlResource}** is the executor's. It carries the text, because
 *     applying a steer is the one thing that needs it.
 */

import type { RunControl, RunControlKind, RunControlState } from "../db/schema";

/** One control, as the console's ack chip reads it. */
export interface RunControlResource {
  /** `run_controls.id`. */
  readonly id: string;
  /** `runs.id`. */
  readonly runId: string;
  readonly kind: RunControlKind;
  /**
   * Where it has got to. `pending` renders *sent*, `acked` *acknowledged*, `expired` *no
   * response — the run may be between stages*, and `rejected` shows {@link detail} as the
   * reason. The last two are different states so the console can tell them apart.
   */
  readonly state: RunControlState;
  /** Who asked — `"user".id`. Null once that person has been deleted. */
  readonly requestedBy: string | null;
  readonly requestedAt: string;
  readonly deliveredAt: string | null;
  readonly ackedAt: string | null;
  readonly expiresAt: string;
  /**
   * What the ack said (*"steering applied to attempt 2"*), or why the control was rejected.
   * Null while nobody has answered.
   */
  readonly detail: string | null;
  /** Whether the control carried steering text. The text itself is in the transcript. */
  readonly hasPayload: boolean;
  /** The steer's *remember this* flag. Always false for the other kinds. */
  readonly remember: boolean;
  /**
   * Whether the steer is a correction round (#332): it also asked for the stage's next
   * attempt. Always false for the other kinds.
   */
  readonly retryStage: boolean;
}

/** One control, as the executor claims it. */
export interface PendingControlResource {
  readonly id: string;
  readonly kind: RunControlKind;
  /** The steering text, and null for every other kind. */
  readonly payload: string | null;
  /** The steer's *remember this* flag. */
  readonly remember: boolean;
  /**
   * A correction round (#332): append the text to the planning context, then start the current
   * stage's next attempt, and ack with that attempt's number. False for an ordinary steer.
   */
  readonly retryStage: boolean;
  readonly requestedAt: string;
  /** After this instant an ack is refused as `control_not_delivered` with state `expired`. */
  readonly expiresAt: string;
}

/** `POST /internal/runs/{id}/controls/fetch` — what the executor now holds. */
export interface ControlsFetchedResource {
  /** Oldest first, which is the order to apply them in. Empty when nothing was waiting. */
  readonly controls: readonly PendingControlResource[];
}

/** `GET /api/v1/runs/{id}/controls` — the run's recent controls. */
export interface RunControlsListResource {
  /** Newest first, at most `MAX_LISTED_CONTROLS`. */
  readonly controls: readonly RunControlResource[];
}

/**
 * The console's shape for a row.
 *
 * @param row - The control, as selected.
 * @returns The resource, with every instant as an ISO string and no steer text.
 */
export function runControlResource(row: RunControl): RunControlResource {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    state: row.state,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    ackedAt: row.acked_at?.toISOString() ?? null,
    expiresAt: row.expires_at.toISOString(),
    detail: row.ack_detail,
    hasPayload: row.payload !== null,
    remember: row.remember,
    retryStage: row.retry_stage,
  };
}

/**
 * The executor's shape for a row.
 *
 * @param row - The control, as claimed.
 * @returns The work item, carrying the steer text.
 */
export function pendingControlResource(row: RunControl): PendingControlResource {
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    remember: row.remember,
    retryStage: row.retry_stage,
    requestedAt: row.requested_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}
