import { describe, expect, it } from "vitest";

import {
  CANCELED_CAPTION,
  FAILED_CAPTION,
  SKIPPED_CAPTION,
  STAGE_PARAM,
  STEP_GLYPH,
  attemptCaption,
  buildLogJob,
  buildPhaseCaption,
  runStepper,
  selectedStage,
  stepBuild,
  stepCaption,
  stepName,
  stepTone,
  stepperTag,
  withStage,
} from "@/app/runs/stepper";

import { SEEDED_NOTE, runConsole, seededStages, timelineStage } from "../helpers/runs";

/**
 * The stage timeline's rules (#311), without rendering: mockup parity against the seed, the
 * five treatments, captions from history, the note printed verbatim, and the URL's filter.
 */

describe("the seeded stepper", () => {
  it("matches the mockup: three done with durations, Implement active on 2/3, four pending", () => {
    const view = runStepper(runConsole());

    expect(view.steps.map((step) => [step.label, step.glyph, step.caption])).toEqual([
      ["Queued", "✓", "0m 04s"],
      ["Analyze", "✓", "1m 12s"],
      ["Plan", "✓", "2m 05s"],
      ["Implement", "●", "attempt 2/3"],
      ["Build", "○", null],
      ["Test", "○", null],
      ["Review", "○", null],
      ["Open PR", "○", null],
    ]);
    expect(view.steps[3]!.note).toBe(SEEDED_NOTE);
    expect(view.tag).toBe("workflow: standard-fix v14");
    expect(view.live).toBe(true);
    expect(view.focusKey).toBe("implement");
  });

  it("glows the three segments the mockup glows — up to the active node, not past it", () => {
    const view = runStepper(runConsole());

    expect(view.steps.map((step) => step.doneSegment)).toEqual([
      false, // the first node has no segment
      true,
      true,
      true, // Plan → Implement
      false,
      false,
      false,
      false,
    ]);
  });

  it("follows the pinned order, whatever order the payload arrived in", () => {
    const view = runStepper(runConsole({ stages: [...seededStages()].reverse() }));

    expect(view.steps.map((step) => step.key)).toEqual(seededStages().map((stage) => stage.stageKey));
  });
});

describe("the warn note", () => {
  it("is the stored transition note, verbatim — whatever it says", () => {
    const note = "  a note the database composed: ↺ <b>not markup</b>, and a very long tail ".repeat(3);
    const stages = [timelineStage("implement", "Implement", 1, { status: "active", attempt: 2, maxAttempts: 3, note })];

    expect(runStepper(runConsole({ stages })).steps[0]!.note).toBe(note);
  });

  it("is composed by nobody here: a returned attempt with no stored note has none", () => {
    const stages = [
      timelineStage("implement", "Implement", 1, {
        status: "active",
        attempt: 2,
        maxAttempts: 3,
        note: null,
        attempts: [
          { attempt: 1, status: "failed", startedAt: null, finishedAt: null, durationSeconds: 60, note: null },
          { attempt: 2, status: "active", startedAt: null, finishedAt: null, durationSeconds: null, note: null },
        ],
      }),
    ];

    expect(runStepper(runConsole({ stages })).steps[0]!.note).toBeNull();
  });
});

describe("stepTone", () => {
  it("maps each stage status to its treatment", () => {
    expect(stepTone(timelineStage("a", "A", 1, { status: "succeeded" }), "coding")).toBe("done");
    expect(stepTone(timelineStage("a", "A", 1, { status: "active" }), "coding")).toBe("active");
    expect(stepTone(timelineStage("a", "A", 1, { status: "pending" }), "coding")).toBe("pending");
    expect(stepTone(timelineStage("a", "A", 1, { status: "failed" }), "coding")).toBe("failed");
    expect(stepTone(timelineStage("a", "A", 1, { status: "skipped" }), "coding")).toBe("skipped");
  });

  it("draws the stage a failed or canceled run stopped on as failed — never merely paused", () => {
    const stopped = timelineStage("implement", "Implement", 1, { status: "active" });

    expect(stepTone(stopped, "canceled")).toBe("failed");
    expect(stepTone(stopped, "failed")).toBe("failed");
  });

  it("keeps a run waiting on a person on its active treatment", () => {
    expect(stepTone(timelineStage("a", "A", 1, { status: "active" }), "needs_human")).toBe("active");
  });
});

