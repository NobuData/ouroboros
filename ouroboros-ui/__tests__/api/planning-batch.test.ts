import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { SETTLED_POLL_SECONDS, SETTLING_POLL_SECONDS, UNREACHABLE_BATCH } from "@/app/planning/batch-poll";

import { SEEDED_BATCH_ID, planningBatch, planningDraft } from "../helpers/planning";

/**
 * One batch, read for the generator card's poll (#284): the translation is `poll-read.ts`'s, and
 * what is this reader's own is the cadence it decides from the batch.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readPlanningBatch } = await import("@/app/api/planning-batch");

describe("readPlanningBatch", () => {
  it("hands the read the id and a deadline, and answers a settled batch at the default cadence", async () => {
    const read = vi.fn().mockResolvedValue(planningBatch());

    const answer = await readPlanningBatch(SEEDED_BATCH_ID, read);

    expect(read.mock.calls[0]![0]).toBe(SEEDED_BATCH_ID);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: planningBatch(), etag: null, pollAfterSeconds: SETTLED_POLL_SECONDS });
  });

  it("asks to be polled closely while a draft is still being sized", async () => {
    const sizing = planningBatch({ drafts: [planningDraft({ estimate: null })] });

    const answer = await readPlanningBatch(SEEDED_BATCH_ID, vi.fn().mockResolvedValue(sizing));

    expect(answer).toMatchObject({ state: "fresh", pollAfterSeconds: SETTLING_POLL_SECONDS });
  });

  it("reads a 401 as gone, a refusal as the service's sentence, and a dropped read as unreachable", async () => {
    expect(await readPlanningBatch("x", vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(
      await readPlanningBatch("x", vi.fn().mockRejectedValue(new ApiError(404, "planning_batch_not_found", "No such batch."))),
    ).toEqual({ state: "failed", reason: "No such batch.", pollAfterSeconds: null });
    expect(await readPlanningBatch("x", vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_BATCH,
      pollAfterSeconds: null,
    });
  });
});
