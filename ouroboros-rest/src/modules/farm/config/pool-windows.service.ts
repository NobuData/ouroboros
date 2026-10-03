/**
 * Time-windowed pool assignment — the farm's own API for *"forge-02 joins pool-a between
 * 14:00–16:00 UTC on weekdays"* (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514);
 * the amendment to AH.1 [#249](https://github.com/NobuData/ouroboros/issues/249)).
 *
 * V040 declared `runner_pool_windows` and dispatch (AH.4, #252) already honours it: a runner is a
 * candidate for a pool's jobs when it is that pool's, or when one of its enabled windows on that
 * pool is open at the instant of the offer. This service is the writer the table lacked. The Build
 * Analyzer's pool-move apply composes it rather than writing the table itself (decision A4).
 *
 * **Adding is idempotent.** A window with the same runner, pool and times is the same window
 * (`runner_pool_windows_unique`), so a retried apply answers the one already there and records
 * nothing new.
 */

import { Injectable } from "@nestjs/common";

import { FarmAudit } from "../farm.audit";
import {
  poolNotFound,
  poolWindowNotFound,
  poolWindowUnordered,
  runnerNotFound,
} from "../farm.errors";
import type { CreatePoolWindowBody } from "./farm-config.dto";
import { FarmConfigRepository } from "./farm-config.repository";
import { poolWindowResource, type PoolWindowResource } from "./farm-config.resources";

/** A pool window and whether this call created it. */
export interface PoolWindowWrite {
  window: PoolWindowResource;
  created: boolean;
}

@Injectable()
export class PoolWindowsService {
  /**
   * @param repository - The statements.
   * @param audit - The farm's trail.
   */
  constructor(
    private readonly repository: FarmConfigRepository,
    private readonly audit: FarmAudit,
  ) {}

  /**
   * The workspace's pool windows.
   *
   * @param organizationId - The workspace.
   * @returns The windows, newest first.
   */
  async list(organizationId: string): Promise<PoolWindowResource[]> {
    return (await this.repository.windows(organizationId)).map(poolWindowResource);
  }

  /**
   * Give a runner a window in a pool.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @param request - The runner and pool by name, the days and the times.
   * @returns The window and whether it is new; an existing identical window is answered as is.
   * @throws {NotFoundError} `farm_runner_not_found` / `farm_pool_not_found`.
   * @throws {InvalidRequestError} `farm_pool_window_unordered` when it does not end after it starts.
   */
  async add(
    organizationId: string,
    actorId: string,
    request: CreatePoolWindowBody,
  ): Promise<PoolWindowWrite> {
    if (request.endsAt <= request.startsAt) {
      throw poolWindowUnordered(request.startsAt, request.endsAt);
    }
    const runner = await this.repository.runnerByName(organizationId, request.runner);
    if (runner === undefined) throw runnerNotFound();
    const pool = await this.repository.poolByName(organizationId, request.pool);
    if (pool === undefined) throw poolNotFound(request.pool);

    const daysOfWeek = [...request.daysOfWeek].sort((a, b) => a - b);
    const { id, created } = await this.repository.insertWindow({
      organizationId,
      runnerId: runner.id,
      poolId: pool.id,
      daysOfWeek,
      startsAt: request.startsAt,
      endsAt: request.endsAt,
      createdBy: actorId,
    });

    if (created) {
      await this.audit.poolWindowAdded(
        { organizationId, actorId, at: new Date() },
        {
          id,
          runner: runner.name,
          pool: pool.name,
          daysOfWeek,
          startsAt: request.startsAt,
          endsAt: request.endsAt,
        },
      );
    }

    return { window: await this.read(organizationId, id), created };
  }

  /**
   * Remove a window — the reversal of {@link add}.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @param id - The window.
   * @throws {NotFoundError} `farm_pool_window_not_found`.
   */
  async remove(organizationId: string, actorId: string, id: string): Promise<void> {
    const window = await this.repository.window(organizationId, id);
    if (window === undefined || !(await this.repository.deleteWindow(organizationId, id))) {
      throw poolWindowNotFound();
    }

    await this.audit.poolWindowRemoved(
      { organizationId, actorId, at: new Date() },
      { id, runner: window.runner, pool: window.pool },
    );
  }

  /**
   * One window.
   *
   * @param organizationId - The workspace.
   * @param id - The window.
   * @returns The resource.
   * @throws {NotFoundError} `farm_pool_window_not_found`.
   */
  async read(organizationId: string, id: string): Promise<PoolWindowResource> {
    const row = await this.repository.window(organizationId, id);
    if (row === undefined) throw poolWindowNotFound();
    return poolWindowResource(row);
  }
}
