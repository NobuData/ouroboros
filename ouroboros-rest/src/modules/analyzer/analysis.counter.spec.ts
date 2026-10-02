import { engineUnavailable } from "../engine/engine.errors";
import { JobCompletions, type JobCompleted } from "../farm/dispatch/job.completions";
import { AnalysisBuildCounter } from "./analysis.counter";
import { analysisAlreadyRunning } from "./analysis.errors";
import type { AnalysisOrchestrator } from "./analysis.orchestrator";
import type { AnalysisRepository } from "./analysis.repository";

const ORG = "5eed0001-0000-4000-8000-000000000001";
const REPO = "acme-robotics/helios-firmware";
const SCHEDULE = "5eed0064-0000-4000-8000-000000000001";

function harness(fired = true) {
  const runs = {
    jobRepo: jest.fn().mockResolvedValue(REPO),
    countBuild: jest.fn().mockResolvedValue({ scheduleId: SCHEDULE, fired }),
    rearm: jest.fn().mockResolvedValue(undefined),
  };
  const orchestrator = { start: jest.fn().mockResolvedValue({ id: "run-1" }) };
  const completions = new JobCompletions();
  const counter = new AnalysisBuildCounter(
    completions,
    runs as unknown as AnalysisRepository,
    orchestrator as unknown as AnalysisOrchestrator,
  );

  return { runs, orchestrator, completions, counter };
}

const completed = (status: JobCompleted["status"]): JobCompleted => ({
  organizationId: ORG,
  jobId: "b0000000-0000-4000-8000-000000000001",
  status,
});

describe("the every-N-builds counter", () => {
  it.each(["succeeded", "failed", "retried"] as const)(
    "counts a %s build against its repository",
    async (status) => {
      const { runs, counter } = harness(false);

      await counter.count(completed(status));

      expect(runs.countBuild).toHaveBeenCalledWith(ORG, REPO);
    },
  );

  it("does not count a cancelled job — it never finished a build", async () => {
    const { runs, counter } = harness();

    await counter.count(completed("canceled"));

    expect(runs.jobRepo).not.toHaveBeenCalled();
    expect(runs.countBuild).not.toHaveBeenCalled();
  });

  it("starts an every_n_builds run, on the schedule that fired, when the threshold is reached", async () => {
    const { orchestrator, counter } = harness(true);

    await counter.count(completed("succeeded"));

    expect(orchestrator.start).toHaveBeenCalledWith({
      organizationId: ORG,
      repoRef: REPO,
      trigger: "every_n_builds",
      scheduleId: SCHEDULE,
    });
  });

  it("starts nothing below the threshold, or for a repository with no schedule", async () => {
    const below = harness(false);
    await below.counter.count(completed("succeeded"));
    expect(below.orchestrator.start).not.toHaveBeenCalled();

    const none = harness();
    none.runs.countBuild.mockResolvedValue(undefined);
    await none.counter.count(completed("succeeded"));
    expect(none.orchestrator.start).not.toHaveBeenCalled();
  });

  it("does not re-arm when a run is already going — that run covers these builds", async () => {
    const { runs, orchestrator, counter } = harness(true);
    orchestrator.start.mockRejectedValue(analysisAlreadyRunning(REPO, undefined));

    await counter.count(completed("succeeded"));

    expect(runs.rearm).not.toHaveBeenCalled();
  });

  it("re-arms the trigger when the run could not start for any other reason", async () => {
    const { runs, orchestrator, counter } = harness(true);
    orchestrator.start.mockRejectedValue(engineUnavailable());

    await counter.count(completed("succeeded"));

    expect(runs.rearm).toHaveBeenCalledWith(SCHEDULE);
  });

  it("listens to job completions once the module is up, and stops when it goes", async () => {
    const { runs, completions, counter } = harness(false);
    counter.onModuleInit();

    completions.emit(completed("succeeded"));
    await new Promise((resolve) => setImmediate(resolve));
    expect(runs.countBuild).toHaveBeenCalledTimes(1);

    counter.onModuleDestroy();
    completions.emit(completed("succeeded"));
    await new Promise((resolve) => setImmediate(resolve));
    expect(runs.countBuild).toHaveBeenCalledTimes(1);
  });
});
