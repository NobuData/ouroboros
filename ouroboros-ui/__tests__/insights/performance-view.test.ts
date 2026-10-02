import { describe, expect, it } from "vitest";

import {
  ALL_REPOSITORIES,
  NO_BUILDS,
  UNPRICED,
  buildsView,
  costCell,
  performanceView,
  scopeTag,
  splitOf,
  worstDay,
} from "@/app/insights/performance-view";

import { WORST_BUILD_DAY, perfCell, seededInsights } from "../helpers/insights";

/**
 * The build & test strip and the builds-per-day card (#446): the six seeded cells as the mockup
 * spells them, the cost cell's money rules — dollars priced, tokens and no dollars unpriced — the
 * scope tag, and the stacked bars' note, label and designed empty state.
 */

describe("performanceView", () => {
  it("spells the seeded strip as mockup 15 does", () => {
    const view = performanceView(seededInsights());

    expect(view.title).toBe("Build & test performance · 30d");
    expect(view.scope).toBe("all repositories · all workflows");
    expect(view.cells.map((cell) => [cell.label, cell.value])).toEqual([
      ["Builds", "412"],
      ["Build success", "91.5%"],
      ["Test cases run", "26.4k"],
      ["Test pass rate", "98.9%"],
      ["Tokens", "126M"],
      ["Total cost", "$563.20"],
    ]);
  });

  it("splits only the build-success cell — `377 ✓ / 35 ✗`", () => {
    const cells = performanceView(seededInsights()).cells;

    expect(cells.find((cell) => cell.key === "build_success_rate")?.split).toEqual({
      succeeded: "377",
      failed: "35",
      words: "377 succeeded, 35 failed",
    });
    expect(cells.filter((cell) => cell.split !== null)).toHaveLength(1);
  });

  it("draws a figure nobody measured as an em dash", () => {
    const page = seededInsights({ performance: [perfCell("test_pass_rate", "pct", null)] });

    expect(performanceView(page).cells[0]).toMatchObject({ value: "—", split: null, note: null });
  });

  it("moves with the range", () => {
    expect(performanceView(seededInsights({ range: "7d" })).title).toBe("Build & test performance · 7d");
  });
});

describe("costCell", () => {
  const cell = perfCell("total_cost", "cents", 56_320);

  it("draws dollars where every token was priced", () => {
    expect(costCell(cell, { pricing: "priced", tokens: 9, unpricedTokens: 0, costCents: 56_320 })).toEqual({
      value: "$563.20",
      note: null,
    });
  });

  it("names the tokens the dollars do not cover where only part was priced", () => {
    expect(
      costCell(cell, { pricing: "priced", tokens: 130_000_000, unpricedTokens: 12_000_000, costCents: 56_320 }),
    ).toEqual({ value: "$563.20", note: "+ 12.0M unpriced tokens" });
  });

  it("draws tokens and no dollars at all where nothing was priced", () => {
    const view = costCell(perfCell("total_cost", "cents", null), {
      pricing: "unpriced",
      tokens: 126_000_000,
      unpricedTokens: 126_000_000,
    });

    expect(view).toEqual({ value: "126M tokens", note: UNPRICED });
    expect(view.value).not.toContain("$");
  });

  it("draws an em dash where there was no usage", () => {
    expect(costCell(perfCell("total_cost", "cents", null), { pricing: "none", tokens: 0, unpricedTokens: 0 })).toEqual({
      value: "—",
      note: null,
    });
  });
});

describe("splitOf", () => {
  it("is absent when the cell carried no parts", () => {
    expect(splitOf(perfCell("build_success_rate", "pct", 90))).toBeNull();
  });

  it("never draws a negative failure count", () => {
    expect(splitOf(perfCell("build_success_rate", "pct", 100, { numerator: 5, denominator: 4 }))?.failed).toBe("0");
  });
});

describe("scopeTag", () => {
  it("names one repository by its name, or the whole workspace", () => {
    expect(scopeTag("acme/helios-firmware")).toBe("helios-firmware · all workflows");
    expect(scopeTag(null)).toBe(`${ALL_REPOSITORIES} · all workflows`);
  });
});

describe("buildsView", () => {
  it("floats the note over the seeded worst day and names the headline", () => {
    const view = buildsView(seededInsights());

    expect(view.tag).toBe("Jul 10 – Aug 8");
    expect(view.days).toHaveLength(30);
    expect(view.note).toEqual({ index: WORST_BUILD_DAY, text: "19 · 7 failed" });
    expect(view.label).toBe("Builds per day, succeeded versus failed: 380 builds, 35 failed");
    expect(view.empty).toBeNull();
  });

  it("carries no note in a range where nothing failed", () => {
    const page = seededInsights();
    const points = page.series.builds.points.map((point) => ({ ...point, failed: 0 }));

    expect(buildsView({ ...page, series: { ...page.series, builds: { ...page.series.builds, points } } }).note).toBeUndefined();
  });

  it("draws the designed empty state rather than thirty zero-height bars", () => {
    const page = seededInsights();
    const points = page.series.builds.points.map((point) => ({ ...point, succeeded: 0, failed: 0 }));

    expect(buildsView({ ...page, series: { ...page.series, builds: { ...page.series.builds, points } } }).empty).toBe(
      NO_BUILDS,
    );
  });
});

describe("worstDay", () => {
  it("is the day with the most failures, the latest of a tie, or none", () => {
    const day = (failed: number) => ({ label: "", succeeded: 1, failed });

    expect(worstDay([day(1), day(3), day(2)])).toBe(1);
    expect(worstDay([day(3), day(1), day(3)])).toBe(2);
    expect(worstDay([day(0), day(0)])).toBe(-1);
    expect(worstDay([])).toBe(-1);
  });
});
