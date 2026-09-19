/**
 * A heartbeat, as the telemetry snapshot mockup 08's runners table renders.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)), decision **B7**. V040's
 * `farm_telemetry_valid` names the five fields the table draws — the CPU meter, the RAM column,
 * the queue chip, and when it was sampled — and refuses anything else, so this is the one place
 * the protocol's heartbeat is translated into that shape.
 *
 * ```
 * heartbeat.cpu_pct          ─▶ cpu_pct            (0–100 on both sides)
 * heartbeat.memory_used_mb   ─▶ ram_used_bytes     (MiB on the wire, bytes in the column)
 * heartbeat.memory_total_mb  ─▶ ram_total_bytes
 * heartbeat.queue_depth      ─▶ queue_depth
 * heartbeat.sent_at          ─▶ sampled_at         (the AGENT's clock — when it measured)
 * ```
 *
 * **An unmeasured metric is left out, never zeroed** (AG.3,
 * [#245](https://github.com/NobuData/ouroboros/issues/245)). An agent whose machine cannot take a
 * reading sends `null`, and the snapshot then simply has no key for it — the shape
 * `farm_telemetry_valid` already accepts and V040 documents as the em-dash, the same shape as the
 * sweep's `{}` for a runner nobody can vouch for. A `0` in its place would draw an idle meter on
 * a machine that may be mid-build.
 *
 * **Two clocks, deliberately.** `sampled_at` is when the agent measured, on the customer's clock,
 * and says how old the numbers are; `runners.last_seen_at` is when the gateway received the beat,
 * on this service's clock, and is what presence is judged by. The protocol is explicit that the
 * control plane records its own receipt time beside the agent's rather than trusting it — a
 * machine whose clock is an hour fast must not look an hour more alive.
 */

import type { HeartbeatPayload } from "../protocol/protocol.messages";
import { MIB } from "./gateway.policy";

/**
 * The document this module writes to `runners.telemetry`. A measurement the agent could not take
 * is absent rather than zero.
 */
export interface TelemetrySnapshot {
  readonly cpu_pct?: number;
  readonly ram_used_bytes?: number;
  readonly ram_total_bytes?: number;
  readonly queue_depth: number;
  readonly sampled_at: string;
}

/**
 * The snapshot a heartbeat carries.
 *
 * @param heartbeat - The payload, already judged by the codec.
 * @returns The snapshot, without a key for each measurement the heartbeat reported as `null`.
 *   Used memory is clamped to total when both are known: `farm_telemetry_valid` refuses a bar past
 *   the end of its track, and an agent that over-reports one heartbeat should cost that
 *   heartbeat's precision rather than the write that also records it was alive.
 */
export function telemetryOf(heartbeat: HeartbeatPayload): TelemetrySnapshot {
  const { cpu_pct, memory_used_mb, memory_total_mb } = heartbeat;
  const total = memory_total_mb === null ? null : memory_total_mb * MIB;
  const used = memory_used_mb === null ? null : memory_used_mb * MIB;

  return {
    ...(cpu_pct === null ? {} : { cpu_pct }),
    ...(used === null ? {} : { ram_used_bytes: total === null ? used : Math.min(used, total) }),
    ...(total === null ? {} : { ram_total_bytes: total }),
    queue_depth: heartbeat.queue_depth,
    sampled_at: heartbeat.sent_at,
  };
}

/**
 * Whether a heartbeat says the runner is building.
 *
 * @param heartbeat - The payload.
 * @returns True for `busy`, and for any beat that reports a running job. A draining agent
 *   finishing its last build reports one too; `draining` still wins the pill, because
 *   `gateway.repository.ts` reads intent before this.
 */
export function isBuilding(heartbeat: HeartbeatPayload): boolean {
  return heartbeat.state === "busy" || heartbeat.job !== null;
}
