/**
 * A run's build stage on the farm — the control plane's half of AJ.3
 * ([#265](https://github.com/NobuData/ouroboros/issues/265)), the seam decision B6 left.
 *
 * ```
 * POST /internal/runs/:id/builds                  {idempotencyKey, epoch?, stageKey, attempt,
 *   → {job}                                         pool, commit, command?}
 *   404 run_not_found · 404 repository_not_found · 404 farm_pool_not_found
 *   409 fenced · 409 run_not_executable · 409 run_branch_missing · 409 farm_pool_disabled
 *   409 build_no_eligible_runner · 422 farm_command_required
 * GET  /internal/runs/:id/builds/:jobId
 *   → {job}                                         404 run_not_found · 404 run_build_not_found
 * POST /internal/runs/:id/builds/:jobId/cancel    {idempotencyKey, epoch?, reason?}
 *   → {job}                                         404 … · 409 fenced
 * ```
 *
 * **One dispatch path.** The submission goes through `FarmJobsService.submitForRun` — the farm's
 * own rules, audit row and dispatch kick — with the run's repository, the run's branch
 * (`refs/heads/<runs.branch_name>`) and the commit the engine pushed there. The engine names the
 * pool, the command and the commit; it cannot name a repository or a workspace. The workspace is
 * the run's, and V040's composite key refuses a run of any other.
 *
 * **One job per stage attempt.** `(run, stage, attempt)` is unique over first submissions (V152),
 * so a resent submission answers the job it already created instead of building twice.
 *
 * **A build no runner can take is refused, not left to wait.** When the submitted job is
 * `queued_no_eligible_runner` — every runner of the pool offline, drained, full, or without its
 * executor — it is cancelled at once and the stage is answered `409 build_no_eligible_runner`,
 * a sentence the engine ends the stage with. A job that later waits with no eligible runner is
 * the engine's to give up on (its grace window), through the cancel route.
 *
 * **The run is `building` while its build is live.** A submission reserves the job
 * (`runs.reserved_build_job_id`, the console's Resources card) and moves a `coding` run to
 * `building`; `run-builds.status.ts` moves it back when the job completes. The dashboard's
 * `building` is a real job on a real runner from here on.
 *
 * **Reads follow the retry chain.** An infrastructure failure retries the job as a new row
 * (`retry_of`); the engine keeps the id the submission answered and is always told about the
 * latest attempt.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { Run } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import { FARM_ERRORS } from "../farm/farm.errors";
import { FarmJobsService } from "../farm/dispatch/jobs.service";
import { isTerminal, phaseOf } from "../farm/dispatch/job.states";
import { repositoryNotFound, runNotFound } from "../ingest/ingest.errors";
import { assertEpoch } from "../ingest/ingest.fence";
import { assertExecutable } from "../ingest/run-push.service";
import { violatesConstraint } from "../tenancy/constraints";
import type { CancelRunBuildDto, SubmitRunBuildDto } from "./run-builds.dto";
import { noEligibleRunner, runBranchMissing, runBuildNotFound } from "./run-builds.errors";
import { RunBuildsRepository } from "./run-builds.repository";
import { runBuildResource, type RunBuildResource, type RunBuildView } from "./run-builds.resources";

/** V152's unique index — a second first-submission of one stage attempt. */
const STAGE_KEY_INDEX = "build_jobs_run_stage_key";

/** What every build route answers. */
export interface RunBuildAnswer {
  readonly job: RunBuildResource;
}

/** What a submission is decided from, under the run's lock. */
type Prepared =
  | { readonly kind: "replay"; readonly run: Run; readonly jobId: string }
  | { readonly kind: "submit"; readonly run: Run; readonly repository: string };

@Injectable()
export class RunBuildsService {
  private readonly logger = new Logger(RunBuildsService.name);

  /**
   * @param builds - The run's side of the linkage.
   * @param jobs - The farm's one dispatch path.
   */
  constructor(
    private readonly builds: RunBuildsRepository,
    private readonly jobs: FarmJobsService,
  ) {}

  /**
   * Submit a build stage's job.
   *
   * @param runId - The run.
   * @param request - The stage and attempt, the pool, the pushed commit and the command.
   * @returns The job, followed to its latest attempt.
   * @throws {NotFoundError} `404 run_not_found`, `404 repository_not_found`,
   *   `404 farm_pool_not_found`.
   * @throws {ConflictError} `409 fenced`, `409 run_not_executable`, `409 run_branch_missing`,
   *   `409 farm_pool_disabled`, `409 build_no_eligible_runner`.
   * @throws {InvalidRequestError} `422 farm_command_required`.
   */
  async submit(runId: string, request: SubmitRunBuildDto): Promise<RunBuildAnswer> {
    const prepared = await this.builds.transaction(async (trx): Promise<Prepared> => {
      const run = await this.builds.lockRun(trx, runId);
      if (run === undefined) throw runNotFound(runId);

      assertEpoch(run, request.epoch);
      assertExecutable(run);

      const existing = await this.builds.stageJob(trx, run, request.stageKey, request.attempt);
      if (existing !== undefined) return { kind: "replay", run, jobId: existing };

      if (run.branch_name === null) throw runBranchMissing(run.id);

      const repository = await this.builds.repositorySlug(trx, run);
      if (repository === undefined) throw repositoryNotFound(run.github_repo_id);

      return { kind: "submit", run, repository };
    });

    const { run } = prepared;
    const jobId =
      prepared.kind === "replay"
        ? prepared.jobId
        : await this.enqueue(run, prepared.repository, request);

    const view = await this.latest(run, jobId);
    const phase = phaseOf(view.job);

    if (prepared.kind === "submit" && phase === "waiting") {
      const { queueState } = await this.jobs.dispatchState(run.organization_id, view.job.id);

      if (queueState === "queued_no_eligible_runner") {
        await this.cancelQuietly(run.organization_id, view.job.id);
        throw noEligibleRunner(view.poolName, view.job.number);
      }
    }

    if (!isTerminal(phase)) {
      await this.builds.transaction(async (trx) => {
        await this.builds.lockRun(trx, run.id);
        await this.builds.reserve(trx, run.id, view.job.id);
      });
    }

    return this.answer(run, view);
  }

