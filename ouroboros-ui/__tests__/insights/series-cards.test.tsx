import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightsPage } from "@/app/api/insights";
import type { InsightsPollOptions } from "@/app/insights/insights-poll";
import { NO_THROUGHPUT, NO_USAGE, NO_PRICED_USAGE } from "@/app/insights/series-view";
import type { PollAnswer } from "@/app/poll";

import { AUG_4, insightsReadings, seededInsights, seededSeries } from "../helpers/insights";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The throughput and daily-cost cards (#444) on the insights screen, under its store: the
 * seeded charts, the tooltip and its unpriced variant, the guide and its uncapped variant, the
 * alerts claim's absence, the spike's bare value, the projection's method tooltip, keyboard
 * reach, the empty and loading states, and a range switch re-rendering both.
 */

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("@/app/insights/intervention-actions", () => ({
  listCauseEvents: vi.fn(),
  recategorizeEvent: vi.fn(),
}));
vi.mock("@/app/insights/digest-actions", () => ({ readDigestSheet: vi.fn(), setDigestSubscription: vi.fn() }));

const { InsightsScreen } = await import("@/app/insights/insights-screen");

/** What the poll answers, reassigned by the range-switch case. */
let answer: PollAnswer<InsightsPage> | null = null;

/** A reader answering {@link answer}, or never while it is `null`. */
const POLL: InsightsPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
};

const THROUGHPUT = "Merged PRs per day · 30d";
const COST = "Daily cost · all providers";

/**
 * Render the screen over one page.
 *
 * @param page The page, or `null` for nothing read.
 * @returns The render.
 */
function show(page: InsightsPage | null = seededInsights()) {
  return render(<InsightsScreen poll={POLL} readings={insightsReadings(page)} />);
}

/**
 * A card, by its heading.
 *
 * @param name The heading.
 * @returns Its region.
 */
function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

/**
 * The seeded page with its cost series changed.
 *
 * @param over What differs in the cost series.
 * @returns The page.
 */
function withCost(over: Partial<InsightsPage["series"]["cost"]>): InsightsPage {
  const series = seededSeries();

  return seededInsights({ series: { ...series, cost: { ...series.cost, ...over } } });
}

/**
 * The text of one marked group in a card's chart.
 *
 * @param region The card.
 * @param mark The `data-chart-*` attribute.
 * @returns Its text, or `null` when the chart has no such mark.
 */
function mark(region: HTMLElement, mark: string): string | null {
  return region.querySelector(`[${mark}]`)?.textContent ?? null;
}

beforeEach(() => {
  replace.mockReset();
  answer = null;
});

describe("the throughput card", () => {
  it("draws the seeded chart with its range tag and the endpoint's direct label", () => {
    show();
    const region = card(THROUGHPUT);

    expect(within(region).getByText("Jul 10 – Aug 8")).toHaveClass("ou-tag");
    expect(within(region).getByRole("img", { name: "Merged PRs per day, last 30d, ending at 6 per day" })).toBeInTheDocument();
    expect(mark(region, "data-chart-endpoint")).toBe("6");
    expect(region.querySelector("[data-chart-guide]")).toBeNull();
  });

  it("composes the day's meta in the crosshair tooltip", () => {
    show();
    const region = card(THROUGHPUT);
    const aug4 = within(region).getByRole("button", { name: "Aug 4 — 6 merged · $9.12 · 1 intervention" });

    fireEvent.pointerEnter(aug4);

    expect(region.querySelector(".chart-tip")).toHaveTextContent("Aug 4 — 6 merged · $9.12 · 1 intervention");
    expect(region.querySelector("[data-chart-crosshair]")).not.toBeNull();
  });

  it("omits the cost fragment for an unpriced workspace", () => {
    const series = seededSeries();
    const points = series.throughput.points.map(({ day, mergedPrs, interventions }) => ({ day, mergedPrs, interventions }));
    show(seededInsights({ series: { ...series, throughput: { ...series.throughput, points } } }));
    const region = card(THROUGHPUT);

    const aug4 = within(region).getByRole("button", { name: "Aug 4 — 6 merged · 1 intervention" });
    fireEvent.pointerEnter(aug4);

    expect(region.querySelector(".chart-tip")).toHaveTextContent("Aug 4 — 6 merged · 1 intervention");
    expect(region.querySelector(".chart-tip")).not.toHaveTextContent("$");
  });

  it("puts every day within reach of the keyboard, announced by its sentence", () => {
    show();
    const region = card(THROUGHPUT);
    const days = within(region).getAllByRole("button");

    expect(days).toHaveLength(30);
    // One tab stop — the latest day — and the arrows walk the rest.
    expect(days.filter((day) => day.tabIndex === 0)).toEqual([days[29]]);

    days[29]!.focus();
    fireEvent.keyDown(days[29]!, { key: "ArrowLeft" });
    fireEvent.keyDown(days[28]!, { key: "ArrowLeft" });
    fireEvent.keyDown(days[27]!, { key: "ArrowLeft" });
    fireEvent.keyDown(days[26]!, { key: "ArrowLeft" });

    expect(document.activeElement).toBe(days[AUG_4]);
    expect(document.activeElement).toHaveAccessibleName("Aug 4 — 6 merged · $9.12 · 1 intervention");
  });

  it("is a designed empty state over a range with no merges — not a flat line", () => {
    const series = seededSeries();
    const points = series.throughput.points.map((day) => ({ ...day, mergedPrs: 0 }));
    show(seededInsights({ series: { ...series, throughput: { ...series.throughput, points } } }));
    const region = card(THROUGHPUT);

    expect(within(region).getByText(NO_THROUGHPUT.title)).toBeInTheDocument();
    expect(within(region).getByText(NO_THROUGHPUT.note)).toBeInTheDocument();
    expect(region.querySelector("svg")).toBeNull();
  });
});

