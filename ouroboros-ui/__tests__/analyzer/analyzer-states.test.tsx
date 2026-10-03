import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerPage, AnalyzerPollOptions } from "@/app/analyzer/analyzer-poll";
import { HOW_IT_WORKS_TITLE, MEASUREMENTS_TITLE } from "@/app/analyzer/measurements-view";
import {
  FIRST_RUN_LABEL,
  FIRST_RUN_NOTE,
  GROWN_TITLE,
  HEADLINE_UNREAD,
  INSUFFICIENT_TITLE,
  NEVER_RUN_TITLE,
  NEW_RUN_LABEL,
  READS_LINE,
  RUN_IN_FLIGHT_REASON,
  THIN_RUN_NOTE,
} from "@/app/analyzer/state-view";
import { CARD_TITLES } from "@/app/analyzer/suggestions-view";
import { TICKETS_TITLE } from "@/app/analyzer/tickets-view";
import { NO_CORPUS, NO_RUN_STRIP, RUN_MEMBER_REASON, RUN_UNREAD_REASON } from "@/app/analyzer/view";
import type { PollAnswer } from "@/app/poll";
import { resetFocusRepos, setFocusRepo } from "@/app/shell/focus-repo";
import { setNavOrigin } from "@/app/shell/nav-registry";
import { stampTheme } from "@/app/theme";

import {
  ANALYZER_NOW,
  ANALYZER_REPOS,
  ANALYZER_WORKSPACE,
  HELIOS,
  analyzerPage,
  analyzerReadings,
  corpusOf,
  emptyDuration,
  freshPage,
  progressOf,
  runningRun,
  seededDuration,
  seededRun,
} from "../helpers/analyzer";
import { noMeasurements } from "../helpers/analyzer-measurements";
import { emptySuggestions } from "../helpers/analyzer-suggestions";
import { emptyTickets } from "../helpers/analyzer-tickets";
import { PALETTES, maskIds } from "../helpers/palettes";

/**
 * The page's states other than the mockup's (#521), on the analyzer screen under its store: the
 * unread page, where every region holds its place and claims nothing; **insufficient corpus**,
 * with its count, the floor and what is read — and never a chart or a suggestion, before a run or
 * after a thin one; **never run**, with the explainer and a call to action; and a run **in
 * flight**, **failed** or **stopped at its budget**, each over the results that were already there.
 */

const startAnalysis = vi.fn();

