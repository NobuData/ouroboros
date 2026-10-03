import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  APPLY_FAILED,
  DISMISS_FAILED,
  PREVIEW_FAILED,
  SPIKE_FAILED,
  TRACKERS_FAILED,
} from "@/app/analyzer/suggestions-view";
import { SCHEDULE_SAVE_FAILED, START_FAILED } from "@/app/analyzer/view";

import { HELIOS, runningRun, seededSchedule } from "../helpers/analyzer";
import { SUGGESTION } from "../helpers/analyzer-suggestions";
import { writableCatalog } from "../helpers/planning";
import { SEEDED_GITHUB_ID, SEEDED_JIRA_ID, sourcePage } from "../helpers/sources";

vi.mock("server-only", () => ({}));

const start = vi.fn();
const saveSchedule = vi.fn();
const preview = vi.fn();
const apply = vi.fn();
const dismiss = vi.fn();
const draft = vi.fn();
const listSources = vi.fn();
const catalog = vi.fn();

vi.mock("@/app/api/analyzer", () => ({
  analyzer: {
    start: (...args: unknown[]) => start(...args),
    saveSchedule: (...args: unknown[]) => saveSchedule(...args),
    preview: (...args: unknown[]) => preview(...args),
    apply: (...args: unknown[]) => apply(...args),
    dismiss: (...args: unknown[]) => dismiss(...args),
    draft: (...args: unknown[]) => draft(...args),
  },
}));

vi.mock("@/app/api/sources", () => ({
  sources: { list: () => listSources(), catalog: () => catalog() },
}));

const {
  applySuggestion,
  dismissSuggestion,
  draftSpike,
  previewSuggestion,
  readDraftTargets,
  saveAnalyzerSchedule,
  startAnalysis,
} = await import("@/app/analyzer/analyzer-actions");

/**
 * The analyzer page's Server Actions (#516): a start refused because one is running is its own
 * outcome naming that run, a save the service refused carries each field's complaint, and
 * anything that is not a refusal still throws. Since #518, what a suggestion may be done with: a
 * preview read, an apply held to that preview's fingerprint, a dismissal, and a spike's draft —
 * each refusal a value the page can word, each malformed call refused without asking.
 */

const INPUT = {
  repo: HELIOS,
  enabled: true,
  weeklyEnabled: true,
  weeklyDay: 1,
  weeklyTime: "06:00",
  everyNBuilds: 50,
  maxBuilds: 2000,
  maxLogLines: 1_230_000,
  computeCeilingSeconds: 3600,
};

beforeEach(() => {
  for (const stub of [start, saveSchedule, preview, apply, dismiss, draft, listSources, catalog]) stub.mockReset();
});

