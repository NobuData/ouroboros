/**
 * The build job's state machine — V040's seven statuses, and which moves between them are legal.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). The vocabulary is AH.1's
 * ([#249](https://github.com/NobuData/ouroboros/issues/249)) and is not extended: `build_jobs.status`
 * stays `queued | offered | running | succeeded | failed | retried | canceled`. What this file adds
 * is the one distinction V040 draws with a column rather than a status — whether a `queued` job
 * is held by a runner — and the transition table every writer is held to.
 *
 * ```
 *  phase      status     runner   meaning
 *  waiting    queued     null     in its pool's queue, nobody's yet
 *  offered    offered    set      an offer is outstanding
 *  accepted   queued     set      accepted and not started — what the agent counts as q:N
 *  running    running    set      job.start seen
 *  succeeded · failed · retried · canceled          terminal: nothing leaves them
 * ```
 *
 * ```
 *  waiting ──offer──▶ offered ──accept──▶ accepted ──start──▶ running ──finish──▶ succeeded
 *     ▲                 │ decline,          │ runner lost          │               failed
 *     └─────────────────┴─ expiry, lost ◀───┘ before it started    ├─ infra ─────▶ retried (+ attempt 2)
 *                                                                  └─ cancel ────▶ canceled
 * ```
 *
 * ---------------------------------------------------------------------------
 * **`accepted` is `queued` with a runner, because that is what V040 and the agent both mean by
 * queue depth.** The mockup's `q:2` is work already assigned to `forge-01` and waiting behind its
 * current build (V040's `build_jobs_runner_when_dispatched` comment), and the protocol pins the
 * agent's `heartbeat.queue_depth` to *accepted and not yet started*. So the server's per-runner
 * queue depth is `status = 'queued' and runner_id = R` — an outstanding offer is not in it, which
 * is exactly why the two never disagree.
 *
 * **A finish is proof of acceptance.** An offered or accepted job may go straight to a terminal
 * status, because an agent can only finish a job it took — an image that would not pull is
 * `errored` without ever sending `job.start`. Refusing that as illegal would refuse the one frame
 * the resume design exists to deliver, and the agent would re-send it for ever.
 *
 * **An illegal transition is a bug, and it is loud.** Every writer selects the row in the state it
 * expects before it moves it, so {@link assertTransition} can only throw when the code and this
 * table disagree — and then it throws {@link InvalidJobTransitionError} rather than writing a row
 * that would make mockup 08's `19 clean · 3 retried · 1 failed` stop adding up with nothing to say
 * why. On an API path that is a `500`; on the agent's path it closes the connection without a
 * receipt, so the frame is re-sent rather than lost.
 */

import type { BuildJobStatus } from "../../db/schema";

/** Where a job is in its life — V040's status, with `queued` split by whether a runner holds it. */
export type JobPhase =
  "waiting" | "offered" | "accepted" | "running" | "succeeded" | "failed" | "retried" | "canceled";

/** Every phase, in lifecycle order. */
export const JOB_PHASES: readonly JobPhase[] = [
  "waiting",
  "offered",
  "accepted",
  "running",
  "succeeded",
  "failed",
  "retried",
  "canceled",
];

/** The phases nothing leaves — each carries a `finished_at`, and the stat row counts them. */
export const TERMINAL_PHASES: readonly JobPhase[] = ["succeeded", "failed", "retried", "canceled"];

/** The phases a runner holds a job in — what its concurrency cap is compared against. */
export const HELD_PHASES: readonly JobPhase[] = ["offered", "accepted", "running"];

/**
 * Every legal move, by the phase it leaves. A phase missing from a list is a move that cannot
 * happen; a terminal phase has no moves at all.
 */
export const TRANSITIONS: Readonly<Record<JobPhase, readonly JobPhase[]>> = {
  waiting: ["offered", "canceled"],
  offered: ["waiting", "accepted", "running", "succeeded", "failed", "retried", "canceled"],
  accepted: ["waiting", "running", "succeeded", "failed", "retried", "canceled"],
  running: ["succeeded", "failed", "retried", "canceled"],
  succeeded: [],
  failed: [],
  retried: [],
  canceled: [],
};

/** A transition the table does not allow — raised instead of writing it. */
export class InvalidJobTransitionError extends Error {
  /**
   * @param from - The phase the job is in.
   * @param to - The phase a writer tried to move it to.
   * @param jobId - The job, when the writer knows it.
   */
  constructor(
    readonly from: JobPhase,
    readonly to: JobPhase,
    readonly jobId?: string,
  ) {
    super(
      `build job ${jobId ?? "(unnamed)"} cannot move from ${from} to ${to}; ` +
        `that transition is not in farm/dispatch/job.states.ts`,
    );
    this.name = "InvalidJobTransitionError";
  }
}

/**
 * The phase a row is in.
 *
 * @param row - Its status and runner.
 * @param row.status - `build_jobs.status`.
 * @param row.runner_id - `build_jobs.runner_id`.
 * @returns The phase.
 */
export function phaseOf(row: {
  readonly status: BuildJobStatus;
  readonly runner_id: string | null;
}): JobPhase {
  if (row.status === "queued") return row.runner_id === null ? "waiting" : "accepted";
  return row.status;
}

/**
 * The status a phase is stored as.
 *
 * @param phase - The phase.
 * @returns `queued` for the two phases that share it, the phase's own name otherwise.
 */
export function statusOf(phase: JobPhase): BuildJobStatus {
  return phase === "waiting" || phase === "accepted" ? "queued" : phase;
}

/**
 * Whether a phase is terminal.
 *
 * @param phase - The phase.
 * @returns True for `succeeded`, `failed`, `retried` and `canceled`.
 */
export function isTerminal(phase: JobPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/**
 * Whether the table allows a move.
 *
 * @param from - The phase the job is in.
 * @param to - The phase it would move to.
 * @returns True when the move is legal.
 */
export function canTransition(from: JobPhase, to: JobPhase): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Hold a move to the table, before it is written.
 *
 * @param from - The phase the job is in.
 * @param to - The phase it is about to move to.
 * @param jobId - The job, for the message.
 * @throws {InvalidJobTransitionError} When the table does not allow it.
 */
export function assertTransition(from: JobPhase, to: JobPhase, jobId?: string): void {
  if (!canTransition(from, to)) throw new InvalidJobTransitionError(from, to, jobId);
}
