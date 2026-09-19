/**
 * Every number build-log ingest, retrieval and retention run on, once.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)), decision **B8**. Constants rather
 * than settings, for `gateway.policy.ts`'s reason — they are behaviour, not deployment facts — with
 * one exception: the per-workspace byte budget, which is `OURO_FARM_LOG_BUDGET_BYTES`, because how
 * much disk a deployment gives build logs is exactly a deployment fact.
 *
 * ```
 * log.chunk ── ahead of a gap? held (≤ LOG_PENDING_MAX, ≤ LOG_GAP_WAIT_MS) ── then stored in seq order
 *           ── over the workspace's rate (LOG_ORG_RATE_BYTES_PER_S, LOG_ORG_BURST_BYTES)? elided, marked
 * GET …/log?after= ── at most LOG_PAGE_MAX_BYTES ── X-Ouro-Poll-After: 2 s while live, 15 s after
 * sweep, every LOG_SWEEP_INTERVAL_MS ── LOG_RETENTION_DAYS, and the workspace budget ── ≤ LOG_SWEEP_BATCH jobs
 * ```
 */

import { DEFAULT_DASHBOARD_POLL_SECONDS } from "../../config/configuration";
import { LOG_RATE_BYTES_PER_S } from "../gateway/gateway.policy";

/** One mebibyte. */
const MIB = 1_048_576;

/**
 * How many chunks one job may have waiting ahead of a gap before the gap is given up.
 *
 * `log.chunk` is not re-sent, so a gap is either a frame still on its way — overtaken across a
 * reconnect — or one that is gone. Sixty-four chunks is two mebibytes held per job at the most.
 */
export const LOG_PENDING_MAX = 64;

/** How long a gap is waited for before it is recorded as missing chunks and the log moves on. */
export const LOG_GAP_WAIT_MS = 10_000;

/** How long an ingest state nobody has written to is kept before it is flushed and forgotten. */
export const LOG_IDLE_FORGET_MS = 600_000;

/** How often stalled gaps and idle states are looked at. */
export const LOG_HOUSEKEEPING_INTERVAL_MS = 5_000;

/**
 * The sustained bytes per second one workspace's builds may stream into storage — 2 MiB/s.
 *
 * Eight agents at the rate each is told to keep (`ack.limits.log_rate_bytes_per_s`, 256 KiB/s).
 * The guard is for a runaway, not for a busy farm: one agent ignoring its throttle cannot take
 * the ingest path — and the database under it — from every other workspace.
 */
export const LOG_ORG_RATE_BYTES_PER_S = 8 * LOG_RATE_BYTES_PER_S;

/** How much one workspace may stream in a burst above its rate — 8 MiB. */
export const LOG_ORG_BURST_BYTES = 8 * MIB;

/** The most log bytes one read returns. The next read continues from its `nextOffset`. */
export const LOG_PAGE_MAX_BYTES = 262_144;

/**
 * How long a stored chunk is kept — thirty days, written onto the chunk as its `retain_until`
 * when it is stored, so a policy that changes later never reaches back into what was written
 * under the old one (V040). Also #482's default for the `build_logs` tier.
 */
export const LOG_RETENTION_DAYS = 30;

/** How often the retention sweep runs, before `scheduling/cadence.ts`'s jitter — ten minutes. */
export const LOG_SWEEP_INTERVAL_MS = 600_000;

/**
 * The most jobs one sweep removes the log of, per rule. Bounded so the sweep can never itself be
 * the load problem: a backlog is worked down a batch per run.
 */
export const LOG_SWEEP_BATCH = 200;

/** How soon a reader of a live log should ask again — `X-Ouro-Poll-After` while `live`. */
export const LOG_POLL_LIVE_SECONDS = 2;

/** How soon a reader of a finished log should ask again: the polling contract's default. */
export const LOG_POLL_DONE_SECONDS = DEFAULT_DASHBOARD_POLL_SECONDS;
