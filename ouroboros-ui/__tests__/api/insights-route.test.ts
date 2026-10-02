import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededInsights } from "../helpers/insights";

/** `GET /api/insights` (#443): the range is parsed by the page's own parser before it is read. */

const readInsightsPage = vi.fn();

vi.mock("@/app/api/insights-page", () => ({
  INSIGHTS_UNAVAILABLE_CODE: "insights_unavailable",
  readInsightsPage: (range: string) => readInsightsPage(range),
}));

const { GET } = await import("@/app/api/insights/route");

beforeEach(() => {
  readInsightsPage.mockReset().mockResolvedValue({ state: "fresh", payload: seededInsights(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/insights", () => {
  it("reads the range the poll names, and answers the page", async () => {
    const response = await GET(new Request("http://ui.test/api/insights?range=90d"));

    expect(readInsightsPage).toHaveBeenCalledExactlyOnceWith("90d");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(seededInsights());
  });

  it("reads the default for no range or one the service would refuse, never passing on a 422", async () => {
    await GET(new Request("http://ui.test/api/insights"));
    await GET(new Request("http://ui.test/api/insights?range=custom"));

    expect(readInsightsPage.mock.calls).toEqual([["30d"], ["30d"]]);
  });

  it("answers a failure under this hop's code", async () => {
    readInsightsPage.mockResolvedValue({ state: "failed", reason: "Choose a workspace.", pollAfterSeconds: null });

    const response = await GET(new Request("http://ui.test/api/insights?range=7d"));

    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "insights_unavailable", message: "Choose a workspace." });
  });
});
