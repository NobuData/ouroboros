import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UNREADABLE_INSIGHTS,
  createInsightsPoll,
  insightsUrl,
  isInsightsPage,
  requestInsights,
} from "@/app/insights/insights-poll";

import { seededInsights } from "../helpers/insights";

/** The insights poll (#443): one address per range, and a guard on what answered. */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("insightsUrl", () => {
  it("always names the range, so the answer is never the service's default standing in", () => {
    expect(insightsUrl("30d")).toBe("/api/insights?range=30d");
    expect(insightsUrl("7d")).toBe("/api/insights?range=7d");
  });
});

describe("isInsightsPage", () => {
  it("accepts the page", () => {
    expect(isInsightsPage(seededInsights())).toBe(true);
  });

  it("refuses what the head and the row could not read", () => {
    expect(isInsightsPage(null)).toBe(false);
    expect(isInsightsPage({})).toBe(false);
    expect(isInsightsPage({ head: { mergedPrs: 1, interventions: 0 }, kpis: {} })).toBe(false);
    expect(isInsightsPage({ head: { mergedPrs: "1", interventions: 0 }, kpis: [] })).toBe(false);
    expect(isInsightsPage({ head: null, kpis: [] })).toBe(false);
  });
});

describe("requestInsights", () => {
  it("asks this origin for the range's address, and reads the page", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(seededInsights()), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);

    const answer = await requestInsights(insightsUrl("90d"))(null);

    expect(fetch.mock.calls[0]![0]).toBe("/api/insights?range=90d");
    expect(answer).toMatchObject({ state: "fresh", payload: seededInsights() });
  });

  it("calls a body that is not the page unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );

    expect(await requestInsights(insightsUrl("7d"))(null)).toMatchObject({ state: "failed", reason: UNREADABLE_INSIGHTS });
  });
});

describe("createInsightsPoll", () => {
  it("is inert until started, and reads through the seam it is given", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: seededInsights(), etag: null, pollAfterSeconds: null });
    const poll = createInsightsPoll(insightsUrl("30d"), { read, visible: () => true });

    expect(read).not.toHaveBeenCalled();

    const stop = poll.start();
    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(seededInsights()));
    stop();
  });
});
