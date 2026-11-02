import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededInsights } from "../helpers/insights";

/**
 * `GET /api/insights` (#443): the range and the data origin (DJ.3) are parsed by the page's own
 * parsers before they are read.
 */

const readInsightsPage = vi.fn();
let remembered: string | undefined;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: (name: string) => (name === "ouro_origin" && remembered !== undefined ? { value: remembered } : undefined) }),
}));
vi.mock("@/app/api/insights-page", () => ({
  INSIGHTS_UNAVAILABLE_CODE: "insights_unavailable",
  readInsightsPage: (range: string, origin: string) => readInsightsPage(range, origin),
}));

const { GET } = await import("@/app/api/insights/route");

beforeEach(() => {
  remembered = undefined;
  readInsightsPage.mockReset().mockResolvedValue({ state: "fresh", payload: seededInsights(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/insights", () => {
  it("reads the range the poll names, and answers the page", async () => {
    const response = await GET(new Request("http://ui.test/api/insights?range=90d"));

    expect(readInsightsPage).toHaveBeenCalledExactlyOnceWith("90d", "live");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(seededInsights());
  });

  it("reads the default for no range or one the service would refuse, never passing on a 422", async () => {
    await GET(new Request("http://ui.test/api/insights"));
    await GET(new Request("http://ui.test/api/insights?range=custom"));

    expect(readInsightsPage.mock.calls).toEqual([
      ["30d", "live"],
      ["30d", "live"],
    ]);
  });

  it("reads the origin the poll names, else the remembered one, else live", async () => {
    await GET(new Request("http://ui.test/api/insights?range=7d&origin=seeded"));
    remembered = "simulated";
    await GET(new Request("http://ui.test/api/insights?range=7d"));
    await GET(new Request("http://ui.test/api/insights?range=7d&origin=all"));
    await GET(new Request("http://ui.test/api/insights?range=7d&origin=bogus"));

    expect(readInsightsPage.mock.calls).toEqual([
      ["7d", "seeded"],
      ["7d", "simulated"],
      ["7d", "all"],
      ["7d", "simulated"],
    ]);
  });

  it("answers a failure under this hop's code", async () => {
    readInsightsPage.mockResolvedValue({ state: "failed", reason: "Choose a workspace.", pollAfterSeconds: null });

    const response = await GET(new Request("http://ui.test/api/insights?range=7d"));

    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "insights_unavailable", message: "Choose a workspace." });
  });
});
