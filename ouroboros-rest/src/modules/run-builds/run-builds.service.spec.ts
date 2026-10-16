import type { Run } from "../db/schema";
import { ConflictError } from "../errors/error.envelope";
import { RUNNER, buildJob } from "../farm/dispatch/dispatch.fixture";
import type { FarmJobsService } from "../farm/dispatch/jobs.service";
import type { SubmitRunBuildDto } from "./run-builds.dto";
import type { RunBuildsRepository } from "./run-builds.repository";
import type { RunBuildView } from "./run-builds.resources";
import { RunBuildsService } from "./run-builds.service";

/**
 * A run's build stage on the farm (AJ.3, #265): one dispatch path, one job per stage attempt, a
 * designed refusal when no runner can take it, and the run's `building` backed by the job.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const ORG = "org-farm";
const JOB = "5eed0028-0000-4000-8000-000000000483";
const COMMIT = "3f9c2ae0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6";
const TRX = { trx: true };

const REQUEST: SubmitRunBuildDto = {
  idempotencyKey: "run-482-build-1",
  epoch: 3,
  stageKey: "build",
  attempt: 1,
  pool: "pool-a",
  commit: COMMIT,
};

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN,
    organization_id: ORG,
    github_repo_id: "repo-1",
    status: "coding",
    exec_epoch: 3,
    branch_name: "ouro/run-482",
    issue_title: "Add OTA rollback on failed checksum",
    ...overrides,
  } as Run;
}

function view(overrides: Partial<RunBuildView["job"]> = {}): RunBuildView {
  return {
    job: buildJob({ id: JOB, number: 483, stage_key: "build", stage_attempt: 1, ...overrides }),
    poolName: "pool-a",
    runnerName: overrides.runner_id ? "forge-02" : null,
    retries: 0,
  };
}

async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string };
  }
  throw new Error("expected a refusal");
}

describe("a run's build stage on the farm", () => {
  let builds: jest.Mocked<RunBuildsRepository>;
  let jobs: jest.Mocked<FarmJobsService>;
  let service: RunBuildsService;

  beforeEach(() => {
    builds = {
      transaction: jest.fn((work: (trx: unknown) => Promise<unknown>) => work(TRX)),
      lockRun: jest.fn().mockResolvedValue(run()),
      findRun: jest.fn().mockResolvedValue(run()),
      stageJob: jest.fn().mockResolvedValue(undefined),
      repositorySlug: jest.fn().mockResolvedValue("acme-robotics/helios-firmware"),
      latest: jest.fn().mockResolvedValue(view({ status: "offered", runner_id: RUNNER })),
      reserve: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RunBuildsRepository>;
    jobs = {
      submitForRun: jest.fn().mockResolvedValue({ id: JOB }),
      dispatchState: jest.fn().mockResolvedValue({ queueState: "queued_runner_available" }),
      cancel: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<FarmJobsService>;
    service = new RunBuildsService(builds, jobs);
  });

  describe("submitting", () => {
    it("submits through the farm with the run's own repository, branch and stage", async () => {
      const { job } = await service.submit(RUN, { ...REQUEST, command: ["make", "all"] });

      expect(jobs.submitForRun).toHaveBeenCalledWith(
        ORG,
        RUN,
        {
          pool: "pool-a",
          repository: "acme-robotics/helios-firmware",
          ref: "refs/heads/ouro/run-482",
          commit: COMMIT,
          command: ["make", "all"],
          title: "Add OTA rollback on failed checksum",
        },
        { key: "build", attempt: 1 },
      );
      expect(job).toMatchObject({ jobId: JOB, phase: "offered", runnerName: "forge-02" });
    });

    it("leaves the command to the pool's default when the stage names none", async () => {
      await service.submit(RUN, REQUEST);

      expect(jobs.submitForRun.mock.calls[0][2]).not.toHaveProperty("command");
    });

    it("reserves the job and calls the run building, under the run's lock", async () => {
      await service.submit(RUN, REQUEST);

      expect(builds.lockRun).toHaveBeenCalledTimes(2);
      expect(builds.reserve).toHaveBeenCalledWith(TRX, RUN, JOB);
    });

    it("answers a resent stage attempt with the job it already created, building nothing", async () => {
      builds.stageJob.mockResolvedValue(JOB);

      const { job } = await service.submit(RUN, REQUEST);

      expect(jobs.submitForRun).not.toHaveBeenCalled();
      expect(builds.latest).toHaveBeenCalledWith(expect.objectContaining({ id: RUN }), JOB);
      expect(job.jobId).toBe(JOB);
    });

    it("takes a lost race for the stage attempt as the replay it is", async () => {
      jobs.submitForRun.mockRejectedValue(
        Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "build_jobs_run_stage_key",
        }),
      );
      builds.stageJob.mockResolvedValueOnce(undefined).mockResolvedValueOnce(JOB);

      const { job } = await service.submit(RUN, REQUEST);

      expect(job.jobId).toBe(JOB);
    });

    it("lets any other database failure through", async () => {
      jobs.submitForRun.mockRejectedValue(new Error("connection reset"));

      await expect(service.submit(RUN, REQUEST)).rejects.toThrow("connection reset");
    });

    it("cancels a job no runner can take and refuses the stage, saying why", async () => {
      builds.latest.mockResolvedValue(view());
      jobs.dispatchState.mockResolvedValue({
        job: {} as never,
        queueState: "queued_no_eligible_runner",
      });

      const refused = await refusal(service.submit(RUN, REQUEST));

      expect(refused.code).toBe("build_no_eligible_runner");
      expect(refused.message).toContain("pool `pool-a`");
      expect(refused.message).toContain("Build #483 was cancelled");
      expect(jobs.cancel).toHaveBeenCalledWith(ORG, JOB);
      expect(builds.reserve).not.toHaveBeenCalled();
    });

    it("still refuses when the job finished between the question and the cancel", async () => {
      builds.latest.mockResolvedValue(view());
      jobs.dispatchState.mockResolvedValue({
        job: {} as never,
        queueState: "queued_no_eligible_runner",
      });
      jobs.cancel.mockRejectedValue(
        new ConflictError("farm_job_not_cancellable", "It has already finished.", {}),
      );

      expect((await refusal(service.submit(RUN, REQUEST))).code).toBe("build_no_eligible_runner");
    });

    it("lets a waiting job a runner could take wait, and reserves it", async () => {
      builds.latest.mockResolvedValue(view());

      const { job } = await service.submit(RUN, REQUEST);

      expect(job).toMatchObject({ phase: "waiting", queueState: "queued_runner_available" });
      expect(jobs.cancel).not.toHaveBeenCalled();
      expect(builds.reserve).toHaveBeenCalled();
    });

    it("does not reserve a replayed job that has already finished", async () => {
      builds.stageJob.mockResolvedValue(JOB);
      builds.latest.mockResolvedValue(
        view({ status: "succeeded", runner_id: RUNNER, exit_code: 0 }),
      );

      await service.submit(RUN, REQUEST);

      expect(builds.reserve).not.toHaveBeenCalled();
    });

    it.each([
      ["an unknown run", () => builds.lockRun.mockResolvedValue(undefined), "run_not_found"],
      [
        "a superseded epoch",
        () => builds.lockRun.mockResolvedValue(run({ exec_epoch: 4 })),
        "fenced",
      ],
      [
        "a run nothing executes",
        () => builds.lockRun.mockResolvedValue(run({ status: "failed" })),
        "run_not_executable",
      ],
      [
        "a run without a branch",
        () => builds.lockRun.mockResolvedValue(run({ branch_name: null })),
        "run_branch_missing",
      ],
      [
        "a repository the workspace no longer holds",
        () => builds.repositorySlug.mockResolvedValue(undefined),
        "repository_not_found",
      ],
    ])("refuses %s before submitting anything", async (_, arrange, code) => {
      arrange();

      expect((await refusal(service.submit(RUN, REQUEST))).code).toBe(code);
      expect(jobs.submitForRun).not.toHaveBeenCalled();
    });
  });

  describe("reading", () => {
    it("answers the latest attempt, with a waiting job's queue state", async () => {
      builds.latest.mockResolvedValue(view());
      jobs.dispatchState.mockResolvedValue({
        job: {} as never,
        queueState: "queued_no_eligible_runner",
      });

      const { job } = await service.read(RUN, JOB);

      expect(job).toMatchObject({ phase: "waiting", queueState: "queued_no_eligible_runner" });
    });

    it("asks no queue question of a job a runner holds", async () => {
      await service.read(RUN, JOB);

      expect(jobs.dispatchState).not.toHaveBeenCalled();
    });

    it("refuses another run's job, and an unknown run", async () => {
      builds.latest.mockResolvedValue(undefined);
      expect((await refusal(service.read(RUN, JOB))).code).toBe("run_build_not_found");

      builds.findRun.mockResolvedValue(undefined);
      expect((await refusal(service.read(RUN, JOB))).code).toBe("run_not_found");
    });
  });

  describe("cancelling", () => {
    it("cancels the latest attempt of a live build", async () => {
      builds.latest
        .mockResolvedValueOnce(view())
        .mockResolvedValueOnce(view({ status: "canceled", finished_at: new Date() }));

      const { job } = await service.cancel(RUN, JOB, { idempotencyKey: "k", reason: "grace" });

      expect(jobs.cancel).toHaveBeenCalledWith(ORG, JOB);
      expect(job.phase).toBe("canceled");
    });

    it("answers a finished build as it is", async () => {
      builds.latest.mockResolvedValue(view({ status: "failed", runner_id: RUNNER, exit_code: 1 }));

      const { job } = await service.cancel(RUN, JOB, { idempotencyKey: "k" });

      expect(jobs.cancel).not.toHaveBeenCalled();
      expect(job.exitCode).toBe(1);
    });

    it("is fenced like every engine write", async () => {
      builds.lockRun.mockResolvedValue(run({ exec_epoch: 9 }));

      expect(
        (await refusal(service.cancel(RUN, JOB, { idempotencyKey: "k", epoch: 3 }))).code,
      ).toBe("fenced");
      expect(jobs.cancel).not.toHaveBeenCalled();
    });
  });
});