  /**
   * Where a run's build is now.
   *
   * @param runId - The run.
   * @param jobId - The job the submission answered, or any later attempt of its chain.
   * @returns The latest attempt.
   * @throws {NotFoundError} `404 run_not_found`, `404 run_build_not_found` — including for another
   *   run's or another workspace's job.
   */
  async read(runId: string, jobId: string): Promise<RunBuildAnswer> {
    const run = await this.builds.findRun(runId);
    if (run === undefined) throw runNotFound(runId);

    return this.answer(run, await this.latest(run, jobId));
  }

  /**
   * Give up on a run's build — the engine's grace window ran out with no runner to take it, or
   * the stage is being abandoned. A build that has already finished is answered as it is.
   *
   * @param runId - The run.
   * @param jobId - The job, or any attempt of its chain.
   * @param request - The key, the epoch and why.
   * @returns The latest attempt, `canceled` unless it had already finished.
   * @throws {NotFoundError} `404 run_not_found`, `404 run_build_not_found`.
   * @throws {ConflictError} `409 fenced`.
   */
  async cancel(runId: string, jobId: string, request: CancelRunBuildDto): Promise<RunBuildAnswer> {
    const run = await this.builds.transaction(async (trx) => {
      const locked = await this.builds.lockRun(trx, runId);
      if (locked === undefined) throw runNotFound(runId);

      assertEpoch(locked, request.epoch);
      return locked;
    });

    const view = await this.latest(run, jobId);

    if (!isTerminal(phaseOf(view.job))) {
      this.logger.log(
        `Run ${run.id} cancelled build #${String(view.job.number)}: ` +
          `${request.reason ?? "no reason given"}.`,
      );
      await this.cancelQuietly(run.organization_id, view.job.id);
    }

    return this.answer(run, await this.latest(run, jobId));
  }

  /**
   * Submit through the farm's dispatch path, treating a lost race for the stage attempt as the
   * replay it is.
   *
   * @param run - The run, as it was locked.
   * @param repository - Its `owner/name`.
   * @param request - The submission.
   * @returns The job's id.
   */
  private async enqueue(run: Run, repository: string, request: SubmitRunBuildDto): Promise<string> {
    try {
      const job = await this.jobs.submitForRun(
        run.organization_id,
        run.id,
        {
          pool: request.pool,
          repository,
          ref: `refs/heads/${run.branch_name ?? ""}`,
          commit: request.commit,
          ...(request.command === undefined ? {} : { command: request.command }),
          title: run.issue_title.slice(0, 200) || `Run ${run.id} · ${request.stageKey}`,
        },
        { key: request.stageKey, attempt: request.attempt },
      );

      return job.id;
    } catch (error) {
      if (!violatesConstraint(error, STAGE_KEY_INDEX)) throw error;

      const winner = await this.builds.stageJob(undefined, run, request.stageKey, request.attempt);
      if (winner === undefined) throw error;

      return winner;
    }
  }

  /**
   * Cancel a job, accepting that it may have finished in the meantime.
   *
   * @param organizationId - The workspace.
   * @param jobId - The job.
   */
  private async cancelQuietly(organizationId: string, jobId: string): Promise<void> {
    try {
      await this.jobs.cancel(organizationId, jobId);
    } catch (error) {
      if (error instanceof DomainError && error.code === FARM_ERRORS.jobNotCancellable) return;
      throw error;
    }
  }

  /**
   * The latest attempt of a run's build.
   *
   * @param run - The run.
   * @param jobId - Any attempt of the chain.
   * @returns The view.
   * @throws {NotFoundError} `404 run_build_not_found`.
   */
  private async latest(run: Run, jobId: string): Promise<RunBuildView> {
    const view = await this.builds.latest(run, jobId);
    if (view === undefined) throw runBuildNotFound(run.id, jobId);

    return view;
  }

  /**
   * The answer, with a waiting job's queue state read the way dispatch reads it.
   *
   * @param run - The run.
   * @param view - The latest attempt.
   * @returns `{job}`.
   */
  private async answer(run: Run, view: RunBuildView): Promise<RunBuildAnswer> {
    const queueState =
      phaseOf(view.job) === "waiting"
        ? (await this.jobs.dispatchState(run.organization_id, view.job.id)).queueState
        : null;

    return { job: runBuildResource(view, queueState) };
  }
}
