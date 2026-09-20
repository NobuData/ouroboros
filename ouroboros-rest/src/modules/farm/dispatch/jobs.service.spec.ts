import { Logger } from "@nestjs/common";

import type { AuditRecord } from "../../audit/audit.events";
import type { AuditService } from "../../audit/audit.service";
import { FarmAudit } from "../farm.audit";
import { drain } from "../gateway/gateway.fixture";
import { COMMIT, JOB, ORG, RUNNER, buildJob, jobView, runnerPool } from "./dispatch.fixture";
import type { DispatchRepository, JobSubmission } from "./dispatch.repository";
import type { DispatchService } from "./dispatcher";
import { JobCompletions, type JobCompleted } from "./job.completions";
import type { BuildJobRequest } from "./jobs.dto";
import { FarmJobsService } from "./jobs.service";

/**
 * Submission and cancellation (#252) — what a request becomes, which refusals it can meet, and
 * that the internal surface AJ.3 will call (#265) is held to exactly the same rules.
 */

const REQUEST: BuildJobRequest = {
  pool: "pool-a",
  repository: "Acme-Robotics/Helios-Firmware",
  ref: "refs/heads/main",
  commit: COMMIT,
};

const NOW = new Date("2026-09-19T12:00:00.000Z");

/** Who is submitting, as the controller reads them off the session. */
const ACTOR = "user_ken";

