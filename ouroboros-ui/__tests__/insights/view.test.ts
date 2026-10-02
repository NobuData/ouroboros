import { describe, expect, it } from "vitest";

import {
  INSIGHTS_ACTIONS,
  INSIGHTS_HEADLINE_UNREAD,
  INSIGHTS_UNREAD_HEADLINE,
  NOTHING_MEASURED,
  NOT_MEASURED,
  TOKENS_PER_MERGED_PR,
  UNTOUCHED_CONTEXT,
  insightsBannerHeadline,
  insightsHeadline,
  kpiCard,
  kpiRow,
  methodologyVersion,
  perWeek,
  toneOf,
} from "@/app/insights/view";

import { kpi, methodology, seededKpis } from "../helpers/insights";

/**
 * The insights head's and KPI row's decisions (#443): the composed headline and its
 * pluralization, the cards' figures in their units, and delta colouring by goodness.
 */

describe("insightsHeadline", () => {
  it("composes the mockup's sentence from the head's two numbers", () => {
    expect(insightsHeadline({ range: "7d", mergedPrs: 27, interventions: 2 })).toBe(
      "27 PRs merged this week. 2 needed a human.",
    );
  });

  it("pluralizes at one", () => {
    expect(insightsHeadline({ range: "7d", mergedPrs: 1, interventions: 1 })).toBe(
      "1 PR merged this week. 1 needed a human.",
    );
  });

  it("reads a week of zeros as intentional rather than broken", () => {
    expect(insightsHeadline({ range: "7d", mergedPrs: 0, interventions: 0 })).toBe(
      "No PRs merged this week. Nothing needed a human.",
    );
  });

  it("says no merge needed a human when there were merges and no intervention", () => {
    expect(insightsHeadline({ range: "7d", mergedPrs: 3, interventions: 0 })).toBe(
      "3 PRs merged this week. None needed a human.",
    );
  });

  it("degrades each clause on its own", () => {
    expect(insightsHeadline({ range: "7d", mergedPrs: 0, interventions: 2 })).toBe(
      "No PRs merged this week. 2 needed a human.",
    );
  });

  it("claims no number when nothing was read", () => {
    expect(insightsHeadline(null)).toBe(INSIGHTS_HEADLINE_UNREAD);
    expect(INSIGHTS_HEADLINE_UNREAD).not.toMatch(/\d/);
  });
});

