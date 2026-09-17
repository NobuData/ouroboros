import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BATCH_ENDPOINT,
  SETTLED_POLL_SECONDS,
  SETTLING_POLL_SECONDS,
  UNREACHABLE_BATCH,
  UNREADABLE_BATCH,
  batchPollSeconds,
  batchUrl,
  createBatchPoll,
  isPlanningBatch,
  isSettling,
  requestBatch,
} from "@/app/planning/batch-poll";
import { DEFAULT_POLL_SECONDS } from "@/app/poll";

import { SEEDED_BATCH_ID, planningBatch, planningDraft, seededDrafts } from "../helpers/planning";

/**
 * The generator card's poll reader (#284): the address, the guard, the cadence a batch asks for,
 * and the answers a read can come back as. The loop itself is `poll.test.ts`'s.
 */

/**
 * A `fetch` answering one response.
 *
 * @param body What to answer with, serialised as JSON.
 * @param status The status.
 * @returns The stub.
 */
function fetching(body: unknown, status = 200) {
  const stub = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A batch with one draft the estimator has not answered for. */
const SIZING = planningBatch({ drafts: [...seededDrafts().slice(0, 5), planningDraft({ localKey: "OTA-6", estimate: null })] });

describe("the address", () => {
  it("is this origin's, with the batch's id as its last segment", () => {
    expect(batchUrl(SEEDED_BATCH_ID)).toBe(`${BATCH_ENDPOINT}/${SEEDED_BATCH_ID}`);
    expect(batchUrl("a/b")).toBe("/api/planning/batches/a%2Fb");
  });
});

describe("the cadence", () => {
  it("watches closely while a draft waits on the estimator, and at the contract's default after", () => {
    expect(isSettling(SIZING)).toBe(true);
    expect(batchPollSeconds(SIZING)).toBe(SETTLING_POLL_SECONDS);
    expect(isSettling(planningBatch())).toBe(false);
    expect(batchPollSeconds(planningBatch())).toBe(SETTLED_POLL_SECONDS);
    expect(SETTLED_POLL_SECONDS).toBe(DEFAULT_POLL_SECONDS);
    expect(SETTLING_POLL_SECONDS).toBeLessThan(DEFAULT_POLL_SECONDS);
  });

  it("does not wait on an estimator nobody asked for", () => {
    expect(isSettling({ ...SIZING, autoSize: false })).toBe(false);
  });
});

describe("isPlanningBatch", () => {
  it("accepts a batch, and refuses what merely answered on the URL", () => {
    expect(isPlanningBatch(planningBatch())).toBe(true);
    expect(isPlanningBatch(null)).toBe(false);
    expect(isPlanningBatch({ id: "x", status: "sized", autoSize: true, drafts: [] })).toBe(false);
    expect(isPlanningBatch("<html>")).toBe(false);
  });
});

describe("requestBatch", () => {
  it("answers fresh with the batch", async () => {
    const stub = fetching(planningBatch());

    const answer = await requestBatch(batchUrl(SEEDED_BATCH_ID))(null);

    expect(stub).toHaveBeenCalledOnce();
    expect(answer).toMatchObject({ state: "fresh", payload: planningBatch() });
  });

  it("carries this origin's failure sentence, and says so when the body is not a batch", async () => {
    fetching({ code: "planning_unavailable", message: "No such batch." }, 502);
    expect(await requestBatch("/api/planning/batches/x")(null)).toMatchObject({ state: "failed", reason: "No such batch." });

    fetching({ hello: "world" });
    expect(await requestBatch("/api/planning/batches/x")(null)).toMatchObject({ state: "failed", reason: UNREADABLE_BATCH });
  });

  it("says unreachable when nothing answered", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));

    expect(await requestBatch("/api/planning/batches/x")(null)).toMatchObject({ state: "failed", reason: UNREACHABLE_BATCH });
  });
});

describe("createBatchPoll", () => {
  it("reads through the seam it is given", async () => {
    const read = vi.fn(() =>
      Promise.resolve({ state: "fresh" as const, payload: planningBatch(), etag: null, pollAfterSeconds: 15 }),
    );
    const poll = createBatchPoll("/ignored", { read, visible: () => true, now: () => 1 });

    const stop = poll.start();
    await vi.waitFor(() => { expect(poll.snapshot().data).toEqual(planningBatch()); });
    stop();

    expect(read).toHaveBeenCalled();
  });
});