describe("startAnalysis", () => {
  it("starts a run of the repository", async () => {
    start.mockResolvedValue(runningRun({ phase: "assembling" }));

    await expect(startAnalysis(HELIOS)).resolves.toEqual({ kind: "started", run: runningRun({ phase: "assembling" }) });
    expect(start).toHaveBeenCalledExactlyOnceWith(HELIOS);
  });

  it("answers a 409 with the run that is going — never a second run", async () => {
    start.mockRejectedValue(
      new ApiError(409, "analysis_already_running", "An analysis is already running.", {
        repo: HELIOS,
        runId: "8c14647a-6139-476d-ba49-76545ffb5aec",
        trigger: "weekly",
        phase: "analyzing",
        startedAt: "2026-10-02T19:56:00.000Z",
      }),
    );

    await expect(startAnalysis(HELIOS)).resolves.toEqual({
      kind: "running",
      runId: "8c14647a-6139-476d-ba49-76545ffb5aec",
      startedAt: "2026-10-02T19:56:00.000Z",
      phase: "analyzing",
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("answers a 409 whose running run could not be read, with what it knows", async () => {
    start.mockRejectedValue(new ApiError(409, "analysis_already_running", "Running.", { repo: HELIOS }));

    await expect(startAnalysis(HELIOS)).resolves.toEqual({ kind: "running", runId: null, startedAt: null, phase: null });
  });

  it("words any other refusal, and refuses a malformed call without asking", async () => {
    start.mockRejectedValue(new ApiError(403, "forbidden", "Only an owner or admin may do this."));

    await expect(startAnalysis(HELIOS)).resolves.toEqual({
      kind: "refused",
      reason: `${START_FAILED} Only an owner or admin may do this.`,
    });
    await expect(startAnalysis("")).resolves.toEqual({ kind: "refused", reason: START_FAILED });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("rethrows what is not a refusal", async () => {
    start.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(startAnalysis(HELIOS)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("saveAnalyzerSchedule", () => {
  it("saves the whole configuration and answers the saved schedule", async () => {
    saveSchedule.mockResolvedValue(seededSchedule());

    await expect(saveAnalyzerSchedule(INPUT)).resolves.toEqual({ ok: true, value: seededSchedule() });
    expect(saveSchedule).toHaveBeenCalledExactlyOnceWith(INPUT);
  });

  it("carries the service's complaint for each refused field", async () => {
    saveSchedule.mockRejectedValue(
      new ApiError(422, "validation_failed", "The request is not valid.", {
        weeklyDay: ["weeklyDay must be an ISO weekday, 1 (Monday) to 7 (Sunday)"],
      }),
    );

    await expect(saveAnalyzerSchedule(INPUT)).resolves.toEqual({
      ok: false,
      reason: `${SCHEDULE_SAVE_FAILED} The request is not valid.`,
      fields: { weeklyDay: "weeklyDay must be an ISO weekday, 1 (Monday) to 7 (Sunday)" },
    });
  });

  it("refuses a malformed call without asking", async () => {
    await expect(saveAnalyzerSchedule(null as never)).resolves.toEqual({
      ok: false,
      reason: SCHEDULE_SAVE_FAILED,
      fields: {},
    });
    expect(saveSchedule).not.toHaveBeenCalled();
  });
});

/** A preview's fingerprint, as the service writes one. */
const FINGERPRINT = `sha256:${"4f".repeat(32)}`;

/** The seed's GitHub source. */
const GITHUB = SEEDED_GITHUB_ID;

describe("previewSuggestion", () => {
  it("reads what applying it would change", async () => {
    const answer = { suggestionId: SUGGESTION.move, summary: "forge-02 joins pool-a…", fingerprint: FINGERPRINT };
    preview.mockResolvedValue(answer);

    await expect(previewSuggestion(SUGGESTION.move)).resolves.toEqual({ ok: true, preview: answer });
    expect(preview).toHaveBeenCalledExactlyOnceWith(SUGGESTION.move);
  });

  it("words a refusal, and refuses an id that is not one without asking", async () => {
    preview.mockRejectedValue(new ApiError(404, "workflow_not_found", "No workflow standard-fix."));

    await expect(previewSuggestion(SUGGESTION.review)).resolves.toEqual({
      ok: false,
      reason: `${PREVIEW_FAILED} No workflow standard-fix.`,
    });
    await expect(previewSuggestion("../runs")).resolves.toEqual({ ok: false, reason: PREVIEW_FAILED });
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("rethrows what is not a refusal", async () => {
    preview.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(previewSuggestion(SUGGESTION.move)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("applySuggestion", () => {
  it("applies exactly the preview that was read — the fingerprint goes with it", async () => {
    const applied = { suggestion: { id: SUGGESTION.move, status: "applied" } };
    apply.mockResolvedValue(applied);

    await expect(applySuggestion(SUGGESTION.move, FINGERPRINT)).resolves.toEqual({ kind: "applied", applied });
    expect(apply).toHaveBeenCalledExactlyOnceWith(SUGGESTION.move, FINGERPRINT);
  });

  it("never applies without a fingerprint — a call missing one is refused before the service", async () => {
    await expect(applySuggestion(SUGGESTION.move, "")).resolves.toEqual({ kind: "refused", reason: APPLY_FAILED });
    await expect(applySuggestion(SUGGESTION.move, undefined as never)).resolves.toEqual({
      kind: "refused",
      reason: APPLY_FAILED,
    });
    await expect(applySuggestion("not-a-uuid", FINGERPRINT)).resolves.toEqual({ kind: "refused", reason: APPLY_FAILED });
    expect(apply).not.toHaveBeenCalled();
  });

  it("tells a preview that moved from a suggestion somebody resolved first", async () => {
    apply.mockRejectedValueOnce(new ApiError(409, "analysis_preview_stale", "The preview changed."));
    apply.mockRejectedValueOnce(new ApiError(409, "analysis_suggestion_resolved", "Already dismissed."));

    await expect(applySuggestion(SUGGESTION.move, FINGERPRINT)).resolves.toEqual({
      kind: "stale",
      reason: "The preview changed.",
    });
    await expect(applySuggestion(SUGGESTION.move, FINGERPRINT)).resolves.toEqual({
      kind: "resolved",
      reason: "Already dismissed.",
    });
  });

  it("words every other refusal — a member's 403, a baseline that is not there yet, a plane nothing owns", async () => {
    for (const [status, code, message] of [
      [403, "forbidden", "Only an owner or admin may do this."],
      [409, "analysis_baseline_unavailable", "There is no queue_wait rollup for those days."],
      [422, "analysis_plane_unavailable", "This suggestion cannot be applied: no plane owns it."],
    ] as const) {
      apply.mockRejectedValueOnce(new ApiError(status, code, message));

      await expect(applySuggestion(SUGGESTION.gate, FINGERPRINT)).resolves.toEqual({
        kind: "refused",
        reason: `${APPLY_FAILED} ${message}`,
      });
    }
  });

  it("rethrows what is not a refusal", async () => {
    apply.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(applySuggestion(SUGGESTION.move, FINGERPRINT)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("dismissSuggestion", () => {
  const resolution = { id: SUGGESTION.flake, status: "dismissed", resolvedAt: "2026-10-02T20:00:00.000Z", reason: null };

  it("dismisses with the reason, and without one when none was given", async () => {
    dismiss.mockResolvedValue(resolution);

    await expect(dismissSuggestion(SUGGESTION.flake, "Being rewritten.")).resolves.toEqual({ ok: true, resolution });
    await expect(dismissSuggestion(SUGGESTION.flake, null)).resolves.toEqual({ ok: true, resolution });
    expect(dismiss.mock.calls).toEqual([
      [SUGGESTION.flake, "Being rewritten."],
      [SUGGESTION.flake, undefined],
    ]);
  });

  it("says when somebody resolved it first, so the page reads again rather than putting it back", async () => {
    dismiss.mockRejectedValue(new ApiError(409, "analysis_suggestion_resolved", "Already applied."));

    await expect(dismissSuggestion(SUGGESTION.flake, null)).resolves.toEqual({
      ok: false,
      reason: `${DISMISS_FAILED} Already applied.`,
      resolved: true,
    });
  });

  it("words any other refusal, and refuses a malformed call without asking", async () => {
    dismiss.mockRejectedValue(new ApiError(403, "forbidden", "Viewers may not dismiss."));

    await expect(dismissSuggestion(SUGGESTION.flake, null)).resolves.toEqual({
      ok: false,
      reason: `${DISMISS_FAILED} Viewers may not dismiss.`,
      resolved: false,
    });
    await expect(dismissSuggestion("nope", null)).resolves.toMatchObject({ ok: false, reason: DISMISS_FAILED });
    await expect(dismissSuggestion(SUGGESTION.flake, 7 as never)).resolves.toMatchObject({ ok: false });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("readDraftTargets", () => {
  it("answers the planning page's own tracker options — a writable source choosable, the rest with reasons", async () => {
    listSources.mockResolvedValue(sourcePage());
    catalog.mockResolvedValue(writableCatalog());

    const answer = await readDraftTargets();

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.options.map((option) => [option.kind, option.sourceId, option.reason === undefined])).toEqual([
      ["github", SEEDED_GITHUB_ID, true],
      ["jira", SEEDED_JIRA_ID, false],
      ["linear", null, false],
    ]);
    expect(answer.options[2]?.reason).toMatch(/not connected/);
  });

  it("offers nothing to choose when the catalog — which says what can be written to — was not read", async () => {
    listSources.mockResolvedValue(sourcePage());
    catalog.mockRejectedValue(new ApiError(500, "internal_error", "The service failed."));

    const answer = await readDraftTargets();

    expect(answer.ok && answer.options.every((option) => option.reason !== undefined)).toBe(true);
  });

  it("says so when the workspace's trackers could not be read", async () => {
    listSources.mockRejectedValue(new ApiError(500, "internal_error", "The service failed."));
    catalog.mockResolvedValue(writableCatalog());

    await expect(readDraftTargets()).resolves.toEqual({
      ok: false,
      reason: `${TRACKERS_FAILED} The service failed.`,
    });
  });
});

describe("draftSpike", () => {
  it("drafts the one suggestion into a batch, and answers where that batch opens", async () => {
    draft.mockResolvedValue({
      batch: {
        id: "5eed006a-0000-4000-8000-000000000002",
        drafts: [{ localKey: "BA-1", title: "Spike: Link zephyr.elf incrementally (partial link cache)" }],
      },
      suggestionIds: [SUGGESTION.link],
    });

    await expect(draftSpike(SUGGESTION.link, GITHUB)).resolves.toEqual({
      ok: true,
      batchId: "5eed006a-0000-4000-8000-000000000002",
      href: "/planning?batch=5eed006a-0000-4000-8000-000000000002",
      localKey: "BA-1",
      title: "Spike: Link zephyr.elf incrementally (partial link cache)",
    });
    expect(draft).toHaveBeenCalledExactlyOnceWith([SUGGESTION.link], GITHUB);
  });

  it("words a refusal — a tracker that cannot be written to, a suggestion that is not a spike", async () => {
    draft.mockRejectedValue(new ApiError(409, "planning_target_read_only", "That tracker cannot be written to."));

    await expect(draftSpike(SUGGESTION.link, GITHUB)).resolves.toEqual({
      ok: false,
      reason: `${SPIKE_FAILED} That tracker cannot be written to.`,
    });
  });

  it("refuses a call naming no tracker, or no suggestion, without asking", async () => {
    await expect(draftSpike(SUGGESTION.link, "")).resolves.toEqual({ ok: false, reason: SPIKE_FAILED });
    await expect(draftSpike("", GITHUB)).resolves.toEqual({ ok: false, reason: SPIKE_FAILED });
    expect(draft).not.toHaveBeenCalled();
  });
});
