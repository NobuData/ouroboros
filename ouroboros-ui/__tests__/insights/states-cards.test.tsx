import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightsDigest, InsightsPage } from "@/app/api/insights";
import { CARD_FAILED_TITLE, COLD_TITLE, LAG_HEADLINE } from "@/app/insights/states-view";
import {
  DIGEST_TITLE,
  DIGEST_TOGGLE,
  DIGEST_UNREADABLE,
  MAILPIT_NOTE,
  MAIL_UNCONFIGURED,
  PREVIEW_FRAME_TITLE,
  PREVIEW_UNREADABLE,
  UNSUBSCRIBE_NOTE,
} from "@/app/insights/digest-view";
import { DORA_CAPTION } from "@/app/insights/dora-view";
import type { InsightsPollOptions } from "@/app/insights/insights-poll";

import {
  CFR_CAVEAT,
  DEPLOY_CAVEAT,
  MTTR_CAVEAT,
  insightsReadings,
  seededInsights,
  seededSeries,
} from "../helpers/insights";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The DORA strip, the digest sheet and the states a working workspace never sees (#447), on the
 * insights screen under its store: the strip with its proxy tags and popovers, a cold workspace
 * framed as *not enough data* with no curve drawn, the rollup-lag banner, one card failing alone,
 * and the subscribe flow round-tripping through its Server Actions.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/insights/intervention-actions", () => ({ listCauseEvents: vi.fn(), recategorizeEvent: vi.fn() }));

const readDigestSheet = vi.fn();
const setDigestSubscription = vi.fn();

vi.mock("@/app/insights/digest-actions", () => ({
  readDigestSheet: () => readDigestSheet(),
  setDigestSubscription: (subscribed: boolean) => setDigestSubscription(subscribed),
}));

const { InsightsScreen } = await import("@/app/insights/insights-screen");
const { CardBoundary } = await import("@/app/insights/card-boundary");

/** A poll that never answers, so the first paint is what is on screen. */
const POLL: InsightsPollOptions = { read: () => new Promise(() => {}), visible: () => true };

const DORA = "Delivery health · DORA-ish";

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
 * A DORA cell, by its metric.
 *
 * @param metric The metric id.
 * @returns The cell.
 */
function cell(metric: string): HTMLElement {
  const found = screen.getByRole("region", { name: DORA }).querySelector<HTMLElement>(`[data-metric="${metric}"]`);

  if (found === null) throw new Error(`no ${metric} cell`);
  return found;
}

/**
 * A digest as the service answers it.
 *
 * @param over What differs.
 * @returns The digest.
 */
function digest(over: Partial<InsightsDigest> = {}): InsightsDigest {
  return {
    subscribed: false,
    recipient: "ada@example.com",
    schedule: { weeklyDay: 1, weeklyTime: "09:00", timezone: "UTC", nextRunAt: "2026-08-10T09:00:00.000Z" },
    mail: { transport: "smtp" },
    ...over,
  };
}

/** The preview the service renders. */
const PREVIEW = {
  subject: "Insights · 27 PRs merged this week",
  html: "<!doctype html><html><body><p>27 PRs merged</p></body></html>",
  text: "27 PRs merged",
  window: { from: "2026-08-02", to: "2026-08-08" },
  contentVersion: 1,
};

/** A page from a workspace where nothing has run. */
function coldPage(): InsightsPage {
  const series = seededSeries();
  const page = seededInsights();

  return {
    ...page,
    usage: { pricing: "none", tokens: 0, unpricedTokens: 0 },
    series: {
      ...series,
      throughput: {
        ...series.throughput,
        points: series.throughput.points.map((point) => ({ day: point.day, mergedPrs: 0, interventions: 0 })),
      },
      builds: { ...series.builds, points: series.builds.points.map((point) => ({ ...point, succeeded: 0, failed: 0 })) },
      cost: { ...series.cost, points: series.cost.points.map((point) => ({ day: point.day, tokens: 0 })) },
    },
    hbars: Object.fromEntries(
      Object.entries(page.hbars).map(([key, card]) => [key, { ...card, total: 0, bars: [], line: null }]),
    ) as unknown as InsightsPage["hbars"],
    flaky: { cases: [] },
    scoreboard: { ...page.scoreboard, rows: [] },
    dora: page.dora.map((each) => ({
      ...each,
      value: null,
      prior: null,
      delta: null,
      trend: { direction: "flat" as const, good: null },
      sparkline: each.sparkline.map(() => null),
    })),
  };
}

beforeEach(() => {
  readDigestSheet.mockReset();
  setDigestSubscription.mockReset();
});

describe("the DORA strip", () => {
  it("draws the four cells with their figures, sparklines and the caption verbatim", () => {
    show();
    const strip = screen.getByRole("region", { name: DORA });

    expect(within(strip).getByText(DORA_CAPTION)).toBeInTheDocument();
    expect(within(cell("deploy_frequency")).getByText("4.2")).toBeInTheDocument();
    expect(within(cell("deploy_frequency")).getByText("/day")).toBeInTheDocument();
    expect(within(cell("lead_time")).getByText("3h 10m")).toBeInTheDocument();
    expect(within(cell("change_failure_rate")).getByText("3.1%")).toBeInTheDocument();
    expect(within(cell("mttr")).getByText("22m")).toBeInTheDocument();
    expect(strip.querySelectorAll(".chart-spark")).toHaveLength(4);
  });

  it("puts a proxy tag on change failure rate and MTTR, and on neither of the others", () => {
    show();

    expect(within(cell("change_failure_rate")).getByText("proxy")).toBeInTheDocument();
    expect(within(cell("mttr")).getByText("proxy")).toBeInTheDocument();
    expect(within(cell("deploy_frequency")).queryByText("proxy")).toBeNull();
    expect(within(cell("lead_time")).queryByText("proxy")).toBeNull();
  });

  it.each([
    ["change_failure_rate", "Change failure rate", CFR_CAVEAT],
    ["mttr", "MTTR", MTTR_CAVEAT],
  ])("opens %s's popover on its formula, its caveat and a proxy tag", (metric, label, caveat) => {
    show();
    fireEvent.click(within(cell(metric)).getByRole("button", { name: label }));

    const popover = within(cell(metric)).getByRole("group");

    expect(within(popover).getByText("Formula")).toBeInTheDocument();
    expect(within(popover).getByText(caveat)).toBeInTheDocument();
    expect(within(popover).getByText("proxy")).toBeInTheDocument();
  });

  it("states in deploy frequency's popover what stands in for a deploy", () => {
    show();
    fireEvent.click(within(cell("deploy_frequency")).getByRole("button", { name: "Deploy frequency" }));

    expect(within(within(cell("deploy_frequency")).getByRole("group")).getByText(DEPLOY_CAVEAT)).toBeInTheDocument();
  });

  it("holds four placeholder cells while nothing is read", () => {
    show(null);
    const strip = screen.getByRole("region", { name: DORA });

    expect(strip).toHaveAttribute("aria-busy", "true");
    expect(strip.querySelectorAll(".insights-dora__cell--skeleton")).toHaveLength(4);
  });

  it("is themed: one markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    expect(light).toContain("insights-dora__cells");
    expect(maskIds(dark!)).toBe(maskIds(light!));
  });
});

