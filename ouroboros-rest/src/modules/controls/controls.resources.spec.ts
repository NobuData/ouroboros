import type { RunControl } from "../db/schema";
import { pendingControlResource, runControlResource } from "./controls.resources";

/**
 * The two shapes (#306), and the property that separates them: the console's never carries
 * the steer text, and the executor's always does.
 */

const STEER: RunControl = {
  id: "c0000000-0000-4000-8000-000000000001",
  run_id: "5eed0009-0000-4000-8000-000000000482",
  kind: "steer",
  payload: "prefer a fix inside the ISR",
  state: "acked",
  requested_by: "user-1",
  requested_at: new Date("2026-09-22T10:00:00.000Z"),
  delivered_at: new Date("2026-09-22T10:00:05.000Z"),
  acked_at: new Date("2026-09-22T10:00:09.000Z"),
  expires_at: new Date("2026-09-22T10:05:00.000Z"),
  ack_detail: "steering applied to attempt 2",
  idempotency_key: "k-1",
  remember: true,
  retry_stage: false,
};

describe("the console's shape", () => {
  it("carries every instant as ISO text and the ack as its detail", () => {
    expect(runControlResource(STEER)).toEqual({
      id: STEER.id,
      runId: STEER.run_id,
      kind: "steer",
      state: "acked",
      requestedBy: "user-1",
      requestedAt: "2026-09-22T10:00:00.000Z",
      deliveredAt: "2026-09-22T10:00:05.000Z",
      ackedAt: "2026-09-22T10:00:09.000Z",
      expiresAt: "2026-09-22T10:05:00.000Z",
      detail: "steering applied to attempt 2",
      hasPayload: true,
      remember: true,
      retryStage: false,
    });
  });

  it("never carries the steer text", () => {
    expect(JSON.stringify(runControlResource(STEER))).not.toContain("ISR");
  });

  it("answers null for the instants that have not happened", () => {
    const pending = runControlResource({
      ...STEER,
      kind: "pause",
      payload: null,
      state: "pending",
      delivered_at: null,
      acked_at: null,
      ack_detail: null,
      remember: false,
    });

    expect(pending.deliveredAt).toBeNull();
    expect(pending.ackedAt).toBeNull();
    expect(pending.detail).toBeNull();
    expect(pending.hasPayload).toBe(false);
  });
});

describe("a correction round (#332)", () => {
  it("tells the console and the executor alike that the steer asks for the next attempt", () => {
    const correction = { ...STEER, retry_stage: true };

    expect(runControlResource(correction).retryStage).toBe(true);
    expect(pendingControlResource(correction).retryStage).toBe(true);
  });
});

describe("the executor's shape", () => {
  it("carries the steer text and the flag, and nothing about delivery", () => {
    expect(pendingControlResource(STEER)).toEqual({
      id: STEER.id,
      kind: "steer",
      payload: "prefer a fix inside the ISR",
      remember: true,
      retryStage: false,
      requestedAt: "2026-09-22T10:00:00.000Z",
      expiresAt: "2026-09-22T10:05:00.000Z",
    });
  });
});
