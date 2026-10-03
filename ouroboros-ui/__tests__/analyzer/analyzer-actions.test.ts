import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { SCHEDULE_SAVE_FAILED, START_FAILED } from "@/app/analyzer/view";

import { HELIOS, runningRun, seededSchedule } from "../helpers/analyzer";

vi.mock("server-only", () => ({}));

const start = vi.fn();
const saveSchedule = vi.fn();

vi.mock("@/app/api/analyzer", () => ({
  analyzer: {
    start: (...args: unknown[]) => start(...args),
    saveSchedule: (...args: unknown[]) => saveSchedule(...args),
  },
}));

const { saveAnalyzerSchedule, startAnalysis } = await import("@/app/analyzer/analyzer-actions");

/**
 * The analyzer page's Server Actions (#516): a start refused because one is running is its own
 * outcome naming that run, a save the service refused carries each field's complaint, and
 * anything that is not a refusal still throws.
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
  start.mockReset();
  saveSchedule.mockReset();
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
