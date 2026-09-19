/**
 * Submitting and cancelling build jobs — the route's surface, and the internal one AJ.3 will use.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). Two ways in, one path:
 *
 * ```
 * POST /api/v1/farm/jobs  (member+, B6: user- and API-submitted) ─┐
 *                                                                 ├─▶ enqueue ─▶ queued ─▶ kick dispatch
 * submitForRun(org, runId, …)  (AJ.3's workflow build stage)     ─┘
 * ```
 *
 * ---------------------------------------------------------------------------
 * **{@link FarmJobsService.submitForRun} is the internal submission surface, defined and not
 * wired** — decision **B6**. MVP builds are submitted by people and by the API; a workflow's build
 * stage (AJ.3, [#265](https://github.com/NobuData/ouroboros/issues/265)) will submit them too, and
 * this is the entry point it calls rather than a second dispatch path. It takes the same request
 * as the route, plus the loop run the build belongs to, which it writes to `build_jobs.run_id` —
 * V040's composite key then refuses a run of any other workspace. Nothing calls it yet; the module
 * exports it for AJ.3, and `jobs.service.spec.ts` holds it to the same rules as the route.
 *
 * **What a submission snapshots.** The pool's executor and image, and the command — the
 * request's, or the pool's `default_command` (V043) — are copied onto the job, so a pool edited
 * after a build was submitted does not change what that build runs. The workspace is always the
 * caller's: the route's is the session's, and AJ.3's is the run's.
 *
 * **Cancellation is final and immediate.** The row is `canceled` the moment the request commits;
 * the runner holding it is then told (`job.cancel`), and the finish it sends back changes
 * nothing, because the ledger only applies a finish to a job that has not already ended.
 */

import { Inject, Injectable } from "@nestjs/common";

import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import {
  commandRequired,
  jobNotCancellable,
  jobNotFound,
  poolDisabled,
  poolNotFound,
  repositoryNotFound,
} from "../farm.errors";
import { parseCommand, renderCommand } from "./command";
import { DispatchRepository } from "./dispatch.repository";
import { DispatchService } from "./dispatcher";
import { JobCompletions } from "./job.completions";
import type { BuildJobRequest } from "./jobs.dto";
import { buildJobResource, type BuildJobResource } from "./jobs.resources";

@Injectable()
export class FarmJobsService {
  /**
   * @param repository - Every statement dispatch issues.
   * @param dispatcher - Kicked after a submission, and told of a cancellation to propagate.
   * @param completions - Where a cancellation is announced as a completion (#510's seam).
   * @param now - The gateway's clock.
   */
  constructor(
    private readonly repository: DispatchRepository,
    private readonly dispatcher: DispatchService,
    private readonly completions: JobCompletions,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /**
   * Submit a build — the route's entry point.
   *
   * @param organizationId - The workspace, from the session.
   * @param request - The pool, repository, ref, commit and command.
   * @returns The job, `queued`. Dispatch has been kicked and may already have offered it.
   * @throws {NotFoundError} `farm_pool_not_found` or `farm_repository_not_found`.
   * @throws {ConflictError} `farm_pool_disabled`.
   * @throws {InvalidRequestError} `farm_command_required`.
   */
  submit(organizationId: string, request: BuildJobRequest): Promise<BuildJobResource> {
    return this.enqueue(organizationId, request, null);
  }

  /**
   * Submit a build on behalf of a loop run — **the internal surface AJ.3
   * ([#265](https://github.com/NobuData/ouroboros/issues/265)) will call**. Defined, documented
   * and not wired: see this file's header.
   *
   * @param organizationId - The run's workspace.
   * @param runId - The run the build belongs to, written to `build_jobs.run_id`.
   * @param request - As {@link submit}.
   * @returns The job, `queued`.
   * @throws As {@link submit}.
   */
  submitForRun(
    organizationId: string,
    runId: string,
    request: BuildJobRequest,
  ): Promise<BuildJobResource> {
    return this.enqueue(organizationId, request, runId);
  }

  /**
   * Cancel a build job, and tell its runner.
   *
   * @param organizationId - The workspace, from the session.
   * @param jobId - The job.
   * @returns The job, `canceled`.
   * @throws {NotFoundError} `farm_job_not_found` — including for another workspace's job.
   * @throws {ConflictError} `farm_job_not_cancellable` when it has already finished.
   */
  async cancel(organizationId: string, jobId: string): Promise<BuildJobResource> {
    const outcome = await this.repository.cancel(organizationId, jobId, this.now());

    if (outcome.kind === "not_found") throw jobNotFound();
    if (outcome.kind === "terminal") throw jobNotCancellable(outcome.job.status);

    if (outcome.heldBy) this.dispatcher.propagateCancel(organizationId, outcome.heldBy, jobId);
    this.completions.emit({ organizationId, jobId, status: "canceled" });
    void this.dispatcher.kick();

    return this.resource(organizationId, jobId);
  }

  /**
   * A runner's queue depth — accepted and not started, the agent's own `q:N` — for AH.6's read
   * APIs ([#254](https://github.com/NobuData/ouroboros/issues/254)).
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns The depth.
   */
  queueDepth(organizationId: string, runnerId: string): Promise<number> {
    return this.repository.queueDepth(organizationId, runnerId);
  }

  /**
   * The one path both entry points share.
   *
   * @param organizationId - The workspace.
   * @param request - What to build.
   * @param runId - The loop run, or null for a user- or API-submitted build.
   * @returns The job.
   */
  private async enqueue(
    organizationId: string,
    request: BuildJobRequest,
    runId: string | null,
  ): Promise<BuildJobResource> {
    const pool = await this.repository.pool(organizationId, request.pool);
    if (!pool) throw poolNotFound(request.pool);
    if (!pool.enabled) throw poolDisabled(pool.name);

    const [owner, name] = request.repository.toLowerCase().split("/");
    const repoId = await this.repository.repository(organizationId, owner, name);
    if (!repoId) throw repositoryNotFound(request.repository);

    const command = request.command
      ? renderCommand(request.command)
      : pool.default_command !== null && parseCommand(pool.default_command)
        ? pool.default_command
        : undefined;
    if (!command) throw commandRequired(pool.name);

    const job = await this.repository.submit({
      organization_id: organizationId,
      pool_id: pool.id,
      run_id: runId,
      github_repo_id: repoId,
      git_ref: request.ref,
      commit_sha: request.commit,
      label: request.label ?? pool.name,
      title: request.title ?? `${owner}/${name} @ ${request.ref}`,
      executor: pool.executor,
      image: pool.executor === "container" ? pool.image : null,
      command,
      env: {},
      queued_at: this.now(),
    });

    void this.dispatcher.kick();

    return this.resource(organizationId, job.id);
  }

  /**
   * A job as the API describes it.
   *
   * @param organizationId - The workspace.
   * @param jobId - The job.
   * @returns The resource.
   */
  private async resource(organizationId: string, jobId: string): Promise<BuildJobResource> {
    const view = await this.repository.view(organizationId, jobId);
    if (!view) throw jobNotFound();

    return buildJobResource(view);
  }
}
