import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import type { ConflictError } from "../errors/error.envelope";
import { StageTransitionDto } from "./ingest.dto";
import { assertEpoch } from "./ingest.fence";
import {
  CheckpointRunDto,
  FinishRunDto,
  HeartbeatDto,
  MAX_CHECKPOINT_BYTES,
  StartRunDto,
  jsonbTextBytes,
} from "./run-execution.dto";

/**
 * The execution bridge's bodies (#160) and the optional epoch on the AP.1 reports: what the
 * global pipe lets through, and what it refuses as `422`.
 */

/** The properties a body fails on, as the pipe would report them. */
function failures<T extends object>(type: new () => T, body: object): string[] {
  return validateSync(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

describe("the execution bodies", () => {
  it("takes a worker named the way a claim names it", () => {
    expect(failures(StartRunDto, { worker: "engine-worker-a" })).toEqual([]);
    expect(failures(StartRunDto, { worker: " padded" })).toEqual(["worker"]);
    expect(failures(StartRunDto, { worker: "w".repeat(129) })).toEqual(["worker"]);
    expect(failures(StartRunDto, {})).toEqual(["worker"]);
  });

  it("requires a positive whole epoch on every write after the start", () => {
    expect(failures(HeartbeatDto, { epoch: 1 })).toEqual([]);
    expect(failures(HeartbeatDto, { epoch: 0 })).toEqual(["epoch"]);
    expect(failures(HeartbeatDto, { epoch: 1.5 })).toEqual(["epoch"]);
    expect(failures(HeartbeatDto, {})).toEqual(["epoch"]);
  });

  it("takes a checkpoint's object state and an optional forty-hex base commit", () => {
    expect(failures(CheckpointRunDto, { epoch: 1, state: { position: "code" } })).toEqual([]);
    expect(
      failures(CheckpointRunDto, { epoch: 1, state: {}, base_commit: "a".repeat(40) }),
    ).toEqual([]);
    expect(failures(CheckpointRunDto, { epoch: 1, state: {}, base_commit: "abc123" })).toEqual([
      "base_commit",
    ]);
    expect(failures(CheckpointRunDto, { epoch: 1, state: ["code"] })).toEqual(["state"]);
  });

  it("refuses a state past 64 KiB as PostgreSQL renders it, not as JSON.stringify does", () => {
    // Compact JSON would fit; jsonb's ", " and ": " push it over.
    const entries = Object.fromEntries(
      Array.from({ length: 6000 }, (_, index) => [`k${String(index).padStart(4, "0")}`, 1]),
    );

    expect(Buffer.byteLength(JSON.stringify(entries))).toBeLessThan(MAX_CHECKPOINT_BYTES);
    expect(jsonbTextBytes(entries)).toBeGreaterThan(MAX_CHECKPOINT_BYTES);
    expect(failures(CheckpointRunDto, { epoch: 1, state: entries })).toEqual(["state"]);
  });

  it("renders jsonb's spacing", () => {
    expect(jsonbTextBytes({ a: [1, "x"], b: null })).toBe('{"a": [1, "x"], "b": null}'.length);
  });

  it("takes a finish with one of four outcomes and a bounded reason", () => {
    const finish = { epoch: 1, idempotency_key: "k", outcome: "back_to_queue", reason: "x" };

    expect(failures(FinishRunDto, finish)).toEqual([]);
    expect(failures(FinishRunDto, { ...finish, stage_key: "implement" })).toEqual([]);
    expect(failures(FinishRunDto, { ...finish, outcome: "merged" })).toEqual(["outcome"]);
    expect(failures(FinishRunDto, { ...finish, reason: "" })).toEqual(["reason"]);
    expect(failures(FinishRunDto, { ...finish, reason: "x".repeat(501) })).toEqual(["reason"]);
    expect(failures(FinishRunDto, { ...finish, idempotency_key: " k" })).toEqual([
      "idempotency_key",
    ]);
    expect(failures(FinishRunDto, { ...finish, stage_key: "Not A Node" })).toEqual(["stage_key"]);
  });
});

describe("the epoch on the AP.1 reports", () => {
  const TRANSITION = { idempotencyKey: "k", stageKey: "implement", status: "active" };

  it("is optional, so the simulator and earlier callers are unchanged", () => {
    expect(failures(StageTransitionDto, TRANSITION)).toEqual([]);
    expect(failures(StageTransitionDto, { ...TRANSITION, epoch: 3 })).toEqual([]);
    expect(failures(StageTransitionDto, { ...TRANSITION, epoch: 0 })).toEqual(["epoch"]);
  });

  it("fences a write whose epoch is not the run's, and lets an absent one through", () => {
    expect(() => assertEpoch({ exec_epoch: 3 }, undefined)).not.toThrow();
    expect(() => assertEpoch({ exec_epoch: 3 }, 3)).not.toThrow();
    let thrown: unknown;
    try {
      assertEpoch({ exec_epoch: 3 }, 2);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ConflictError).envelope()).toMatchObject({
      code: "fenced",
      details: { current_epoch: 3 },
    });
  });
});
