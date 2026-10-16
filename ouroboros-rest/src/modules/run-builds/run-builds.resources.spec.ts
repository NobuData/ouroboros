import { RUNNER, buildJob } from "../farm/dispatch/dispatch.fixture";
import { ccacheSummary, runBuildResource, type RunBuildView } from "./run-builds.resources";

/** What the engine's build stage reads (AJ.3, #265): the lifecycle, the exit code, ccache. */

function view(overrides: Partial<RunBuildView["job"]> = {}, retries = 0): RunBuildView {
  return {
    job: buildJob({ stage_key: "build", stage_attempt: 1, ...overrides }),
    poolName: "pool-a",
    runnerName: overrides.runner_id ? "forge-02" : null,
    retries,
  };
}

describe("a ccache summary", () => {
  it("is the counts and the hit rate to one decimal — mockup 08's 78.4", () => {
    expect(ccacheSummary({ hits: 784, misses: 216, size_bytes: 1, max_size_bytes: 2 })).toEqual({
      hits: 784,
      misses: 216,
      hitRatePct: 78.4,
    });
  });

  it.each([
    ["null — nothing measured", null],
    ["a non-object", "78%"],
    ["counts that are not numbers", { hits: "1", misses: 2 }],
    ["0/0, which a rate would divide by", { hits: 0, misses: 0 }],
  ])("is null for %s, never zero", (_, stats) => {
    expect(ccacheSummary(stats)).toBeNull();
  });
});

describe("a run's build, as the engine reads it", () => {
  it("names a waiting job's phase and whether a runner could take it", () => {
    const resource = runBuildResource(view(), "queued_no_eligible_runner");

    expect(resource).toMatchObject({
      phase: "waiting",
      queueState: "queued_no_eligible_runner",
      pool: "pool-a",
      runnerName: null,
      stageKey: "build",
      stageAttempt: 1,
      exitCode: null,
      ccache: null,
      retries: 0,
      offeredAt: null,
    });
  });

  it("carries no queue state once a runner holds the job", () => {
    const resource = runBuildResource(
      view({ status: "running", runner_id: RUNNER, started_at: new Date("2026-10-16T12:00:02Z") }),
      "queued_runner_available",
    );

    expect(resource).toMatchObject({ phase: "running", queueState: null, runnerName: "forge-02" });
    expect(resource.startedAt).toBe("2026-10-16T12:00:02.000Z");
  });

  it("calls a queued job a runner has accepted accepted, not waiting", () => {
    expect(runBuildResource(view({ runner_id: RUNNER }), null).phase).toBe("accepted");
  });

  it("carries the exit code, the ccache result and the retries of a finished build", () => {
    const resource = runBuildResource(
      view(
        {
          status: "failed",
          runner_id: RUNNER,
          exit_code: 2,
          ccache_stats: { hits: 3, misses: 1, size_bytes: 0, max_size_bytes: 1 },
          finished_at: new Date("2026-10-16T12:04:10Z"),
        },
        1,
      ),
      null,
    );

    expect(resource).toMatchObject({
      phase: "failed",
      exitCode: 2,
      ccache: { hits: 3, misses: 1, hitRatePct: 75 },
      retries: 1,
      finishedAt: "2026-10-16T12:04:10.000Z",
    });
  });
});
