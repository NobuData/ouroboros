import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightsPage } from "@/app/api/insights";
import type { InsightsPollOptions } from "@/app/insights/insights-poll";
import { CUSTOM_REASON } from "@/app/insights/range";
import { PROXY_NOTE } from "@/app/insights/view";
import type { PollAnswer } from "@/app/poll";

import {
  I6_FORMULA,
  insightsReadings,
  kpi,
  methodology,
  seededInsights,
  seededKpis,
} from "../helpers/insights";
import { renderInBothPalettes } from "../helpers/palettes";

/**
 * The insights screen (#443) end to end, under its store: the composed head, the range segment
 * driving every region and the address, the honest actions, the KPI row and each card's
 * methodology popover.
 */

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

const { InsightsScreen } = await import("@/app/insights/insights-screen");

/** What the poll answers, reassigned by the cases that switch the range. */
let answer: PollAnswer<InsightsPage> | null = null;

/** A reader answering {@link answer}, or never while it is `null`. */
const POLL: InsightsPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
};

/**
 * A fresh answer carrying one page.
 *
 * @param page The page.
 * @returns The answer.
 */
function fresh(page: InsightsPage): PollAnswer<InsightsPage> {
  return { state: "fresh", payload: page, etag: null, pollAfterSeconds: null };
}

/**
 * One KPI card, by its caption.
 *
 * @param name The caption.
 * @returns The card's region.
 */
function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  replace.mockReset();
  answer = null;
});

describe("the head", () => {
  it("composes the headline from the head payload, under the mockup's eyebrow and subline", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("27 PRs merged this week. 2 needed a human.");
    expect(screen.getByText("Insights")).toHaveClass("ou-eyebrow");
    expect(
      screen.getByText("Every loop measured: what merged untouched, what it cost, where humans still step in."),
    ).toBeInTheDocument();
  });

  it("pluralizes at one and reads a quiet week as intentional", () => {
    const one = render(
      <InsightsScreen poll={POLL} readings={insightsReadings(seededInsights({ head: { range: "7d", mergedPrs: 1, interventions: 1 } }))} />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 PR merged this week. 1 needed a human.");
    one.unmount();

    render(<InsightsScreen poll={POLL} readings={insightsReadings(seededInsights({ head: { range: "7d", mergedPrs: 0, interventions: 0 } }))} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No PRs merged this week. Nothing needed a human.");
  });

  it("renders each unbuilt action inert, saying why, rather than doing nothing", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    for (const [name, why] of [
      ["✦ Build Analyzer soon", /#516/],
      ["Email weekly digest soon", /#447/],
      ["Send to Slack soon", /#536/],
    ] as const) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", expect.stringMatching(why));
    }
  });
});

describe("the range segment", () => {
  it("shows the read range as pressed", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    const group = screen.getByRole("group", { name: "Time range" });
    expect(within(group).getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "false");
  });

  it("opens on the range a shared link names", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings(seededInsights({ range: "90d" }))} />);

    expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
    expect(card("Autonomous merge rate")).toHaveTextContent("▲ 3pts vs prior 90d");
  });

  it("writes a press into the address — the default as the bare path", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(replace).toHaveBeenLastCalledWith("/insights?range=7d", { scroll: false });

    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(replace).toHaveBeenLastCalledWith("/insights", { scroll: false });
  });

  it("does nothing for a press on the range already shown", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    fireEvent.click(screen.getByRole("button", { name: "30d" }));

    expect(replace).not.toHaveBeenCalled();
  });

  it("re-renders every consumer for the new range, and marks the switch until it lands", async () => {
    const view = render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    // Pressed at once; the old range's figures stay on screen, marked busy.
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector(".insights__grid")).toHaveAttribute("aria-busy", "true");

    const week = seededInsights({
      range: "7d",
      head: { range: "7d", mergedPrs: 6, interventions: 1 },
      kpis: [kpi({ value: 97, delta: 5 }), ...seededKpis().slice(1)],
    });
    answer = fresh(week);
    // The route renders the new range's first paint too.
    view.rerender(<InsightsScreen poll={POLL} readings={insightsReadings(week)} />);

    await waitFor(() => expect(card("Autonomous merge rate")).toHaveTextContent("97%"));
    expect(card("Autonomous merge rate")).toHaveTextContent("▲ 5pts vs prior 7d");
    expect(card("Cost per merged PR")).toHaveTextContent("vs prior 7d");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("6 PRs merged this week. 1 needed a human.");
    expect(view.container.querySelector(".insights__grid")).toHaveAttribute("aria-busy", "false");
  });

  it("follows the address when it moves under the screen — a back-button press", () => {
    const view = render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    view.rerender(<InsightsScreen poll={POLL} readings={insightsReadings(seededInsights({ range: "90d" }))} />);

    expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps custom present and honestly unavailable", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    const custom = screen.getByRole("button", { name: `custom — ${CUSTOM_REASON}` });
    expect(custom).toHaveAttribute("aria-disabled", "true");
    expect(custom).toHaveAttribute("title", CUSTOM_REASON);

    fireEvent.click(custom);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the KPI row", () => {
  it("draws mockup 15's five cards, coloured by goodness", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    expect(card("Autonomous merge rate")).toHaveTextContent("92%▲ 3pts vs prior 30d");
    expect(card("Merged w/o human edits")).toHaveTextContent("78%of all merged PRs");
    expect(card("Median cycle")).toHaveTextContent("14m 20s▼ 2m faster");
    expect(card("Cost per merged PR")).toHaveTextContent("$1.87▼ $0.41 vs prior 30d");
    expect(card("Human interventions")).toHaveTextContent("2/wk▼ 5/wk vs prior 30d");

    // ▼ on the median cycle is good news — drawn as `up`, by goodness rather than by sign.
    expect(within(card("Median cycle")).getByText("▼ 2m faster")).toHaveClass("ou-stat__delta--up");
    expect(within(card("Autonomous merge rate")).getByText("92%")).toHaveClass("ou-stat__value--accent");
  });

  it("colours a fall on an upward-is-good metric as bad news", () => {
    render(
      <InsightsScreen
        poll={POLL}
        readings={insightsReadings(
          seededInsights({ kpis: [kpi({ value: 80, delta: -12, trend: { direction: "down", good: false } })] }),
        )}
      />,
    );

    expect(within(card("Autonomous merge rate")).getByText("▼ 12pts vs prior 30d")).toHaveClass("ou-stat__delta--down");
  });

  it("moves with the poll", async () => {
    answer = fresh(seededInsights({ kpis: [kpi({ value: 99, delta: 10 })] }));

    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    await waitFor(() => expect(card("Autonomous merge rate")).toHaveTextContent("99%"));
  });
});

