import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightsPage } from "@/app/api/insights";
import type { InsightsPollOptions } from "@/app/insights/insights-poll";
import { NO_CLOSED_PR, insightsBadges, insightsSearch } from "@/app/insights/origin-view";
import { FLAKY_TITLE } from "@/app/insights/flaky-view";
import { COLD_TITLE } from "@/app/insights/states-view";
import { insightsHeadline } from "@/app/insights/view";
import { ORIGIN_COOKIE } from "@/app/origin/origin";

import { insightsReadings, seededInsights } from "../helpers/insights";

/**
 * Data origin on Insights (DJ.3, #1316): the filter (live by default, kept in the address and the
 * origin cookie), the page strip when everything is non-live, a badge on every card that shows
 * non-live figures, and a heading that says "no data" rather than "nothing merged".
 */

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("@/app/insights/intervention-actions", () => ({
  listCauseEvents: vi.fn(),
  recategorizeEvent: vi.fn(),
}));
vi.mock("@/app/insights/digest-actions", () => ({ readDigestSheet: vi.fn(), setDigestSubscription: vi.fn() }));

const { InsightsScreen } = await import("@/app/insights/insights-screen");

/** A poll that never answers: the page under test is the first read's. */
const POLL: InsightsPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/**
 * A workspace holding only demo data, read under some origin.
 *
 * @param origin What the page was read for.
 * @returns The page — no figures when live was asked for, the seed's own otherwise.
 */
function demoOnly(origin: InsightsPage["origin"]): InsightsPage {
  const seeded = seededInsights({ origin, originsPresent: ["seeded"], mixed: false });

  return origin === "live" ? { ...seeded, head: { range: "7d", mergedPrs: null, interventions: null } } : seeded;
}

/**
 * What the service answers for live over a workspace holding only demo data (DJ.2): every figure
 * null with a count of 0, every chart without points, every bar card empty.
 *
 * @returns The page.
 */
function noLiveData(): InsightsPage {
  const page = demoOnly("live");

  return {
    ...page,
    usage: { pricing: "none", tokens: 0, unpricedTokens: 0 },
    kpis: page.kpis.map((kpi) => ({ ...kpi, value: null, n: 0, prior: null, delta: null, trend: { direction: "flat", good: null } })),
    series: {
      throughput: { ...page.series.throughput, points: [] },
      builds: { ...page.series.builds, points: [] },
      cost: { methodology: page.series.cost.methodology, points: [] },
    },
    hbars: Object.fromEntries(
      Object.entries(page.hbars).map(([key, card]) => [key, { ...card, total: null, bars: [], line: null }]),
    ) as unknown as InsightsPage["hbars"],
    performance: page.performance.map(({ key, unit, methodology }) => ({ key, unit, methodology, value: null, n: 0 })),
    flaky: { cases: [] },
    scoreboard: { ...page.scoreboard, rows: [] },
    dora: page.dora.map((cell) => ({
      ...cell,
      value: null,
      n: 0,
      prior: null,
      delta: null,
      trend: { direction: "flat" as const, good: null },
      sparkline: cell.sparkline.map(() => null),
    })),
  };
}

/**
 * Render the screen for a page, read under the page's own origin.
 *
 * @param page The page.
 * @returns The render.
 */
function show(page: InsightsPage) {
  return render(<InsightsScreen poll={POLL} readings={insightsReadings(page)} />);
}

/**
 * Every card region that reads the origin-split figures — every one but the flaky card, whose
 * scores the flakes plane keeps without an origin.
 *
 * @returns The regions.
 */
function splitCards(): HTMLElement[] {
  return screen.getAllByRole("region").filter((region) => !region.textContent?.includes(FLAKY_TITLE));
}

beforeEach(() => {
  replace.mockReset();
  document.cookie = `${ORIGIN_COOKIE}=; Max-Age=0; Path=/`;
});

afterEach(() => {
  document.cookie = `${ORIGIN_COOKIE}=; Max-Age=0; Path=/`;
});

describe("the origin filter", () => {
  it("opens on live, and names the four choices as a group", () => {
    show(seededInsights());

    const group = screen.getByRole("group", { name: "Data origin" });
    const pressed = within(group)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");

    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Live",
      "Demo data",
      "Simulated",
      "All origins",
    ]);
    expect(pressed.map((button) => button.textContent)).toEqual(["Live"]);
  });

  it("writes a press into the address and remembers it in the origin cookie", () => {
    show(seededInsights());

    fireEvent.click(screen.getByRole("button", { name: "Demo data" }));

    expect(replace).toHaveBeenLastCalledWith("/insights?origin=seeded", { scroll: false });
    expect(document.cookie).toContain(`${ORIGIN_COOKIE}=seeded`);
  });

  it("keeps the origin when the range moves, and the range when the origin moves", () => {
    show(seededInsights({ origin: "all", originsPresent: ["live", "seeded"], mixed: true }));

    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(replace).toHaveBeenLastCalledWith("/insights?range=7d&origin=all", { scroll: false });

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(replace).toHaveBeenLastCalledWith("/insights?range=7d", { scroll: false });
  });
});

