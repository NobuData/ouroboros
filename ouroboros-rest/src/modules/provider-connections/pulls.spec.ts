import type { ModelPullRecord } from "../providers/provider.pulls";
import { pullResource, pullsResource } from "./pulls";

/**
 * A tracked pull as the contract publishes it ([#230](https://github.com/NobuData/ouroboros/issues/230)).
 *
 * The tracker's record with its dates as strings and nothing else: every assertion here is
 * that a field crosses unchanged, because a resource with an opinion of its own about a
 * percentage is the drift `pullPercent` exists to prevent.
 */

const CONNECTION = "5eed000c-0000-4000-8000-000000000005";

function record(overrides: Partial<ModelPullRecord> = {}): ModelPullRecord {
  return {
    connectionId: CONNECTION,
    modelId: "llama4:scout",
    state: "running",
    status: "downloading",
    completedBytes: 41_263_898_296,
    totalBytes: 67_645_734_912,
    percent: 61,
    queuedAt: new Date("2026-08-25T10:00:00.000Z"),
    startedAt: new Date("2026-08-25T10:00:00.200Z"),
    finishedAt: null,
    errorClass: null,
    detail: null,
    ...overrides,
  };
}

describe("one pull as a resource", () => {
  it("carries the record's own facts, with its instants in ISO 8601", () => {
    expect(pullResource(record())).toEqual({
      connectionId: CONNECTION,
      modelId: "llama4:scout",
      state: "running",
      status: "downloading",
      completedBytes: 41_263_898_296,
      totalBytes: 67_645_734_912,
      percent: 61,
      queuedAt: "2026-08-25T10:00:00.000Z",
      startedAt: "2026-08-25T10:00:00.200Z",
      finishedAt: null,
      errorClass: null,
      detail: null,
    });
  });

  it("keeps a queued pull's absences as nulls — nothing has been asked of the daemon yet", () => {
    const resource = pullResource(
      record({
        state: "queued",
        status: "queued",
        completedBytes: null,
        totalBytes: null,
        percent: null,
        startedAt: null,
      }),
    );

    expect(resource).toMatchObject({
      state: "queued",
      percent: null,
      completedBytes: null,
      totalBytes: null,
      startedAt: null,
      finishedAt: null,
    });
  });

  it("carries a failure's class and sentence, and its finishing instant", () => {
    const resource = pullResource(
      record({
        state: "failed",
        finishedAt: new Date("2026-08-25T10:05:00.000Z"),
        errorClass: "upstream",
        detail: "the pull ended before the host reported success",
      }),
    );

    expect(resource).toMatchObject({
      state: "failed",
      finishedAt: "2026-08-25T10:05:00.000Z",
      errorClass: "upstream",
      detail: "the pull ended before the host reported success",
    });
  });
});

describe("a connection's pulls as one payload", () => {
  it("names the connection and keeps the tracker's order", () => {
    const resource = pullsResource(CONNECTION, [
      record({ modelId: "first" }),
      record({ modelId: "second", state: "queued" }),
    ]);

    expect(resource.connectionId).toBe(CONNECTION);
    expect(resource.pulls.map((pull) => pull.modelId)).toEqual(["first", "second"]);
  });

  it("answers an empty list for a connection nothing has pulled on", () => {
    expect(pullsResource(CONNECTION, [])).toEqual({ connectionId: CONNECTION, pulls: [] });
  });
});
