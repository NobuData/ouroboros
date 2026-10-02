import { describe, expect, it } from "vitest";

import {
  COST_TITLE,
  NO_PRICED_SPEND,
  NO_PRICED_USAGE,
  NO_USAGE,
  PROJECTED_MONTH,
  type CostSeries,
  budgetLabel,
  costView,
  dayLabel,
  projectionMethod,
  projectionView,
  roundMoney,
  spikeLabel,
  throughputMeta,
  throughputView,
  unpricedUsage,
  wholeDollars,
  windowTag,
} from "@/app/insights/series-view";

import { AUG_4, SEEDED_DAYS, SPIKE_DAY, seededSeries } from "../helpers/insights";

/**
 * The time-series cards' decisions (#444): the tooltip's composition and its unpriced variant,
 * the guide only from a real cap, the spike's bare value, the projection's method, and the empty
 * states that stand in for a flat line at zero.
 */

/**
 * The seeded cost series with some of it changed.
 *
 * @param over What differs.
 * @returns The series.
 */
function cost(over: Partial<CostSeries> = {}): CostSeries {
  return { ...seededSeries().cost, ...over };
}

/** Every sentence a cost view would say, joined — what an absence assertion reads. */
function said(series: CostSeries): string {
  return JSON.stringify(costView(series, "30d"));
}

describe("days and windows", () => {
  it("spells a UTC day as the axis does, whatever the reader's zone", () => {
    expect(dayLabel("2026-08-04")).toBe("Aug 4");
    expect(dayLabel("2026-07-10")).toBe("Jul 10");
    expect(dayLabel("2026-12-31")).toBe("Dec 31");
  });

  it("leaves anything that is not an ISO day alone", () => {
    expect(dayLabel("yesterday")).toBe("yesterday");
    expect(dayLabel("2026-13-01")).toBe("2026-13-01");
  });

  it("writes the window as the mockup's tag", () => {
    expect(windowTag({ from: "2026-07-10", to: "2026-08-08" })).toBe("Jul 10 – Aug 8");
  });
});

describe("money", () => {
  it("drops the cents from a round amount and keeps them otherwise", () => {
    expect(roundMoney(2000)).toBe("$20");
    expect(roundMoney(60_000)).toBe("$600");
    expect(roundMoney(1935)).toBe("$19.35");
  });

  it("states an estimate to the dollar", () => {
    expect(wholeDollars(57_100)).toBe("$571");
    expect(wholeDollars(57_149)).toBe("$571");
    expect(wholeDollars(57_150)).toBe("$572");
  });
});

describe("the throughput tooltip", () => {
  it("composes the day's merges, spend and interventions — the mockup's sentence", () => {
    expect(throughputMeta({ day: "2026-08-04", mergedPrs: 6, interventions: 1, costCents: 912 })).toBe(
      "6 merged · $9.12 · 1 intervention",
    );
  });

  it("omits the cost fragment on an unpriced day rather than writing $0.00", () => {
    const meta = throughputMeta({ day: "2026-08-04", mergedPrs: 6, interventions: 1 });

    expect(meta).toBe("6 merged · 1 intervention");
    expect(meta).not.toContain("$");
  });

  it("pluralizes interventions", () => {
    expect(throughputMeta({ day: "2026-08-04", mergedPrs: 0, interventions: 0 })).toBe("0 merged · 0 interventions");
    expect(throughputMeta({ day: "2026-08-04", mergedPrs: 2, interventions: 3 })).toBe("2 merged · 3 interventions");
  });
});

describe("the throughput card", () => {
  it("plots one point per day with the tooltip's detail, ending at 6", () => {
    const view = throughputView(seededSeries().throughput, "30d");

    expect(view.title).toBe("Merged PRs per day · 30d");
    expect(view.points).toHaveLength(30);
    expect(view.points![AUG_4]).toEqual({ label: "Aug 4", value: 6, meta: "6 merged · $9.12 · 1 intervention" });
    expect(view.label).toBe("Merged PRs per day, last 30d, ending at 6 per day");
  });

  it("titles itself for the range", () => {
    expect(throughputView(seededSeries().throughput, "7d").title).toBe("Merged PRs per day · 7d");
  });

  it("is empty — not a flat line at zero — over a range with no merges", () => {
    const quiet = seededSeries().throughput;
    const none = throughputView({ ...quiet, points: quiet.points.map((day) => ({ ...day, mergedPrs: 0 })) }, "30d");

    expect(none.points).toBeNull();
    expect(throughputView({ ...quiet, points: [] }, "30d").points).toBeNull();
  });
});

