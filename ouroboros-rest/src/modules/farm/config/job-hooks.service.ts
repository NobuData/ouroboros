/**
 * Farm job hooks — a job the farm submits when a pull request merges into a repository (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514)). *"Re-warm ccache right after
 * deps-refresh merges"* is a hook on `merge` whose title filter is `deps-refresh`.
 *
 * ```
 * register ─▶ farm_job_hooks (idempotent on its identity) ─▶ audited, never the command
 * PR sync ─▶ newly merged ─▶ FARM_MERGE_OBSERVER.mergeObserved ─▶ every matching hook
 *                                     └─▶ FarmJobsService.submitForHook (audited, no actor)
 * ```
 *
 * **What a fired hook builds.** The merged PR's repository — by the loop run that opened it, or
 * else by the `owner/name` in its host URL — at its base branch, on the newest revision's head
 * commit: the commit the merge brought in. The mirror does not record the merge commit itself, and
 * for a re-warm the merged content is what matters. A PR whose repository or commit cannot be
 * resolved fires nothing, and says so in the log.
 *
 * **A failing hook costs only itself.** Each submission is tried on its own; one refused (a
 * disabled pool, say) is logged and the others still go.
 */

import { Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import { parseCommand, renderCommand } from "../dispatch/command";
import { FarmJobsService } from "../dispatch/jobs.service";
import { FarmAudit } from "../farm.audit";
import { jobHookNotFound, poolNotFound, repositoryNotFound } from "../farm.errors";
import type { CreateJobHookBody } from "./farm-config.dto";
import { FarmConfigRepository, type MergedPullRequest } from "./farm-config.repository";
import { jobHookResource, type JobHookResource } from "./farm-config.resources";
import type { FarmMergeObserver } from "./merge.observer";

/** A job hook and whether this call created it. */
export interface JobHookWrite {
  hook: JobHookResource;
  created: boolean;
}

/** A full commit sha, as a build submission requires. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

/**
 * The `owner/name` a host URL names — `https://github.com/acme/helios/pull/12` → `acme/helios`.
 *
 * @param url - The PR's page on its host.
 * @returns `owner/name`, or `undefined` when the path does not start with two segments.
 */
export function repositoryFromUrl(url: string): string | undefined {
  try {
    const [owner, name] = new URL(url).pathname.split("/").filter((part) => part !== "");
    return owner !== undefined && name !== undefined ? `${owner}/${name}` : undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class JobHooksService implements FarmMergeObserver {
  private readonly logger = new Logger(JobHooksService.name);

  /**
   * @param repository - The statements.
   * @param jobs - Dispatch's submission, which a fired hook goes through like any other build.
   * @param audit - The farm's trail.
   */
  constructor(
    private readonly repository: FarmConfigRepository,
    private readonly jobs: FarmJobsService,
    private readonly audit: FarmAudit,
  ) {}

  /**
   * The workspace's job hooks.
   *
   * @param organizationId - The workspace.
   * @returns The hooks, newest first.
   */
  async list(organizationId: string): Promise<JobHookResource[]> {
    return (await this.repository.hooks(organizationId)).map(jobHookResource);
  }

  /**
   * Register a job hook.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @param request - The repository, pool, event, title filter and job.
   * @returns The hook and whether it is new; an identical hook is answered as is.
   * @throws {NotFoundError} `farm_repository_not_found` / `farm_pool_not_found`.
   */
  async register(
    organizationId: string,
    actorId: string,
    request: CreateJobHookBody,
  ): Promise<JobHookWrite> {
    const repo = await this.repository.repositoryByRef(organizationId, request.repo);
    if (repo === undefined) throw repositoryNotFound(request.repo);
    const pool = await this.repository.poolByName(organizationId, request.pool);
    if (pool === undefined) throw poolNotFound(request.pool);

    const titleContains = request.titleContains?.trim() ?? null;
    const { id, created } = await this.repository.insertHook({
      organizationId,
      githubRepoId: repo.id,
      poolId: pool.id,
      titleContains,
      label: request.label.trim(),
      title: request.title.trim(),
      command: renderCommand(request.command),
      createdBy: actorId,
    });

    if (created) {
      await this.audit.jobHookRegistered(
        { organizationId, actorId, at: new Date() },
        { id, repository: repo.repository, pool: pool.name, event: request.event, titleContains },
      );
    }

    return { hook: await this.read(organizationId, id), created };
  }

  /**
   * Remove a hook — the reversal of {@link register}.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @param id - The hook.
   * @throws {NotFoundError} `farm_job_hook_not_found`.
   */
  async remove(organizationId: string, actorId: string, id: string): Promise<void> {
    const hook = await this.repository.hook(organizationId, id);
    if (hook === undefined || !(await this.repository.deleteHook(organizationId, id))) {
      throw jobHookNotFound();
    }

    await this.audit.jobHookRemoved(
      { organizationId, actorId, at: new Date() },
      { id, repository: hook.repository, pool: hook.pool },
    );
  }

  /**
   * One hook.
   *
   * @param organizationId - The workspace.
   * @param id - The hook.
   * @returns The resource.
   * @throws {NotFoundError} `farm_job_hook_not_found`.
   */
  async read(organizationId: string, id: string): Promise<JobHookResource> {
    const row = await this.repository.hook(organizationId, id);
    if (row === undefined) throw jobHookNotFound();
    return jobHookResource(row);
  }

  /**
   * A PR merged: submit every hook it fires. See the file header for what a fired hook builds.
   *
   * @param organizationId - The workspace.
   * @param prId - `pull_requests.id`.
   * @returns When every matching hook's job is submitted or its refusal logged.
   */
  async mergeObserved(organizationId: string, prId: string): Promise<void> {
    const pr = await this.repository.mergedPullRequest(organizationId, prId);
    if (pr === undefined) return;

    const repoId = await this.repositoryOf(organizationId, pr);
    if (repoId === undefined) {
      this.logger.warn(`Merged PR ${prId}: no mirrored repository resolves; no job hook fires.`);
      return;
    }

    const hooks = await this.repository.mergeHooks(organizationId, repoId, pr.title);
    if (hooks.length === 0) return;

    if (pr.head_sha === null || !COMMIT_SHA.test(pr.head_sha)) {
      this.logger.warn(
        `Merged PR ${prId}: the mirror holds no head commit; ${String(hooks.length)} job hook(s) not fired.`,
      );
      return;
    }

    for (const hook of hooks) {
      const command = parseCommand(hook.command);
      try {
        await this.jobs.submitForHook(organizationId, hook.id, {
          pool: hook.pool,
          repository: hook.repository,
          ref: `refs/heads/${pr.base_branch}`,
          commit: pr.head_sha,
          ...(command === undefined ? {} : { command }),
          title: hook.title,
          label: hook.label,
        });
      } catch (error) {
        this.logger.error(
          `Job hook ${hook.id} for merged PR ${prId} was not submitted.`,
          describeForLog(error),
        );
      }
    }
  }

  /**
   * The repository a merged PR went into.
   *
   * @param organizationId - The workspace.
   * @param pr - The PR.
   * @returns The `github_repos.id`, or `undefined`.
   */
  private async repositoryOf(
    organizationId: string,
    pr: MergedPullRequest,
  ): Promise<string | undefined> {
    if (pr.run_repo_id !== null) return pr.run_repo_id;
    const ref = repositoryFromUrl(pr.external_url);
    return ref === undefined
      ? undefined
      : (await this.repository.repositoryByRef(organizationId, ref))?.id;
  }
}
