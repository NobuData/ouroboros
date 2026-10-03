import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerPage, AnalyzerPollOptions } from "@/app/analyzer/analyzer-poll";
import { PROGRESS_ANCHOR } from "@/app/analyzer/run-progress";
import {
  CHOSEN_REPO_HINT,
  NO_REPOSITORY,
  RUN_MEMBER_REASON,
  SCHEDULE_MEMBER_NOTE,
} from "@/app/analyzer/view";
import { navRegistry, setNavOrigin } from "@/app/shell/nav-registry";
import { resetFocusRepos, setFocusRepo } from "@/app/shell/focus-repo";
import type { PollAnswer } from "@/app/poll";

import {
  ANALYZER_NOW,
  ANALYZER_REPOS,
  ANALYZER_WORKSPACE,
  HELIOS,
  analyzerPage,
  analyzerReadings,
  freshPage,
  progressOf,
  runningRun,
  seededRun,
  seededSchedule,
} from "../helpers/analyzer";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The Build Analyzer screen (#516) end to end, under its store: the head from the chosen
 * repository, the seeded meta strip with decision A3's honest provenance, the two popovers,
 * *Run analysis now*'s progress and its concurrent-run state, the schedule editor, role gating,
 * the Build Farm entry kept lit, and both palettes.
 */

const startAnalysis = vi.fn();
const saveAnalyzerSchedule = vi.fn();

vi.mock("@/app/analyzer/analyzer-actions", () => ({
  startAnalysis: (...args: unknown[]) => startAnalysis(...args),
  saveAnalyzerSchedule: (...args: unknown[]) => saveAnalyzerSchedule(...args),
}));

const { AnalyzerScreen } = await import("@/app/analyzer/analyzer-screen");

/** What the poll answers next; reassigned by the cases that move the run along. */
let answer: PollAnswer<AnalyzerPage> | null = null;

/** A reader answering {@link answer}, or never while it is `null`. */
const POLL: AnalyzerPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
  // The strip's *ago* phrases are measured against the poll's last answer.
  now: () => ANALYZER_NOW,
};

/** Focus the tenant chip on helios-firmware. */
function focusHelios(): void {
  setFocusRepo(ANALYZER_WORKSPACE, { id: ANALYZER_REPOS[1]!.id, name: "helios-firmware" });
}

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

/** The meta strip. */
function strip(): HTMLElement {
  return screen.getByRole("region", { name: "Analysis summary" });
}

beforeEach(() => {
  answer = freshPage();
  startAnalysis.mockReset();
  saveAnalyzerSchedule.mockReset();
  focusHelios();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetFocusRepos();
  setNavOrigin(null);
});

