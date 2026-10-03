/**
 * The workspace state machine — mockup 17's Danger zone as a table (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * ```
 * active ──pause──▶ paused ──resume──▶ active
 * active | paused ──delete (owner · typed name · step-up)──▶ pending_delete
 * pending_delete ──restore (owner, within 30 days)──▶ active
 * pending_delete ──purge (system, day 30)──▶ (gone: DEK destroyed, tombstone kept)
 * ```
 *
 * Pure: no database, no clock. The service decides *who* may ask for a move; this file decides
 * which moves exist at all, so a request for one that does not is a `409` with nothing written.
 */

import type { WorkspaceLifecycleState } from "../db/schema";

/** How long a deleted workspace stays recoverable, in days — the card's *"30-day recovery window"*. */
export const RECOVERY_WINDOW_DAYS = 30;

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The operations that move a workspace between states. The purge ends the machine. */
export type LifecycleMove = "pause" | "resume" | "delete" | "restore";

/**
 * Where each move may start, and where it lands.
 *
 * `delete` may start from `paused` as well as `active`: an owner who paused first and then decided
 * to delete has done nothing wrong. `pause` from `paused` is refused rather than a no-op, so a
 * double-click cannot write a second audit row claiming a second pause happened.
 */
export const LIFECYCLE_MOVES: Readonly<
  Record<
    LifecycleMove,
    { readonly from: readonly WorkspaceLifecycleState[]; readonly to: WorkspaceLifecycleState }
  >
> = {
  pause: { from: ["active"], to: "paused" },
  resume: { from: ["paused"], to: "active" },
  delete: { from: ["active", "paused"], to: "pending_delete" },
  restore: { from: ["pending_delete"], to: "active" },
};

/**
 * May this move start from this state?
 *
 * @param move - The requested operation.
 * @param from - Where the workspace stands now.
 * @returns Whether the machine allows it.
 */
export function canMove(move: LifecycleMove, from: WorkspaceLifecycleState): boolean {
  return LIFECYCLE_MOVES[move].from.includes(from);
}

/**
 * When a deletion requested at `requestedAt` becomes purgeable.
 *
 * @param requestedAt - When the owner asked.
 * @returns `requestedAt` plus {@link RECOVERY_WINDOW_DAYS} days.
 */
export function purgeAfter(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + RECOVERY_WINDOW_DAYS * DAY_MS);
}

/**
 * Whether new work may start in a workspace in this state — the question every dispatch point
 * asks. Only `active` admits; `paused` holds and `pending_delete` stops everything.
 *
 * @param state - The workspace's state.
 * @returns `true` only for `active`.
 */
export function admitsNewWork(state: WorkspaceLifecycleState): boolean {
  return state === "active";
}
