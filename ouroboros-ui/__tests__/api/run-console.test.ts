import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_RUN } from "@/app/runs/console-poll";

import { SEEDED_RUN_ID, runConsole } from "../helpers/runs";

/**
 * One run, read for the console's poll (#309): the translation is `poll-read.ts`'s, and the
 * cadence is the shared default — nothing here overrides it.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readRunConsole } = await import("@/app/api/run-console");

describe("readRunConsole", () => {
  it("hands the read the id and a deadline, and answers at the shared cadence", async () => {
    const read = vi.fn().mockResolvedValue(runConsole());

    const answer = await readRunConsole(SEEDED_RUN_ID, read);

    expect(read.mock.calls[0]![0]).toBe(SEEDED_RUN_ID);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: runConsole(), etag: null, pollAfterSeconds: null });
  });

  it("reads a 401 as gone, a refusal as the service's sentence, and a dropped read as unreachable", async () => {
    expect(await readRunConsole("x", vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(
      await readRunConsole("x", vi.fn().mockRejectedValue(new ApiError(404, "run_not_found", "No such run."))),
    ).toEqual({ state: "failed", reason: "No such run.", pollAfterSeconds: null });
    expect(await readRunConsole("x", vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_RUN,
      pollAfterSeconds: null,
    });
  });
});