describe("stepCaption", () => {
  it("says the duration of a done node, and nothing when it has none", () => {
    expect(stepCaption(timelineStage("a", "A", 1, { status: "succeeded", durationSeconds: 3725 }), "done", "coding")).toBe(
      "1h 02m 05s",
    );
    expect(stepCaption(timelineStage("a", "A", 1, { status: "succeeded" }), "done", "coding")).toBeNull();
  });

  it("says the attempt of an active node, against its limit when it has one", () => {
    expect(stepCaption(timelineStage("a", "A", 1, { status: "active", attempt: 2, maxAttempts: 3 }), "active", "coding")).toBe(
      "attempt 2/3",
    );
    expect(attemptCaption(4, null)).toBe("attempt 4");
  });

  it("says canceled where an aborted run stopped, failed where an attempt failed, skipped, or nothing", () => {
    expect(stepCaption(timelineStage("a", "A", 1, { status: "active" }), "failed", "canceled")).toBe(CANCELED_CAPTION);
    expect(stepCaption(timelineStage("a", "A", 1, { status: "active" }), "failed", "failed")).toBe(FAILED_CAPTION);
    expect(stepCaption(timelineStage("a", "A", 1, { status: "failed" }), "failed", "canceled")).toBe(FAILED_CAPTION);
    expect(stepCaption(timelineStage("a", "A", 1, { status: "skipped" }), "skipped", "coding")).toBe(SKIPPED_CAPTION);
    expect(stepCaption(timelineStage("a", "A", 1), "pending", "coding")).toBeNull();
  });
});

describe("an aborted run", () => {
  it("is drawn failed at the stage it stopped on, still, with nothing to scroll to but that", () => {
    const view = runStepper(
      runConsole({ run: { status: "canceled" }, head: { live: false } }),
    );
    const implement = view.steps[3]!;

    expect(implement.tone).toBe("failed");
    expect(implement.glyph).toBe(STEP_GLYPH.failed);
    expect(implement.caption).toBe(CANCELED_CAPTION);
    expect(view.live).toBe(false);
    expect(view.focusKey).toBe("implement");
  });
});

describe("stepName", () => {
  it("names the node, its state and its caption for a screen reader", () => {
    expect(stepName("Implement", "active", "attempt 2/3")).toBe("Implement, in progress, attempt 2/3");
    expect(stepName("Build", "pending", null)).toBe("Build, pending");
    expect(stepName("Build", "failed", "failed")).toBe("Build, failed");
  });
});

describe("stepperTag", () => {
  it("names the workflow and its pinned version", () => {
    expect(stepperTag("standard-fix", 14)).toBe("workflow: standard-fix v14");
    expect(stepperTag("standard-fix", null)).toBe("workflow: standard-fix");
  });
});

describe("the URL's filter", () => {
  const steps = runStepper(runConsole()).steps;

  it("accepts a stage the run has, and nothing else", () => {
    expect(selectedStage("implement", steps)).toBe("implement");
    expect(selectedStage(["build", "test"], steps)).toBe("build");
    expect(selectedStage("deploy", steps)).toBeNull();
    expect(selectedStage("", steps)).toBeNull();
    expect(selectedStage(null, steps)).toBeNull();
    expect(selectedStage(undefined, steps)).toBeNull();
  });

  it("sets and clears ?stage= and keeps everything else in the address", () => {
    expect(STAGE_PARAM).toBe("stage");
    expect(withStage("?from=build-farm", "implement")).toBe("?from=build-farm&stage=implement");
    expect(withStage("?from=build-farm&stage=plan", "implement")).toBe("?from=build-farm&stage=implement");
    expect(withStage("?from=build-farm&stage=plan", null)).toBe("?from=build-farm");
    expect(withStage("?stage=plan", null)).toBe("");
    expect(withStage("", "open pr")).toBe("?stage=open+pr");
  });
});

describe("a build stage's farm job (AJ.3 #265)", () => {
  const JOB = {
    jobId: "5eed0028-0000-4000-8000-000000000483",
    jobNumber: 483,
    phase: "running",
    pool: "pool-a",
    runnerName: "forge-02",
    exitCode: null,
    ccacheHitRatePct: null,
    retries: 0,
  } as const;

  it.each([
    [{ phase: "waiting", runnerName: null }, "waiting for a runner in pool-a"],
    [{ phase: "offered" }, "offered to forge-02"],
    [{ phase: "accepted" }, "accepted by forge-02"],
    [{ phase: "running" }, "building on forge-02"],
    [{ phase: "succeeded", exitCode: 0, ccacheHitRatePct: 78.4 }, "exit 0 · ccache 78.4%"],
    [{ phase: "failed", exitCode: 2 }, "exit 2"],
    [{ phase: "canceled", runnerName: null }, "cancelled"],
  ] as const)("says the job's real phase — %o", (over, said) => {
    expect(buildPhaseCaption({ ...JOB, ...over })).toBe(said);
  });

  it("puts the job's number and phase under the build node, and nothing under the others", () => {
    const view = runStepper(
      runConsole({
        stages: seededStages().map((stage) =>
          stage.stageKey === "build" ? { ...stage, status: "active", build: JOB } : stage,
        ),
      }),
    );

    const build = view.steps.find((step) => step.key === "build")!;
    expect(build.build).toEqual({
      jobId: JOB.jobId,
      number: "#483",
      line: "#483 · building on forge-02",
      runner: "forge-02",
    });
    expect(view.steps.filter((step) => step.build !== null)).toHaveLength(1);
  });

  it("hands the log sheet the job, titled for its stage", () => {
    const build = stepBuild(JOB)!;

    expect(buildLogJob(build, "Build")).toEqual({
      id: JOB.jobId,
      number: "#483",
      title: "Build",
      runner: "forge-02",
      startedAt: null,
    });
    expect(stepBuild(undefined)).toBeNull();
  });
});
