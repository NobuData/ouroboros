/**
 * Mockup 08, as one payload.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). The stat row, the runners
 * table, the pools card and the live-build reference, assembled from four statements measured
 * over one set of boundaries.
 *
 * ---------------------------------------------------------------------------
 * **One payload rather than four endpoints, and the reason is consistency rather than
 * round-trips.**
 *
 * The page's figures are claims about each other: *4/5 runners* is a count of the rows in the
 * table beside it, *3 runners* on the pools card is a partition of the same set, and `q:2` on
 * `forge-01` is the same queue the live card's build came out of. Fetched separately those
 * would be four reads of a farm that moves every ten seconds, and a page could render five
 * runners in a table above a card that said four. Assembled here, they are one observation.
 *
 * ---------------------------------------------------------------------------
 * **The clock is the gateway's**, and that is load-bearing rather than tidy. *forge-03 offline
 * · 2h* is `now − last_seen_at`, and `last_seen_at` is written by the gateway's heartbeat
 * handler against `GATEWAY_CLOCK`. Two clocks would make that subtraction a comparison between
 * a time the fleet recorded and a different time this service believed — which is exactly the
 * argument `dispatch/dispatcher.ts` makes for sharing it with the lost-runner cutoff.
 */

import { Inject, Injectable } from "@nestjs/common";

import type { Runner } from "../../db/schema";
import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import { farmWindows } from "./fleet.policy";
import { FleetRepository } from "./fleet.repository";
import {
  liveBuildResource,
  poolResource,
  runnerResource,
  type FarmResource,
  type PoolResource,
  type RunnerResource,
} from "./fleet.resources";
import { farmStats } from "./fleet.stats";

/** The fleet, in the two forms one read of the page needs it in. */
interface FleetView {
  /** What the runners table renders. */
  readonly resources: RunnerResource[];
  /** The same machines as rows, which is what the stat row's fraction counts. */
  readonly rows: Runner[];
}

@Injectable()
export class FleetService {
  /**
   * @param fleet - Every statement the page issues.
   * @param now - The gateway's clock — see this file's header.
   */
  constructor(
    private readonly fleet: FleetRepository,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /**
   * The whole page.
   *
   * The four reads run **concurrently**: they are independent of each other, and the windows
   * they are measured over were fixed before any of them started, so overlapping them cannot
   * make the payload disagree with itself. What it can do is halve the page's latency on a
   * surface a workspace leaves open and polls.
   *
   * @param organizationId - The workspace, from the tenant context. Never from the request.
   * @returns The stat row, the fleet, the pools and the live build.
   */
  async page(organizationId: string): Promise<FarmResource> {
    const windows = farmWindows(this.now());

    const [runners, pools, aggregates, live] = await Promise.all([
      this.runners(organizationId),
      this.pools(organizationId),
      this.fleet.aggregates(organizationId, windows),
      this.fleet.liveBuild(organizationId),
    ]);

    return {
      stats: farmStats({
        // The rows the table renders, not a second count of them. A workspace whose fleet
        // changed between two statements would otherwise get a fraction whose denominator
        // disagreed with the list underneath it.
        runners: runners.rows,
        outcomes: aggregates.outcomes,
        today: aggregates.today,
        prior: aggregates.prior,
        cache: aggregates.cache,
        since: windows.dayStart.toISOString(),
        timeZone: windows.timeZone,
        now: windows.now,
      }),
      runners: runners.resources,
      pools,
      live: live ? liveBuildResource(live.job, live.runner) : null,
    };
  }

  /**
   * The fleet, with each runner's queue depth and current build.
   *
   * @param organizationId - The workspace.
   * @returns The resources the table renders, and the rows the stat row counts — the same
   *   machines, returned together so the two can never be taken from different reads.
   */
  private async runners(organizationId: string): Promise<FleetView> {
    const [rows, depths, current] = await Promise.all([
      this.fleet.runners(organizationId),
      this.fleet.queueDepths(organizationId),
      this.fleet.currentJobs(organizationId),
    ]);

    return {
      resources: rows.map((row) =>
        runnerResource({
          runner: row.runner,
          poolName: row.poolName,
          // Absent from the map means nothing is waiting — `queueDepths` returns a `group by`,
          // which has no row for a runner with an empty queue.
          queueDepth: depths.get(row.runner.id) ?? 0,
          currentJob: current.get(row.runner.id),
        }),
      ),
      rows: rows.map((row) => row.runner),
    };
  }

  /**
   * The pools, with their runner counts.
   *
   * @param organizationId - The workspace.
   * @returns The resources.
   */
  private async pools(organizationId: string): Promise<PoolResource[]> {
    const rows = await this.fleet.pools(organizationId);

    return rows.map(poolResource);
  }
}
