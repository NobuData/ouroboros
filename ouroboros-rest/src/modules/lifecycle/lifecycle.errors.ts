/**
 * What the workspace lifecycle refuses with (BR.5, [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * Every code here is documented in `openapi.yaml` (and, for the two dispatch refusals, in
 * `openapi.internal.yaml`) beside the operations that answer with it.
 */

import type { WorkspaceLifecycleState } from "../db/schema";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  UnauthenticatedError,
} from "../errors/error.envelope";
import type { LifecycleMove } from "./lifecycle.states";

/** The stable codes. */
export const LIFECYCLE_ERRORS = {
  /** A dispatch point declined: the workspace is paused. */
  workspacePaused: "workspace_paused",
  /** A dispatch point declined, or a surface is frozen: the workspace is pending deletion. */
  workspacePendingDelete: "workspace_pending_delete",
  /** The state machine has no such move from where the workspace stands. */
  stateConflict: "workspace_state_conflict",
  /** A destructive operation was sent without its explicit confirmation. */
  confirmationRequired: "confirmation_required",
  /** The typed workspace name is not exactly the workspace's name. */
  nameMismatch: "workspace_name_mismatch",
  /** No recent re-authentication on this session. */
  stepUpRequired: "step_up_required",
} as const;

/**
 * `409` — a dispatch point declined to start new work (the ingest routes, for the engine).
 *
 * A hold rather than a failure: the caller should keep what it has and ask again later. Work
 * already in flight is never refused — only a run opening or a stage starting.
 *
 * @param state - The workspace's state; never `active`.
 * @returns The error to throw.
 */
export function workspaceNotAdmitting(state: WorkspaceLifecycleState): ConflictError {
  return state === "paused"
    ? new ConflictError(
        LIFECYCLE_ERRORS.workspacePaused,
        "This workspace is paused. Work in flight finishes its stage; nothing new starts until it resumes.",
        { state },
      )
    : new ConflictError(
        LIFECYCLE_ERRORS.workspacePendingDelete,
        "This workspace is pending deletion. Nothing new starts.",
        { state },
      );
}

/**
 * `403` — the workspace is pending deletion, and every surface is frozen behind the recovery
 * screen. `details.restorable` tells the client whether this caller is an owner who may restore.
 *
 * @param purgeAfter - When the recovery window closes.
 * @param restorable - Whether the caller holds the owner role.
 * @returns The error to throw.
 */
export function workspaceFrozen(purgeAfter: Date | null, restorable: boolean): ForbiddenError {
  return new ForbiddenError(
    LIFECYCLE_ERRORS.workspacePendingDelete,
    "This workspace is pending deletion. Only an owner can restore it before the recovery window closes.",
    { purgeAfter: purgeAfter?.toISOString() ?? null, restorable },
  );
}

/**
 * `409` — no such move from the workspace's current state.
 *
 * @param move - What was asked.
 * @param state - Where the workspace stands.
 * @returns The error to throw.
 */
export function stateConflict(
  move: LifecycleMove | "disconnect",
  state: WorkspaceLifecycleState,
): ConflictError {
  return new ConflictError(
    LIFECYCLE_ERRORS.stateConflict,
    `A workspace that is ${state} cannot be asked to ${move}.`,
    { move, state },
  );
}

/**
 * `409` — a restore arrived after the purge began: the workspace's keys may already be destroyed,
 * so it cannot come back (#490). The same code as any other impossible move; `details.purge` says
 * why this one is.
 *
 * @returns The error to throw.
 */
export function purgeStarted(): ConflictError {
  return new ConflictError(
    LIFECYCLE_ERRORS.stateConflict,
    "This workspace's purge has begun and it can no longer be restored.",
    { move: "restore", state: "pending_delete", purge: "started" },
  );
}

/**
 * `400` — the body did not carry `confirm: true`.
 *
 * @param operation - Which operation, for the message.
 * @returns The error to throw.
 */
export function confirmationRequired(operation: string): BadRequestError {
  return new BadRequestError(
    LIFECYCLE_ERRORS.confirmationRequired,
    `Confirm the ${operation} explicitly: send "confirm": true.`,
    { operation },
  );
}

/**
 * `422` — the typed name is not exactly the workspace's name. The expected name is not echoed:
 * the person deleting it can read it on the page, and the point of typing it is that they did.
 *
 * @returns The error to throw.
 */
export function nameMismatch(): InvalidRequestError {
  return new InvalidRequestError(
    LIFECYCLE_ERRORS.nameMismatch,
    "Type the workspace's name exactly to confirm deletion.",
  );
}

/**
 * `401` — deletion needs a recent re-authentication, exactly as revealing a credential does.
 *
 * @param methods - The step-up methods this build accepts.
 * @param maxAgeSeconds - How recent counts.
 * @returns The error to throw.
 */
export function stepUpRequired(
  methods: readonly string[],
  maxAgeSeconds: number,
): UnauthenticatedError {
  return new UnauthenticatedError(
    LIFECYCLE_ERRORS.stepUpRequired,
    "Deleting a workspace needs a recent re-authentication.",
    { methods: [...methods], maxAgeSeconds },
  );
}
