import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerPage, AnalyzerPollOptions } from "@/app/analyzer/analyzer-poll";
import {
  ALREADY_RESOLVED,
  APPLY_ROLE_REASON,
  CANNOT_APPLY,
  CARD_TITLES,
  CHOOSE_TRACKER,
  CONFIDENCE_HEADING,
  DISMISS_GUARANTEE,
  DISMISS_ROLE_REASON,
  DISMISS_TITLE,
  DRAFT_ROLE_REASON,
  FINDINGS_GONE,
  IMPACT_HEADING,
  MEASURE_NOTE,
  NO_SUGGESTIONS_YET,
  NOTHING_OF_KIND,
  PREVIEW_LOADING,
  PUBLISH_HUMAN_NOTE,
  REASON_LABEL,
  SIMULATE_SOON,
  SPIKE_DRAFTED,
  SPIKE_IMPACT_NOTE,
  SPIKE_LEDE,
  STALE_NOTE,
  cardRows,
} from "@/app/analyzer/suggestions-view";
import type { AnalysisSuggestions, SuggestionPreview } from "@/app/api/analyzer";
import { trackerOptions } from "@/app/planning/generator";
import type { PollAnswer } from "@/app/poll";
import { resetFocusRepos, setFocusRepo } from "@/app/shell/focus-repo";
import { setNavOrigin } from "@/app/shell/nav-registry";

import {
  ANALYZER_NOW,
  ANALYZER_REPOS,
  ANALYZER_WORKSPACE,
  analyzerPage,
  analyzerReadings,
  evidenceOf,
  freshPage,
} from "../helpers/analyzer";
import {
  SUGGESTION,
  emptySuggestions,
  resolvedSuggestions,
  seededSuggestions,
} from "../helpers/analyzer-suggestions";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { writableCatalog } from "../helpers/planning";
import { SEEDED_GITHUB_ID, seededSources } from "../helpers/sources";

/**
 * The two suggestion cards (#518) on the analyzer screen, under its store: the seeded cards
 * against mockup 18; every number with a route to its basis; Apply behind a consequence preview
 * that names the concrete change and applies exactly what it showed; a dismissal that resolves at
 * once, states its permanence and is rolled back when refused; a spike drafted as an investigation
 * instead of applied; a workflow draft that opens the studio and says publishing is human; the
 * Details sheet's findings and resolving evidence; and what a member, and a viewer, may do.
 */

const previewSuggestion = vi.fn();
const applySuggestion = vi.fn();
const dismissSuggestion = vi.fn();
const draftSpike = vi.fn();
const readDraftTargets = vi.fn();
const push = vi.fn();

