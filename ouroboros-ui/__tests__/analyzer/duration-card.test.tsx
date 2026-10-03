import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerPage, AnalyzerPollOptions } from "@/app/analyzer/analyzer-poll";
import {
  ATTRIBUTED_HEADING,
  DURATION_CAPTION,
  DURATION_TAG,
  MARKERS_LABEL,
  NO_DURATION_RUN,
  NO_DURATION_SERIES,
  RANKING_NOTE,
  UNATTRIBUTED_NOTE,
} from "@/app/analyzer/duration-view";
import type { ChangePoint } from "@/app/api/analyzer";
import { plotFrame, xOf } from "@/app/charts/geometry";
import { CHART_MIN_WIDTH_REM, MARK_OFFSET_REM, markWidthRem } from "@/app/charts/marks";
import { resetFocusRepos, setFocusRepo } from "@/app/shell/focus-repo";
import { setNavOrigin } from "@/app/shell/nav-registry";
import type { PollAnswer } from "@/app/poll";

import {
  ANALYZER_NOW,
  ANALYZER_REPOS,
  ANALYZER_WORKSPACE,
  analyzerPage,
  analyzerReadings,
  emptyDuration,
  evidenceOf,
  freshPage,
  runningRun,
  seededChangePoints,
  seededDay,
  seededDuration,
} from "../helpers/analyzer";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The annotated duration chart (#517) on the analyzer screen, under its store: the seeded chart
 * against mockup 18, chips that are the findings and nothing else, clustered change-points that
 * stay legible, the Details sheet's ranked candidates and resolving evidence, durations on the
 * axis and at the endpoint, what a screen reader and a keyboard reach, and both palettes.
 */

const startAnalysis = vi.fn();

vi.mock("@/app/analyzer/analyzer-actions", () => ({
  startAnalysis: (...args: unknown[]) => startAnalysis(...args),
  saveAnalyzerSchedule: vi.fn(),
}));

const { AnalyzerScreen } = await import("@/app/analyzer/analyzer-screen");
const { DurationPlot } = await import("@/app/analyzer/duration-card");

/** What the poll answers next; reassigned by the cases that move the analysis along. */
let answer: PollAnswer<AnalyzerPage> | null = null;

/** A reader answering {@link answer}, or never while it is `null`. */
const POLL: AnalyzerPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
  now: () => ANALYZER_NOW,
};

const TITLE = "Build duration · 90 days, with detected change-points";

const [ZEPHYR, CCACHE, TWISTER] = seededChangePoints() as [ChangePoint, ChangePoint, ChangePoint];

/**
 * Render the screen and wait for the poll's first page.
 *
 * @param readings The route's readings.
 * @returns The render result.
 */
async function draw(readings = analyzerReadings()) {
  const view = render(<AnalyzerScreen poll={POLL} readings={readings} />);
  if (answer !== null) await screen.findByRole("region", { name: "Analysis summary" });
  await act(async () => {});

  return view;
}

/** The duration card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: TITLE });
}

/** The chips, in document order. */
function chips(): HTMLElement[] {
  return within(within(card()).getByRole("group", { name: MARKERS_LABEL })).getAllByRole("button");
}

/** A chip by the start of its text. */
function chip(text: RegExp): HTMLElement {
  return chips().find((element) => text.test(element.textContent))!;
}

/** The open Details sheet. */
function sheet(): HTMLElement {
  return screen.getByRole("dialog");
}

/**
 * Have the page read again now, as a finished analysis does: a press of *Run analysis now* that
 * starts a run refreshes the poll at once.
 */
function readAgain(): void {
  startAnalysis.mockResolvedValue({ kind: "started", run: runningRun() });
  fireEvent.click(screen.getByRole("button", { name: /Run analysis now/ }));
}

