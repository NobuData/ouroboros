import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_FARM } from "@/app/farm/farm-poll";

import { seededFarm } from "../helpers/farm";

/**
 * The farm page, read for the screen's poll (#256): the translation is `poll-read.ts`'s, and what
 * is this reader's own is that the fresh answer carries the *service's* cadence.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { FARM_UNAVAILABLE_CODE, readFarmPage } = await import("@/app/api/farm-page");

describe("readFarmPage", () => {
  it("hands the read a deadline, and answers the page with the cadence the service asked for", async () => {
    const read = vi.fn().mockResolvedValue({ page: seededFarm(), pollAfterSeconds: 10 });

    const answer = await readFarmPage(read);

    expect(read.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    // The payload is the page itself — the observation's envelope does not reach the browser.
    expect(answer).toEqual({ state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 });
  });

  it("passes on the absence of a hint, so the loop keeps the interval it already holds", async () => {
    const answer = await readFarmPage(vi.fn().mockResolvedValue({ page: seededFarm(), pollAfterSeconds: null }));

    expect(answer).toMatchObject({ state: "fresh", pollAfterSeconds: null });
  });

  it("reads a 401 as gone, a refusal as the service's sentence, and a dropped read as unreachable", async () => {
    expect(await readFarmPage(vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(
      await readFarmPage(vi.fn().mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace."))),
    ).toEqual({ state: "failed", reason: "Choose a workspace.", pollAfterSeconds: null });
    expect(await readFarmPage(vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_FARM,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(FARM_UNAVAILABLE_CODE).toBe("farm_unavailable");
  });
});
