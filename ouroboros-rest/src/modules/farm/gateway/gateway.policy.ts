/**
 * Every number the agent gateway runs on, once — and the arithmetic that makes the presence
 * threshold a documented figure rather than an emergent one.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). `farm.policy.ts` is the same
 * idea for AH.2's numbers, and the reason is the same: a figure written in two places is a
 * figure that will disagree with itself, and these ones are read by an agent on a customer's
 * machine that nobody can force to re-read them.
 *
 * ---------------------------------------------------------------------------
 * **The session limits travel in `ack`, so none of these is compiled into an agent.** That is
 * the protocol's whole argument for sending them (`docs/RUNNER_PROTOCOL.md` § 4.1): a fleet on
 * hardware this service does not own can be re-tuned by changing this file and deploying the
 * gateway, without a release of the agent. Each one is at or below the ceiling `v1.json`
 * publishes for it, which `gateway.policy.spec.ts` holds by decoding an `ack` built from them.
 *
 * **Presence is inferred, never announced** — except by a `bye`. A runner that stops
 * heartbeating is `offline` after {@link PRESENCE_THRESHOLD_MS}: three missed intervals plus the
 * jitter half-width, so the latest a live agent's third beat can legitimately arrive is still
 * inside the window. One missed beat is a network; three is a machine. The sweep that applies
 * it runs every {@link PRESENCE_SWEEP_INTERVAL_MS}, so the farm table is stale by at most the
 * sum — 37 seconds — and that is the figure the issue asks to have documented.
 */

import type { Limits } from "../protocol/protocol.messages";

/** Where agents connect: `wss://<control plane>/api/v1/farm/agent`. */
export const GATEWAY_PATH = "/api/v1/farm/agent";

/** The nominal heartbeat period an agent is told to keep. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Half-width of the jitter an agent adds to each heartbeat. */
export const HEARTBEAT_JITTER_MS = 2_000;

/** How many consecutive heartbeats may be missed before a runner is `offline`. */
export const MISSED_HEARTBEATS = 3;

/**
 * How long after its last genuine heartbeat a runner is presumed gone — 32 seconds.
 *
 * `last_seen_at` is never moved by the sweep that applies this; it stays at the last beat that
 * actually arrived, which is what mockup 08's `last seen 2h ago` is computed from.
 */
export const PRESENCE_THRESHOLD_MS =
  MISSED_HEARTBEATS * HEARTBEAT_INTERVAL_MS + HEARTBEAT_JITTER_MS;

/** How often the presence sweep runs, before `scheduling/cadence.ts`'s jitter. */
export const PRESENCE_SWEEP_INTERVAL_MS = 5_000;

/** How long an agent has to answer a `job.offer`. */
export const OFFER_ACK_MS = 5_000;

/** How long a session survives a dropped socket, for `hello.resume` to reclaim it. */
export const RESUME_WINDOW_MS = 300_000;

/** The largest decoded `log.chunk` this gateway accepts — the protocol's own ceiling. */
export const LOG_CHUNK_MAX_BYTES = 32_768;

/** The sustained decoded-byte rate an agent throttles its log to: 256 KiB/s. */
export const LOG_RATE_BYTES_PER_S = 262_144;

/**
 * How long a connection may stay silent before its first frame.
 *
 * A socket that upgrades and never says `hello` holds a file descriptor and proves nothing;
 * the Go agent writes its hello the moment the upgrade completes, so ten seconds is generous.
 */
export const HELLO_TIMEOUT_MS = 10_000;

/**
 * How many frames one session may hold undelivered.
 *
 * A detached session keeps its offers and receipts for the resume window, and a bound is what
 * stops a runner that never comes back from being a place memory goes. Past it, a new offer is
 * refused to its caller — the job stays queued — rather than evicting one already promised.
 */
export const MAX_PENDING_FRAMES = 256;

/**
 * The window a gateway's `bye {server_shutdown}` spreads its fleet's reconnections over.
 *
 * A gateway that told a thousand agents to come back *now* would be a denial of service it
 * inflicted on itself; each agent is given its own point inside this range instead.
 */
export const SHUTDOWN_RECONNECT_SPREAD_MS = { min: 1_000, max: 30_000 } as const;

/**
 * The `deadline_ms` a re-sent `drain` carries.
 *
 * A runner drained while it was disconnected is told again when it reconnects, and the
 * original deadline — advisory in any case — has no meaning an hour later. Zero is the
 * protocol's *no grace*, and the agent still finishes the job it holds.
 */
export const REDRAIN_DEADLINE_MS = 0;

/** The bytes in a mebibyte — the protocol reports memory in MiB and V040 stores bytes. */
export const MIB = 1_048_576;

/** The limits every `ack` carries. */
export const SESSION_LIMITS: Limits = {
  heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
  heartbeat_jitter_ms: HEARTBEAT_JITTER_MS,
  log_chunk_max_bytes: LOG_CHUNK_MAX_BYTES,
  log_rate_bytes_per_s: LOG_RATE_BYTES_PER_S,
  offer_ack_ms: OFFER_ACK_MS,
  resume_window_ms: RESUME_WINDOW_MS,
};
