import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightsPage } from "@/app/api/insights";
import { NO_SUITE_FAILURES, NO_TOKENS } from "@/app/insights/bars-view";
import { NO_FLAKY, NO_PLAYBOOK } from "@/app/insights/flaky-view";
import type { InsightsPollOptions } from "@/app/insights/insights-poll";
import { NO_BUILDS } from "@/app/insights/performance-view";
import { BUILD_FARM_PATH, FARM_RUNNERS_HASH, playbookPath, runPath } from "@/app/paths";
import type { PollAnswer } from "@/app/poll";

import {
  FIXING_RUN_ID,
  SEEDED_PLAYBOOK,
  barCard,
  insightsReadings,
  perfCell,
  seededInsights,
  seededPerformance,
  seededSeries,
  seededSuites,
  seededTokens,
} from "../helpers/insights";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The build & test strip, the builds-per-day bars, the three secondary bar cards and the flaky
 * card (#446) on the insights screen, under its store: the seeded visuals, the computed lines
 * moving with the data, the unpriced strip, the absent deps-refresh line, the flaky links that
 * resolve, the playbook present, absent and unread, the empty and loading states, the scroll
 * wrappers, both palettes, and a range switch re-rendering them.
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

const STRIP = "Build & test performance · 30d";
const BUILDS = "Builds per day — succeeded vs failed";
const SUITES = "Test failures by suite · 30d";
const EFFORT = "Time to completion by effort";
const TOKENS = "Tokens by stage · 30d";
const FLAKY = "Flaky tests";

/**
 * Render the screen over one page.
 *
 * @param page The page, or `null` for nothing read.
 * @param playbook The flaky-test recipe reading.
 * @returns The render.
 */
function show(
  page: InsightsPage | null = seededInsights(),
  playbook?: Parameters<typeof insightsReadings>[3],
) {
  return render(<InsightsScreen poll={POLL} readings={insightsReadings(page, page?.range ?? "30d", true, playbook)} />);
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
 * The seeded page with some bar cards changed.
 *
 * @param hbars What differs.
 * @returns The page.
 */
function withBars(hbars: Partial<InsightsPage["hbars"]>): InsightsPage {
  const page = seededInsights();

  return { ...page, hbars: { ...page.hbars, ...hbars } };
}

/**
 * A strip cell's figure, by its caption.
 *
 * @param label The caption.
 * @returns The `<dd>` beside it.
 */
function cell(label: string): HTMLElement {
  return within(card(STRIP)).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
}

beforeEach(() => {
  answer = null;
  replace.mockReset();
});

describe("the build & test strip", () => {
  it("draws the seeded six cells, the split and the scope tag", () => {
    show(seededInsights({ repo: "acme/helios-firmware" }));
    const region = card(STRIP);

    expect(cell("Builds")).toHaveTextContent("412");
    expect(cell("Build success")).toHaveTextContent("91.5%");
    expect(cell("Test cases run")).toHaveTextContent("26.4k");
    expect(cell("Test pass rate")).toHaveTextContent("98.9%");
    expect(cell("Tokens")).toHaveTextContent("126M");
    expect(cell("Total cost")).toHaveTextContent("$563.20");
    expect(region).toHaveTextContent("377 ✓ / 35 ✗");
    expect(within(region).getByText("377 succeeded, 35 failed")).toHaveClass("sr-only");
    expect(within(region).getByText("35 ✗")).toHaveClass("insights-perf__failed");
    expect(within(region).getByText("helios-firmware · all workflows")).toBeInTheDocument();
  });

  it("shows tokens and no dollars for an unpriced workspace", () => {
    show(
      seededInsights({
        usage: { pricing: "unpriced", tokens: 126_000_000, unpricedTokens: 126_000_000 },
        performance: seededPerformance().map((each) =>
          each.key === "total_cost" ? perfCell("total_cost", "cents", null) : each,
        ),
      }),
    );

    expect(cell("Total cost")).toHaveTextContent("126M tokens");
    expect(card(STRIP)).toHaveTextContent("unpriced");
    expect(card(STRIP)).not.toHaveTextContent("$");
  });

  it("scrolls its cells inside its own wrapper", () => {
    show();

    expect(card(STRIP).querySelector(".insights-scroll > dl")).not.toBeNull();
  });
});

describe("builds per day", () => {
  it("draws the stacked bars, the worst day's note and the legend", () => {
    show();
    const region = card(BUILDS);

    expect(within(region).getByText("Jul 10 – Aug 8")).toBeInTheDocument();
    expect(
      within(region).getByRole("img", { name: "Builds per day, succeeded versus failed: 380 builds, 35 failed" }),
    ).toBeInTheDocument();
    expect(region.querySelectorAll(".chart-vb")).toHaveLength(30);
    expect(region).toHaveTextContent("19 · 7 failed");
    expect(region).toHaveTextContent("succeeded·failed");
  });

  it("draws no deps-refresh cluster line — the analyzer's finding is not in the payload", () => {
    show();
    const region = card(BUILDS);

    expect(region).not.toHaveTextContent(/cluster|deps-refresh|analyzer/i);
    expect(region.querySelector(".insights-series__foot")).toBeNull();
  });

  it("draws the designed empty state for a range nothing built in", () => {
    const series = seededSeries();
    const points = series.builds.points.map(({ day }) => ({ day, succeeded: 0, failed: 0 }));
    show(seededInsights({ series: { ...series, builds: { ...series.builds, points } } }));

    expect(within(card(BUILDS)).getByText(NO_BUILDS.title)).toBeInTheDocument();
    expect(card(BUILDS).querySelector(".chart-vbars")).toBeNull();
  });
});

describe("the secondary bar cards", () => {
  it("draw the seeded suites, effort and token cards with their computed lines", () => {
    show();

    expect(within(card(SUITES)).getByText("33 cases")).toBeInTheDocument();
    expect(card(SUITES)).toHaveTextContent("33 failing cases total — 0.12% of everything that ran.");
    expect(within(card(EFFORT)).getByText("median · issue→merge")).toBeInTheDocument();
    expect(within(card(EFFORT)).getByText("XL")).toBeInTheDocument();
    expect(card(EFFORT)).toHaveTextContent("2h 10m");
    expect(card(EFFORT)).toHaveTextContent("Estimator calibration: 89% of issues land within their predicted band.");
    expect(within(card(TOKENS)).getByText("126M total")).toBeInTheDocument();
    expect(card(TOKENS).querySelector(".chart-hbars--model")).not.toBeNull();
    expect(card(TOKENS)).toHaveTextContent("≈ 4.6M tokens per merged PR · 31% served by local models.");
  });

  it("say the changed sentence when the data changes — every ratio line is computed", () => {
    show(
      withBars({
        suites: { ...seededSuites(), line: "12 failing cases total — 0.05% of everything that ran." },
        tokens: { ...seededTokens(), line: "≈ 2.1M tokens per merged PR · 54% served by local models." },
      }),
    );

    expect(card(SUITES)).toHaveTextContent("0.05% of everything that ran.");
    expect(card(SUITES)).not.toHaveTextContent("0.12%");
    expect(card(TOKENS)).toHaveTextContent("54% served by local models.");
    expect(card(TOKENS)).not.toHaveTextContent("31%");
  });

  it("say nothing where the service had nothing true to say — no local share invented", () => {
    show(withBars({ tokens: { ...seededTokens(), line: null } }));

    expect(card(TOKENS)).not.toHaveTextContent(/local models/);
    expect(card(TOKENS).querySelector(".insights-series__foot")).toBeNull();
  });

  it("draw designed empty states rather than zero-length bars", () => {
    show(withBars({ suites: barCard([]), tokens: barCard([], { total: 0 }) }));

    expect(within(card(SUITES)).getByText(NO_SUITE_FAILURES.title)).toBeInTheDocument();
    expect(within(card(TOKENS)).getByText(NO_TOKENS.title)).toBeInTheDocument();
    expect(card(SUITES).querySelector(".chart-hbars")).toBeNull();
  });

  it("scroll their bars inside their own wrappers", () => {
    show();

    for (const name of [SUITES, EFFORT, TOKENS]) {
      expect(card(name).querySelector(".insights-scroll > .chart-hbars")).not.toBeNull();
    }
  });
});

describe("the flaky card", () => {
  it("draws the seeded rows — paths, pills, rates and context", () => {
    show();
    const region = card(FLAKY);

    expect(within(region).getByText("30d window")).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem")).toHaveLength(3);
    for (const state of ["fixed", "quarantined", "watching"]) expect(region).toHaveTextContent(state);
    expect(region).toHaveTextContent("4.1%");
    expect(region).toHaveTextContent("under threshold");
    expect(region.querySelectorAll(".chart-spark")).toHaveLength(3);
    expect(region.querySelectorAll(".chart-spark--dim")).toHaveLength(1);
    expect(within(region).getByText("4.1%")).toHaveClass("insights-flaky__rate--warn");
  });

  it("links a fixed row to the run that fixed it, and a quarantined row to its rig", () => {
    show();
    const region = card(FLAKY);

    expect(within(region).getByRole("link", { name: "loop #1847" })).toHaveAttribute(
      "href",
      runPath(FIXING_RUN_ID, "insights"),
    );
    expect(within(region).getByRole("link", { name: "hil-rig-02" })).toHaveAttribute(
      "href",
      `${BUILD_FARM_PATH}#${FARM_RUNNERS_HASH}`,
    );
  });

  it("gives each row one sentence for a screen reader", () => {
    show();

    expect(
      within(card(FLAKY)).getByText("tests/hil/test_estop_release.py, quarantined, 4.1% flaky, rising on hil-rig-02"),
    ).toHaveClass("sr-only");
  });

  it("opens the real playbook when the workspace has it", () => {
    show();

    expect(within(card(FLAKY)).getByRole("link", { name: "Open playbook: Flaky test hunt →" })).toHaveAttribute(
      "href",
      playbookPath(SEEDED_PLAYBOOK.id),
    );
  });

  it("says plainly that there is no playbook when there is none", () => {
    show(seededInsights(), { ok: true, value: null });
    const region = card(FLAKY);

    expect(region).toHaveTextContent(NO_PLAYBOOK);
    expect(within(region).queryByRole("link", { name: /Open playbook/ })).toBeNull();
    expect(within(region).getByRole("link", { name: "Playbooks →" })).toHaveAttribute("href", "/knowledge#playbooks");
  });

  it("draws no playbook line when the playbooks could not be read", () => {
    show(seededInsights(), { ok: false, reason: "Playbooks are unavailable." });
    const region = card(FLAKY);

    expect(within(region).queryByRole("link", { name: /playbook/i })).toBeNull();
    expect(region).not.toHaveTextContent(NO_PLAYBOOK);
  });

  it("draws the designed empty state for a range with nothing distrusted", () => {
    show(seededInsights({ flaky: { cases: [] } }));

    expect(within(card(FLAKY)).getByText(NO_FLAKY.title)).toBeInTheDocument();
    expect(within(card(FLAKY)).queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("every new card", () => {
  it("holds its place while nothing has been read", () => {
    show(null);

    for (const name of [BUILDS, "Test failures by suite", EFFORT, "Tokens by stage", FLAKY]) {
      const region = card(name);
      expect(region).toHaveAttribute("aria-busy", "true");
      expect(region.querySelector(".insights-series__skeleton")).not.toBeNull();
    }
    expect(card("Build & test performance")).toHaveAttribute("aria-busy", "true");
  });

  it("re-renders for a new range", async () => {
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    const series = seededSeries();
    const week = seededInsights({
      range: "7d",
      window: { from: "2026-08-02", to: "2026-08-08" },
      series: { ...series, builds: { ...series.builds, points: series.builds.points.slice(-7) } },
    });
    answer = { state: "fresh", payload: week, etag: null, pollAfterSeconds: null };
    view.rerender(<InsightsScreen poll={POLL} readings={insightsReadings(week)} />);

    await waitFor(() => expect(card("Build & test performance · 7d")).toBeInTheDocument());
    expect(card("Test failures by suite · 7d")).toBeInTheDocument();
    expect(card("Tokens by stage · 7d")).toBeInTheDocument();
    expect(within(card(FLAKY)).getByText("7d window")).toBeInTheDocument();
    expect(card(BUILDS).querySelectorAll(".chart-vb")).toHaveLength(7);
  });

  it("renders the same markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