describe("the daily cost card", () => {
  it("draws the seeded chart: guide, bare spike, endpoint and projection", () => {
    show();
    const region = card(COST);

    expect(within(region).getByText("Jul 10 – Aug 8")).toHaveClass("ou-tag");
    expect(mark(region, "data-chart-guide")).toBe("$20 budget");
    expect(mark(region, "data-chart-annotation")).toBe("$31.40");
    expect(mark(region, "data-chart-endpoint")).toBe("$18.60");
    expect(region.querySelector(".insights-series__foot")).toHaveTextContent(/^Projected month: \$571 of \$600 cap\.Linear to date/);
  });

  it("labels the spike with its value alone — no invented narrative", () => {
    show();

    expect(card(COST)).not.toHaveTextContent(/migration|Zephyr/);
  });

  it("names the projection's method in a tooltip a keyboard reaches", () => {
    show();
    const lead = within(card(COST)).getByRole("button", { name: "Projected month" });

    expect(lead).toHaveAccessibleDescription(
      "Linear to date: $147.34 spent over the first 8 of 31 days of this month, scaled to the whole month — not a forecast.",
    );
    expect(within(card(COST)).getByRole("tooltip")).toHaveTextContent("Linear to date");
  });

  it("draws no guide without a provider cap, and still states the projection", () => {
    show(withCost({ budget: undefined }));
    const region = card(COST);

    expect(region.querySelector("[data-chart-guide]")).toBeNull();
    expect(region).not.toHaveTextContent(/budget|cap/);
    expect(region.querySelector(".insights-series__foot")).toHaveTextContent(/^Projected month: \$571\.Linear to date/);
  });

  it("never claims alerts fire, while the guide and the projection still render", () => {
    show();
    const region = card(COST);

    expect(mark(region, "data-chart-guide")).toBe("$20 budget");
    expect(region.querySelector(".insights-series__foot")).not.toBeNull();
    expect(region).not.toHaveTextContent(/alert/i);
  });

  it("draws no footer with no projection", () => {
    show(withCost({ projection: undefined }));

    expect(card(COST).querySelector(".insights-series__foot")).toBeNull();
  });

  it("is an unpriced empty state — not a line at $0.00 — when no price covers the usage", () => {
    const points = seededSeries().cost.points.map(({ day, tokens }) => ({ day, tokens }));
    show(withCost({ points, budget: undefined, spike: undefined, projection: undefined }));
    const region = card(COST);

    expect(within(region).getByText(NO_PRICED_USAGE)).toBeInTheDocument();
    expect(region.querySelector("svg")).toBeNull();
    expect(region).not.toHaveTextContent("$0.00");
  });

  it("is a no-usage empty state over a range nothing ran in", () => {
    const points = seededSeries().cost.points.map(({ day }) => ({ day, tokens: 0 }));
    show(withCost({ points, budget: undefined, spike: undefined, projection: undefined }));

    expect(within(card(COST)).getByText(NO_USAGE.title)).toBeInTheDocument();
  });
});

describe("both cards", () => {
  it("hold their places with skeletons while nothing has been read", () => {
    show(null);

    for (const name of [THROUGHPUT, COST]) {
      const region = card(name);
      expect(region).toHaveAttribute("aria-busy", "true");
      expect(region.querySelector(".insights-series__skeleton")).not.toBeNull();
      expect(region.querySelector("svg")).toBeNull();
    }
  });

  it("re-render for a new range with its axes and endpoints", async () => {
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    const series = seededSeries();
    const week = seededInsights({
      range: "7d",
      window: { from: "2026-08-02", to: "2026-08-08" },
      series: {
        ...series,
        throughput: { ...series.throughput, points: series.throughput.points.slice(-7) },
        cost: { ...series.cost, points: series.cost.points.slice(-7), spike: undefined },
      },
    });
    answer = { state: "fresh", payload: week, etag: null, pollAfterSeconds: null };
    view.rerender(<InsightsScreen poll={POLL} readings={insightsReadings(week)} />);

    await waitFor(() => expect(card("Merged PRs per day · 7d")).toBeInTheDocument());
    const throughput = card("Merged PRs per day · 7d");
    const cost = card(COST);

    expect(within(throughput).getByText("Aug 2 – Aug 8")).toBeInTheDocument();
    expect(within(throughput).getAllByRole("button")).toHaveLength(7);
    expect(mark(throughput, "data-chart-ticks")).toContain("Aug 2");
    expect(mark(throughput, "data-chart-ticks")).not.toContain("Jul");
    expect(mark(cost, "data-chart-endpoint")).toBe("$18.60");
    expect(cost.querySelector("[data-chart-annotation]")).toBeNull();
  });

  it("draw the same markup in both palettes — every hue is a token", () => {
    const [light, dark] = renderInBothPalettes(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