describe("a cold workspace", () => {
  it("frames every card as not enough data, and draws no curve anywhere", () => {
    const { container } = show(coldPage());

    expect(screen.getAllByText(COLD_TITLE)).toHaveLength(10);
    expect(container.querySelectorAll(".chart-spark")).toHaveLength(0);
    expect(container.querySelectorAll(".chart-scroll, .chart-vbars, .chart-hbars")).toHaveLength(0);
    expect(within(cell("deploy_frequency")).getByText("Not enough data to measure yet.")).toBeInTheDocument();
  });

  it("is not called behind — it is cold, not stale", () => {
    show(coldPage());

    expect(screen.queryByText(LAG_HEADLINE)).toBeNull();
  });
});

describe("the rollup-lag banner", () => {
  it("shows the real last-filled time when the rollups are behind", () => {
    show(
      seededInsights({
        freshness: { filledThrough: "2026-08-05", lastFilledAt: "2026-08-08T11:02:00.000Z", behind: true, failing: false },
      }),
    );

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent(LAG_HEADLINE);
    expect(banner).toHaveTextContent("Figures run through Aug 5, last filled 3h ago.");
  });

  it("is absent while the rollups are current", () => {
    show();

    expect(screen.queryByText(LAG_HEADLINE)).toBeNull();
  });
});