describe("the head's actions", () => {
  it("are the mockup's three, in its order, each unbuilt one saying which issue builds it", () => {
    expect(INSIGHTS_ACTIONS.map((action) => action.label)).toEqual([
      "✦ Build Analyzer",
      "Email weekly digest",
      "Send to Slack",
    ]);
    expect(INSIGHTS_ACTIONS.map((action) => action.soonNote)).toEqual([
      expect.stringMatching(/arrives? with #516/),
      // The digest's subscribe sheet is built (#447): it works, so it has no note.
      null,
      expect.stringMatching(/arrives? with #536/),
    ]);
  });
});

describe("the seeded KPI row", () => {
  it("draws mockup 15's five cards", () => {
    const row = kpiRow(seededKpis(), "30d");

    expect(row.map(({ label, value, valueSuffix, delta }) => [label, value, valueSuffix, delta])).toEqual([
      ["Autonomous merge rate", "92%", null, "▲ 3pts vs prior 30d"],
      ["Merged w/o human edits", "78%", null, UNTOUCHED_CONTEXT],
      ["Median cycle", "14m 20s", null, "▼ 2m faster"],
      ["Cost per merged PR", "$1.87", null, "▼ $0.41 vs prior 30d"],
      ["Human interventions", "2", "/wk", "▼ 5/wk vs prior 30d"],
    ]);
  });

  it("colours the merge rate's figure with the accent and the interventions' in the warn hue", () => {
    const [rate, , , , interventions] = kpiRow(seededKpis(), "30d");

    expect(rate!.accent).toBe(true);
    expect(interventions!.valueTone).toBe("warn");
  });

  it("draws no card when nothing was read", () => {
    expect(kpiRow(null, "30d")).toEqual([]);
  });

  it("hands each card its registry entry for the popover", () => {
    const row = kpiRow(seededKpis(), "30d");

    expect(row.map((card) => card.methodology.metricId)).toEqual([
      "merge_rate",
      "merged_untouched_rate",
      "cycle_time",
      "cost_per_merged_pr",
      "human_interventions",
    ]);
  });
});

describe("delta colouring follows goodness, not sign", () => {
  it("colours a downward-is-good move as good news", () => {
    const faster = kpi({
      key: "cycle_time",
      unit: "duration_ms",
      value: 600_000,
      delta: -60_000,
      trend: { direction: "down", good: true },
    });

    expect(kpiCard(faster, "30d")).toMatchObject({ delta: "▼ 1m faster", tone: "up" });
  });

  it("colours the same arrow on an upward-is-good metric as bad news", () => {
    const fell = kpi({ value: 80, delta: -4, trend: { direction: "down", good: false } });

    expect(kpiCard(fell, "30d")).toMatchObject({ delta: "▼ 4pts vs prior 30d", tone: "down" });
  });

  it("colours a rise in interventions as bad news", () => {
    const rose = kpi({
      key: "human_interventions",
      unit: "count",
      value: 14,
      delta: 7,
      trend: { direction: "up", good: false },
    });

    expect(kpiCard(rose, "7d")).toMatchObject({ value: "14", delta: "▲ 7/wk vs prior 7d", tone: "down" });
  });

  it("says slower for a cycle that grew", () => {
    const slower = kpi({
      key: "cycle_time",
      unit: "duration_ms",
      value: 900_000,
      delta: 45_000,
      trend: { direction: "up", good: false },
    });

    expect(kpiCard(slower, "30d").delta).toBe("▲ 45s slower");
  });

  it("makes no judgement when the service makes none", () => {
    expect(toneOf(kpi({ trend: { direction: "flat", good: null }, delta: 0 }))).toBe("muted");
  });
});

describe("what a card says with nothing to say", () => {
  it("draws an unmeasured figure as an em dash and says so", () => {
    const card = kpiCard(kpi({ value: null, prior: null, delta: null, trend: { direction: "flat", good: null } }), "7d");

    expect(card).toMatchObject({ value: NOT_MEASURED, delta: NOTHING_MEASURED, tone: "muted", accent: false });
  });

  it("says there is nothing to compare when there is no prior window", () => {
    const card = kpiCard(kpi({ prior: null, delta: null, trend: { direction: "flat", good: null } }), "90d");

    expect(card).toMatchObject({ value: "92%", delta: "No prior 90d to compare.", tone: "muted" });
  });

  it("says no change for a flat move", () => {
    expect(kpiCard(kpi({ delta: 0, trend: { direction: "flat", good: null } }), "30d").delta).toBe(
      "No change vs prior 30d",
    );
  });

  it("draws no hue and no suffix on interventions nobody measured", () => {
    const card = kpiCard(
      kpi({ key: "human_interventions", unit: "count", value: null, delta: null, trend: { direction: "flat", good: null } }),
      "30d",
    );

    expect(card).toMatchObject({ value: NOT_MEASURED, valueSuffix: null, valueTone: null });
  });

  it("draws zero interventions plainly, without the warn hue", () => {
    const card = kpiCard(
      kpi({ key: "human_interventions", unit: "count", value: 0, delta: -3, trend: { direction: "down", good: true } }),
      "7d",
    );

    expect(card).toMatchObject({ value: "0", valueSuffix: "/wk", valueTone: null });
  });
});

describe("units", () => {
  it("draws unpriced usage as tokens per merged PR, under its own caption", () => {
    const card = kpiCard(
      kpi({
        key: "cost_per_merged_pr",
        unit: "tokens",
        value: 26_400,
        delta: -3_100,
        trend: { direction: "down", good: true },
        methodology: methodology({ metricId: "tokens", unit: "tokens" }),
      }),
      "30d",
    );

    expect(card).toMatchObject({ label: TOKENS_PER_MERGED_PR, value: "26.4k", delta: "▼ 3.1k tokens vs prior 30d" });
  });

  it("draws a sub-point move to a decimal rather than as zero", () => {
    expect(kpiCard(kpi({ delta: 0.4 }), "30d").delta).toBe("▲ 0.4pts vs prior 30d");
  });

  it("scales a window's count to a week by the range's days", () => {
    expect(perWeek(30, "30d")).toBe(7);
    expect(perWeek(9, "90d")).toBeCloseTo(0.7);
    expect(perWeek(3, "7d")).toBe(3);
  });

  it("keeps a quiet workspace's weekly rate off zero", () => {
    const card = kpiCard(
      kpi({ key: "human_interventions", unit: "count", value: 3, delta: 1, trend: { direction: "up", good: false } }),
      "90d",
    );

    expect(card).toMatchObject({ value: "0.2", delta: "▲ 0.1/wk vs prior 90d" });
  });
});

describe("methodologyVersion", () => {
  it("names the registry entry and its version", () => {
    expect(methodologyVersion(methodology({ metricId: "human_interventions", version: 2 }))).toBe(
      "human_interventions · v2",
    );
  });
});

describe("insightsBannerHeadline", () => {
  it("says the page never arrived, or when the data on screen is from", () => {
    expect(insightsBannerHeadline(null, () => "14:02")).toBe(INSIGHTS_UNREAD_HEADLINE);
    expect(insightsBannerHeadline(1, () => "14:02")).toBe("Showing data from 14:02 — the latest refresh failed.");
  });
});
