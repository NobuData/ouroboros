import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerPage, AnalyzerPollOptions } from "@/app/analyzer/analyzer-poll";
import { DURATION_ANCHOR, chipLabel } from "@/app/analyzer/duration-view";
import {
  CONFOUNDS_HEADING,
  MEASUREMENTS_ANCHOR,
  MEASUREMENTS_TITLE,
  NO_MEASUREMENTS,
  NO_RECALIBRATION,
  PENDING_CONFOUNDS_HEADING,
  RECALIBRATION_HEADING,
  RECALIBRATION_LEDE,
  measurementAnchor,
} from "@/app/analyzer/measurements-view";
import type { Measurements } from "@/app/api/analyzer";
import type { PollAnswer } from "@/app/poll";
import { resetFocusRepos, setFocusRepo } from "@/app/shell/focus-repo";
import { setNavOrigin } from "@/app/shell/nav-registry";
import { stampTheme } from "@/app/theme";

import {
  ANALYZER_NOW,
  ANALYZER_REPOS,
  ANALYZER_WORKSPACE,
  analyzerPage,
  analyzerReadings,
  emptyDuration,
  freshPage,
  runningRun,
  seededDuration,
} from "../helpers/analyzer";
import {
  CONFOUNDED_NOTE,
  DELIVERED_ID,
  SEEDED_FORMULA,
  UNDER_ID,
  confoundedMeasurement,
  measurementsWith,
  noMeasurements,
  pendingMeasurement,
  seededMeasurement,
  seededMeasurements,
} from "../helpers/analyzer-measurements";
import { SUGGESTION, resolvedSuggestions } from "../helpers/analyzer-suggestions";
import { PALETTES, maskIds } from "../helpers/palettes";

/**
 * The predicted-vs-measured card (#520) on the analyzer screen, under its store: the seeded pair
 * against mockup 18; a miss drawn exactly as a win is, with only its hue and its note apart; a
 * confounded measurement as neither, listing what interfered with links that land on the page; a
 * pending one counting its days and naming its metric; the recalibration popover's live numbers;
 * and the card with nothing applied.
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

/** What the poll answers next; reassigned by the cases that move the page along. */
let answer: PollAnswer<AnalyzerPage> | null = null;

/** A reader answering {@link answer}, or never while it is `null`. */
const POLL: AnalyzerPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
  now: () => ANALYZER_NOW,
};

/** The seeded chart's first change-point (Jul 12). */
const POINT = seededDuration().changePoints[0]!;

/** A page whose measurements are the given ones. */
function pageWith(measurements: Measurements, over: Partial<AnalyzerPage> = {}): PollAnswer<AnalyzerPage> {
  return freshPage(analyzerPage({ measurements, ...over }));
}

/**
 * Render the screen and wait for the poll's first page.
 *
 * @returns The render result.
 */
async function draw() {
  const view = render(<AnalyzerScreen poll={POLL} readings={analyzerReadings()} />);
  if (answer !== null) await screen.findByRole("region", { name: "Analysis summary" });
  await act(async () => {});

  return view;
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: MEASUREMENTS_TITLE });
}

/** The card's rows, in the order drawn. */
function rows(): HTMLElement[] {
  return [...card().querySelectorAll<HTMLElement>(".analyzer-pv__row")];
}

/** A row, by its suggestion's name. */
function row(title: string): HTMLElement {
  const found = rows().find((candidate) => candidate.querySelector(".analyzer-pv__name")?.textContent?.startsWith(title));

  if (found === undefined) throw new Error(`no row named ${title}`);

  return found;
}

/** A row's two lines — `[label, figure]` each, the figure without what only a screen reader hears. */
function lines(of: HTMLElement): [string, string][] {
  return [...of.querySelectorAll(".analyzer-pv__line")].map((line) => {
    const value = line.querySelector(".analyzer-pv__value")!.cloneNode(true) as HTMLElement;
    value.querySelectorAll(".sr-only").forEach((hidden) => hidden.remove());

    return [line.querySelector(".analyzer-pv__key")!.textContent ?? "", value.textContent ?? ""];
  });
}