/** A chip's left and right edges at the chart's narrowest width, by the sheet's own rule, in rem. */
function edges(element: HTMLElement): { row: number; left: number; right: number } {
  const x = Number.parseFloat(element.style.getPropertyValue("--chart-x")) / 100;
  const end = Number.parseFloat(element.style.getPropertyValue("--chart-end")) / 100;
  const span = markWidthRem(Number(element.style.getPropertyValue("--chart-chars")));
  const width = CHART_MIN_WIDTH_REM.wide;
  const left = Math.max(0, Math.min(x * width + MARK_OFFSET_REM, width * (1 - end) - span));

  return { row: Number(element.style.getPropertyValue("--chart-row")), left, right: left + span };
}

beforeEach(() => {
  answer = freshPage();
  startAnalysis.mockReset();
  setFocusRepo(ANALYZER_WORKSPACE, { id: ANALYZER_REPOS[1]!.id, name: "helios-firmware" });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetFocusRepos();
  setNavOrigin(null);
});

describe("the seeded chart, against mockup 18", () => {
  it("is the mockup's card: its title, its tag and its caption", async () => {
    await draw();

    expect(within(card()).getByRole("heading", { level: 2, name: TITLE })).toBeInTheDocument();
    expect(within(card()).getByText(DURATION_TAG)).toBeInTheDocument();
    expect(within(card()).getByText(DURATION_CAPTION)).toBeInTheDocument();
    expect(DURATION_CAPTION).toBe(
      "The analyzer attributes every shift in the curve to a merge, a config change, or infrastructure drift.",
    );
  });

  it("draws the three chips with the mockup's candidates and deltas", async () => {
    await draw();

    expect(chips().map((element) => element.textContent)).toEqual([
      "Jul 12 · Zephyr 4.1 migration +1m 30s",
      "Aug 16 · ccache enabled −2m 10s",
      "Sep 23 · twister suite growth +40s",
    ]);
  });

  it("tints by the delta's sign — the two regressions warn, the improvement is ok and never a warning", async () => {
    await draw();
    const [zephyr, ccache, twister] = chips();

    expect(zephyr).toHaveClass("chart-mark--warn");
    expect(twister).toHaveClass("chart-mark--warn");
    expect(ccache).toHaveClass("chart-mark--ok");
    expect(ccache).not.toHaveClass("chart-mark--warn");
  });

  it("sits each chip and its dashed vertical at the detected breakpoint's own day", async () => {
    await draw();
    const frame = plotFrame(640, 180, 30);
    const days = [7, 42, 80];
    const verticals = [...card().querySelectorAll("[data-chart-markers] .chart-ts__marker")];

    expect(days.map(seededDay)).toEqual([ZEPHYR.date, CCACHE.date, TWISTER.date]);
    expect(verticals.map((line) => Number(line.getAttribute("x1")))).toEqual(days.map((day) => xOf(day, 89, frame)));
    expect(chips().map((element) => element.style.getPropertyValue("--chart-x"))).toEqual(
      days.map((day) => `${Math.round((xOf(day, 89, frame) / 640) * 10000) / 100}%`),
    );
  });

  it("arranges them as the mockup does: the first and last on the top row, the middle one stepped down", async () => {
    await draw();

    expect(chips().map((element) => element.style.getPropertyValue("--chart-row"))).toEqual(["0", "1", "0"]);
  });

  it("writes the y-axis and the endpoint as durations, never as seconds", async () => {
    await draw();
    const axis = [...card().querySelectorAll("[data-chart-axis] text")].map((label) => label.textContent);

    expect(axis).toEqual(["3m", "4m", "5m", "6m"]);
    // The seeded series ends on a 245 s day; the level it wobbles about is the mockup's 4m 12s.
    expect(card().querySelector("[data-chart-endpoint] text")).toHaveTextContent("4m 05s");
    expect(card().querySelector(".chart-ts__svg")!.textContent).not.toMatch(/\b\d{3}\b/);
  });

  it("labels four days across the window, as the mockup's x-axis does", async () => {
    await draw();

    expect([...card().querySelectorAll("[data-chart-ticks] text")].map((tick) => tick.textContent)).toEqual([
      "Jul 5",
      "Aug 3",
      "Sep 2",
      "Oct 1",
    ]);
  });

  it("draws the whole ninety-day curve — one point per day with builds", async () => {
    await draw();

    expect(card().querySelector(".chart-ts__line")!.getAttribute("points")!.split(" ")).toHaveLength(89);
  });
});

