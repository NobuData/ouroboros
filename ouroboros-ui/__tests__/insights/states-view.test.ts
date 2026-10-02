import { describe, expect, it } from "vitest";

import { NO_THROUGHPUT } from "@/app/insights/series-view";
import {
  COLD_LEAD,
  COLD_TITLE,
  FAILING_HEADLINE,
  LAG_HEADLINE,
  NEVER_FILLED,
  emptyFor,
  isColdWorkspace,
  lagBanner,
} from "@/app/insights/states-view";

import { CURRENT_FRESHNESS, seededInsights, seededSeries } from "../helpers/insights";

/**
 * The states a working insights page never shows (#447): the cold workspace, the rollup lag and
 * their copy.
 */

const NOW = new Date("2026-08-08T14:02:00.000Z");

/** A page from a workspace where nothing has run: no merges, no builds, no usage. */
function coldPage() {
  const series = seededSeries();

  return seededInsights({
    usage: { pricing: "none", tokens: 0, unpricedTokens: 0 },
    series: {
      ...series,
      throughput: {
        ...series.throughput,
        points: series.throughput.points.map((point) => ({ day: point.day, mergedPrs: 0, interventions: 0 })),
      },
      builds: { ...series.builds, points: series.builds.points.map((point) => ({ ...point, succeeded: 0, failed: 0 })) },
    },
  });
}

describe("isColdWorkspace", () => {
  it("is not cold for the seeded workspace", () => {
    expect(isColdWorkspace(seededInsights())).toBe(false);
  });

  it("is cold when nothing merged, built or used a model in the window", () => {
    expect(isColdWorkspace(coldPage())).toBe(true);
  });

  it("is cold when no rollup has filled a day yet, whatever the payload holds", () => {
    const page = seededInsights({ freshness: { filledThrough: null, lastFilledAt: null, behind: false, failing: false } });

    expect(isColdWorkspace(page)).toBe(true);
  });

  it("is not cold when only builds ran — the loop has run, and an empty card is a fact about it", () => {
    const page = coldPage();

    expect(isColdWorkspace({ ...page, series: { ...page.series, builds: seededSeries().builds } })).toBe(false);
  });
});

describe("emptyFor", () => {
  it("leaves a working workspace's empty state alone", () => {
    expect(emptyFor(NO_THROUGHPUT, false)).toBe(NO_THROUGHPUT);
  });

  it("frames a cold one as not enough data, and keeps what will fill it", () => {
    expect(emptyFor(NO_THROUGHPUT, true)).toEqual({ title: COLD_TITLE, note: `${COLD_LEAD} ${NO_THROUGHPUT.note}` });
    expect(COLD_TITLE).toBe("Not enough data to measure yet");
    expect(COLD_LEAD).toBe("The loop hasn't run enough to measure this.");
  });
});

describe("lagBanner", () => {
  it("is silent while the rollups are current", () => {
    expect(lagBanner(seededInsights({ freshness: CURRENT_FRESHNESS }), NOW)).toBeNull();
  });

  it("is silent in a cold workspace — its cards already say so", () => {
    const page = seededInsights({ freshness: { filledThrough: null, lastFilledAt: null, behind: false, failing: false } });

    expect(lagBanner(page, NOW)).toBeNull();
  });

  it("names the real day and time the rollups were last filled when they are behind", () => {
    const page = seededInsights({
      freshness: { filledThrough: "2026-08-05", lastFilledAt: "2026-08-08T11:02:00.000Z", behind: true, failing: false },
    });

    expect(lagBanner(page, NOW)).toEqual({ headline: LAG_HEADLINE, detail: "Figures run through Aug 5, last filled 3h ago." });
  });

  it("says the job is failing when it is", () => {
    const page = seededInsights({
      freshness: { filledThrough: "2026-08-05", lastFilledAt: "2026-08-05T23:10:00.000Z", behind: true, failing: true },
    });

    expect(lagBanner(page, NOW)!.detail).toBe(
      "Figures run through Aug 5, last filled 2d ago. The rollup job's latest run failed; it retries every hour.",
    );
  });

  it("says a failed refresh over current figures without calling them behind", () => {
    const page = seededInsights({ freshness: { ...CURRENT_FRESHNESS, failing: true } });

    expect(lagBanner(page, NOW)!.headline).toBe(FAILING_HEADLINE);
  });

  it("says nothing has filled when a family never has and no day is known", () => {
    const page = seededInsights({ freshness: { filledThrough: null, lastFilledAt: null, behind: true, failing: false } });

    expect(lagBanner(page, NOW)!.detail).toBe(NEVER_FILLED);
  });
});