describe("the methodology popover", () => {
  it("opens from every KPI label, carrying the formula, the sources, the caveats and the version", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    const trigger = within(card("Autonomous merge rate")).getByRole("button", { name: "Autonomous merge rate" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const popover = screen.getByRole("group", { name: "Autonomous merge rate" });
    expect(trigger).toHaveAttribute("aria-controls", popover.id);
    expect(popover).toHaveTextContent(methodology().formula);
    expect(popover).toHaveTextContent("pull_requests · runs");
    expect(popover).toHaveTextContent(methodology().caveats);
    expect(popover).toHaveTextContent("merge_rate · v1");
  });

  it("gives each of the five cards a label that opens", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    for (const name of [
      "Autonomous merge rate",
      "Merged w/o human edits",
      "Median cycle",
      "Cost per merged PR",
      "Human interventions",
    ]) {
      expect(within(card(name)).getByRole("button", { name })).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("states the I6 definition on Merged w/o human edits", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    fireEvent.click(within(card("Merged w/o human edits")).getByRole("button", { name: "Merged w/o human edits" }));

    expect(screen.getByRole("group", { name: "Merged w/o human edits" })).toHaveTextContent(I6_FORMULA);
  });

  it("says when a figure is a proxy", () => {
    render(
      <InsightsScreen
        poll={POLL}
        readings={insightsReadings(seededInsights({ kpis: [kpi({ methodology: methodology({ proxy: true }) })] }))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Autonomous merge rate" }));

    expect(screen.getByRole("group", { name: "Autonomous merge rate" })).toHaveTextContent(PROXY_NOTE);
  });

  it("closes on Escape, handing focus back to the label, and on a press outside", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);
    const trigger = screen.getByRole("button", { name: "Median cycle" });

    fireEvent.click(trigger);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByRole("group", { name: "Median cycle" })).toBeNull();
  });
});

describe("the states", () => {
  it("renders a refused read as a page under a banner rather than throwing", () => {
    const view = render(<InsightsScreen poll={POLL} readings={insightsReadings(null)} />);

    expect(view.container.querySelector(".ou-retry")).toHaveTextContent("Choose a workspace.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("PRs merged this week. Humans who stepped in.");
    expect(view.container.querySelectorAll(".ou-stat")).toHaveLength(0);
    // The range and the actions still draw.
    expect(screen.getByRole("group", { name: "Time range" })).toBeInTheDocument();
  });

  it("mounts as the pane's own content, with no chrome of its own", () => {
    const view = render(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    expect(view.container.querySelector("main.insights")).not.toBeNull();
    expect(view.container.querySelector("header, nav, aside")).toBeNull();
  });

  it("draws the same markup in both palettes — every hue is a token", () => {
    const [light, dark] = renderInBothPalettes(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    expect(light).toBe(dark);
  });
});