describe("chips are findings rendered, not annotations drawn", () => {
  it("draws no chip and no vertical when the run found no change-point", async () => {
    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: [] }) }));

    await draw();

    expect(within(card()).queryByRole("group", { name: MARKERS_LABEL })).toBeNull();
    expect(card().querySelector("[data-chart-markers]")).toBeNull();
    expect(card().querySelector(".chart-ts__line")).not.toBeNull();
  });

  it("draws exactly one chip per finding — never one more", async () => {
    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: [CCACHE] }) }));

    await draw();

    expect(chips().map((element) => element.textContent)).toEqual(["Aug 16 · ccache enabled −2m 10s"]);
    expect(card().querySelectorAll("[data-chart-markers] .chart-ts__marker")).toHaveLength(1);
  });

  it("moves, renames, re-measures and re-tints a chip when its finding changes", async () => {
    const changed: ChangePoint = {
      ...CCACHE,
      date: seededDay(50),
      deltaSeconds: 75,
      candidates: [{ ...CCACHE.candidates[0]!, label: "LTO enabled" }, ...CCACHE.candidates.slice(1)],
    };
    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: [changed] }) }));

    await draw();
    const [only] = chips();
    const frame = plotFrame(640, 180, 30);

    expect(only).toHaveTextContent("Aug 24 · LTO enabled +1m 15s");
    expect(only).toHaveClass("chart-mark--warn");
    expect(Number(card().querySelector(".chart-ts__marker")!.getAttribute("x1"))).toBe(xOf(50, 89, frame));
  });

  it("follows the findings from one poll to the next", async () => {
    await draw();
    expect(chips()).toHaveLength(3);

    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: [ZEPHYR] }) }));
    readAgain();

    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(chips()[0]).toHaveTextContent("Jul 12 · Zephyr 4.1 migration +1m 30s");
    expect(card().querySelectorAll("[data-chart-markers] .chart-ts__marker")).toHaveLength(1);
  });

  it("keeps the last analysis's chart while a new run is in flight", async () => {
    answer = freshPage(analyzerPage({ run: runningRun() }));

    await draw();

    expect(chips()).toHaveLength(3);
  });
});

describe("clustered change-points", () => {
  /** Three breakpoints inside two weeks. */
  const cluster: ChangePoint[] = [
    { ...ZEPHYR, id: "c1", date: seededDay(40) },
    { ...CCACHE, id: "c2", date: seededDay(45) },
    { ...TWISTER, id: "c3", date: seededDay(52) },
  ];

  it("lay out without overlap — each on a row it shares with nothing it touches", async () => {
    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: cluster }) }));

    await draw();
    const placed = chips().map(edges);

    expect(placed).toHaveLength(3);
    for (const [index, one] of placed.entries()) {
      for (const other of placed.slice(index + 1)) {
        const apart = one.right <= other.left || other.right <= one.left;

        expect(one.row !== other.row || apart, "two chips of one row overlap").toBe(true);
      }
    }
    expect(new Set(placed.map((place) => place.row)).size).toBe(3);
  });

  it("gives the band a row for each, and every chip its whole label", async () => {
    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: cluster }) }));

    await draw();
    const band = within(card()).getByRole("group", { name: MARKERS_LABEL });

    expect(band.style.getPropertyValue("--chart-rows")).toBe("3");
    for (const element of chips()) {
      expect(Number(element.style.getPropertyValue("--chart-chars"))).toBe([...element.textContent].length);
    }
  });

  it("cuts a long candidate name on the chip and keeps it whole in the chip's name", async () => {
    const long = "Tune the brown-out threshold for writes during flashing";
    const point = { ...TWISTER, candidates: [{ ...TWISTER.candidates[0]!, label: long }] };
    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: [point] }) }));

    await draw();
    const [only] = chips();

    expect(only).toHaveTextContent("Sep 23 · Tune the brown-out threshol… +40s");
    expect(only).toHaveAccessibleName(expect.stringContaining(`Top candidate: ${long}.`));
  });
});

