import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { DEFAULT_POLL_SECONDS } from "@/app/poll";
import { UNREACHABLE_CONTROLS } from "@/app/runs/controls-poll";

import { SEEDED_RUN_ID, runControl } from "../helpers/runs";

/**
 * A run's controls, read for the head's chips (#310): the translation is `poll-read.ts`'s, and
 * the cadence is this reader's — quick while a chip is still moving, the default once not.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { CONTROL_POLL_SECONDS, controlsCadence, readRunControls } = await import("@/app/api/run-controls");

describe("controlsCadence", () => {
  it("asks for the quick cadence while any control is queued or fetched", () => {
    expect(controlsCadence({ controls: [runControl({ state: "pending" })] })).toBe(CONTROL_POLL_SECONDS);
    expect(
      controlsCadence({ controls: [runControl({ state: "acked" }), runControl({ state: "delivered" })] }),
    ).toBe(CONTROL_POLL_SECONDS);
  });

  it("goes back to the shared default once nothing is on its way", () => {
    expect(controlsCadence({ controls: [] })).toBe(DEFAULT_POLL_SECONDS);
    expect(
      controlsCadence({ controls: [runControl({ state: "acked" }), runControl({ state: "expired" })] }),
    ).toBe(DEFAULT_POLL_SECONDS);
  });

  it("is quicker than the default, and never below the contract's floor", () => {
    expect(CONTROL_POLL_SECONDS).toBeLessThan(DEFAULT_POLL_SECONDS);
    expect(CONTROL_POLL_SECONDS).toBeGreaterThanOrEqual(1);
  });
});

describe("readRunControls", () => {
  it("hands the read the id and a deadline, and answers with the cadence attached", async () => {
    const list = { controls: [runControl({ state: "pending" })] };
    const read = vi.fn().mockResolvedValue(list);

    const answer = await readRunControls(SEEDED_RUN_ID, read);

    expect(read.mock.calls[0]![0]).toBe(SEEDED_RUN_ID);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: list, etag: null, pollAfterSeconds: CONTROL_POLL_SECONDS });
  });

  it("reads a 401 as gone, a refusal as the service's sentence, and a dropped read as unreachable", async () => {
    expect(
      await readRunControls("x", vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in."))),
    ).toEqual({ state: "gone" });
    expect(
      await readRunControls("x", vi.fn().mockRejectedValue(new ApiError(404, "run_not_found", "No such run."))),
    ).toEqual({ state: "failed", reason: "No such run.", pollAfterSeconds: null });
    expect(await readRunControls("x", vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_CONTROLS,
      pollAfterSeconds: null,
    });
  });
});