vi.mock("@/app/analyzer/analyzer-actions", () => ({
  startAnalysis: vi.fn(),
  saveAnalyzerSchedule: vi.fn(),
  previewSuggestion: (...args: unknown[]) => previewSuggestion(...args),
  applySuggestion: (...args: unknown[]) => applySuggestion(...args),
  dismissSuggestion: (...args: unknown[]) => dismissSuggestion(...args),
  draftSpike: (...args: unknown[]) => draftSpike(...args),
  readDraftTargets: (...args: unknown[]) => readDraftTargets(...args),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { AnalyzerScreen } = await import("@/app/analyzer/analyzer-screen");
const { SuggestionList } = await import("@/app/analyzer/suggestion-cards");

/** What the poll answers next; reassigned by the cases that move the page along. */
let answer: PollAnswer<AnalyzerPage> | null = null;

/** A reader answering {@link answer}, or never while it is `null`. */
const POLL: AnalyzerPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
  now: () => ANALYZER_NOW,
};

const TITLES = {
  gate: "Split the test gate: native_sim every build, QEMU + HIL only before merge",
  ccache: "Re-warm ccache right after deps-refresh merges",
  move: "Move forge-02 to pool-a during 14:00–16:00 UTC",
  link: "Link zephyr.elf incrementally (partial link cache)",
  review: "standard-fix: run self-review BEFORE the build stage",
  flake: "Loops touching drivers/can/: add a 'flake-retry under load profile' test stage",
} as const;

/** A preview's fingerprint, and the one a moved preview carries. */
const FINGERPRINT = `sha256:${"4f".repeat(32)}`;
const MOVED_FINGERPRINT = `sha256:${"9c".repeat(32)}`;

/** The runner move's preview, as the service answers it — or a variant. */
function movePreview(over: Partial<SuggestionPreview> = {}): SuggestionPreview {
  return {
    suggestionId: SUGGESTION.move,
    plane: "farm_config",
    appliable: true,
    draftable: false,
    summary:
      "forge-02 joins pool-a between 14:00–16:00 UTC on weekdays (Mon–Fri); outside that window it stays in its own pool.",
    lands: "Build farm · pool windows",
    reason: null,
    change: { runner: "forge-02", pool: "pool-a", daysOfWeek: [1, 2, 3, 4, 5], startsAt: "14:00", endsAt: "16:00" },
    studioPath: null,
    delta: null,
    fingerprint: FINGERPRINT,
    ...over,
  };
}

/** The review-first suggestion's preview: a workflow draft with its stage delta. */
function reviewPreview(): SuggestionPreview {
  return movePreview({
    suggestionId: SUGGESTION.review,
    plane: "workflow",
    summary:
      "standard-fix: a draft on the open draft moves `review` (Self-review diff) to run before `build` (Build farm · pool A). It becomes v15 only when a person publishes it.",
    lands: "Workflow studio · standard-fix draft",
    change: {
      workflowId: "5eed001b-0000-4000-8000-000000000001",
      slug: "standard-fix",
      ifMatch: "etag",
      nextVersion: 15,
      changeNote: `Proposed by the Build Analyzer (suggestion ${SUGGESTION.review}): ${TITLES.review}.`,
      definition: { nodes: [], edges: [] },
    },
    studioPath: "/workflows/standard-fix",
    delta: {
      nodesAdded: [],
      nodesRemoved: [],
      edgesAdded: ["implement → review", "review → build", "test → checks-green"],
      edgesRemoved: ["implement → build", "test → review", "review → checks-green"],
    },
  });
}

/** What an accepted apply answers. */
function applied(preview: SuggestionPreview) {
  return {
    kind: "applied",
    applied: {
      suggestion: { id: preview.suggestionId, status: "applied", resolvedAt: "2026-10-02T20:00:00.000Z", reason: null },
      preview,
      target: { kind: "runner_pool_window", id: "5eed0026-0000-4000-8000-000000000001" },
      eventId: "5eed0068-0000-4000-8000-000000000013",
      measurement: { id: "m", targetMetric: "queue_wait", windowDays: 14, baseline: {}, predicted: {} },
    },
  };
}

/** A page whose suggestions are the given ones. */
function pageWith(suggestions: AnalysisSuggestions): PollAnswer<AnalyzerPage> {
  return freshPage(analyzerPage({ suggestions }));
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

/** A card, by its kind. */
function card(kind: keyof typeof CARD_TITLES): HTMLElement {
  return screen.getByRole("region", { name: CARD_TITLES[kind] });
}

/** A row, by its suggestion's title. */
function row(title: string): HTMLElement {
  return screen.getByRole("article", { name: title });
}

/** A control of a row, by its name. */
function control(title: string, name: string | RegExp): HTMLElement {
  return within(row(title)).getByRole("button", { name });
}

/** The open dialog. */
function dialog(role: "dialog" | "alertdialog" = "dialog"): HTMLElement {
  return screen.getByRole(role);
}

/** Press a control and let whatever it started settle. */
async function press(element: HTMLElement): Promise<void> {
  fireEvent.click(element);
  await act(async () => {});
}

beforeEach(() => {
  answer = freshPage();
  for (const stub of [previewSuggestion, applySuggestion, dismissSuggestion, draftSpike, readDraftTargets, push]) {
    stub.mockReset();
  }
  previewSuggestion.mockResolvedValue({ ok: true, preview: movePreview() });
  readDraftTargets.mockResolvedValue({ ok: true, options: trackerOptions(seededSources(), { ok: true, value: writableCatalog() }) });
  setFocusRepo(ANALYZER_WORKSPACE, { id: ANALYZER_REPOS[1]!.id, name: "helios-firmware" });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetFocusRepos();
  setNavOrigin(null);
});

describe("the seeded cards, against mockup 18", () => {
  it("are the mockup's two cards, in the main column under the chart", async () => {
    await draw();

    expect(within(card("build_process")).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Suggested build-process changes",
    );
    expect(within(card("workflow")).getByRole("heading", { level: 2 })).toHaveTextContent("Suggested workflow changes");
    expect(card("build_process").closest(".analyzer__main")).not.toBeNull();

    const main = [...document.querySelectorAll(".analyzer__main > *")];
    expect(main.indexOf(card("build_process"))).toBeGreaterThan(0);
    expect(main.indexOf(card("workflow"))).toBeGreaterThan(main.indexOf(card("build_process")));
  });

  it("counts `4 open`, and links the workflow card to the studio", async () => {
    await draw();

    expect(within(card("build_process")).getByText("4 open")).toBeInTheDocument();
    expect(within(card("workflow")).getByRole("link", { name: "Open workflow studio" })).toHaveAttribute(
      "href",
      "/workflows",
    );
  });

  it("draws each row's title, its mono evidence line, its impact pill and its confidence", async () => {
    await draw();

    const expected: readonly [string, string, string, string][] = [
      [TITLES.gate, "qemu_cortex_m3 caught 0 unique failures in 214 builds; HIL caught 9 — all at merge gates", "−3m 40s per loop", "conf 91%"],
      [TITLES.ccache, "cache hit rate drops 78%→31% for ~6h after every deps-refresh merge (14 occurrences)", "−1m 50s on ~20% of builds", "conf 88%"],
      [TITLES.move, "pool-a queue exceeds 5 min in that window on 11 of last 14 weekdays; pool-b sits idle 82% of it", "−4m queue p95", "conf 84%"],
      [TITLES.link, "link step grew from 18% to 42% of build time since v2.3 (LTO enabled)", "−55s per build", "conf 72%"],
      [TITLES.review, "34% of failed builds in standard-fix loops contained defects the later self-review flagged anyway — reordering catches them pre-build", "−2m 05s per failed attempt", "conf 89%"],
      [TITLES.flake, "merges touching drivers/can are 3.1× more likely to flake the telemetry suite within 7 days (21 cases)", "−1 intervention/wk projected", "conf 77%"],
    ];

    for (const [title, evidence, impact, confidence] of expected) {
      const element = row(title);

      expect(within(element).getByRole("heading", { level: 3 })).toHaveTextContent(title);
      expect(element.querySelector(".analyzer-sugg__evidence")).toHaveTextContent(`Evidence${evidence}`);
      expect(within(element).getByRole("button", { name: impact })).toBeInTheDocument();
      expect(within(element).getByRole("button", { name: confidence })).toBeInTheDocument();
    }
  });

  it("keeps the mockup's order: build-process rows by confidence, then the two workflow rows", async () => {
    await draw();

    const titles = (kind: keyof typeof CARD_TITLES) =>
      within(card(kind))
        .getAllByRole("article")
        .map((element) => within(element).getByRole("heading", { level: 3 }).textContent);

    expect(titles("build_process")).toEqual([TITLES.gate, TITLES.ccache, TITLES.move, TITLES.link]);
    expect(titles("workflow")).toEqual([TITLES.review, TITLES.flake]);
  });

  it("offers Apply · Details · Dismiss on a build-process row", async () => {
    await draw();

    const names = within(row(TITLES.move))
      .getAllByRole("button")
      .map((button) => button.textContent?.replace(/\s*ⓘ$/, ""));

    expect(names).toEqual(["−4m queue p95", "conf 84%", "Apply", "Details", "Dismiss"]);
  });

  it("flags the spike row and offers Draft spike ticket where the others have Apply", async () => {
    await draw();
    const spike = row(TITLES.link);

    expect(within(spike).getByText("needs a spike")).toBeInTheDocument();
    expect(within(spike).getByRole("button", { name: "Draft spike ticket" })).toBeInTheDocument();
    expect(within(spike).queryByRole("button", { name: "Apply" })).toBeNull();
    // The figure it carries is the mockup's, and its route says it is unverified.
    expect(within(spike).getByRole("button", { name: "−55s per build" })).toBeInTheDocument();
    for (const other of [TITLES.gate, TITLES.ccache, TITLES.move]) {
      expect(within(row(other)).queryByText("needs a spike")).toBeNull();
    }
  });

  it("names the version a workflow draft would really become — the workflow's next, not the mockup's", async () => {
    await draw();

    expect(control(TITLES.review, "Draft as v15")).toBeInTheDocument();
    expect(control(TITLES.flake, "Draft as v15")).toBeInTheDocument();
  });

  it("draws no figure for a spike whose impact was never quantified", async () => {
    answer = pageWith(
      seededSuggestions((suggestion) =>
        suggestion.id !== SUGGESTION.link
          ? suggestion
          : {
              ...suggestion,
              impact: {
                ...suggestion.impact!,
                estimate: null,
                basis: { ...suggestion.impact!.basis, method: "unquantified", raw: null },
              },
            },
      ),
    );
    await draw();
    const spike = row(TITLES.link);

    expect(within(spike).queryByRole("button", { name: /per build/ })).toBeNull();
    expect(within(spike).getByText("needs a spike")).toBeInTheDocument();
    expect(within(spike).getByRole("button", { name: "Draft spike ticket" })).toBeInTheDocument();
  });
});

describe("before there is anything to list", () => {
  it("holds the rows' place while the page is unread", async () => {
    answer = null;
    await draw();

    expect(card("build_process")).toHaveAttribute("aria-busy", "true");
    expect(card("build_process").querySelector(".analyzer-sugg__skeleton")).not.toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("says no analysis has composed a suggestion yet — and shows no count", async () => {
    answer = pageWith(emptySuggestions());
    await draw();

    expect(within(card("build_process")).getByText(NO_SUGGESTIONS_YET.title)).toBeInTheDocument();
    expect(within(card("workflow")).getByText(NO_SUGGESTIONS_YET.note)).toBeInTheDocument();
    expect(within(card("build_process")).queryByText(/open$/)).toBeNull();
    expect(card("build_process")).not.toHaveAttribute("aria-busy");
  });

  it("says when the analysis proposed nothing of one kind", async () => {
    const seeded = seededSuggestions();
    answer = pageWith({ ...seeded, suggestions: seeded.suggestions.filter((entry) => entry.kind !== "workflow") });
    await draw();

    expect(within(card("workflow")).getByText(NOTHING_OF_KIND.workflow.title)).toBeInTheDocument();
    expect(within(card("build_process")).getAllByRole("article")).toHaveLength(4);
  });
});

describe("numbers have routes to their basis", () => {
  it("opens the scoring behind `conf NN%`: sample size, effect size, stability, the formula", async () => {
    await draw();
    const trigger = control(TITLES.review, "conf 89%");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await press(trigger);

    const panel = within(row(TITLES.review)).getByRole("group", { name: CONFIDENCE_HEADING });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveTextContent("Sample size: 50");
    expect(panel).toHaveTextContent("Effect size: 0.34 against a decisive 0.3");
    expect(panel).toHaveTextContent("Stability: 0.896");
    expect(panel).toHaveTextContent("round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(row(TITLES.review)).queryByRole("group", { name: CONFIDENCE_HEADING })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("opens what produced the impact: the formula, its inputs and the calibration that scaled it", async () => {
    await draw();

    await press(control(TITLES.ccache, "−1m 50s on ~20% of builds"));

    const panel = within(row(TITLES.ccache)).getByRole("group", { name: IMPACT_HEADING });
    expect(panel).toHaveTextContent("Measured over 14 occurrences");
    expect(panel).toHaveTextContent("Formula: ccache_rewarm v1: -slowdown_seconds.");
    expect(panel).toHaveTextContent("Inputs: slowdown_seconds = 168.");
    expect(panel).toHaveTextContent("−168 s raw × 0.6545 calibration (cache_window · duration_delta) = −110 s.");
  });

  it("says a spike's figure is extrapolated and unverified", async () => {
    await draw();

    await press(control(TITLES.link, "−55s per build"));

    expect(within(row(TITLES.link)).getByRole("group", { name: IMPACT_HEADING })).toHaveTextContent(SPIKE_IMPACT_NOTE);
  });
});

describe("Apply, behind a consequence preview", () => {
  it("applies nothing from the row: the press opens a preview naming the concrete change", async () => {
    await draw();

    fireEvent.click(control(TITLES.move, "Apply"));
    expect(dialog()).toHaveTextContent(PREVIEW_LOADING);
    await act(async () => {});

    expect(previewSuggestion).toHaveBeenCalledExactlyOnceWith(SUGGESTION.move);
    expect(applySuggestion).not.toHaveBeenCalled();
    expect(dialog()).toHaveAccessibleName(`Consequence preview · ${TITLES.move}`);
    expect(dialog()).toHaveTextContent(
      "forge-02 joins pool-a between 14:00–16:00 UTC on weekdays (Mon–Fri); outside that window it stays in its own pool.",
    );
    expect(dialog()).toHaveTextContent("Lands inBuild farm · pool windows");
    expect(dialog()).toHaveTextContent("Runnerforge-02");
    expect(dialog()).toHaveTextContent("Joins poolpool-a");
    expect(dialog()).toHaveTextContent("Window14:00–16:00 UTC");
    expect(dialog()).toHaveTextContent("Daysweekdays (Mon–Fri)");
    expect(dialog()).toHaveTextContent(MEASURE_NOTE);
  });

  it("applies exactly the preview that was read, then shows the row applied with measurement pending", async () => {
    applySuggestion.mockResolvedValue(applied(movePreview()));
    await draw();
    await press(control(TITLES.move, "Apply"));

    await press(within(dialog()).getByRole("button", { name: "Apply" }));

    expect(applySuggestion).toHaveBeenCalledExactlyOnceWith(SUGGESTION.move, FINGERPRINT);
    expect(screen.queryByRole("dialog")).toBeNull();

    const resolved = row(TITLES.move);
    expect(resolved).toHaveTextContent("Applied Oct 2 — measurement pending — day 0 of 14");
    expect(within(resolved).getByRole("link", { name: "Predicted vs measured" })).toHaveAttribute(
      "href",
      "#predicted-vs-measured",
    );
    expect(within(resolved).queryByRole("button", { name: "Apply" })).toBeNull();
    expect(within(resolved).getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(within(card("build_process")).getByText("3 open")).toBeInTheDocument();
    // The control that had focus is gone with the row's open form, so the row takes it.
    expect(resolved).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the row applied when the poll confirms it, now with who applied it and the day", async () => {
    applySuggestion.mockImplementation(() => {
      answer = pageWith(resolvedSuggestions(SUGGESTION.move, "applied"));

      return Promise.resolve(applied(movePreview()));
    });
    await draw();
    await press(control(TITLES.move, "Apply"));
    await press(within(dialog()).getByRole("button", { name: "Apply" }));

    expect(row(TITLES.move)).toHaveTextContent("Applied Oct 2 by Ken Suenobu — measurement pending — day 0 of 14");
  });

  it("describes a job hook by its repository, trigger, command and pool", async () => {
    previewSuggestion.mockResolvedValue({
      ok: true,
      preview: movePreview({
        suggestionId: SUGGESTION.ccache,
        plane: "job_hook",
        summary:
          "On every merge into acme-robotics/helios-firmware whose title contains “deps: refresh west manifest”, the farm submits `west build -t ccache-warm` in pool-a, at the merged commit of the base branch.",
        lands: "Build farm · job hooks",
        change: {
          repo: "acme-robotics/helios-firmware",
          pool: "pool-a",
          event: "merge",
          titleContains: "deps: refresh west manifest",
          label: "post-merge hook",
          title: TITLES.ccache,
          command: ["west", "build", "-t", "ccache-warm"],
        },
      }),
    });
    await draw();

    await press(control(TITLES.ccache, "Apply"));

    expect(dialog()).toHaveTextContent("Lands inBuild farm · job hooks");
    expect(dialog()).toHaveTextContent("Repositoryacme-robotics/helios-firmware");
    expect(dialog()).toHaveTextContent("Runs onevery merge whose title contains “deps: refresh west manifest”");
    expect(dialog()).toHaveTextContent("Commandwest build -t ccache-warm");
    expect(dialog()).toHaveTextContent("In poolpool-a");
  });

  it("says why a change no plane can take cannot be applied, and offers no confirm", async () => {
    previewSuggestion.mockResolvedValue({
      ok: true,
      preview: movePreview({
        suggestionId: SUGGESTION.gate,
        plane: "test_gate",
        appliable: false,
        summary: "PR builds run native_sim; native_sim, qemu_cortex_m3, HIL run only at the merge gate.",
        lands: "nowhere — not applied",
        reason: "no plane owns per-stage PR and merge gates yet, so this cannot be applied — draft it as a ticket or dismiss it",
        change: null,
      }),
    });
    await draw();

    await press(control(TITLES.gate, "Apply"));

    expect(dialog()).toHaveTextContent("PR builds run native_sim; native_sim, qemu_cortex_m3, HIL run only at the merge gate.");
    expect(within(dialog()).getByRole("note")).toHaveTextContent(CANNOT_APPLY);
    expect(within(dialog()).getByRole("note")).toHaveTextContent("no plane owns per-stage PR and merge gates yet");
    expect(within(dialog()).queryByRole("button", { name: "Apply" })).toBeNull();
    expect(dialog()).not.toHaveTextContent(MEASURE_NOTE);

    await press(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(applySuggestion).not.toHaveBeenCalled();
  });

  it("re-reads a preview that moved, says so, and applies the new one only on a second confirm", async () => {
    const moved = movePreview({
      summary: "forge-02 joins pool-a between 13:00–16:00 UTC on weekdays (Mon–Fri); outside that window it stays in its own pool.",
      change: { runner: "forge-02", pool: "pool-a", daysOfWeek: [1, 2, 3, 4, 5], startsAt: "13:00", endsAt: "16:00" },
      fingerprint: MOVED_FINGERPRINT,
    });
    applySuggestion.mockResolvedValueOnce({ kind: "stale", reason: "The preview changed." });
    await draw();
    await press(control(TITLES.move, "Apply"));
    previewSuggestion.mockResolvedValue({ ok: true, preview: moved });

    await press(within(dialog()).getByRole("button", { name: "Apply" }));

    expect(previewSuggestion).toHaveBeenCalledTimes(2);
    expect(within(dialog()).getByRole("status")).toHaveTextContent(STALE_NOTE);
    expect(dialog()).toHaveTextContent("Window13:00–16:00 UTC");
    expect(row(TITLES.move)).not.toHaveTextContent("Applied");

    applySuggestion.mockResolvedValueOnce(applied(moved));
    await press(within(dialog()).getByRole("button", { name: "Apply" }));

    expect(applySuggestion).toHaveBeenLastCalledWith(SUGGESTION.move, MOVED_FINGERPRINT);
    expect(row(TITLES.move)).toHaveTextContent("Applied Oct 2");
  });

  it("keeps the preview open with the service's reason when the apply is refused", async () => {
    applySuggestion.mockResolvedValue({
      kind: "refused",
      reason: "The suggestion could not be applied. There is no queue_wait rollup for 2026-09-18–2026-10-01.",
    });
    await draw();
    await press(control(TITLES.move, "Apply"));

    await press(within(dialog()).getByRole("button", { name: "Apply" }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent("There is no queue_wait rollup");
    expect(within(dialog()).getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(control(TITLES.move, "Apply")).toBeInTheDocument();
  });

  it("says when somebody else resolved it first, and applies nothing", async () => {
    applySuggestion.mockResolvedValue({ kind: "resolved", reason: "This suggestion is already dismissed." });
    await draw();
    await press(control(TITLES.move, "Apply"));

    await press(within(dialog()).getByRole("button", { name: "Apply" }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent(ALREADY_RESOLVED);
    expect(within(dialog()).queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("says when the preview could not be read, and reads it again on request", async () => {
    previewSuggestion.mockResolvedValueOnce({ ok: false, reason: "The preview could not be read. No workflow standard-fix." });
    await draw();
    await press(control(TITLES.move, "Apply"));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent("No workflow standard-fix.");
    expect(within(dialog()).queryByRole("button", { name: "Apply" })).toBeNull();

    await press(within(dialog()).getByRole("button", { name: "Read it again" }));

    expect(previewSuggestion).toHaveBeenCalledTimes(2);
    expect(dialog()).toHaveTextContent("forge-02 joins pool-a");
  });

  it("closes on Escape having applied nothing, and gives focus back to Apply", async () => {
    await draw();
    const apply = control(TITLES.move, "Apply");
    apply.focus();
    await press(apply);

    fireEvent.keyDown(dialog(), { key: "Escape" });
    await act(async () => {});

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(applySuggestion).not.toHaveBeenCalled();
    expect(apply).toHaveFocus();
  });
});

describe("Draft as vN →", () => {
  beforeEach(() => {
    previewSuggestion.mockResolvedValue({ ok: true, preview: reviewPreview() });
  });

  it("previews the stage delta and says publishing remains human", async () => {
    await draw();

    await press(control(TITLES.review, "Draft as v15"));

    expect(dialog()).toHaveTextContent("moves `review` (Self-review diff) to run before `build`");
    expect(dialog()).toHaveTextContent("Lands inWorkflow studio · standard-fix draft");
    expect(dialog()).toHaveTextContent("Workflowstandard-fix");
    expect(dialog()).toHaveTextContent("Becomesv15 — only when a person publishes it");
    expect(dialog()).toHaveTextContent(`Proposed by the Build Analyzer (suggestion ${SUGGESTION.review})`);
    expect(within(dialog()).getByRole("region", { name: "Connections added" })).toHaveTextContent("review → build");
    expect(within(dialog()).getByRole("region", { name: "Connections removed" })).toHaveTextContent("implement → build");
    expect(within(dialog()).queryByRole("region", { name: "Stages added" })).toBeNull();
    expect(dialog()).toHaveTextContent(PUBLISH_HUMAN_NOTE);
    expect(PUBLISH_HUMAN_NOTE).toMatch(/^Publishing remains human\./);
  });

  it("creates the draft and opens the studio on it", async () => {
    applySuggestion.mockResolvedValue(applied(reviewPreview()));
    await draw();
    await press(control(TITLES.review, "Draft as v15"));

    await press(within(dialog()).getByRole("button", { name: "Create draft & open studio" }));

    expect(applySuggestion).toHaveBeenCalledExactlyOnceWith(SUGGESTION.review, FINGERPRINT);
    expect(push).toHaveBeenCalledExactlyOnceWith("/workflows/standard-fix");
    expect(row(TITLES.review)).toHaveTextContent("Draft created Oct 2 — publishing remains a person's step");
    expect(within(row(TITLES.review)).getByRole("link", { name: "Open in the studio" })).toHaveAttribute(
      "href",
      "/workflows/standard-fix",
    );
  });

  it("shows Simulate on last 50 loops as an honest soon-state, not a dead button", async () => {
    await draw();
    const simulate = control(TITLES.review, /Simulate on last 50 loops/);

    expect(simulate).toHaveTextContent("soon");
    expect(simulate).toHaveAttribute("aria-disabled", "true");
    expect(simulate).toHaveAttribute("title", SIMULATE_SOON);
    expect(SIMULATE_SOON).toMatch(/BX\.2/);

    await press(simulate);

    expect(screen.queryByRole("dialog")).toBeNull();
    // A build-process row has no workflow to simulate.
    expect(within(row(TITLES.move)).queryByRole("button", { name: /Simulate/ })).toBeNull();
  });

  it("is inert, with why, when the workflow it names is gone", async () => {
    answer = pageWith(
      seededSuggestions((suggestion) => (suggestion.id === SUGGESTION.review ? { ...suggestion, workflow: null } : suggestion)),
    );
    await draw();
    const draft = control(TITLES.review, "Draft a workflow change");

    expect(draft).toHaveAttribute("aria-disabled", "true");
    await press(draft);
    expect(previewSuggestion).not.toHaveBeenCalled();
  });
});

describe("Dismiss", () => {
  it("states the persistence guarantee before the dismissal is made", async () => {
    await draw();

    await press(control(TITLES.flake, "Dismiss"));

    const confirm = dialog("alertdialog");
    expect(confirm).toHaveAccessibleName(DISMISS_TITLE);
    expect(confirm).toHaveAccessibleDescription(DISMISS_GUARANTEE);
    expect(DISMISS_GUARANTEE).toMatch(/won't be suggested again/);
    expect(confirm).toHaveTextContent(TITLES.flake);
    expect(dismissSuggestion).not.toHaveBeenCalled();
  });

  it("resolves the row at once — before the service has answered — with its reason", async () => {
    dismissSuggestion.mockReturnValue(new Promise(() => {}));
    await draw();
    await press(control(TITLES.flake, "Dismiss"));

    fireEvent.change(within(dialog("alertdialog")).getByLabelText(REASON_LABEL), {
      target: { value: "  The telemetry suite is being rewritten.  " },
    });
    await press(within(dialog("alertdialog")).getByRole("button", { name: "Dismiss" }));

    expect(dismissSuggestion).toHaveBeenCalledExactlyOnceWith(SUGGESTION.flake, "The telemetry suite is being rewritten.");
    expect(screen.queryByRole("alertdialog")).toBeNull();

    const resolved = row(TITLES.flake);
    expect(resolved).toHaveTextContent("Dismissed Oct 2 — won't be suggested again");
    expect(resolved).toHaveTextContent("“The telemetry suite is being rewritten.”");
    expect(within(resolved).queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(within(resolved).queryByRole("button", { name: /Draft as/ })).toBeNull();
    expect(resolved).toHaveFocus();
  });

  it("needs no reason", async () => {
    dismissSuggestion.mockResolvedValue({
      ok: true,
      resolution: { id: SUGGESTION.ccache, status: "dismissed", resolvedAt: "2026-10-02T20:00:00.000Z", reason: null },
    });
    await draw();
    await press(control(TITLES.ccache, "Dismiss"));

    await press(within(dialog("alertdialog")).getByRole("button", { name: "Dismiss" }));

    expect(dismissSuggestion).toHaveBeenCalledExactlyOnceWith(SUGGESTION.ccache, null);
    expect(row(TITLES.ccache)).toHaveTextContent("won't be suggested again");
    expect(within(card("build_process")).getByText("3 open")).toBeInTheDocument();
  });

  it("rolls the row back to open, saying why, when the service refuses", async () => {
    let refuse: (outcome: unknown) => void = () => {};
    dismissSuggestion.mockReturnValue(new Promise((resolve) => (refuse = resolve)));
    await draw();
    await press(control(TITLES.flake, "Dismiss"));
    await press(within(dialog("alertdialog")).getByRole("button", { name: "Dismiss" }));
    expect(row(TITLES.flake)).toHaveTextContent("won't be suggested again");

    await act(async () => {
      refuse({ ok: false, reason: "The suggestion could not be dismissed, so it is open again. The service failed.", resolved: false });
    });

    const reopened = row(TITLES.flake);
    expect(reopened).not.toHaveTextContent("won't be suggested again");
    expect(within(reopened).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(within(reopened).getByRole("alert")).toHaveTextContent("so it is open again. The service failed.");
  });

  it("stays dismissed when the poll confirms it — and after a later analysis finds it again", async () => {
    dismissSuggestion.mockImplementation(() => {
      answer = pageWith(resolvedSuggestions(SUGGESTION.flake, "dismissed", { reason: "Being rewritten." }));

      return Promise.resolve({
        ok: true,
        resolution: { id: SUGGESTION.flake, status: "dismissed", resolvedAt: "2026-10-02T19:00:00.000Z", reason: "Being rewritten." },
      });
    });
    await draw();
    await press(control(TITLES.flake, "Dismiss"));
    await press(within(dialog("alertdialog")).getByRole("button", { name: "Dismiss" }));

    expect(row(TITLES.flake)).toHaveTextContent("Dismissed Oct 2 by Ken Suenobu — won't be suggested again");

    // A re-analysis re-records the same suggestion under a new run: the page draws what it reads.
    cleanup();
    answer = pageWith({
      ...resolvedSuggestions(SUGGESTION.flake, "dismissed", { reason: "Being rewritten." }),
      runId: "5eed0065-0000-4000-8000-000000000003",
    });
    await draw();

    expect(row(TITLES.flake)).toHaveTextContent("won't be suggested again");
    expect(within(row(TITLES.flake)).queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(within(card("workflow")).getAllByRole("article")).toHaveLength(2);
  });

  it("refuses a reason longer than the service keeps, without sending it", async () => {
    await draw();
    await press(control(TITLES.flake, "Dismiss"));

    fireEvent.change(within(dialog("alertdialog")).getByLabelText(REASON_LABEL), {
      target: { value: "x".repeat(4097) },
    });
    await press(within(dialog("alertdialog")).getByRole("button", { name: "Dismiss" }));

    expect(dialog("alertdialog")).toHaveTextContent("Keep the reason under 4,096 characters.");
    expect(dismissSuggestion).not.toHaveBeenCalled();
  });

  it("backs out on Cancel, changing nothing", async () => {
    await draw();
    await press(control(TITLES.flake, "Dismiss"));

    await press(within(dialog("alertdialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(dismissSuggestion).not.toHaveBeenCalled();
    expect(control(TITLES.flake, "Dismiss")).toBeInTheDocument();
  });
});

describe("Draft spike ticket", () => {
  it("shows the ticket before drafting it: its title, what is uncertain, and that it asserts no impact", async () => {
    await draw();

    await press(control(TITLES.link, "Draft spike ticket"));

    expect(previewSuggestion).not.toHaveBeenCalled();
    expect(dialog()).toHaveTextContent(SPIKE_LEDE);
    expect(SPIKE_LEDE).toMatch(/asserts no impact/);
    expect(dialog()).toHaveTextContent("Ticket titleSpike: Link zephyr.elf incrementally (partial link cache)");
    expect(dialog()).toHaveTextContent(
      "What is uncertainthe link step's growth, if a partial link cache won half of it back",
    );
    expect(dialog()).toHaveTextContent("link step grew from 18% to 42% of build time since v2.3 (LTO enabled)");
  });

  it("opens on the tracker that can be written to, with the others disabled and why", async () => {
    await draw();
    await press(control(TITLES.link, "Draft spike ticket"));

    const trackers = within(dialog()).getByRole("group", { name: "Target tracker" });
    expect(within(trackers).getByRole("button", { name: "GitHub Issues" })).toHaveAttribute("aria-pressed", "true");
    expect(within(trackers).getByRole("button", { name: /Linear/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("drafts it into a planning batch, and leads to that batch rather than to a tracker", async () => {
    draftSpike.mockResolvedValue({
      ok: true,
      batchId: "5eed006a-0000-4000-8000-000000000002",
      href: "/planning?batch=5eed006a-0000-4000-8000-000000000002",
      localKey: "BA-1",
      title: "Spike: Link zephyr.elf incrementally (partial link cache)",
    });
    await draw();
    await press(control(TITLES.link, "Draft spike ticket"));

    await press(within(dialog()).getByRole("button", { name: "Draft spike ticket" }));

    expect(draftSpike).toHaveBeenCalledExactlyOnceWith(SUGGESTION.link, SEEDED_GITHUB_ID);
    expect(within(dialog()).getByRole("status")).toHaveTextContent(`BA-1 · ${SPIKE_DRAFTED}`);
    expect(within(dialog()).getByRole("link", { name: "Open the draft in Planning" })).toHaveAttribute(
      "href",
      "/planning?batch=5eed006a-0000-4000-8000-000000000002",
    );

    await press(within(dialog()).getByRole("button", { name: "Close" }));

    const drafted = row(TITLES.link);
    expect(drafted).toHaveTextContent("Spike drafted Oct 2");
    expect(within(drafted).getByRole("link", { name: "Open the draft in Planning" })).toHaveAttribute(
      "href",
      "/planning?batch=5eed006a-0000-4000-8000-000000000002",
    );
    expect(within(drafted).queryByRole("button", { name: "Draft spike ticket" })).toBeNull();
    expect(within(card("build_process")).getByText("3 open")).toBeInTheDocument();
    expect(drafted).toHaveFocus();
  });

  it("keeps the dialog open with the service's reason when the draft is refused", async () => {
    draftSpike.mockResolvedValue({ ok: false, reason: "The spike could not be drafted. That tracker cannot be written to." });
    await draw();
    await press(control(TITLES.link, "Draft spike ticket"));

    await press(within(dialog()).getByRole("button", { name: "Draft spike ticket" }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent("That tracker cannot be written to.");
    expect(control(TITLES.link, "Draft spike ticket")).toBeInTheDocument();
  });

  it("will not draft for nowhere: with no tracker to write to, the confirm is inert and says why", async () => {
    readDraftTargets.mockResolvedValue({
      ok: true,
      options: trackerOptions(seededSources(), { ok: false, reason: "The catalog could not be read." }),
    });
    await draw();
    await press(control(TITLES.link, "Draft spike ticket"));

    const confirm = within(dialog()).getByRole("button", { name: "Draft spike ticket" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", CHOOSE_TRACKER);

    await press(confirm);
    expect(draftSpike).not.toHaveBeenCalled();
  });

  it("says when the workspace's trackers could not be read", async () => {
    readDraftTargets.mockResolvedValue({ ok: false, reason: "The workspace's trackers could not be read. The service failed." });
    await draw();

    await press(control(TITLES.link, "Draft spike ticket"));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent("The service failed.");
  });
});

describe("Details", () => {
  it("shows the impact's basis, the calibration in effect with its history, and the scoring", async () => {
    await draw();

    await press(control(TITLES.ccache, "Details"));

    const sheet = dialog();
    expect(sheet).toHaveAccessibleName(`Details · ${TITLES.ccache}`);
    expect(sheet).toHaveTextContent("Suggestion · build process");
    expect(within(sheet).getByRole("region", { name: "Impact" })).toHaveTextContent("−1m 50s on ~20% of builds");
    expect(within(sheet).getByRole("region", { name: "Impact" })).toHaveTextContent("Formula: ccache_rewarm v1: -slowdown_seconds.");

    const calibration = within(sheet).getByRole("region", { name: "Calibration in effect" });
    expect(calibration).toHaveTextContent("× 0.6545 — the cache_window model's factor for duration_delta");
    expect(calibration).toHaveTextContent("Learned from 1 closed measurement");
    expect(calibration).toHaveTextContent("Sep 17 · × 1 → × 0.6545 · measured −72 against −110 predicted, over 1 measurement");

    expect(within(sheet).getByRole("region", { name: "Confidence" })).toHaveTextContent("conf 88%");
    expect(within(sheet).getByRole("region", { name: "Confidence" })).toHaveTextContent("Effect size: 0.47 against a decisive 0.5 → 0.94.");
  });

  it("shows the findings behind it, as their analyzers wrote them", async () => {
    await draw();

    await press(control(TITLES.gate, "Details"));

    const findings = within(dialog()).getByRole("region", { name: "Findings behind it" });
    const items = within(findings).getAllByRole("listitem").filter((item) => item.classList.contains("analyzer-sd__finding"));
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent("workflow_outcome v1 · standard-fix/stage qemu_cortex_m3/unique_failures");
    expect(items[1]).toHaveTextContent("confidence 91% — sample 214 · effect 0 · stability 0.95");
    expect(items[1]).toHaveTextContent("workflow_outcome v1: failures a stage caught that no other stage of the same commit did");
    expect(items[1]).toHaveTextContent("sample214");
    expect(items[1]).toHaveTextContent("pr seconds per commit158");
    expect(items[1]).toHaveTextContent("3 of 10 references listed.");
  });

  it("links each evidence reference to the farm surface it resolves on", async () => {
    await draw();

    await press(control(TITLES.move, "Details"));

    const sheet = dialog();
    expect(within(sheet).getByRole("link", { name: "pool-a" })).toHaveAttribute("href", "/build-farm#pools-card-title");
    expect(within(sheet).getByRole("link", { name: "forge-02" })).toHaveAttribute("href", "/build-farm#runners-card-title");
    expect(sheet).toHaveTextContent("opens in Build Farm");
  });

  it("links evidence into the test-results and waiver surfaces, and the workflow studio", async () => {
    answer = pageWith(
      seededSuggestions((suggestion) =>
        suggestion.id !== SUGGESTION.review
          ? suggestion
          : {
              ...suggestion,
              findings: [
                {
                  ...suggestion.findings[0]!,
                  evidence: [
                    ...suggestion.findings[0]!.evidence,
                    evidenceOf("test_case", "5eed0033-0000-4000-8000-000000000001", "ring buffer drains under burst", {
                      surface: "test_results",
                      runId: "5eed0009-0000-4000-8000-000000000479",
                      attempt: 3,
                      suiteName: "telemetry integration",
                      caseName: "ring buffer drains under burst",
                    }),
                    evidenceOf("test_run", "5eed0031-0000-4000-8000-000000000003", "Build 3", {
                      surface: "test_results",
                      runId: "5eed0009-0000-4000-8000-000000000479",
                      attempt: 3,
                    }),
                    evidenceOf("waiver", "5eed006d-0000-4000-8000-000000003401", "No thermal chamber on helios-rig-02", {
                      surface: "pull_request",
                      pullRequestId: "5eed003a-0000-4000-8000-000000000514",
                    }),
                    evidenceOf("waiver", "5eed006d-0000-4000-8000-000000003402", "Bench waived for the release", {
                      surface: "test_results",
                      runId: "5eed0009-0000-4000-8000-000000000480",
                    }),
                    evidenceOf("build", "5eed0062-0000-4000-8000-000000010001", null),
                  ],
                  evidenceTotal: 6,
                },
              ],
            },
      ),
    );
    await draw();

    await press(control(TITLES.review, "Details"));

    const sheet = dialog();
    expect(within(sheet).getByRole("link", { name: "standard-fix v14" })).toHaveAttribute("href", "/workflows/standard-fix");
    expect(within(sheet).getByRole("link", { name: "ring buffer drains under burst" })).toHaveAttribute(
      "href",
      "/runs/5eed0009-0000-4000-8000-000000000479/tests?from=build-farm&attempt=3&suite=telemetry+integration&case=ring+buffer+drains+under+burst",
    );
    expect(within(sheet).getByRole("link", { name: "Build 3" })).toHaveAttribute(
      "href",
      "/runs/5eed0009-0000-4000-8000-000000000479/tests?from=build-farm&attempt=3",
    );
    expect(within(sheet).getByRole("link", { name: "No thermal chamber on helios-rig-02" })).toHaveAttribute(
      "href",
      "/prs/5eed003a-0000-4000-8000-000000000514?from=build-farm",
    );
    expect(within(sheet).getByRole("link", { name: "Bench waived for the release" })).toHaveAttribute(
      "href",
      "/runs/5eed0009-0000-4000-8000-000000000480/tests?from=build-farm",
    );
    expect(sheet).toHaveTextContent("opens in Test results");
    // A reference whose row is gone keeps its id and opens nothing.
    expect(sheet).toHaveTextContent("5eed0062");
    expect(sheet).toHaveTextContent("no longer available to open");
    expect(within(sheet).queryByRole("link", { name: "5eed0062" })).toBeNull();
  });

  it("says so when retention has removed the findings, keeping the suggestion as composed", async () => {
    answer = pageWith(
      seededSuggestions((suggestion) => (suggestion.id === SUGGESTION.move ? { ...suggestion, findings: [] } : suggestion)),
    );
    await draw();

    await press(control(TITLES.move, "Details"));

    expect(within(dialog()).getByRole("region", { name: "Findings behind it" })).toHaveTextContent(FINDINGS_GONE);
  });

  it("is offered on a resolved row too, and says how it was resolved", async () => {
    answer = pageWith(resolvedSuggestions(SUGGESTION.flake, "dismissed", { reason: "Being rewritten." }));
    await draw();

    await press(control(TITLES.flake, "Details"));

    const resolution = within(dialog()).getByRole("region", { name: "Resolution" });
    expect(resolution).toHaveTextContent("Dismissed Oct 2 by Ken Suenobu — won't be suggested again");
    expect(resolution).toHaveTextContent("“Being rewritten.”");
  });

  it("follows the live suggestion, and closes when an analysis no longer has it", async () => {
    dismissSuggestion.mockImplementation(() => {
      const seeded = seededSuggestions();
      answer = pageWith({ ...seeded, suggestions: seeded.suggestions.filter((entry) => entry.id !== SUGGESTION.move) });

      return Promise.resolve({ ok: false, reason: "refused", resolved: true });
    });
    await draw();
    await press(control(TITLES.move, "Details"));
    expect(dialog()).toHaveAccessibleName(`Details · ${TITLES.move}`);

    // Something else makes the page read again; the suggestion is gone from the answer.
    await act(async () => {
      fireEvent.keyDown(dialog(), { key: "Escape" });
    });
    await press(control(TITLES.flake, "Dismiss"));
    await press(within(dialog("alertdialog")).getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("article", { name: TITLES.move })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("roles", () => {
  it("lets a member read the preview, with the confirm inert and why", async () => {
    await draw(analyzerReadings({ mayAdminister: false }));

    await press(control(TITLES.move, "Apply"));

    expect(dialog()).toHaveTextContent("forge-02 joins pool-a between 14:00–16:00 UTC");
    const confirm = within(dialog()).getByRole("button", { name: "Apply" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", APPLY_ROLE_REASON);

    await press(confirm);
    expect(applySuggestion).not.toHaveBeenCalled();
  });

  it("lets a member dismiss", async () => {
    dismissSuggestion.mockReturnValue(new Promise(() => {}));
    await draw(analyzerReadings({ mayAdminister: false }));

    await press(control(TITLES.flake, "Dismiss"));
    await press(within(dialog("alertdialog")).getByRole("button", { name: "Dismiss" }));

    expect(dismissSuggestion).toHaveBeenCalledTimes(1);
    expect(row(TITLES.flake)).toHaveTextContent("won't be suggested again");
  });

  it("shows a member the spike as it would be drafted, without asking which tracker or drafting", async () => {
    await draw(analyzerReadings({ mayAdminister: false }));

    await press(control(TITLES.link, "Draft spike ticket"));

    expect(readDraftTargets).not.toHaveBeenCalled();
    expect(within(dialog()).queryByRole("group", { name: "Target tracker" })).toBeNull();
    const confirm = within(dialog()).getByRole("button", { name: "Draft spike ticket" });
    expect(confirm).toHaveAttribute("title", DRAFT_ROLE_REASON);

    await press(confirm);
    expect(draftSpike).not.toHaveBeenCalled();
  });

  it("shows a viewer every row, with Dismiss inert and why — and Details still open", async () => {
    await draw(analyzerReadings({ mayAdminister: false, mayDismiss: false }));
    const dismiss = control(TITLES.move, "Dismiss");

    expect(dismiss).toHaveAttribute("aria-disabled", "true");
    expect(dismiss).toHaveAttribute("title", DISMISS_ROLE_REASON);

    await press(dismiss);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await press(control(TITLES.move, "Details"));
    expect(dialog()).toHaveAccessibleName(`Details · ${TITLES.move}`);
  });
});

describe("what a screen reader and a keyboard reach", () => {
  it("names each row by its title and describes its controls by it, so rows are not a list of identical Applys", async () => {
    await draw();
    const title = within(row(TITLES.move)).getByRole("heading", { level: 3 });

    expect(control(TITLES.move, "Apply")).toHaveAccessibleDescription(TITLES.move);
    expect(control(TITLES.move, "Details")).toHaveAccessibleDescription(TITLES.move);
    expect(row(TITLES.move)).toHaveAttribute("aria-labelledby", title.id);
  });

  it("describes an inert control by its reason", async () => {
    await draw();

    expect(control(TITLES.review, /Simulate on last 50 loops/)).toHaveAccessibleDescription(SIMULATE_SOON);
  });

  it("keeps every control a real button or link — nothing is a click handler on text", async () => {
    await draw();

    for (const element of card("build_process").querySelectorAll("[onclick], [role='button']")) {
      expect(element.tagName).toBe("BUTTON");
    }
    expect(within(card("build_process")).getAllByRole("button").every((button) => button.tagName === "BUTTON")).toBe(true);
  });
});

describe("theming", () => {
  it("draws the same markup in light and dark — every tint is a token", () => {
    const rows = cardRows(resolvedSuggestions(SUGGESTION.ccache, "dismissed", { reason: "Not now." }), "build_process");
    const [light, dark] = renderInBothPalettes(<SuggestionList onOpen={() => {}} refusals={new Map()} rows={rows} />);

    expect(light).toContain("ou-chip--ok");
    expect(light).toContain("ou-chip--warn");
    expect(maskIds(light!)).toBe(maskIds(dark!));
  });

  it("writes no inline style into either card", async () => {
    await draw();

    expect(card("build_process").querySelectorAll("[style]")).toHaveLength(0);
    expect(card("workflow").querySelectorAll("[style]")).toHaveLength(0);
  });
});