/** A row's measured figure. */
function measured(of: HTMLElement): HTMLElement {
  return of.querySelectorAll<HTMLElement>(".analyzer-pv__line")[1]!.querySelector<HTMLElement>(".analyzer-pv__value")!;
}

/** The control behind the caption's *retrains*. */
function retrains(): HTMLElement {
  return within(card()).getByRole("button", { name: /^retrains/ });
}

/** Open the recalibration popover. */
function openPopover(): HTMLElement {
  fireEvent.click(retrains());

  return within(card()).getByRole("group", { name: RECALIBRATION_HEADING });
}

/**
 * Have the page read again now, as a finished analysis does: a press of *Run analysis now* that
 * starts a run refreshes the poll at once.
 */
function readAgain(): void {
  startAnalysis.mockResolvedValue({ kind: "started", run: runningRun() });
  fireEvent.click(screen.getByRole("button", { name: /Run analysis now/ }));
}

/**
 * A row's shape: every element under it with its classes — the two verdict hues as one word, the
 * suggestion's own text left out — which is what "drawn as prominently" means in markup.
 */
function shape(of: HTMLElement): string[] {
  return [...of.querySelectorAll("*")]
    .filter((element) => !element.matches(".analyzer-pv__note, .sr-only"))
    .map((element) => `${element.tagName}.${element.className.replace(/--(ok|warn)\b/, "--verdict")}`);
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

describe("the seeded card, against mockup 18", () => {
  it("sits in the side column under the drafted tickets, with the mockup's title and tag", async () => {
    await draw();

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent("Predicted vs measured");
    expect(within(card()).getByText("applied earlier")).toBeInTheDocument();

    const side = card().parentElement!;
    expect(side).toHaveClass("analyzer__side");
    expect([...side.children].map((child) => child.getAttribute("aria-labelledby") !== null)).toEqual([true, true, true]);
    expect(side.children[1]).toBe(card());
  });

  it("draws the pair oldest apply first, each with its two mono lines", async () => {
    await draw();

    expect(rows().map((entry) => entry.querySelector(".analyzer-pv__name")!.textContent)).toEqual([
      "Test-suite split (applied Aug 26)",
      "ccache warm-up (applied Sep 2)",
    ]);
    expect(lines(row("Test-suite split"))).toEqual([
      ["predicted", "−3m 40s"],
      ["measured", "−3m 55s ✓"],
    ]);
    expect(lines(row("ccache warm-up"))).toEqual([
      ["predicted", "−1m 50s"],
      ["measured", "−1m 12s"],
    ]);
  });

  it("marks the delivered one with the success hue and a check, and nothing under it", async () => {
    await draw();

    const delivered = row("Test-suite split");

    expect(measured(delivered)).toHaveClass("analyzer-pv__value--ok");
    expect(delivered.querySelector(".analyzer-pv__note")).toBeNull();
  });

  it("draws the under-delivered one in the warning hue, with the service's composed note under it", async () => {
    await draw();

    const under = row("ccache warm-up");

    expect(measured(under)).toHaveClass("analyzer-pv__value--warn");
    expect(under.querySelector(".analyzer-pv__note")).toHaveTextContent(
      "under-delivered — analyzer revised its cache model",
    );
    expect(under).not.toHaveTextContent("✓");
  });

  it("closes on the mockup's caption", async () => {
    await draw();

    expect(card().querySelector(".analyzer-pv__caption")).toHaveTextContent(
      "Every applied suggestion is re-measured for 14 days. The analyzer's model retrains ⓘ on its own misses.",
    );
  });

  it("states the window the rows were measured over, where it is not the default", async () => {
    answer = pageWith(measurementsWith([pendingMeasurement({ windowDays: 21 }), seededMeasurement(UNDER_ID)]));
    await draw();

    expect(card().querySelector(".analyzer-pv__caption")).toHaveTextContent("is re-measured for 21 days.");
  });
});

describe("a miss is drawn as prominently as a success", () => {
  it("gives the under-delivered row the delivered row's exact shape — only the hue and the note differ", async () => {
    await draw();

    expect(shape(row("ccache warm-up"))).toEqual(shape(row("Test-suite split")));
    expect(row("ccache warm-up").className).toBe(row("Test-suite split").className);
  });

  it("draws an over-delivery as a miss too — the same warning, the same note", async () => {
    const over = seededMeasurement(UNDER_ID, {
      verdict: "over",
      measured: { ...seededMeasurement(UNDER_ID).measured!, delta: -190 },
      note: "over-delivered — analyzer revised its cache model",
    });
    answer = pageWith(measurementsWith([over, seededMeasurement(DELIVERED_ID)]));
    await draw();

    expect(measured(row("ccache warm-up"))).toHaveClass("analyzer-pv__value--warn");
    expect(lines(row("ccache warm-up"))[1]).toEqual(["measured", "−3m 10s"]);
    expect(row("ccache warm-up").querySelector(".analyzer-pv__note")).toHaveTextContent(/^over-delivered — /);
  });

  it("never leaves a miss without its line, even one closed without a note", async () => {
    answer = pageWith(measurementsWith([seededMeasurement(UNDER_ID, { note: null })]));
    await draw();

    expect(row("ccache warm-up").querySelector(".analyzer-pv__note")).toHaveTextContent(/^under-delivered$/);
  });

  it("keeps every measurement on the card — a long history is listed whole, misses included", async () => {
    const history = Array.from({ length: 12 }, (_, index) =>
      seededMeasurement(index % 2 === 0 ? UNDER_ID : DELIVERED_ID, {
        id: `5eed0069-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
        title: `Applied change ${index + 1}`,
        appliedAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
      }),
    );
    answer = pageWith(measurementsWith(history));
    await draw();

    expect(rows()).toHaveLength(12);
    expect(card().querySelectorAll(".analyzer-pv__value--warn")).toHaveLength(6);
    expect(card().querySelectorAll(".analyzer-pv__value--ok")).toHaveLength(6);
    expect(within(card()).queryByRole("button", { name: /show|more|older/i })).toBeNull();
  });

  it("says every verdict in a word a screen reader hears, so the hue is never the only signal", async () => {
    answer = pageWith(measurementsWith([...seededMeasurements().measurements, pendingMeasurement()]));
    await draw();

    expect(measured(row("Test-suite split")).querySelector(".sr-only")).toHaveTextContent("— delivered");
    expect(measured(row("ccache warm-up")).querySelector(".sr-only")).toHaveTextContent("— under-delivered");
    expect(measured(row("Shift pool-a")).querySelector(".sr-only")).toHaveTextContent("— pending");
  });
});

describe("a confounded measurement", () => {
  /** The confounded row beside the seeded pair. */
  function withConfounded(over: Parameters<typeof confoundedMeasurement>[1] = {}): PollAnswer<AnalyzerPage> {
    return pageWith(measurementsWith([confoundedMeasurement(POINT, over), ...seededMeasurements().measurements]));
  }

  it("is drawn as neither a delivery nor a miss: its figure, marked confounded", async () => {
    answer = withConfounded();
    await draw();

    const confounded = row("Pin the Zephyr SDK image");
    const figure = measured(confounded);

    expect(lines(confounded)[1]).toEqual(["measured", "−1m 36s confounded"]);
    expect(figure).toHaveClass("analyzer-pv__value--confounded");
    expect(figure).not.toHaveClass("analyzer-pv__value--ok");
    expect(figure).not.toHaveClass("analyzer-pv__value--warn");
    expect(figure.querySelector(".analyzer-pv__flag")).toHaveTextContent(/^confounded$/);
    expect(confounded).not.toHaveTextContent("✓");
    expect(confounded.querySelector(".analyzer-pv__note")).toHaveTextContent(CONFOUNDED_NOTE);
  });

  it("lists what interfered, each dated, under its own heading", async () => {
    answer = withConfounded();
    await draw();

    const confounded = row("Pin the Zephyr SDK image");

    expect(confounded.querySelector(".analyzer-pv__interfering")).toHaveTextContent(CONFOUNDS_HEADING);
    expect([...confounded.querySelectorAll(".analyzer-pv__confound")].map((item) => item.textContent)).toEqual([
      "applied Sep 2: ccache warm-up",
      `change-point ${chipLabel(POINT)}`,
    ]);
  });

  it("links the interfering application to its own row, and the change-point to the chart — both on the page", async () => {
    answer = withConfounded();
    await draw();

    const confounded = row("Pin the Zephyr SDK image");
    const application = within(confounded).getByRole("link", { name: "applied Sep 2: ccache warm-up" });
    const point = within(confounded).getByRole("link", { name: `change-point ${chipLabel(POINT)}` });

    expect(application).toHaveAttribute("href", `#${measurementAnchor(UNDER_ID)}`);
    expect(document.getElementById(measurementAnchor(UNDER_ID))).toBe(row("ccache warm-up"));
    expect(point).toHaveAttribute("href", `#${DURATION_ANCHOR}`);
    expect(document.getElementById(DURATION_ANCHOR)).toBe(
      within(screen.getByRole("region", { name: /build duration/i })).getByRole("heading", { level: 2 }),
    );
  });

  it("keeps the date and draws no link for what the page no longer holds", async () => {
    answer = pageWith(measurementsWith([confoundedMeasurement(POINT)]), { duration: emptyDuration() });
    await draw();

    const confounded = row("Pin the Zephyr SDK image");

    expect([...confounded.querySelectorAll(".analyzer-pv__confound")].map((item) => item.textContent)).toEqual([
      "another suggestion was applied Sep 2",
      "a change-point was detected Jul 12",
    ]);
    expect(within(confounded).queryByRole("link")).toBeNull();
  });

  it("draws no list under a clean measurement", async () => {
    answer = withConfounded();
    await draw();

    expect(row("ccache warm-up").querySelector(".analyzer-pv__confounds")).toBeNull();
    expect(row("ccache warm-up").querySelector(".analyzer-pv__interfering")).toBeNull();
  });
});

describe("a pending measurement", () => {
  it("counts its days and names the metric being measured, with no verdict drawn", async () => {
    answer = pageWith(measurementsWith([pendingMeasurement(), ...seededMeasurements().measurements]));
    await draw();

    const pending = row("Shift pool-a's weekday autoscale floor");

    expect(pending.querySelector(".analyzer-pv__name")).toHaveTextContent("(applied Sep 30)");
    expect(lines(pending)).toEqual([
      ["predicted", "−4m"],
      ["measured", "day 3 of 14"],
    ]);
    expect(measured(pending)).toHaveClass("analyzer-pv__value--pending");
    expect(measured(pending)).not.toHaveClass("analyzer-pv__value--ok");
    expect(pending.querySelector(".analyzer-pv__note")).toHaveTextContent(
      "measuring queue wait (p95, pool-a) until Oct 14",
    );
    expect(pending).not.toHaveTextContent("✓");
    // The newest apply is the last row.
    expect(rows().at(-1)).toBe(pending);
  });

  it("already lists what has landed inside its window", async () => {
    const early = pendingMeasurement({ confounds: [{ kind: "change_point", id: POINT.id, date: POINT.date }] });
    answer = pageWith(measurementsWith([early]));
    await draw();

    const pending = row("Shift pool-a");

    expect(pending.querySelector(".analyzer-pv__interfering")).toHaveTextContent(PENDING_CONFOUNDS_HEADING);
    expect(within(pending).getByRole("link", { name: `change-point ${chipLabel(POINT)}` })).toBeInTheDocument();
    expect(measured(pending)).toHaveTextContent("day 3 of 14");
  });

  it("becomes its verdict when the service closes it — the same row, over a poll", async () => {
    answer = pageWith(measurementsWith([pendingMeasurement()]));
    await draw();
    expect(lines(row("Shift pool-a"))[1]).toEqual(["measured", "day 3 of 14"]);

    answer = pageWith(
      measurementsWith([
        pendingMeasurement({
          day: 14,
          verdict: "under",
          measured: { delta: -95, value: 317, window: { from: "2026-09-30", to: "2026-10-14" } },
          note: "under-delivered — analyzer revised its queue model",
          closedAt: "2026-10-15T03:00:00.000Z",
        }),
      ]),
    );
    readAgain();

    await waitFor(() => expect(lines(row("Shift pool-a"))[1]).toEqual(["measured", "−1m 35s"]));
    expect(measured(row("Shift pool-a"))).toHaveClass("analyzer-pv__value--warn");
    expect(row("Shift pool-a").querySelector(".analyzer-pv__note")).toHaveTextContent(
      "under-delivered — analyzer revised its queue model",
    );
  });

  it("is where an applied suggestion's row links — the card's heading answers to its anchor", async () => {
    answer = freshPage(analyzerPage({ suggestions: resolvedSuggestions(SUGGESTION.move, "applied") }));
    await draw();

    const link = screen.getAllByRole("link", { name: "Predicted vs measured" })[0]!;

    expect(link).toHaveAttribute("href", `#${MEASUREMENTS_ANCHOR}`);
    expect(document.getElementById(MEASUREMENTS_ANCHOR)).toBe(within(card()).getByRole("heading", { level: 2 }));
  });
});

describe("the recalibration popover", () => {
  it("opens from the caption's retrains, as a disclosure", async () => {
    await draw();

    expect(retrains()).toHaveAttribute("aria-expanded", "false");
    expect(within(card()).queryByRole("group")).toBeNull();

    const panel = openPopover();

    expect(retrains()).toHaveAttribute("aria-expanded", "true");
    expect(retrains()).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveTextContent(RECALIBRATION_LEDE);
  });

  it("shows the formula as the service states it", async () => {
    await draw();

    expect(openPopover().querySelector(".analyzer-pv__formula")).toHaveTextContent(SEEDED_FORMULA);
  });

  it("shows each cell: analyzer and impact class, the factor now, and the measurements that moved it", async () => {
    await draw();

    const cells = [...openPopover().querySelectorAll(".analyzer-pv__cell")].map((cell) =>
      [...cell.children].map((line) => line.textContent),
    );

    expect(cells).toEqual([
      [
        "cache_window · duration_delta",
        "× 0.6545 now, from 1 closed measurement",
        "Sep 17 · × 1 → × 0.6545 = −72 ÷ −110 over 1 measurement — moved by ccache warm-up",
      ],
      [
        "workflow_outcome · duration_delta",
        "× 1.0682 now, from 1 closed measurement",
        "Sep 10 · × 1 → × 1.0682 = −235 ÷ −220 over 1 measurement — moved by Test-suite split",
      ],
    ]);
  });

  it("is live data: a factor the service moves is the factor shown, with the update that moved it", async () => {
    await draw();
    const panel = openPopover();
    expect(panel.querySelector(".analyzer-pv__cell")).toHaveTextContent("× 0.6545 now, from 1 closed measurement");

    const moved = seededMeasurements();
    const [cell] = moved.calibration;
    cell!.factor = 0.8125;
    cell!.sampleCount = 2;
    cell!.history.unshift({
      fromFactor: 0.6545,
      toFactor: 0.8125,
      sampleCount: 2,
      measuredSum: -195,
      predictedSum: -240,
      measurementIds: [UNDER_ID, DELIVERED_ID],
      addedMeasurementIds: [DELIVERED_ID],
      createdAt: "2026-10-01T03:00:00.000Z",
    });
    moved.formula = "factor = the service's own words";
    answer = pageWith(moved);
    readAgain();

    // The popover is open across the poll, and shows what the service now holds.
    await waitFor(() =>
      expect(panel.querySelector(".analyzer-pv__cell")).toHaveTextContent("× 0.8125 now, from 2 closed measurements"),
    );
    expect(panel.querySelector(".analyzer-pv__formula")).toHaveTextContent("factor = the service's own words");
    expect([...panel.querySelector(".analyzer-pv__cell")!.children].map((line) => line.textContent).slice(2)).toEqual([
      "Oct 1 · × 0.6545 → × 0.8125 = −195 ÷ −240 over 2 measurements — moved by Test-suite split",
      "Sep 17 · × 1 → × 0.6545 = −72 ÷ −110 over 1 measurement — moved by ccache warm-up",
    ]);
  });

  it("says nothing has been recalibrated where no measurement has closed", async () => {
    answer = pageWith(measurementsWith([pendingMeasurement()], []));
    await draw();

    const panel = openPopover();

    expect(panel).toHaveTextContent(NO_RECALIBRATION);
    expect(panel.querySelector(".analyzer-pv__formula")).toHaveTextContent(SEEDED_FORMULA);
    expect(panel.querySelector(".analyzer-pv__cell")).toBeNull();
  });

  it("closes on Escape and gives focus back to the word that opened it", async () => {
    await draw();
    openPopover();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(within(card()).queryByRole("group")).toBeNull();
    expect(retrains()).toHaveFocus();
  });
});

describe("with nothing applied", () => {
  it("says so, and what will appear — not an empty frame", async () => {
    answer = pageWith(noMeasurements());
    await draw();

    expect(within(card()).getByText(NO_MEASUREMENTS.title)).toBeInTheDocument();
    expect(within(card()).getByText(NO_MEASUREMENTS.note)).toBeInTheDocument();
    expect(within(card()).queryByText("applied earlier")).toBeNull();
    expect(rows()).toHaveLength(0);
    expect(card().querySelector(".analyzer-pv__caption")).toBeNull();
    expect(within(card()).queryByRole("button")).toBeNull();
    expect(card()).not.toHaveAttribute("aria-busy");
  });

  it("holds the rows' place while the page is unread, claiming nothing either way", async () => {
    answer = null;
    await draw();

    expect(card()).toHaveAttribute("aria-busy", "true");
    expect(card().querySelector(".analyzer-pv__skeleton")).not.toBeNull();
    expect(within(card()).queryByText(NO_MEASUREMENTS.title)).toBeNull();
    expect(within(card()).queryByText("applied earlier")).toBeNull();
    expect(rows()).toHaveLength(0);
  });
});

describe("theming and markup", () => {
  it("draws the same markup in light and dark — every tint is a token", async () => {
    answer = pageWith(
      measurementsWith([confoundedMeasurement(POINT), pendingMeasurement(), ...seededMeasurements().measurements]),
    );

    const drawn: string[] = [];
    for (const palette of PALETTES) {
      stampTheme(palette);
      await draw();
      openPopover();
      drawn.push(maskIds(card().outerHTML));
      cleanup();
    }

    expect(drawn[0]).toContain("analyzer-pv__value--ok");
    expect(drawn[0]).toContain("analyzer-pv__value--warn");
    expect(drawn[0]).toContain("analyzer-pv__value--confounded");
    expect(drawn[0]).toContain("analyzer-pv__value--pending");
    expect(drawn[0]).toContain("analyzer-pv__cell");
    expect(drawn[0]).toBe(drawn[1]);
  });

  it("writes no inline style into the card", async () => {
    answer = pageWith(
      measurementsWith([confoundedMeasurement(POINT), pendingMeasurement(), ...seededMeasurements().measurements]),
    );
    await draw();
    openPopover();

    expect(card().querySelectorAll("[style]")).toHaveLength(0);
  });
});