describe("the budget guide", () => {
  it("draws at the real provider cap's daily share", () => {
    expect(costView(cost(), "30d").guide).toEqual({ value: 2000, label: "$20 budget" });
    expect(budgetLabel(1935)).toBe("$19.35 budget");
  });

  it("is absent when no provider has a cap — never an invented budget", () => {
    const view = costView(cost({ budget: undefined }), "30d");

    expect(view.guide).toBeUndefined();
    expect(said(cost({ budget: undefined }))).not.toMatch(/budget|cap/);
  });
});

describe("the spike label", () => {
  it("is the bare value — nothing attributes it, so no cause is written", () => {
    const view = costView(cost(), "30d");

    expect(view.annotation).toEqual({ index: 21, label: "$31.40" });
    expect(spikeLabel({ day: SPIKE_DAY, costCents: 3140 })).toBe("$31.40");
    expect(said(cost())).not.toMatch(/migration|Zephyr|spike"/);
  });

  it("names the spike in the chart's accessible name", () => {
    expect(costView(cost(), "30d").label).toBe(
      "Daily cost across all providers, last 30d, ending at $18.60, with a $31.40 spike on Jul 31",
    );
  });

  it("is not annotated when there is no spike", () => {
    const view = costView(cost({ spike: undefined }), "30d");

    expect(view.annotation).toBeUndefined();
    expect(view.label).toBe("Daily cost across all providers, last 30d, ending at $18.60");
  });

  it("is not annotated on the last day, whose endpoint already labels that figure", () => {
    expect(costView(cost({ spike: { day: SEEDED_DAYS.at(-1)!, costCents: 1860 } }), "30d").annotation).toBeUndefined();
  });

  it("is not annotated on a day outside the series", () => {
    expect(costView(cost({ spike: { day: "2020-01-01", costCents: 9999 } }), "30d").annotation).toBeUndefined();
  });
});

describe("the projection footer", () => {
  it("states the projection against the cap", () => {
    expect(projectionView(cost())).toEqual({
      lead: PROJECTED_MONTH,
      figures: ": $571 of $600 cap.",
      method: projectionMethod(cost().projection!),
    });
  });

  it("names its method — linear to date, and not a forecast", () => {
    expect(projectionMethod(cost().projection!)).toBe(
      "Linear to date: $147.34 spent over the first 8 of 31 days of this month, scaled to the whole month — not a forecast.",
    );
  });

  it("still states the projection without a cap, and names none", () => {
    expect(projectionView(cost({ budget: undefined }))!.figures).toBe(": $571.");
  });

  it("is absent with no projection", () => {
    expect(projectionView(cost({ projection: undefined }))).toBeNull();
  });

  it("never claims alerts — nothing fires one until #237", () => {
    expect(said(cost())).not.toMatch(/alert/i);
    expect(said(cost({ budget: undefined }))).not.toMatch(/alert/i);
  });
});

describe("the daily cost card", () => {
  it("plots each priced day in cents", () => {
    const view = costView(cost(), "30d");

    expect(view.empty).toBeNull();
    expect(view.points).toHaveLength(30);
    expect(view.points.at(-1)).toEqual({ label: "Aug 8", value: 1860 });
  });

  it("says a day had no priced spend rather than claiming $0.00", () => {
    const points = cost().points.map((day, index) => (index === 3 ? { day: day.day, tokens: 4200 } : day));
    const view = costView(cost({ points }), "30d");

    expect(view.points[3]).toEqual({ label: "Jul 13", value: 0, meta: `${NO_PRICED_SPEND} · 4.2k tokens` });
  });

  it("says the last day had no priced spend in its name rather than $0.00", () => {
    const points = cost().points.map((day, index) => (index === 29 ? { day: day.day, tokens: 0 } : day));

    expect(costView(cost({ points }), "30d").label).toContain(`ending with ${NO_PRICED_SPEND}`);
  });

  it("is an unpriced empty state when no price covers the range's usage", () => {
    const points = cost().points.map((day) => ({ day: day.day, tokens: 1000 }));
    const view = costView(cost({ points, budget: undefined, spike: undefined, projection: undefined }), "30d");

    expect(view.points).toEqual([]);
    expect(view.empty).toEqual(unpricedUsage(30_000));
    expect(view.empty!.title).toBe(NO_PRICED_USAGE);
    expect(view.empty!.note).toContain("30.0k tokens");
  });

  it("is a no-usage empty state over a range nothing ran in", () => {
    const points = cost().points.map((day) => ({ day: day.day, tokens: 0 }));

    expect(costView(cost({ points }), "30d").empty).toEqual(NO_USAGE);
    expect(costView(cost({ points: [] }), "30d").empty).toEqual(NO_USAGE);
  });

  it("keeps the heading the mockup writes", () => {
    expect(COST_TITLE).toBe("Daily cost · all providers");
  });
});