describe("the page strip", () => {
  it("says no real loop has run, and where the demo data is, when live shows nothing", () => {
    show(demoOnly("live"));

    expect(screen.getByRole("note")).toHaveTextContent(
      "No real loop has run in this workspace yet. Demo data is hidden; choose Demo data under Data origin to see it.",
    );
    expect(screen.getByRole("link", { name: "Check readiness →" })).toHaveAttribute("href", "/get-started");
  });

  it("says the page is showing demo data when the reader chose it", () => {
    show(demoOnly("seeded"));

    expect(screen.getByRole("note")).toHaveTextContent(
      "This page is showing demo data. No real loop has run in this workspace yet.",
    );
  });

  it("is absent once any live data exists", () => {
    show(seededInsights({ origin: "all", originsPresent: ["live", "seeded"], mixed: true }));

    expect(screen.queryByText(/No real loop has run/)).toBeNull();
  });
});

describe("the badges", () => {
  it("marks every card with Demo data while demo figures are shown", () => {
    const { container } = show(demoOnly("seeded"));

    expect(splitCards().length).toBeGreaterThanOrEqual(10);
    for (const region of splitCards()) {
      expect(region.querySelector(".origin-badge"), region.getAttribute("aria-label") ?? "").toHaveTextContent(
        "Demo data",
      );
    }
    // The five KPI cards carry theirs in their captions.
    expect(container.querySelectorAll(".ou-stat .origin-badge, .insights-kpi .origin-badge")).toHaveLength(5);
  });

  it("marks each non-live origin an all-origins page sums, and never live", () => {
    show(seededInsights({ origin: "all", originsPresent: ["live", "simulated", "seeded"], mixed: true }));

    const badges = splitCards()[0]!.querySelectorAll(".origin-badge");

    expect([...badges].map((badge) => badge.textContent)).toEqual(["Simulated", "Demo data"]);
  });

  it("draws none on a live page", () => {
    const { container } = show(seededInsights());

    expect(container.querySelector(".origin-badge")).toBeNull();
  });
});

describe("the heading", () => {
  it("says no loop of the origin closed a pull request rather than that nothing merged", () => {
    show(demoOnly("live"));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "No live loop closed a pull request this week.",
    );
  });

  it.each(["live", "seeded", "simulated", "all"] as const)("names the %s origin", (origin) => {
    expect(insightsHeadline({ range: "7d", mergedPrs: null, interventions: null }, origin)).toBe(NO_CLOSED_PR[origin]);
  });

  it("still reads a quiet week of real data as a quiet week", () => {
    expect(insightsHeadline({ range: "7d", mergedPrs: 0, interventions: 0 }, "live")).toBe(
      "No PRs merged this week. Nothing needed a human.",
    );
  });
});

describe("no live data", () => {
  it("frames every card as not enough data and draws no zero anywhere", () => {
    const { container } = show(noLiveData());

    expect(screen.getAllByText(COLD_TITLE)).toHaveLength(10);
    expect(container.querySelectorAll(".chart-spark, .chart-scroll, .chart-vbars, .chart-hbars")).toHaveLength(0);
    for (const value of container.querySelectorAll(".ou-stat__value, .insights-perf__value")) {
      expect(value.textContent).not.toMatch(/^\s*0(\.0+)?\s*%?$/);
    }
  });
});

describe("insightsSearch", () => {
  it("leaves each default out of the address", () => {
    expect(insightsSearch("30d", "live")).toBe("");
    expect(insightsSearch("7d", "live")).toBe("?range=7d");
    expect(insightsSearch("30d", "seeded")).toBe("?origin=seeded");
    expect(insightsSearch("90d", "all")).toBe("?range=90d&origin=all");
  });
});

describe("insightsBadges", () => {
  it("badges the shown non-live origins, and only those present", () => {
    const page = seededInsights({ originsPresent: ["live", "seeded"] });

    expect(insightsBadges(null, "seeded")).toEqual([]);
    expect(insightsBadges(page, "live")).toEqual([]);
    expect(insightsBadges(page, "seeded")).toEqual(["seeded"]);
    expect(insightsBadges(page, "simulated")).toEqual([]);
    expect(insightsBadges(page, "all")).toEqual(["seeded"]);
  });
});
