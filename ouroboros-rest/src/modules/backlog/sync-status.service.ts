/**
 * `SyncStatusService` — the three reads behind one honest answer.
 *
 * M.4 ([#113](https://github.com/NobuData/ouroboros/issues/113)). This file fetches; the rule
 * that turns what it fetched into a state lives in `sync.resources.ts`, which is pure and
 * therefore testable without any of it.
 *
 * **It reads the same objects the sync itself uses**, and that is the point rather than a
 * convenience. `GithubRateLimiter` is exported by `github.module.ts` precisely *"so that a
 * caller reporting a paused state reads the same budget the client enforces rather than a
 * second opinion about it"*; `BacklogSyncService.lastCycle()` is the report K.4 kept for this
 * endpoint. A status endpoint that computed its own view of either would be a screen that
 * disagrees with the loop it describes.
 */

import { Injectable } from "@nestjs/common";

import { BacklogSyncRepository } from "../backlog-sync/backlog-sync.repository";
import { BacklogSyncScheduler } from "../backlog-sync/backlog-sync.scheduler";
import { BacklogSyncService } from "../backlog-sync/backlog-sync.service";
import { GithubCredentialsService } from "../github/github.credentials.service";
import { GithubRateLimiter } from "../github/github.rate-limit";
import { syncStatus, type SyncStatusResource } from "./sync.resources";

@Injectable()
export class SyncStatusService {
  /**
   * @param repositories - The durable half: which repositories are enabled, and what the last
   *   poll of each wrote.
   * @param credentials - Whether the workspace has a token at all. Asked rather than inferred
   *   from a failure, so `not_configured` is right on a process that has polled nothing.
   * @param limiter - The rate guard, for the one pause that says when it ends.
   * @param sync - The cycle, for the pause reasons only an attempt can establish.
   * @param scheduler - The loop, for whether one is running right now.
   */
  constructor(
    private readonly repositories: BacklogSyncRepository,
    private readonly credentials: GithubCredentialsService,
    private readonly limiter: GithubRateLimiter,
    private readonly sync: BacklogSyncService,
    private readonly scheduler: BacklogSyncScheduler,
  ) {}

  /**
   * One workspace's sync status.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param now - The clock, injectable so a test does not have to wait out a rate-limit
   *   window. Only the rate guard reads it; every other field is a stored value or a report.
   * @returns The status. Never a `404` and never empty: a workspace that has configured
   *   nothing has a state to render, which is the whole reason the pause vocabulary exists.
   */
  async status(organizationId: string, now: Date = new Date()): Promise<SyncStatusResource> {
    const [targets, configured] = await Promise.all([
      this.repositories.enabledRepositoriesFor(organizationId),
      this.credentials.isConfigured(organizationId),
    ]);

    return syncStatus({
      organizationId,
      targets,
      configured,
      retryAfterSeconds: this.limiter.retryAfterSeconds(organizationId, now),
      last: this.sync.lastCycle(),
      running: this.scheduler.running(),
    });
  }
}
