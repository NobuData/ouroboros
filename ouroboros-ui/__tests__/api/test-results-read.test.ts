import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_GATE, UNREACHABLE_TIMELINE } from "@/app/test-results/poll";

import { SEEDED_RUN_ID } from "../helpers/runs";
import { BUILD_3_ID, gate, timeline } from "../helpers/test-results";

/**
 * The test-results page's two reads, for its polls (#335): the translation is `poll-read.ts`'s,
 * the cadence the shared default, and a gate asked of something that is not an id is refused
 * before the service is called.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { TEST_RUN_ID_INVALID, readGateForPoll, readTimelineForPoll } = await import("@/app/api/test-results-read");

describe("readTimelineForPoll", () => {
  it("hands the read the run and a deadline, and answers fresh", async () => {
    const read = vi.fn().mockResolvedValue(timeline());

    expect(await readTimelineForPoll(SEEDED_RUN_ID, read)).toEqual({
      state: "fresh",
      payload: timeline(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBe(SEEDED_RUN_ID);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it("says the service's refusal, or its own sentence when nothing answered", async () => {
    expect(
      await readTimelineForPoll("x", vi.fn().mockRejectedValue(new ApiError(404, "run_not_found", "No such run."))),
    ).toEqual({ state: "failed", reason: "No such run.", pollAfterSeconds: null });
    expect(await readTimelineForPoll("x", vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_TIMELINE,
      pollAfterSeconds: null,
    });
  });
});

describe("readGateForPoll", () => {
  it("reads the gate of the attempt the id names", async () => {
    const read = vi.fn().mockResolvedValue(gate());

    expect(await readGateForPoll(BUILD_3_ID, read)).toEqual(expect.objectContaining({ state: "fresh", payload: gate() }));
    expect(read.mock.calls[0]![0]).toBe(BUILD_3_ID);
  });

  it("refuses an id that is not a uuid without calling out", async () => {
    const read = vi.fn();

    for (const id of ["..", "not-an-id", `${BUILD_3_ID}/../x`]) {
      expect(await readGateForPoll(id, read)).toEqual({ state: "failed", reason: TEST_RUN_ID_INVALID, pollAfterSeconds: null });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a 401 as gone, and a dropped read in its own words", async () => {
    expect(
      await readGateForPoll(BUILD_3_ID, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in."))),
    ).toEqual({ state: "gone" });
    expect(await readGateForPoll(BUILD_3_ID, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_GATE,
      pollAfterSeconds: null,
    });
  });
});
