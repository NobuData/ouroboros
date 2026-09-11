import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { POLL_READ_TIMEOUT_MS, readForPoll } from "@/app/api/poll-read";

/**
 * One read made for a poll (#117, shared by #119): the four answers, and the deadline handed to
 * the wire. `backlog-page.test.ts` and `backlog-detail.test.ts` hold the two readers built on it.
 */

describe("readForPoll", () => {
  it("answers fresh with what the read returned, handing it a deadline inside the cadence", async () => {
    const read = vi.fn().mockResolvedValue({ answer: 42 });

    expect(await readForPoll(read, "unreachable")).toEqual({
      state: "fresh",
      payload: { answer: 42 },
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    expect(POLL_READ_TIMEOUT_MS).toBeLessThan(15_000);
  });

  it("reads a 401 as gone, but a step-up challenge as a failure carrying its sentence", async () => {
    expect(await readForPoll(() => Promise.reject(new ApiError(401, "unauthenticated", "Sign in.")), "u")).toEqual({
      state: "gone",
    });
    expect(
      await readForPoll(() => Promise.reject(new ApiError(401, "step_up_required", "Confirm it is you.")), "u"),
    ).toEqual({ state: "failed", reason: "Confirm it is you.", pollAfterSeconds: null });
  });

  it("carries the service's sentence for a refusal, and the caller's for a read that never arrived", async () => {
    expect(await readForPoll(() => Promise.reject(new ApiError(503, "unavailable", "Not answering.")), "u")).toEqual({
      state: "failed",
      reason: "Not answering.",
      pollAfterSeconds: null,
    });
    expect(await readForPoll(() => Promise.reject(new TypeError("fetch failed")), "Nothing answered.")).toEqual({
      state: "failed",
      reason: "Nothing answered.",
      pollAfterSeconds: null,
    });
  });
});
