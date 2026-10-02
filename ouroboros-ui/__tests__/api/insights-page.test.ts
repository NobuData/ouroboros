import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_INSIGHTS } from "@/app/insights/insights-poll";

import { seededInsights } from "../helpers/insights";

/** The insights page, read for the screen's poll (#443): the range travels, the rest is `poll-read.ts`'s. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { INSIGHTS_UNAVAILABLE_CODE, readInsightsPage } = await import("@/app/api/insights-page");

describe("readInsightsPage", () => {
  it("reads the range it was asked for, with a deadline, and answers the page", async () => {
    const read = vi.fn().mockResolvedValue(seededInsights({ range: "7d" }));

    const answer = await readInsightsPage("7d", read);

    expect(read.mock.calls[0]![0]).toBe("7d");
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: seededInsights({ range: "7d" }), etag: null, pollAfterSeconds: null });
  });

  it("reads a 401 as gone, a refusal as the service's sentence, and a dropped read as unreachable", async () => {
    expect(await readInsightsPage("30d", vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(
      await readInsightsPage("30d", vi.fn().mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace."))),
    ).toEqual({ state: "failed", reason: "Choose a workspace.", pollAfterSeconds: null });
    expect(await readInsightsPage("30d", vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_INSIGHTS,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(INSIGHTS_UNAVAILABLE_CODE).toBe("insights_unavailable");
  });
});
