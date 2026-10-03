import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerPage, AnalyzerPollOptions } from "@/app/analyzer/analyzer-poll";
import {
  HOW_IT_WORKS_TITLE,
  INGEST_BEFORE_A_RUN,
  LOCALITY_URL,
  MEASUREMENTS_TITLE,
} from "@/app/analyzer/measurements-view";
import { TICKETS_TITLE } from "@/app/analyzer/tickets-view";
import type { AnalysisManifest } from "@/app/api/analyzer";
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
  freshPage,
  runningRun,
  seededRun,
} from "../helpers/analyzer";
import { PALETTES, maskIds } from "../helpers/palettes";

/**
 * The how-it-works card (#520) on the analyzer screen: mockup 18's three steps; the ingest line as
 * the newest run's corpus manifest states it — an absent source reported as not read, never as
 * ingested; and the tenant-locality footer with its link to the security model.
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

/** What a deployment without the rig telemetry export records in every manifest. */
const NO_RIG_EXPORT = "Rig/HIL telemetry export (AJ.4, #266) is not available in this deployment.";

/** A page whose newest run assembled this corpus. */
function pageOf(manifest: Partial<AnalysisManifest>): PollAnswer<AnalyzerPage> {
  return freshPage(analyzerPage({ run: seededRun({ manifest: { ...seededRun().manifest!, ...manifest } }) }));
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
  return screen.getByRole("region", { name: HOW_IT_WORKS_TITLE });
}

/** The three steps, in order. */
function steps(): HTMLElement[] {
  return within(card()).getAllByRole("listitem");
}

/** A step's label and the lines under it. */
function step(index: number): { label: string; lines: string[] } {
  const item = steps()[index]!;

  return {
    label: item.querySelector(".analyzer-hiw__label")!.textContent ?? "",
    lines: [...item.querySelectorAll(".analyzer-hiw__desc, .analyzer-hiw__absent")].map((line) => line.textContent ?? ""),
  };
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
  it("closes the side column, under the predicted-vs-measured card", async () => {
    await draw();

    const side = card().parentElement!;

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent("How it works");
    expect([...side.children]).toEqual([
      screen.getByRole("region", { name: TICKETS_TITLE }),
      screen.getByRole("region", { name: MEASUREMENTS_TITLE }),
      card(),
    ]);
  });

  it("draws the three steps, numbered, with the mockup's copy", async () => {
    await draw();

    expect(within(card()).getByRole("list").tagName).toBe("OL");
    expect([0, 1, 2].map((index) => step(index))).toEqual([
      { label: "01 Ingest", lines: ["build logs, test results, loop transcripts, rig telemetry"] },
      { label: "02 Correlate", lines: ["change-points ↔ merges, configs, infra events"] },
      { label: "03 Synthesize", lines: ["process changes, workflow drafts, tickets — with evidence attached"] },
    ]);
  });

  it("closes on the tenant-locality line, linked to where the security model argues it", async () => {
    await draw();

    const foot = card().querySelector(".analyzer-hiw__foot")!;
    const link = within(card()).getByRole("link", { name: "How that is enforced ↗" });

    expect(foot).toHaveTextContent("Runs on your build farm's data. Nothing leaves the tenant.");
    expect(link).toHaveAttribute("href", LOCALITY_URL);
    expect(link.getAttribute("href")).toMatch(/SECURITY_MODEL\.md#66-the-build-analyzers-corpus-stays-on-the-tenant$/);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});

describe("the ingest line reflects the corpus the run read", () => {
  it("does not list a source the deployment lacks as ingested — it says it was not read, and why", async () => {
    answer = pageOf({
      counts: { ...seededRun().manifest!.counts, hilSessions: 0 },
      absent: [{ source: "rig_telemetry", reason: NO_RIG_EXPORT }],
    });
    await draw();

    const ingest = step(0);

    expect(ingest.lines[0]).toBe("build logs, test results, loop transcripts");
    expect(ingest.lines[0]).not.toContain("rig telemetry");
    expect(ingest.lines[1]).toBe(`not read rig telemetry — ${NO_RIG_EXPORT}`);
    expect(steps()[0]!.querySelector(".analyzer-hiw__flag")).toHaveTextContent(/^not read$/);
  });

  it("says a class was present and empty, which is not the same as absent", async () => {
    answer = pageOf({ counts: { ...seededRun().manifest!.counts, loops: 0 } });
    await draw();

    expect(step(0).lines).toEqual([
      "build logs, test results, loop transcripts (none in this window), rig telemetry",
    ]);
  });

  it("follows the page from one poll to the next: the next run's manifest is the next line", async () => {
    await draw();
    expect(step(0).lines).toEqual(["build logs, test results, loop transcripts, rig telemetry"]);

    // A press of *Run analysis now* that starts a run has the page read again at once.
    answer = pageOf({ absent: [{ source: "rig_telemetry", reason: NO_RIG_EXPORT }] });
    startAnalysis.mockResolvedValue({ kind: "started", run: runningRun() });
    fireEvent.click(screen.getByRole("button", { name: /Run analysis now/ }));

    await waitFor(() => expect(step(0).lines).toHaveLength(2));
    expect(step(0).lines).toEqual(["build logs, test results, loop transcripts", `not read rig telemetry — ${NO_RIG_EXPORT}`]);
  });

  it("claims nothing was read where no analysis has run", async () => {
    answer = freshPage(analyzerPage({ run: null }));
    await draw();

    expect(step(0).lines).toEqual([INGEST_BEFORE_A_RUN]);
    expect(card()).not.toHaveAttribute("aria-busy");
  });

  it("holds the line's place while the page is unread — the other two steps need no data", async () => {
    answer = null;
    await draw();

    expect(card()).toHaveAttribute("aria-busy", "true");
    expect(steps()[0]!.querySelector(".analyzer-hiw__skeleton")).not.toBeNull();
    expect(step(0).lines).toEqual([]);
    expect(step(1).lines).toEqual(["change-points ↔ merges, configs, infra events"]);
    expect(step(2).lines).toEqual(["process changes, workflow drafts, tickets — with evidence attached"]);
    expect(within(card()).getByRole("link", { name: "How that is enforced ↗" })).toBeInTheDocument();
  });
});

describe("theming and markup", () => {
  it("draws the same markup in light and dark — every tint is a token", async () => {
    answer = pageOf({ absent: [{ source: "rig_telemetry", reason: NO_RIG_EXPORT }] });

    const drawn: string[] = [];
    for (const palette of PALETTES) {
      stampTheme(palette);
      await draw();
      drawn.push(maskIds(card().outerHTML));
      cleanup();
    }

    expect(drawn[0]).toContain("analyzer-hiw__absent");
    expect(drawn[0]).toBe(drawn[1]);
  });

  it("writes no inline style into the card", async () => {
    await draw();

    expect(card().querySelectorAll("[style]")).toHaveLength(0);
  });
});
