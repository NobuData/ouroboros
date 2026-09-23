import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { BAD_TRANSCRIPT_CURSOR, UNREACHABLE_TRANSCRIPT } from "@/app/runs/transcript-poll";

import { SEEDED_RUN_ID, eventsPage } from "../helpers/runs";

/** The transcript's tail, read for the poll (#312): the cursor checked first, the cadence the service's. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { BAD_RUN_ID, readRunEvents } = await import("@/app/api/run-events");

describe("readRunEvents", () => {
  it("reads from the cursor asked for, answering at the service's cadence", async () => {
    const read = vi.fn().mockResolvedValue(eventsPage({ pollAfter: 5 }));

    const answer = await readRunEvents(SEEDED_RUN_ID, "4", read);

    expect(read.mock.calls[0]![0]).toBe(SEEDED_RUN_ID);
    expect(read.mock.calls[0]![1]).toBe(4);
    expect(read.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
    expect(answer).toMatchObject({ state: "fresh", pollAfterSeconds: 5 });
  });

  it("reads from the start when no cursor is given", async () => {
    const read = vi.fn().mockResolvedValue(eventsPage());

    await readRunEvents(SEEDED_RUN_ID, null, read);

    expect(read.mock.calls[0]![1]).toBe(0);
  });

  it("refuses a cursor or an id it cannot use, before asking", async () => {
    const read = vi.fn();

    for (const after of ["-1", "1.5", "x", "9".repeat(20)]) {
      expect(await readRunEvents(SEEDED_RUN_ID, after, read)).toEqual({
        state: "failed",
        reason: BAD_TRANSCRIPT_CURSOR,
        pollAfterSeconds: null,
      });
    }
    expect(await readRunEvents("..", "0", read)).toEqual({ state: "failed", reason: BAD_RUN_ID, pollAfterSeconds: null });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a 401 as gone, a refusal as the service's sentence, a dropped read as unreachable", async () => {
    expect(await readRunEvents(SEEDED_RUN_ID, "0", vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "x")))).toEqual({
      state: "gone",
    });
    expect(
      await readRunEvents(SEEDED_RUN_ID, "0", vi.fn().mockRejectedValue(new ApiError(404, "run_not_found", "No such run."))),
    ).toEqual({ state: "failed", reason: "No such run.", pollAfterSeconds: null });
    expect(await readRunEvents(SEEDED_RUN_ID, "0", vi.fn().mockRejectedValue(new TypeError("x")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_TRANSCRIPT,
      pollAfterSeconds: null,
    });
  });
});