describe("the head", () => {
  it("names the chosen repository and slot-fills the headline from the corpus manifest", async () => {
    await draw();

    expect(screen.getByText("Build Analyzer · Helios-Firmware")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Your last 1,284 builds have opinions." })).toBeInTheDocument();
    expect(screen.queryByText(CHOSEN_REPO_HINT)).toBeNull();
  });

  it("tells a small corpus the truth rather than boasting", async () => {
    const run = seededRun();
    answer = freshPage(analyzerPage({ run: { ...run, manifest: { ...run.manifest!, counts: { ...run.manifest!.counts, builds: 40 } } } }));

    await draw();

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("40 builds in 90 days — early opinions, held loosely.");
  });

  it("falls back to the first enabled repository under All repos, and says how to choose", async () => {
    resetFocusRepos();
    window.localStorage.clear();
    answer = freshPage(analyzerPage({ repo: ANALYZER_REPOS[0]!.ref, run: null }));

    await draw();

    expect(screen.getByText("Build Analyzer · Atlas-Scheduler")).toBeInTheDocument();
    expect(screen.getByText(CHOSEN_REPO_HINT)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "No analysis has run here yet." })).toBeInTheDocument();
  });

  it("draws no actions for a workspace with no repository enabled", async () => {
    answer = null;
    await draw(analyzerReadings({ repos: { ok: true, value: [] } }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(NO_REPOSITORY);
    expect(screen.queryByRole("button", { name: /Run analysis now/ })).toBeNull();
  });

  it("never draws another repository's answer under this one's name", async () => {
    answer = freshPage(analyzerPage({ repo: "acme-robotics/helios-console" }));

    await draw(analyzerReadings());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No analysis has run here yet.");
  });

  it("keeps the Build Farm entry lit — the analyzer has no entry of its own", async () => {
    await draw();

    expect(navRegistry().origin).toBe("build-farm");
  });
});

describe("the seeded meta strip — decision A3's honest provenance", () => {
  it("matches the mockup's slots with deterministic analyzers, compute time, no $ and no model pill", async () => {
    await draw();

    const row = within(strip());
    expect(row.getByText("Corpus")).toBeInTheDocument();
    expect(row.getByText(/1,284 builds · 312 loops · 90 days · 4\.1M log lines · 62 HIL sessions/)).toBeInTheDocument();
    expect(row.getByRole("button", { name: "deterministic analyzers v1" })).toBeInTheDocument();
    expect(row.getByText("2h ago · 41 min")).toBeInTheDocument();
    expect(row.getByRole("button", { name: "high — 90d of stable telemetry" })).toBeInTheDocument();

    expect(strip().textContent).not.toContain("$");
    expect(strip().querySelector(".analyzer-strip__model")).toBeNull();
    expect(strip().textContent).not.toMatch(/claude|fable|gpt/i);
  });

  it("draws a model pill and the $ only when an LLM pass ran", async () => {
    const run = seededRun();
    answer = freshPage(
      analyzerPage({
        run: seededRun({
          llmCostCents: 286,
          analyzerSet: { label: "analyzers v2", analyzers: [...run.analyzerSet.analyzers, { id: "synthesis", version: 1, kind: "llm" }] },
        }),
      }),
    );

    await draw();

    expect(within(strip()).getByText("2h ago · 41 min · $2.86")).toBeInTheDocument();
    expect(strip().querySelector(".analyzer-strip__model")).toHaveTextContent("synthesis");
  });

  it("marks a sampled corpus as sampled, rather than presenting its counts as exhaustive", async () => {
    await draw();

    expect(within(strip()).getByText(/sampled: log lines read at 30%, capped by the max-log-lines budget/)).toBeInTheDocument();
  });

  it("draws no sampling mark when every source was read in full", async () => {
    const run = seededRun();
    const full = { sampled: false, rate: 1, cap: null };
    answer = freshPage(
      analyzerPage({
        run: { ...run, manifest: { ...run.manifest!, sources: { builds: full, loops: full, logLines: full, hilSessions: full } } },
      }),
    );

    await draw();

    expect(within(strip()).queryByText(/sampled/)).toBeNull();
  });

  it("opens the analyzer list with the run's real ids and versions", async () => {
    await draw();

    fireEvent.click(within(strip()).getByRole("button", { name: "deterministic analyzers v1" }));

    const list = screen.getByRole("group", { name: "Analyzers in this run" });
    for (const id of ["change_point", "log_signature", "config_usage", "cache_window", "queue_correlation", "waiver_cite", "workflow_outcome"]) {
      expect(within(list).getByText(`${id} v1`)).toBeInTheDocument();
    }
    expect(list).toHaveTextContent("change_point v1 · deterministic · completed · 3 findings");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Analyzers in this run" })).toBeNull();
  });

  it("opens the confidence tag on its computed basis, not a static string", async () => {
    await draw();

    fireEvent.click(within(strip()).getByRole("button", { name: "high — 90d of stable telemetry" }));

    const basis = screen.getByRole("group", { name: "How this was judged" });
    expect(basis).toHaveTextContent("Builds on 89 of 90 days (98.9%)");
    expect(basis).toHaveTextContent("14.27 builds a day (1,284 builds)");
  });

  it("says before the first run what the strip will hold", async () => {
    answer = freshPage(analyzerPage({ run: null }));

    await draw();

    expect(strip()).toHaveTextContent(/No analysis yet/);
  });
});

describe("Run analysis now", () => {
  it("starts a run and streams its real progress: phases, per-analyzer ticks, then complete", async () => {
    startAnalysis.mockResolvedValue({ kind: "started", run: runningRun({ phase: "assembling", manifest: null }) });
    await draw();

    answer = freshPage(analyzerPage({ run: runningRun() }));
    fireEvent.click(screen.getByRole("button", { name: "Run analysis now" }));

    const panel = await screen.findByRole("region", { name: "Analysis progress" });
    expect(startAnalysis).toHaveBeenCalledExactlyOnceWith(HELIOS);
    expect(within(panel).getByText("Analyzing")).toHaveAttribute("aria-current", "step");
    expect(within(panel).getByRole("list", { name: "Analyzers" })).toHaveTextContent("change_point completed · 3 findings");
    expect(within(panel).getByRole("list", { name: "Analyzers" })).toHaveTextContent("log_signature running");
    expect(within(panel).getByRole("status")).toHaveTextContent("Analyzing — 1 of 3 analyzers finished.");

    answer = freshPage(analyzerPage({ run: seededRun({ id: runningRun().id }) }));
    fireEvent.click(screen.getByRole("button", { name: "Run analysis now" }));
    await waitFor(() => expect(within(panel).getByRole("status")).toHaveTextContent("Analysis complete — 7 analyzers finished."));
  });

  it("shows a run in flight without a press, from the poll", async () => {
    answer = freshPage(analyzerPage({ run: runningRun({ phase: "assembling", manifest: null }) }));

    await draw();

    const panel = screen.getByRole("region", { name: "Analysis progress" });
    expect(within(panel).getByText("Assembling corpus")).toHaveAttribute("aria-current", "step");
    expect(within(panel).queryByRole("list", { name: "Analyzers" })).toBeNull();
    expect(within(strip()).getByText(/being assembled/)).toBeInTheDocument();
  });

  it("renders failed and budget_exceeded distinctly, each with the run's reason", async () => {
    answer = freshPage(
      analyzerPage({
        run: seededRun({
          status: "budget_exceeded",
          failureReason: "The compute ceiling of 3600 s was reached.",
          progress: { analyzers: [progressOf("change_point", "completed", { findings: 3 }), progressOf("waiver_cite", "not_run", { reason: "the compute ceiling was reached" })] },
        }),
      }),
    );
    await draw();

    const budget = within(screen.getByRole("region", { name: "Analysis progress" })).getByRole("status");
    expect(budget).toHaveTextContent("Stopped at its budget; the findings of 1 analyzer were kept.");
    expect(budget).toHaveClass("analyzer-progress__status--budget");
    expect(screen.getByRole("list", { name: "Analyzers" })).toHaveTextContent("waiver_cite not run — the compute ceiling was reached");

    cleanup();
    answer = freshPage(analyzerPage({ run: seededRun({ status: "failed", phase: "analyzing", failureReason: "The engine stream was cut off.", confidenceNote: null }) }));
    await draw();

    const failed = within(screen.getByRole("region", { name: "Analysis progress" })).getByRole("status");
    expect(failed).toHaveTextContent("The analysis failed and kept no findings. The engine stream was cut off.");
    expect(failed).toHaveClass("analyzer-progress__status--failed");
  });

  it("answers a press while one runs with the concurrent-run state and a link — and no second run", async () => {
    answer = freshPage(analyzerPage({ run: runningRun() }));
    startAnalysis.mockResolvedValue({
      kind: "running",
      runId: runningRun().id,
      startedAt: "2026-10-02T19:56:00.000Z",
      phase: "analyzing",
    });
    await draw();

    fireEvent.click(screen.getByRole("button", { name: "Run analysis now" }));

    const busy = await screen.findByText(/is already running — started 4m ago, analyzing\. No second run was started\./);
    expect(within(busy).getByRole("link", { name: "Follow its progress" })).toHaveAttribute("href", `#${PROGRESS_ANCHOR}`);
    expect(document.getElementById(PROGRESS_ANCHOR)).toHaveTextContent("Analysis progress");
    expect(startAnalysis).toHaveBeenCalledTimes(1);
  });

  it("says why a start was refused", async () => {
    startAnalysis.mockResolvedValue({ kind: "refused", reason: "The analysis could not be started. The engine is not available." });
    await draw();

    fireEvent.click(screen.getByRole("button", { name: "Run analysis now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The engine is not available.");
    // The previous run's ending is not drawn as if this press had produced it.
    expect(screen.queryByRole("region", { name: "Analysis progress" })).toBeNull();
  });

  it("is inert for a member, with the reason, and asks nothing", async () => {
    await draw(analyzerReadings({ mayAdminister: false }));

    const control = screen.getByRole("button", { name: "Run analysis now" });
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", RUN_MEMBER_REASON);

    fireEvent.click(control);
    expect(startAnalysis).not.toHaveBeenCalled();
  });
});

describe("the schedule editor", () => {
  it("labels the control from the schedule, as the mockup does", async () => {
    await draw();

    expect(screen.getByRole("button", { name: "Schedule: weekly + every 50 builds" })).toBeInTheDocument();
  });

  it("round-trips the weekly slot, the every-N threshold and the budgets, and shows the live counter", async () => {
    saveAnalyzerSchedule.mockResolvedValue({ ok: true, value: seededSchedule({ everyNBuilds: 51, maxBuilds: 1500 }) });
    await draw();

    fireEvent.click(screen.getByRole("button", { name: "Schedule: weekly + every 50 builds" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Day")).toHaveValue("1");
    expect(within(dialog).getByLabelText(/Time \(UTC\)/)).toHaveValue("06:00");
    expect(within(dialog).getByLabelText("Builds between runs")).toHaveValue("50");
    expect(within(dialog).getByText("12 of 50 builds finished since the every-N trigger last fired.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Max log lines")).toHaveValue("1230000");

    fireEvent.click(within(dialog).getByRole("button", { name: "One build more" }));
    fireEvent.change(within(dialog).getByLabelText("Max builds"), { target: { value: "1500" } });
    answer = freshPage(analyzerPage({ schedule: seededSchedule({ everyNBuilds: 51, maxBuilds: 1500 }) }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save schedule" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(saveAnalyzerSchedule).toHaveBeenCalledExactlyOnceWith({
      repo: HELIOS,
      enabled: true,
      weeklyEnabled: true,
      weeklyDay: 1,
      weeklyTime: "06:00",
      everyNBuilds: 51,
      maxBuilds: 1500,
      maxLogLines: 1_230_000,
      computeCeilingSeconds: 3600,
    });
    expect(await screen.findByRole("button", { name: "Schedule: weekly + every 51 builds" })).toBeInTheDocument();
  });

  it("refuses an invalid form before asking, field by field", async () => {
    await draw();

    fireEvent.click(screen.getByRole("button", { name: "Schedule: weekly + every 50 builds" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Time \(UTC\)/), { target: { value: "6pm" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save schedule" }));

    expect(await within(dialog).findByText("Use a 24-hour UTC time, like 06:00.")).toBeInTheDocument();
    expect(saveAnalyzerSchedule).not.toHaveBeenCalled();
  });

  it("lands the service's refusals on their fields", async () => {
    saveAnalyzerSchedule.mockResolvedValue({
      ok: false,
      reason: "The schedule could not be saved. The request is not valid.",
      fields: { maxBuilds: "maxBuilds must not be greater than 2147483647" },
    });
    await draw();

    fireEvent.click(screen.getByRole("button", { name: "Schedule: weekly + every 50 builds" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save schedule" }));

    expect(await within(dialog).findByText("maxBuilds must not be greater than 2147483647")).toBeInTheDocument();
    expect(within(dialog).getByText(/The schedule could not be saved/)).toBeInTheDocument();
  });

  it("is read-only for a member, with the reason and no save", async () => {
    await draw(analyzerReadings({ mayAdminister: false }));

    fireEvent.click(screen.getByRole("button", { name: "Schedule: weekly + every 50 builds" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(SCHEDULE_MEMBER_NOTE)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Save schedule" })).toBeNull();
    expect(within(dialog).getByLabelText("Max builds")).toBeDisabled();
  });
});

describe("both palettes", () => {
  it("draws the same markup in light and dark — every hue is a token", () => {
    answer = null;
    const [light, dark] = renderInBothPalettes(<AnalyzerScreen poll={POLL} readings={analyzerReadings()} />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
