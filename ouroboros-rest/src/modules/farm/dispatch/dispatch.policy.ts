/**
 * Every number build dispatch runs on, once.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). `gateway.policy.ts` is the
 * same idea for the gateway's numbers, and two of these are derived from it rather than restated:
 * how long an offer may go unanswered, and how long a runner may be gone before its work is
 * taken back. Constants rather than settings, for `gateway.policy.ts`'s reason — they are
 * behaviour, not deployment facts.
 *
 * ```
 * job.offer ── OFFER_ACK_MS ── + OFFER_EXPIRY_GRACE_MS ──▶ unanswered: back to the queue
 * runner silent ── PRESENCE (32 s) ──▶ offline ── + RESUME_WINDOW_MS (5 min) ──▶ lost: requeue / retry
 * job.decline ──▶ that runner is not offered that job again for DECLINE_COOLDOWN_MS
 * ```
 */

import { OFFER_ACK_MS, RESUME_WINDOW_MS } from "../gateway/gateway.policy";

/** How often the dispatcher sweeps and drains the queue, before `scheduling/cadence.ts`'s jitter. */
export const DISPATCH_INTERVAL_MS = 2_000;

/** How many waiting jobs one pass considers, oldest first. The next pass takes the rest. */
export const DISPATCH_BATCH = 50;

/**
 * How long past its `expires_at` an unanswered offer is left before it is taken back.
 *
 * The agent refuses an offer that arrives expired (`job.decline {expired}`), so the grace is only
 * for an answer already on the wire when the offer lapsed — without it, a busy gateway would
 * reclaim a job whose accept it had not read yet and then have to cancel it on the agent.
 */
export const OFFER_EXPIRY_GRACE_MS = 5_000;

/** How old an `offered` row may be before the dispatcher takes it back. */
export const OFFER_RECLAIM_MS = OFFER_ACK_MS + OFFER_EXPIRY_GRACE_MS;

/**
 * How long an offline runner's work waits for it before it is **lost**: the resume window.
 *
 * A runner that drops and resumes inside it carries on with the job it was running — the
 * protocol's `ack.resumed: true` — so taking the job back sooner would retry a build that was
 * never interrupted, and run it twice.
 */
export const LOST_RUNNER_AFTER_MS = RESUME_WINDOW_MS;

/** How long a runner that declined a job is passed over for that job. */
export const DECLINE_COOLDOWN_MS = 30_000;

/**
 * The wall-clock budget an offer carries, in seconds: six hours.
 *
 * Generous on purpose. Mockup 08's `#472` is an overnight HIL sweep, and a budget that cut a
 * legitimate build short would be reported as `timed_out` — a failure charged to the code. The
 * protocol's ceiling is a day.
 */
export const JOB_TIMEOUT_S = 21_600;

/** Where a container job's workspace is mounted — an absolute path other than `/`. */
export const CONTAINER_WORKDIR = "/workspace";

/** Where a shell job runs, inside its own workspace: `/` is the workspace's root. */
export const SHELL_WORKDIR = "/";

/**
 * How many times an infrastructure failure is retried automatically: once.
 *
 * *Requeue once, then terminal failure* is the issue's policy, and it is what makes mockup 08's
 * `3 retried` a meaningful number rather than an unbounded counter: an infrastructure failure
 * that recurs is a signal, not something to paper over. A retry is its own `build_jobs` row with
 * `retry_of` set, so an attempt is a retry exactly when that column is set — which is how the
 * bound is read.
 */
export const AUTOMATIC_RETRIES = 1;

/** The `detail` a `job.cancel` carries when an operator cancelled the build. */
export const OPERATOR_CANCEL_DETAIL = "the build was cancelled from the farm";

/** The `detail` a `job.cancel` carries when the job is no longer this runner's. */
export const REASSIGNED_CANCEL_DETAIL =
  "the control plane no longer counts this job as this runner's; it was re-dispatched or finished elsewhere";