vi.mock("@/app/analyzer/analyzer-actions", () => ({
  startAnalysis: (...args: unknown[]) => startAnalysis(...args),
  saveAnalyzerSchedule: vi.fn(),
  selectTicket: vi.fn(),
  pushTickets: vi.fn(),
  draftTickets: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { AnalyzerScreen } = await import("@/app/analyzer/analyzer-screen");

/** What the poll answers next. */
let answer: PollAnswer<AnalyzerPage> | null = null;

/** A reader answering {@link answer}, or never while it is `null`. */
const POLL: AnalyzerPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
  now: () => ANALYZER_NOW,
};

/** The duration card's title over the seeded window. */
const CHART_TITLE = "Build duration · 90 days, with detected change-points";

/** The result cards' names — the ones a cold state must not draw. */
const RESULT_CARDS = [CHART_TITLE, CARD_TITLES.build_process, CARD_TITLES.workflow];

/** A page with nothing analysed on it, over this corpus — the reads as the service answers them. */
function bare(corpus = corpusOf([0, 0]), over: Partial<AnalyzerPage> = {}): PollAnswer<AnalyzerPage> {
  return freshPage(
    analyzerPage({
      run: null,
      duration: emptyDuration(),
      suggestions: emptySuggestions(),
      tickets: emptyTickets(),
      measurements: noMeasurements(),
      corpus,
      ...over,
    }),
  );
}

/**
 * Render the screen and wait for the poll's first page.
 *
 * @param readings The route's readings.
 * @returns The render result.
 */
async function draw(readings = analyzerReadings()) {
  const view = render(<AnalyzerScreen poll={POLL} readings={readings} />);
  if (answer !== null) await screen.findByRole("heading", { level: 1, name: /^(?!Reading the analyzer)/ });
  await act(async () => {});

  return view;
}

/** The page's headline. */
function headline(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

/** A region of the page by its name, or `null`. */
function region(name: string | RegExp): HTMLElement | null {
  return screen.queryByRole("region", { name });
}

/** The cold-state panel, by its title. */
function panel(title: string): HTMLElement {
  return screen.getByRole("region", { name: title });
}

/** The progress panel. */
function progress(): HTMLElement {
  return screen.getByRole("region", { name: "Analysis progress" });
}

/** The line saying whose results the cards below hold, or `null`. */
function below(): string | null {
  return progress().querySelector(".analyzer-progress__below")?.textContent ?? null;
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

describe("before the page is read", () => {
  beforeEach(() => {
    answer = null;
  });

  it("claims nothing about the repository in the head", async () => {
    await draw();

    expect(headline()).toHaveTextContent(HEADLINE_UNREAD);
    expect(screen.queryByText(/No analysis has run/)).toBeNull();
    expect(screen.queryByText(/builds have opinions/)).toBeNull();
  });

  it("keeps Run analysis now inert until it knows what it would be running over", async () => {
    await draw();

    const run = screen.getByRole("button", { name: /Run analysis now/ });

    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(run).toHaveAttribute("title", RUN_UNREAD_REASON);
  });

  it("holds the strip's place rather than saying no analysis has run", async () => {
    await draw();

    const strip = screen.getByRole("region", { name: "Analysis summary" });

    expect(strip).toHaveAttribute("aria-busy", "true");
    expect(strip.querySelector(".analyzer-strip__skeleton")).not.toBeNull();
    expect(strip).not.toHaveTextContent(NO_RUN_STRIP);
  });

  it("holds every region's place: seven regions, each busy, each with a skeleton", async () => {
    await draw();

    const regions = [
      "Analysis summary",
      CHART_TITLE,
      CARD_TITLES.build_process,
      CARD_TITLES.workflow,
      TICKETS_TITLE,
      MEASUREMENTS_TITLE,
      HOW_IT_WORKS_TITLE,
    ].map((name) => screen.getByRole("region", { name }));

    for (const card of regions) {
      expect(card, card.getAttribute("aria-label") ?? card.textContent ?? "").toHaveAttribute("aria-busy", "true");
      expect(card.querySelector("[class$='__skeleton']"), card.textContent ?? "").not.toBeNull();
    }
  });

  it("draws neither cold-state panel, and no empty state, while it does not know", async () => {
    await draw();

    expect(region(INSUFFICIENT_TITLE)).toBeNull();
    expect(region(NEVER_RUN_TITLE)).toBeNull();
    expect(document.querySelector(".ou-empty")).toBeNull();
  });

  it("stops being busy once the page is read", async () => {
    answer = freshPage();
    await draw();

    expect(document.querySelectorAll("[aria-busy='true']")).toHaveLength(0);
    expect(document.querySelectorAll("[class$='__skeleton']")).toHaveLength(0);
  });
});

describe("insufficient corpus", () => {
  it("states the current build count, the floor and what the analyzer reads", async () => {
    answer = bare(corpusOf([7, 5]));
    await draw();

    const state = panel(INSUFFICIENT_TITLE);

    expect(headline()).toHaveTextContent("The analyzer needs more history.");
    expect(within(state).getByRole("heading", { level: 2 })).toHaveTextContent(INSUFFICIENT_TITLE);
    expect(state.querySelector(".analyzer-state__count")).toHaveTextContent("7 builds on 5 days in the last 90.");
    expect(state).toHaveTextContent("It needs builds on at least 10 days before it can tell a shift from noise.");
    expect(state).toHaveTextContent(THIN_RUN_NOTE);
    expect(state.querySelector(".analyzer-state__reads")).toHaveTextContent(`What it reads${READS_LINE}`);
  });

  it("states the service's floor, whatever it is", async () => {
    answer = bare({ ...corpusOf([40, 12]), minimumDaysWithBuilds: 14, sufficient: false });
    await draw();

    expect(panel(INSUFFICIENT_TITLE)).toHaveTextContent("at least 14 days");
  });

  it("says a repository with no builds has none", async () => {
    answer = bare(corpusOf([0, 0]));
    await draw();

    expect(panel(INSUFFICIENT_TITLE).querySelector(".analyzer-state__count")).toHaveTextContent(
      "No builds in the last 90 days.",
    );
  });

  it("draws no chart, no suggestion card and no tickets — not an empty one of them either", async () => {
    answer = bare(corpusOf([7, 5]));
    await draw();

    for (const name of [...RESULT_CARDS, TICKETS_TITLE, MEASUREMENTS_TITLE]) expect(region(name), name).toBeNull();
    expect(document.querySelector(".chart-ts__line")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    expect(document.querySelector(".ou-empty")).toBeNull();
  });

  it("never draws a chart or a suggestion derived from too little data — a thin run's are withheld", async () => {
    // A run completed on three days: the service answers its three-point series and its rows.
    answer = freshPage(
      analyzerPage({
        duration: seededDuration({ series: seededDuration().series.slice(0, 3), changePoints: [] }),
        corpus: corpusOf([3, 3], [3, 3]),
        tickets: emptyTickets(),
        measurements: noMeasurements(),
      }),
    );
    await draw();

    const state = panel(INSUFFICIENT_TITLE);

    for (const name of RESULT_CARDS) expect(region(name), name).toBeNull();
    expect(document.querySelector(".chart-ts__line")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    expect(state).toHaveTextContent(
      "The last analysis read 3 builds on 3 days — too little to show a chart or suggestions from.",
    );
    expect(state.querySelector(".analyzer-state__count")).toHaveTextContent("3 builds on 3 days in the last 90.");
  });

  it("keeps the explainer beside it, and offers no call to action of its own", async () => {
    answer = bare(corpusOf([7, 5]));
    await draw();

    expect(region(HOW_IT_WORKS_TITLE)).not.toBeNull();
    expect(within(panel(INSUFFICIENT_TITLE)).queryByRole("button")).toBeNull();
    // An analysis may still be started: the head's action is live for an administrator.
    expect(screen.getByRole("button", { name: /Run analysis now/ })).not.toHaveAttribute("aria-disabled");
  });

  it("keeps a drafted batch and a measurement on the page — work somebody made does not vanish", async () => {
    answer = freshPage(analyzerPage({ corpus: corpusOf([3, 3], [3, 3]) }));
    await draw();

    expect(region(TICKETS_TITLE)).not.toBeNull();
    expect(region(MEASUREMENTS_TITLE)).not.toBeNull();
    for (const name of RESULT_CARDS) expect(region(name), name).toBeNull();
  });
});

describe("never run", () => {
  it("says so, with what a first analysis produces and the history it would read", async () => {
    answer = bare(corpusOf([1284, 89]));
    await draw();

    const state = panel(NEVER_RUN_TITLE);

    expect(headline()).toHaveTextContent("No analysis has run here yet.");
    expect(state.querySelector(".analyzer-state__count")).toHaveTextContent(
      "1,284 builds on 89 days in the last 90.",
    );
    expect(state).toHaveTextContent(FIRST_RUN_NOTE);
    expect(state.querySelector(".analyzer-state__reads")).toHaveTextContent(READS_LINE);
    expect(state).not.toHaveTextContent(THIN_RUN_NOTE);
  });

  it("stands beside the how-it-works explainer, in place of the result cards", async () => {
    answer = bare(corpusOf([1284, 89]));
    await draw();

    expect(region(HOW_IT_WORKS_TITLE)).not.toBeNull();
    for (const name of [...RESULT_CARDS, TICKETS_TITLE, MEASUREMENTS_TITLE]) expect(region(name), name).toBeNull();
    expect(document.querySelector(".ou-empty")).toBeNull();
  });

  it("offers the first analysis, and a press starts one for this repository", async () => {
    startAnalysis.mockResolvedValue({ kind: "started", run: runningRun({ phase: "assembling", manifest: null }) });
    answer = bare(corpusOf([1284, 89]));
    await draw();

    fireEvent.click(within(panel(NEVER_RUN_TITLE)).getByRole("button", { name: FIRST_RUN_LABEL }));
    await act(async () => {});

    expect(startAnalysis).toHaveBeenCalledExactlyOnceWith(HELIOS);
  });

  it("is inert for a member, with the reason — and asks nothing", async () => {
    answer = bare(corpusOf([1284, 89]));
    await draw(analyzerReadings({ mayAdminister: false }));

    const action = within(panel(NEVER_RUN_TITLE)).getByRole("button", { name: FIRST_RUN_LABEL });

    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveAttribute("title", RUN_MEMBER_REASON);
    fireEvent.click(action);
    expect(startAnalysis).not.toHaveBeenCalled();
  });

  it("offers a new analysis where a thin one came before and the history has grown since", async () => {
    answer = bare(corpusOf([60, 12], [3, 3]), { run: seededRun() });
    await draw();

    const state = panel(GROWN_TITLE);

    expect(headline()).toHaveTextContent("There is enough history to analyse now.");
    // The count is today's corpus — what a new analysis would read — not the thin one's.
    expect(state.querySelector(".analyzer-state__count")).toHaveTextContent("60 builds on 12 days in the last 90.");
    expect(state).toHaveTextContent("The last analysis read 3 builds on 3 days — too little");
    expect(within(state).getByRole("button", { name: NEW_RUN_LABEL })).toBeInTheDocument();
    for (const name of RESULT_CARDS) expect(region(name), name).toBeNull();
  });

  it("stays under a first run in flight, its action inert because one is running", async () => {
    answer = bare(corpusOf([1284, 89]), { run: runningRun({ phase: "assembling", manifest: null }) });
    await draw();

    const action = within(panel(NEVER_RUN_TITLE)).getByRole("button", { name: FIRST_RUN_LABEL });

    expect(headline()).toHaveTextContent("Reading your build history…");
    expect(progress()).toBeInTheDocument();
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveAttribute("title", RUN_IN_FLIGHT_REASON);
    expect(below()).toBeNull();
  });

  it("is still offered after a first run that failed — and nothing says it is still reading", async () => {
    answer = bare(corpusOf([1284, 89]), {
      run: seededRun({
        status: "failed",
        phase: "assembling",
        manifest: null,
        confidenceNote: null,
        failureReason: "The analysis engine could not be reached, or its answer broke off.",
      }),
    });
    await draw();

    expect(headline()).toHaveTextContent("No analysis has run here yet.");
    expect(screen.queryByText(/Reading your build history/)).toBeNull();
    expect(screen.getByRole("region", { name: "Analysis summary" })).toHaveTextContent(NO_CORPUS);
    expect(screen.queryByText(/being assembled/)).toBeNull();
    expect(within(progress()).getByRole("status")).toHaveTextContent(
      "The analysis failed, and nothing from it is shown. The analysis engine could not be reached",
    );
    expect(within(panel(NEVER_RUN_TITLE)).getByRole("button", { name: FIRST_RUN_LABEL })).not.toHaveAttribute(
      "aria-disabled",
    );
  });
});

describe("a run in flight, over results", () => {
  it("shows its progress — the phases and a tick per analyzer — with the prior results readable under it", async () => {
    answer = freshPage(analyzerPage({ run: runningRun() }));
    await draw();

    expect(within(progress()).getByRole("status")).toHaveTextContent("Analyzing — 1 of 3 analyzers finished.");
    expect(within(progress()).getByRole("list", { name: "Analyzers" })).toHaveTextContent("log_signature running");
    // The last finished analysis's chart and rows are still there.
    for (const name of RESULT_CARDS) expect(region(name), name).not.toBeNull();
    expect(document.querySelectorAll("[data-chart-markers] .chart-ts__marker")).toHaveLength(3);
    expect(within(region(CARD_TITLES.build_process)!).getAllByRole("article")).toHaveLength(4);
  });

  it("says whose results those are, and that they stay until it ends", async () => {
    answer = freshPage(analyzerPage({ run: runningRun() }));
    await draw();

    expect(below()).toBe(
      "The results below are the last finished analysis's, from 2h ago — they stay until this one ends.",
    );
  });
});

describe("a failed run, over results", () => {
  const failed = () =>
    seededRun({
      id: runningRun().id,
      status: "failed",
      phase: "analyzing",
      confidenceNote: null,
      failureReason: "The analysis engine's stream ended without its report.",
      progress: {
        analyzers: [
          progressOf("change_point", "completed", { findings: 3 }),
          progressOf("log_signature", "not_run", { reason: "The analysis engine's stream ended without its report." }),
        ],
      },
    });

  it("says it failed and why, and names what did not run", async () => {
    answer = freshPage(analyzerPage({ run: failed() }));
    await draw();

    expect(within(progress()).getByRole("status")).toHaveTextContent(
      "The analysis failed, and nothing from it is shown. The analysis engine's stream ended without its report.",
    );
    expect(within(progress()).getByRole("list", { name: "Analyzers" })).toHaveTextContent(
      "log_signature not run — The analysis engine's stream ended without its report.",
    );
  });

  it("leaves the last finished analysis's results on the page, and says the run changed none of them", async () => {
    answer = freshPage(analyzerPage({ run: failed() }));
    await draw();

    for (const name of RESULT_CARDS) expect(region(name), name).not.toBeNull();
    expect(document.querySelectorAll("[data-chart-markers] .chart-ts__marker")).toHaveLength(3);
    expect(below()).toBe(
      "The results below are the last finished analysis's, from 2h ago — this run changed none of them.",
    );
    // The headline still speaks for the analysed corpus, not for a run that read none.
    expect(headline()).toHaveTextContent("Your last 1,284 builds have opinions.");
  });
});

describe("a run stopped at its budget", () => {
  const reason =
    "The compute ceiling of 60 s was reached. Kept the findings of 2 analyzer(s); did not finish: cache_window, waiver_cite.";
  const stopped = () =>
    seededRun({
      status: "budget_exceeded",
      failureReason: reason,
      progress: {
        analyzers: [
          progressOf("change_point", "completed", { findings: 3 }),
          progressOf("log_signature", "completed", { findings: 2 }),
          progressOf("cache_window", "timed_out", { reason: "stopped at the run's compute ceiling" }),
          progressOf("waiver_cite", "not_run", { reason: "the run's compute ceiling was reached" }),
        ],
      },
    });

  it("shows the findings that were produced: the chart and the rows are drawn", async () => {
    answer = freshPage(analyzerPage({ run: stopped() }));
    await draw();

    for (const name of RESULT_CARDS) expect(region(name), name).not.toBeNull();
    expect(document.querySelectorAll("[data-chart-markers] .chart-ts__marker")).toHaveLength(3);
    expect(within(region(CARD_TITLES.build_process)!).getAllByRole("article")).toHaveLength(4);
  });

  it("names what did not run, and why — in the service's sentence and analyzer by analyzer", async () => {
    answer = freshPage(analyzerPage({ run: stopped() }));
    await draw();

    const status = within(progress()).getByRole("status");
    const analyzers = within(progress()).getByRole("list", { name: "Analyzers" });

    expect(status).toHaveTextContent(`Stopped at its budget. ${reason}`);
    expect(status).toHaveClass("analyzer-progress__status--budget");
    expect(analyzers).toHaveTextContent("change_point completed · 3 findings");
    expect(analyzers).toHaveTextContent("cache_window timed out — stopped at the run's compute ceiling");
    expect(analyzers).toHaveTextContent("waiver_cite not run — the run's compute ceiling was reached");
  });

  it("says the cards include what finished, and that the rest is an earlier analysis's", async () => {
    answer = freshPage(analyzerPage({ run: stopped() }));
    await draw();

    expect(below()).toBe(
      "The results below include what its finished analyzers found; anything from an analyzer that did not finish is an earlier analysis's.",
    );
  });
});

describe("the chart's own guard", () => {
  /** A results page whose chart read holds this many timed days. */
  function withDays(days: number): PollAnswer<AnalyzerPage> {
    return freshPage(
      analyzerPage({ duration: seededDuration({ series: seededDuration().series.slice(0, days), changePoints: [] }) }),
    );
  }

  it("draws no curve from fewer timed days than the floor, and says how many there were", async () => {
    answer = withDays(6);
    await draw();

    const chart = region(CHART_TITLE)!;

    expect(chart.querySelector(".chart-ts__line")).toBeNull();
    expect(chart).toHaveTextContent("Too few days to chart");
    expect(chart).toHaveTextContent("The last analysis timed builds on 6 days. A curve, and a shift detected in it, need at least 10.");
  });

  it("draws the curve on the floor", async () => {
    answer = withDays(10);
    await draw();

    expect(region(CHART_TITLE)!.querySelector(".chart-ts__line")).not.toBeNull();
  });
});

describe("theming and markup", () => {
  it("draws both cold states and the progress panel's line the same in light and dark", async () => {
    const pictures: [string, PollAnswer<AnalyzerPage>, () => HTMLElement][] = [
      ["insufficient", bare(corpusOf([3, 3], [3, 3])), () => panel(INSUFFICIENT_TITLE)],
      ["never run", bare(corpusOf([1284, 89])), () => panel(NEVER_RUN_TITLE)],
      ["running", freshPage(analyzerPage({ run: runningRun() })), progress],
    ];

    for (const [name, page, element] of pictures) {
      const drawn: string[] = [];
      for (const palette of PALETTES) {
        stampTheme(palette);
        answer = page;
        await draw();
        drawn.push(maskIds(element().outerHTML));
        cleanup();
      }

      expect(drawn[0], name).toContain("analyzer-");
      expect(drawn[0], name).toBe(drawn[1]);
    }
  });

  it("writes no inline style into either panel", async () => {
    for (const [page, title] of [
      [bare(corpusOf([7, 5])), INSUFFICIENT_TITLE],
      [bare(corpusOf([1284, 89])), NEVER_RUN_TITLE],
    ] as const) {
      answer = page;
      await draw();

      expect(panel(title).querySelectorAll("[style]")).toHaveLength(0);
      cleanup();
    }
  });
});