/** A caught throw, for asserting on its code. */
async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("build job submission and cancellation", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  let repository: jest.Mocked<
    Pick<DispatchRepository, "pool" | "repository" | "submit" | "cancel" | "view" | "queueDepth">
  >;
  let dispatcher: jest.Mocked<Pick<DispatchService, "kick" | "propagateCancel">>;
  let completed: JobCompleted[];
  let trail: AuditRecord[];
  let record: jest.Mock<Promise<string>, [AuditRecord]>;
  let jobs: FarmJobsService;

  beforeEach(() => {
    repository = {
      pool: jest.fn().mockResolvedValue(runnerPool()),
      repository: jest.fn().mockResolvedValue("7f000003-0000-4000-8000-000000000001"),
      submit: jest
        .fn()
        .mockImplementation((submission: JobSubmission) =>
          Promise.resolve(buildJob({ ...submission, id: JOB, number: 483 })),
        ),
      cancel: jest.fn(),
      view: jest.fn().mockResolvedValue(jobView()),
      queueDepth: jest.fn().mockResolvedValue(2),
    };
    dispatcher = { kick: jest.fn().mockResolvedValue(undefined), propagateCancel: jest.fn() };
    const completions = new JobCompletions();
    completed = [];
    completions.subscribe((event) => {
      completed.push(event);
    });
    trail = [];
    record = jest.fn((event: AuditRecord) => {
      trail.push(event);

      return Promise.resolve("event");
    });
    jobs = new FarmJobsService(
      repository as unknown as DispatchRepository,
      dispatcher as unknown as DispatchService,
      completions,
      new FarmAudit({ record } as unknown as AuditService),
      () => NOW,
    );
  });

  /** What the last submission wrote. */
  function written(): JobSubmission {
    return repository.submit.mock.calls[0][0];
  }

  describe("submitting", () => {
    it("queues a build with the pool's snapshot and default command, then kicks dispatch", async () => {
      const resource = await jobs.submit(ORG, ACTOR, REQUEST);

      expect(repository.pool).toHaveBeenCalledWith(ORG, "pool-a");
      expect(repository.repository).toHaveBeenCalledWith(ORG, "acme-robotics", "helios-firmware");
      expect(written()).toEqual({
        organization_id: ORG,
        pool_id: "7f000001-0000-4000-8000-000000000001",
        run_id: null,
        github_repo_id: "7f000003-0000-4000-8000-000000000001",
        git_ref: "refs/heads/main",
        commit_sha: COMMIT,
        label: "pool-a",
        title: "acme-robotics/helios-firmware @ refs/heads/main",
        executor: "container",
        image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
        command: "west build -b helios_mainboard app",
        env: {},
        queued_at: NOW,
      });
      expect(dispatcher.kick).toHaveBeenCalledTimes(1);
      expect(resource.id).toBe(JOB);
    });

    it("stores a named command as its canonical rendering, and keeps a title and label", async () => {
      await jobs.submit(ORG, ACTOR, {
        ...REQUEST,
        command: ["sh", "-c", "west build -p always"],
        title: "Pristine build",
        label: "zephyr build",
      });

      expect(written()).toMatchObject({
        command: "sh -c 'west build -p always'",
        title: "Pristine build",
        label: "zephyr build",
      });
    });

    it("snapshots no image onto a shell pool's build", async () => {
      repository.pool.mockResolvedValue(
        runnerPool({ name: "pool-b", executor: "shell", image: null, default_command: null }),
      );

      await jobs.submit(ORG, ACTOR, { ...REQUEST, pool: "pool-b", command: ["make", "hil-sweep"] });

      expect(written()).toMatchObject({ executor: "shell", image: null });
    });

    it.each([
      [
        "a pool the workspace does not have",
        "farm_pool_not_found",
        () => repository.pool.mockResolvedValue(undefined),
      ],
      [
        "a pool an operator switched off",
        "farm_pool_disabled",
        () => repository.pool.mockResolvedValue(runnerPool({ enabled: false })),
      ],
      [
        "a repository the workspace does not mirror",
        "farm_repository_not_found",
        () => repository.repository.mockResolvedValue(undefined),
      ],
      [
        "no command and no pool default",
        "farm_command_required",
        () => repository.pool.mockResolvedValue(runnerPool({ default_command: null })),
      ],
      [
        "no command and a pool default that is not argv",
        "farm_command_required",
        () => repository.pool.mockResolvedValue(runnerPool({ default_command: 'sh -c "x"' })),
      ],
    ])("refuses %s, and queues nothing", async (_, code, arrange) => {
      arrange();

      expect(await refusal(jobs.submit(ORG, ACTOR, REQUEST))).toMatchObject({ code });
      expect(repository.submit).not.toHaveBeenCalled();
      expect(dispatcher.kick).not.toHaveBeenCalled();
      // The trail is of builds that were submitted, not of attempts.
      expect(trail).toEqual([]);
    });
  });

  describe("who submitted it (#260)", () => {
    it("records the build, the person and the exact commit", async () => {
      await jobs.submit(ORG, ACTOR, REQUEST);

      expect(trail).toEqual([
        {
          organizationId: ORG,
          actorId: ACTOR,
          action: "runner.job_submitted",
          subjectType: "build_job",
          subjectId: JOB,
          at: NOW,
          detail: {
            number: 483,
            pool: "pool-a",
            // As stored — lower-cased — so one repository is one spelling in the trail.
            repository: "acme-robotics/helios-firmware",
            ref: "refs/heads/main",
            commit: COMMIT,
          },
        },
      ]);
    });

    it("never records the command", async () => {
      // A token pasted onto a command line is the likeliest secret a submission carries.
      await jobs.submit(ORG, ACTOR, {
        ...REQUEST,
        command: ["sh", "-c", "curl -H 'Authorization: Bearer hunter2' https://example.test"],
      });

      expect(JSON.stringify(trail)).not.toContain("hunter2");
    });

    it("records before dispatch is kicked, and a failure to record fails the submission", async () => {
      // `farm.audit.ts`'s rule: a farm operation that cannot be recorded did not succeed.
      // Nothing is offered to a runner on the strength of a build nobody can be asked about.
      record.mockRejectedValueOnce(new Error("audit store unavailable"));

      await expect(jobs.submit(ORG, ACTOR, REQUEST)).rejects.toThrow("audit store unavailable");
      expect(dispatcher.kick).not.toHaveBeenCalled();
    });

    it("names the run and no person when a run submitted it", async () => {
      await jobs.submitForRun(ORG, "7f000009-0000-4000-8000-000000000001", REQUEST);

      expect(trail[0]).toMatchObject({
        actorId: null,
        action: "runner.job_submitted",
        detail: { runId: "7f000009-0000-4000-8000-000000000001" },
      });
    });
  });

  describe("the internal surface for AJ.3 (#265)", () => {
    it("queues the same build, linked to the loop run that asked for it", async () => {
      await jobs.submitForRun(ORG, "7f000009-0000-4000-8000-000000000001", REQUEST);

      expect(written()).toMatchObject({
        organization_id: ORG,
        run_id: "7f000009-0000-4000-8000-000000000001",
        command: "west build -b helios_mainboard app",
      });
      expect(dispatcher.kick).toHaveBeenCalledTimes(1);
    });

    it("is held to the route's refusals", async () => {
      repository.pool.mockResolvedValue(runnerPool({ enabled: false }));

      expect(
        await refusal(jobs.submitForRun(ORG, "7f000009-0000-4000-8000-000000000001", REQUEST)),
      ).toMatchObject({ code: "farm_pool_disabled" });
    });
  });

  describe("cancelling", () => {
    it("cancels a running job, tells its runner, and announces the completion", async () => {
      repository.cancel.mockResolvedValue({
        kind: "canceled",
        job: buildJob({ status: "canceled", runner_id: RUNNER }),
        heldBy: RUNNER,
      });
      repository.view.mockResolvedValue(jobView({ status: "canceled", runner_id: RUNNER }));

      const resource = await jobs.cancel(ORG, JOB);
      await drain();

      expect(repository.cancel).toHaveBeenCalledWith(ORG, JOB, NOW);
      expect(dispatcher.propagateCancel).toHaveBeenCalledWith(ORG, RUNNER, JOB);
      expect(completed).toEqual([{ organizationId: ORG, jobId: JOB, status: "canceled" }]);
      expect(resource.status).toBe("canceled");
    });

    it("cancels a waiting job without telling any runner", async () => {
      repository.cancel.mockResolvedValue({
        kind: "canceled",
        job: buildJob({ status: "canceled" }),
        heldBy: null,
      });

      await jobs.cancel(ORG, JOB);

      expect(dispatcher.propagateCancel).not.toHaveBeenCalled();
    });

    it("answers 404 for a job this workspace does not have — another workspace's included", async () => {
      repository.cancel.mockResolvedValue({ kind: "not_found" });

      expect(await refusal(jobs.cancel(ORG, JOB))).toMatchObject({
        code: "farm_job_not_found",
        status: 404,
      });
    });

    it("answers 409 for a job that has already finished, naming how", async () => {
      repository.cancel.mockResolvedValue({
        kind: "terminal",
        job: buildJob({ status: "succeeded" }),
      });

      expect(await refusal(jobs.cancel(ORG, JOB))).toMatchObject({
        code: "farm_job_not_cancellable",
        status: 409,
        details: { status: "succeeded" },
      });
      expect(dispatcher.propagateCancel).not.toHaveBeenCalled();
    });
  });

  it("answers a runner's queue depth for AH.6 (#254)", async () => {
    expect(await jobs.queueDepth(ORG, RUNNER)).toBe(2);
    expect(repository.queueDepth).toHaveBeenCalledWith(ORG, RUNNER);
  });
});
