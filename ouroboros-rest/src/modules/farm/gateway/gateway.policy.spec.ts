import { decode, encode, frame } from "../protocol/protocol";
import { newPrefixedId, wireId } from "../protocol/ulid";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_JITTER_MS,
  MISSED_HEARTBEATS,
  PRESENCE_SWEEP_INTERVAL_MS,
  PRESENCE_THRESHOLD_MS,
  SESSION_LIMITS,
} from "./gateway.policy";

describe("the gateway's policy", () => {
  it("documents the presence threshold as three missed beats plus the jitter — 32 seconds", () => {
    expect(MISSED_HEARTBEATS).toBe(3);
    expect(PRESENCE_THRESHOLD_MS).toBe(3 * HEARTBEAT_INTERVAL_MS + HEARTBEAT_JITTER_MS);
    expect(PRESENCE_THRESHOLD_MS).toBe(32_000);
  });

  it("is stale by at most threshold plus sweep interval — the 37 seconds the docs promise", () => {
    expect(PRESENCE_THRESHOLD_MS + PRESENCE_SWEEP_INTERVAL_MS).toBe(37_000);
  });

  it("never calls one lost beat a dead machine: two late gaps back to back stay inside the window", () => {
    // An agent beats every interval ± jitter, so the longest legitimate gap is interval + jitter;
    // one frame lost on the network makes a gap of two of those.
    const oneLostBeat = 2 * (HEARTBEAT_INTERVAL_MS + HEARTBEAT_JITTER_MS);

    expect(oneLostBeat).toBeLessThan(PRESENCE_THRESHOLD_MS);
  });

  it("hands out session limits an ack can legally carry — each at or below v1.json's ceiling", () => {
    const ack = frame("ack", {
      session: newPrefixedId("sess"),
      protocol: 1,
      resumed: false,
      runner: {
        id: wireId("rnr", "7f000002-0000-4000-8000-000000000001"),
        name: "forge-01",
        pool: "pool-a",
      },
      limits: SESSION_LIMITS,
    });

    expect(decode(encode(ack)).diagnostics).toEqual([]);
  });

  it("matches the golden ack's limits, which the Go agent's suites run against", () => {
    const golden = decode(
      JSON.stringify({
        v: 1,
        type: "ack",
        id: "01KE7EFQYQ1P7VEMQ3GJSX6YN0",
        payload: {
          session: "sess_01KE7MV3WKAG706QMDN23AJ3BE",
          protocol: 1,
          resumed: false,
          runner: {
            id: "rnr_01KE76X95CS69B659HTXZJ0HA3",
            name: "shed-pi-01",
            pool: "arm-builders",
          },
          limits: SESSION_LIMITS,
        },
      }),
    );

    expect(golden.diagnostics).toEqual([]);
    expect(SESSION_LIMITS).toEqual({
      heartbeat_interval_ms: 10000,
      heartbeat_jitter_ms: 2000,
      log_chunk_max_bytes: 32768,
      log_rate_bytes_per_s: 262144,
      offer_ack_ms: 5000,
      resume_window_ms: 300000,
    });
  });
});