describe("one failing card", () => {
  /** A card that cannot draw. */
  function Broken(): never {
    throw new Error("unexpected shape");
  }

  it("degrades itself, not the page", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <>
        <CardBoundary className="insights-col--4" label="Broken card">
          <Broken />
        </CardBoundary>
        <p>The rest of the page</p>
      </>,
    );

    const region = screen.getByRole("region", { name: "Broken card" });

    expect(within(region).getByText(CARD_FAILED_TITLE)).toBeInTheDocument();
    expect(region).toHaveClass("insights-col--4");
    expect(screen.getByText("The rest of the page")).toBeInTheDocument();
    quiet.mockRestore();
  });

  it("keeps the rest of the screen when one card's part of the payload is malformed", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    show({ ...seededInsights(), dora: undefined as unknown as InsightsPage["dora"] });

    expect(screen.getByRole("region", { name: DORA })).toHaveTextContent(CARD_FAILED_TITLE);
    expect(screen.getByRole("region", { name: "Model scoreboard" })).toBeInTheDocument();
    quiet.mockRestore();
  });
});

describe("the weekly-digest sheet", () => {
  /** Open the sheet from the head's action. */
  async function openSheet(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole("button", { name: DIGEST_TITLE }));

    return screen.findByRole("dialog", { name: DIGEST_TITLE });
  }

  it("is a working action now, not a soon mark", () => {
    show();

    const action = screen.getByRole("button", { name: DIGEST_TITLE });

    expect(action).not.toHaveAttribute("aria-disabled");
    expect(action).not.toHaveTextContent("soon");
  });

  it("opens on the toggle, the schedule, the dev mailpit note and the service's own preview", async () => {
    readDigestSheet.mockResolvedValue({ digest: { ok: true, value: digest() }, preview: { ok: true, value: PREVIEW } });
    show();

    const sheet = await openSheet();

    expect(within(sheet).getByRole("switch", { name: DIGEST_TOGGLE })).toHaveAttribute("aria-checked", "false");
    expect(within(sheet).getByText("Sent Mondays at 09:00 UTC to ada@example.com. Next: Aug 10.")).toBeInTheDocument();
    expect(within(sheet).getByText(MAILPIT_NOTE)).toBeInTheDocument();
    expect(within(sheet).getByText(`Subject: ${PREVIEW.subject}`)).toBeInTheDocument();

    const frame = within(sheet).getByTitle(PREVIEW_FRAME_TITLE);

    // The preview is what is sent, and nothing in it may run.
    expect(frame).toHaveAttribute("srcdoc", PREVIEW.html);
    expect(frame).toHaveAttribute("sandbox", "");
  });

  it("round-trips a subscription, then offers the way back out", async () => {
    readDigestSheet.mockResolvedValue({ digest: { ok: true, value: digest() }, preview: { ok: true, value: PREVIEW } });
    setDigestSubscription.mockResolvedValueOnce({ ok: true, value: digest({ subscribed: true }) });
    setDigestSubscription.mockResolvedValueOnce({ ok: true, value: digest({ subscribed: false }) });
    show();

    const sheet = await openSheet();
    const toggle = within(sheet).getByRole("switch", { name: DIGEST_TOGGLE });

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(setDigestSubscription).toHaveBeenLastCalledWith(true);
    expect(within(sheet).getByText(UNSUBSCRIBE_NOTE)).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(setDigestSubscription).toHaveBeenLastCalledWith(false);
  });

  it("draws a refusal in the sheet and leaves the subscription as it was", async () => {
    readDigestSheet.mockResolvedValue({ digest: { ok: true, value: digest() }, preview: { ok: true, value: PREVIEW } });
    setDigestSubscription.mockResolvedValue({ ok: false, reason: "That change did not save. Try again." });
    show();

    const sheet = await openSheet();
    const toggle = within(sheet).getByRole("switch", { name: DIGEST_TOGGLE });

    fireEvent.click(toggle);

    expect(await within(sheet).findByRole("alert")).toHaveTextContent("That change did not save. Try again.");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("holds the opt-in on a deployment with no mail server, and says why", async () => {
    readDigestSheet.mockResolvedValue({
      digest: { ok: true, value: digest({ mail: { transport: "none" } }) },
      preview: { ok: true, value: PREVIEW },
    });
    show();

    const toggle = within(await openSheet()).getByRole("switch", { name: DIGEST_TOGGLE });

    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute("title", MAIL_UNCONFIGURED);
    fireEvent.click(toggle);
    expect(setDigestSubscription).not.toHaveBeenCalled();
  });

  it("degrades the sheet, not the page, when the digest or its preview cannot be read", async () => {
    readDigestSheet.mockResolvedValue({
      digest: { ok: false, reason: "down" },
      preview: { ok: false, reason: "down" },
    });
    show();

    const sheet = await openSheet();

    expect(within(sheet).getByRole("alert")).toHaveTextContent(DIGEST_UNREADABLE);
    expect(within(sheet).getByText(PREVIEW_UNREADABLE)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: DORA })).toBeInTheDocument();
  });
});
