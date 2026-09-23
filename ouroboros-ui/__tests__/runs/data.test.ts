import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { SEEDED_RUN_ID, runConsole } from "../helpers/runs";

/**
 * The run console's first read (#309): a snapshot, a run this workspace cannot see — which the
 * route answers with its not-found page — or a failure the page draws as a banner.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readRun } = await import("@/app/runs/data");

describe("readRun", () => {
  it("finds the run the id names", async () => {
    const read = vi.fn().mockResolvedValue(runConsole());

    expect(await readRun(SEEDED_RUN_ID, read)).toEqual({ state: "found", value: runConsole() });
    expect(read).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID);
  });

  it("reads another workspace's run, and an id that is not one, as missing", async () => {
    const notFound = new ApiError(404, "run_not_found", "No such run.");
    const malformed = new ApiError(400, "validation_failed", "Not a uuid.");

    expect(await readRun("x", vi.fn().mockRejectedValue(notFound))).toEqual({ state: "missing" });
    expect(await readRun("x", vi.fn().mockRejectedValue(malformed))).toEqual({ state: "missing" });
  });

  it("reads any other refusal as a failure, in the service's own words", async () => {
    const down = new ApiError(503, "unavailable", "The database is down.");

    expect(await readRun("x", vi.fn().mockRejectedValue(down))).toEqual({
      state: "failed",
      reason: "The database is down.",
    });
  });

  it("does not turn a bug into a banner", async () => {
    await expect(readRun("x", vi.fn().mockRejectedValue(new TypeError("boom")))).rejects.toThrow("boom");
  });
});
