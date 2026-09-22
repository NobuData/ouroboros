/**
 * The stage state machine — decision **R1**, as the one thing that decides whether a
 * reported transition is allowed.
 *
 * V045 gave `run_stages` five statuses and a `run_stages_clock` CHECK pairing each with the
 * timestamps it may carry. What the schema cannot state is which status may follow which,
 * because that is a fact about the row's *previous* value and a CHECK only sees the new one.
 * So the machine lives here, and the issue is explicit about what it is worth:
 *
 * > Without transition validation, a stage can jump from `pending` to `succeeded` and the
 * > stepper renders a lie.
 *
 * ```
 *        ┌──────────────────────────────────────── skipped        (the path went elsewhere)
 *        │
 *   (absent) ─▶ pending ─▶ active ─▶ succeeded
 *        │          │         └────▶ failed
 *        └──────────┴─▶ active
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The four rules, and why each is a rule rather than a habit.**
 *
 *   1. **A stage may be materialised in `pending`, `active` or `skipped`, never in a terminal
 *      status.** `succeeded` out of nowhere is the lie the issue names: it would draw a ✓ on
 *      a stepper for work no row ever recorded starting.
 *   2. **Only `active` ends.** A duration is the arithmetic of two timestamps, and `finished_at`
 *      without `started_at` is refused by `run_stages_clock` anyway — this is that refusal
 *      given a code instead of a constraint name.
 *   3. **A terminal status is terminal.** `succeeded → failed` would rewrite history a reader
 *      may already have seen; a *retry* is a new row with a higher `attempt`, which is
 *      decision R1's whole point and what makes attempt 1 still answerable.
 *   4. **`skipped` is reachable from `pending` and from nothing.** A decision node forks, so
 *      which stages a run materialises depends on the path it took; a stage the path avoided
 *      is skipped whether or not anyone drew it as pending first.
 *
 * ---------------------------------------------------------------------------
 * **What is deliberately *not* here.** Whether attempt N may begin — which depends on attempt
 * N−1 having ended — is V045's `run_stages_attempt_sequence()` trigger, and whether attempt N
 * is within the pinned limit is `ingest.pin.ts` plus `attemptLimitExceeded`. Both are facts
 * about *other rows*, and folding them in here would make this table describe something other
 * than what it is named for.
 */

import type { RunStageStatus } from "../db/schema";

/**
 * Where a stage attempt may be created.
 *
 * `succeeded` and `failed` are absent, which is rule 1.
 */
export const OPENING_STAGE_STATUSES = [
  "pending",
  "active",
  "skipped",
] as const satisfies readonly RunStageStatus[];

/** One of {@link OPENING_STAGE_STATUSES}. */
export type OpeningStageStatus = (typeof OPENING_STAGE_STATUSES)[number];

/**
 * What each status may become, as one table.
 *
 * Written as an exhaustive record rather than as a list of allowed pairs, so a sixth status
 * added to `RunStageStatus` fails the compile here instead of silently having no successors
 * and refusing every move an executor makes.
 */
export const STAGE_TRANSITIONS: Readonly<Record<RunStageStatus, readonly RunStageStatus[]>> = {
  pending: ["active", "skipped"],
  active: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  skipped: [],
};

/**
 * May a stage attempt be created in this status?
 *
 * @param to - The status the transition asks for.
 * @returns `true` for the three a stage can begin in.
 */
export function isOpeningStatus(to: RunStageStatus): to is OpeningStageStatus {
  return (OPENING_STAGE_STATUSES as readonly RunStageStatus[]).includes(to);
}

/**
 * May a stage attempt move from one status to another?
 *
 * @param from - Where the row stands, or `null` when there is no row yet — which is a
 *   *creation* and is decided by {@link isOpeningStatus} instead.
 * @param to - Where the transition asks to take it.
 * @returns Whether the move is one the machine allows. A move to the status the row is
 *   already in is **not** allowed here: a redelivery is an idempotency-key replay, which is
 *   answered from the receipt ledger before the machine is ever consulted, and treating a
 *   no-op move as legal would make a *second, different* submission of the same transition
 *   silently succeed.
 */
export function canTransition(from: RunStageStatus | null, to: RunStageStatus): boolean {
  return from === null ? isOpeningStatus(to) : STAGE_TRANSITIONS[from].includes(to);
}

/**
 * Does this status mean the attempt has started?
 *
 * @param status - The status being moved to.
 * @returns `true` when `started_at` must be set — `run_stages_clock`'s rule, stated once so
 *   the writer and the reader of a row cannot disagree about it.
 */
export function hasStarted(status: RunStageStatus): boolean {
  return status === "active" || status === "succeeded" || status === "failed";
}

/**
 * Does this status mean the attempt is over?
 *
 * @param status - The status being moved to.
 * @returns `true` when `finished_at` must be set. `skipped` is **not** among them: a stage
 *   the path avoided has no clock at all, which is why `run_stages_clock` asks only that its
 *   `started_at` be null.
 */
export function hasFinished(status: RunStageStatus): boolean {
  return status === "succeeded" || status === "failed";
}