describe("the Details sheet", () => {
  /** Open a chip's sheet. */
  async function open(text: RegExp): Promise<HTMLElement> {
    await draw();
    fireEvent.click(chip(text));

    return sheet();
  }

  it("opens from a chip, named for its change-point, with the delta and both segment medians", async () => {
    const dialog = await open(/ccache enabled/);

    expect(dialog).toHaveAccessibleName("Change-point details · Change-point · Aug 16");
    expect(within(dialog).getByRole("heading", { level: 2, name: "Build duration fell by 2m 10s on Aug 16" })).toBeInTheDocument();
    expect(within(dialog).getByText("−2m 10s")).toHaveClass("analyzer-cp__delta--ok");
    expect(within(dialog).getByText(/5m 42s before → 3m 32s after/)).toBeInTheDocument();
  });

  it("labels the top entry attributed to (top candidate), with its score — not as the cause", async () => {
    const dialog = await open(/ccache enabled/);
    const top = within(dialog).getByRole("region", { name: ATTRIBUTED_HEADING });

    expect(top).toHaveTextContent("ccache enabled score 0.70");
    expect(within(top).getByText(RANKING_NOTE)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/caused by|the cause/i);
  });

  it("shows the whole ranked candidate list with every score — not a single asserted cause", async () => {
    const dialog = await open(/ccache enabled/);
    const rows = within(within(dialog).getByRole("region", { name: "Ranked candidates" })).getAllByRole("listitem");

    expect(rows.map((row) => row.textContent)).toEqual([
      "1ccache enabledscore 0.70merge · Aug 16 · same day · proximity 1.00 × prior 0.70",
      "2can: driver timeout tweakscore 0.525merge · Aug 15 · 1 day before · proximity 0.75 × prior 0.70",
      "3standard-fix v9score 0.30workflow version · Aug 15 · 1 day before · proximity 0.75 × prior 0.40",
    ]);
  });

  it("states the attribution window and the confidence with its basis", async () => {
    const dialog = await open(/Zephyr 4\.1 migration/);

    expect(within(dialog).getByText("±3 days · Jul 9 – Jul 15")).toBeInTheDocument();
    expect(within(dialog).getByText("70%")).toBeInTheDocument();
    expect(within(dialog).getByText("370 builds in the two segments either side of the shift.")).toBeInTheDocument();
    expect(within(dialog).getByText(/^change_point v1: 100 \* stability/)).toBeInTheDocument();
  });

  it("resolves its evidence to the farm and the workflow studio", async () => {
    const dialog = await open(/Zephyr 4\.1 migration/);
    const evidence = within(dialog).getByRole("region", { name: "Evidence" });
    const links = within(evidence).getAllByRole("link");

    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Zephyr 4.1 migration", "/build-farm"],
      ["pool-a", "/build-farm#pools-card-title"],
      ["standard-fix v5", "/workflows/standard-fix"],
      ["docs: README typo", "/build-farm"],
      ["#10100 · zephyr build", "/build-farm"],
      ["#10102 · zephyr build", "/build-farm"],
    ]);
    expect(within(evidence).getAllByText("opens in Build Farm")).toHaveLength(5);
    expect(within(evidence).getByText("opens in Workflows")).toBeInTheDocument();
    expect(within(evidence).getByText("63863e5")).toBeInTheDocument();
  });

  it("resolves a merge the mirror holds to its PR page, and says when a reference is gone", async () => {
    const sha = CCACHE.candidates[0]!.ref.id;
    const point: ChangePoint = {
      ...CCACHE,
      evidence: [
        evidenceOf("merge", sha, "ccache enabled", {
          surface: "pull_request",
          pullRequestId: "5eed003a-0000-4000-8000-000000000514",
        }),
        ...CCACHE.evidence.slice(1, 3),
        evidenceOf("build", "5eed0062-0000-4000-8000-000000010623", null),
      ],
    };
    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: [point] }) }));

    const dialog = await open(/ccache enabled/);
    const evidence = within(dialog).getByRole("region", { name: "Evidence" });

    expect(within(evidence).getByRole("link", { name: "ccache enabled" })).toHaveAttribute(
      "href",
      "/prs/5eed003a-0000-4000-8000-000000000514?from=build-farm",
    );
    expect(within(evidence).getByText("opens in Pull request")).toBeInTheDocument();
    expect(within(evidence).getByText("no longer available to open")).toBeInTheDocument();
    expect(within(evidence).queryByRole("link", { name: "5eed0062" })).toBeNull();
    // The ranked list links the top candidate to the same PR.
    expect(
      within(within(dialog).getByRole("region", { name: "Ranked candidates" })).getByRole("link", { name: "ccache enabled" }),
    ).toHaveAttribute("href", "/prs/5eed003a-0000-4000-8000-000000000514?from=build-farm");
  });

  it("says a shift nothing recorded explains is unattributed, and still lists what it has", async () => {
    const orphan: ChangePoint = {
      ...TWISTER,
      candidates: [
        {
          label: "no recorded change within ±3 days",
          score: 0,
          eventKind: null,
          date: TWISTER.date,
          daysFromBreakpoint: 0,
          proximity: 0,
          prior: 0,
          ref: { kind: "build", id: "5eed0062-0000-4000-8000-000000011167" },
        },
      ],
    };
    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: [orphan] }) }));

    const dialog = await open(/no recorded change/);

    expect(within(dialog).getByRole("region", { name: ATTRIBUTED_HEADING })).toHaveTextContent(UNATTRIBUTED_NOTE);
    expect(within(dialog).queryByText(RANKING_NOTE)).toBeNull();
    expect(within(dialog).getByText("no recorded change within ±3 days")).toBeInTheDocument();
  });

  it("closes on Escape and gives focus back to the chip that opened it", async () => {
    await draw();
    const opener = chip(/ccache enabled/);

    opener.focus();
    fireEvent.click(opener);
    expect(sheet()).toBeInTheDocument();

    fireEvent.keyDown(sheet(), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("follows its finding over a poll, and closes by itself when a new analysis no longer has it", async () => {
    await draw();
    fireEvent.click(chip(/ccache enabled/));
    expect(within(sheet()).getByText("100%")).toBeInTheDocument();

    answer = freshPage(
      analyzerPage({ duration: seededDuration({ changePoints: [ZEPHYR, { ...CCACHE, confidence: 61 }] }) }),
    );
    readAgain();
    await waitFor(() => expect(within(sheet()).getByText("61%")).toBeInTheDocument());

    answer = freshPage(analyzerPage({ duration: seededDuration({ changePoints: [ZEPHYR] }) }));
    readAgain();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("what a screen reader and a keyboard reach", () => {
  it("names the chart's image by a summary of the series", async () => {
    await draw();

    expect(
      within(card()).getByRole("img", {
        name: "Median zephyr build duration per day, Jul 5 – Oct 1: between 3m 21s and 5m 53s, ending at 4m 05s. 3 detected change-points.",
      }),
    ).toBeInTheDocument();
  });

  it("gives each change-point its date, direction, magnitude and top candidate, in words", async () => {
    await draw();

    expect(chips().map((element) => element.getAttribute("aria-label"))).toEqual([
      "Jul 12 · Zephyr 4.1 migration +1m 30s — Build duration rose by 1m 30s on Jul 12. Top candidate: Zephyr 4.1 migration. Opens the details.",
      "Aug 16 · ccache enabled −2m 10s — Build duration fell by 2m 10s on Aug 16. Top candidate: ccache enabled. Opens the details.",
      "Sep 23 · twister suite growth +40s — Build duration rose by 40s on Sep 23. Top candidate: twister suite growth. Opens the details.",
    ]);
  });

  it("makes every chip a button in the tab order, ahead of the plot's own stop", async () => {
    await draw();
    const stops = [...card().querySelectorAll<HTMLElement>("button:not([tabindex='-1'])")];

    expect(stops.slice(0, 3)).toEqual(chips());
    for (const element of chips()) {
      expect(element.tagName).toBe("BUTTON");
      expect(element).toHaveAttribute("type", "button");
    }
    // The day columns keep their single roving stop, on the latest day.
    expect(stops[3]).toHaveAccessibleName("Oct 1 — 4m 05s median · 11 builds");
  });

  it("opens the same sheet from the keyboard as from the pointer", async () => {
    await draw();
    const opener = chip(/twister suite growth/);

    opener.focus();
    expect(opener).toHaveFocus();
    // A button's Enter and Space are the browser's click.
    fireEvent.click(opener);

    expect(sheet()).toHaveAccessibleName("Change-point details · Change-point · Sep 23");
  });

  it("reads each day's median and builds from the plot's columns", async () => {
    await draw();

    expect(within(card()).getByRole("button", { name: "Aug 16 — 3m 32s median · 12 builds" })).toBeInTheDocument();
  });
});

describe("the card's other states", () => {
  it("holds the chart's place, busy, until the page is read", async () => {
    answer = null;
    await draw();

    expect(card()).toHaveAttribute("aria-busy", "true");
    expect(card().querySelector(".analyzer-duration__skeleton")).not.toBeNull();
    expect(card().querySelector(".chart-ts__svg")).toBeNull();
  });

  it("says no analysis has looked for change-points yet, rather than drawing a flat line", async () => {
    answer = freshPage(analyzerPage({ run: null, duration: emptyDuration() }));

    await draw();

    expect(card()).not.toHaveAttribute("aria-busy");
    expect(within(card()).getByText(NO_DURATION_RUN.title)).toBeInTheDocument();
    expect(card().querySelector(".chart-ts__svg")).toBeNull();
    expect(within(card()).queryByText(DURATION_CAPTION)).toBeNull();
  });

  it("says when the last analysis timed nothing", async () => {
    answer = freshPage(analyzerPage({ duration: seededDuration({ durationLabel: null, series: [], changePoints: [] }) }));

    await draw();

    expect(within(card()).getByText(NO_DURATION_SERIES.title)).toBeInTheDocument();
  });

  it("draws no card for a workspace with no repository to analyse", async () => {
    answer = null;
    await draw(analyzerReadings({ repos: { ok: true, value: [] } }));

    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
  });

  it("never draws another repository's chart under this one's name", async () => {
    answer = freshPage(analyzerPage({ repo: "acme-robotics/helios-console" }));

    await draw();

    expect(card()).toHaveAttribute("aria-busy", "true");
    expect(within(card()).queryByRole("group", { name: MARKERS_LABEL })).toBeNull();
  });
});

describe("theming and scrolling", () => {
  it("draws the same markup in light and dark — every tint is a token", () => {
    const [light, dark] = renderInBothPalettes(<DurationPlot chart={seededDuration()} onOpen={() => {}} />);

    expect(light).toContain("chart-mark--ok");
    expect(maskIds(light!)).toBe(maskIds(dark!));
  });

  it("scrolls the chart inside its own wrapper, chips and plot together", async () => {
    await draw();
    const scroller = card().querySelector(".chart-scroll")!;
    const inner = scroller.querySelector(".chart-scroll__inner")!;

    expect(inner.querySelector(".chart-marks")).not.toBeNull();
    expect(inner.querySelector(".chart-ts__plot .chart-ts__svg")).not.toBeNull();
    expect(card().closest(".analyzer__main")).not.toBeNull();
  });

  it("writes nothing but data into the chart's inline styles", async () => {
    await draw();

    for (const element of card().querySelectorAll("[style]")) {
      for (const declaration of element.getAttribute("style")!.split(";").filter(Boolean)) {
        expect(declaration.trim()).toMatch(/^--chart-/);
      }
    }
  });
});
