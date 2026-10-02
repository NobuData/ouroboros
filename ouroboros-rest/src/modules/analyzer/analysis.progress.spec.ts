import {
  analyzerEnded,
  analyzerStarted,
  analyzerSummary,
  pendingProgress,
  remainingNotRun,
} from "./analysis.progress";

const SET = {
  label: "deterministic analyzers v1",
  analyzers: [
    { id: "cache_window", version: 1, kind: "deterministic" as const },
    { id: "change_point", version: 1, kind: "deterministic" as const },
    { id: "log_signature", version: 1, kind: "deterministic" as const },
  ],
};

describe("run progress", () => {
  it("starts with every analyzer of the set pending, in the set's order", () => {
    expect(pendingProgress(SET)).toEqual({
      analyzers: [
        { id: "cache_window", version: 1, status: "pending" },
        { id: "change_point", version: 1, status: "pending" },
        { id: "log_signature", version: 1, status: "pending" },
      ],
    });
  });

  it("ticks an analyzer from pending to running to its outcome, leaving the others alone", () => {
    const started = analyzerStarted(pendingProgress(SET), "change_point", 1);
    expect(started.analyzers[1]).toEqual({ id: "change_point", version: 1, status: "running" });

    const ended = analyzerEnded(
      started,
      {
        analyzer: "change_point",
        version: 1,
        status: "completed",
        reason: null,
        elapsedSeconds: 2.5,
      },
      3,
    );
    expect(ended.analyzers[1]).toEqual({
      id: "change_point",
      version: 1,
      status: "completed",
      elapsed_seconds: 2.5,
      findings: 3,
    });
    expect(ended.analyzers[0].status).toBe("pending");
  });

  it("records a reason, and no findings count, for an analyzer that did not complete", () => {
    const ended = analyzerEnded(
      pendingProgress(SET),
      {
        analyzer: "log_signature",
        version: 1,
        status: "skipped",
        reason: "the corpus lacks log_tails@build",
        elapsedSeconds: 0,
      },
      0,
    );

    expect(ended.analyzers[2]).toEqual({
      id: "log_signature",
      version: 1,
      status: "skipped",
      elapsed_seconds: 0,
      reason: "the corpus lacks log_tails@build",
    });
  });

  it("does not mutate the document it was given", () => {
    const before = pendingProgress(SET);
    const copy = structuredClone(before);

    analyzerStarted(before, "cache_window", 1);

    expect(before).toEqual(copy);
  });

  it("appends an analyzer the set did not name rather than dropping it", () => {
    const progress = analyzerStarted(pendingProgress(SET), "queue_correlation", 1);

    expect(progress.analyzers.map((entry) => entry.id)).toEqual([
      "cache_window",
      "change_point",
      "log_signature",
      "queue_correlation",
    ]);
  });

  it("marks every analyzer that never ended not_run, with the reason, when a run stops early", () => {
    let progress = analyzerEnded(
      pendingProgress(SET),
      {
        analyzer: "cache_window",
        version: 1,
        status: "completed",
        reason: null,
        elapsedSeconds: 1,
      },
      2,
    );
    progress = analyzerStarted(progress, "change_point", 1);

    const stopped = remainingNotRun(progress, "the run's compute ceiling was reached");

    expect(stopped.analyzers.map((entry) => [entry.id, entry.status, entry.reason])).toEqual([
      ["cache_window", "completed", undefined],
      ["change_point", "not_run", "the run's compute ceiling was reached"],
      ["log_signature", "not_run", "the run's compute ceiling was reached"],
    ]);
  });

  it("summarises which analyzers completed and which did not, for the manifest", () => {
    let progress = pendingProgress({
      ...SET,
      analyzers: [
        ...SET.analyzers,
        { id: "queue_correlation", version: 1, kind: "deterministic" as const },
      ],
    });
    progress = analyzerEnded(
      progress,
      {
        analyzer: "cache_window",
        version: 1,
        status: "completed",
        reason: null,
        elapsedSeconds: 1,
      },
      1,
    );
    progress = analyzerEnded(
      progress,
      { analyzer: "change_point", version: 1, status: "timed_out", reason: "x", elapsedSeconds: 9 },
      0,
    );
    progress = analyzerEnded(
      progress,
      { analyzer: "log_signature", version: 1, status: "skipped", reason: "y", elapsedSeconds: 0 },
      0,
    );

    expect(analyzerSummary(progress)).toEqual({
      completed: ["cache_window"],
      skipped: ["log_signature"],
      failed: ["change_point"],
      not_run: ["queue_correlation"],
    });
  });
});
