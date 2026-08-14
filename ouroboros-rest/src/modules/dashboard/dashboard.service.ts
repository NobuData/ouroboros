/**
 * The rules of the dashboard surface — what the payload means, and when it has changed.
 *
 * Three, and each is a decision the ticket names:
 *
 *   * **One request, one set of boundaries.** `windows.ts` computes every instant the
 *     payload is measured between, once, and every statement is answered about those. A
 *     service that let each query call the clock would produce a payload whose stat row and
 *     whose pulse card disagreed about where the week started — rarely, and only under load,
 *     which is the worst way for a number to be wrong.
 *   * **The version is read before the payload, never after.** The `ETag` names the state
 *     the body was derived from, so a tag taken *after* the queries could name rows the body
 *     does not contain — and a client would then hold a stale payload under a fresh tag and
 *     never ask again. Taken first, the only possible skew is the harmless one: a body
 *     slightly newer than the tag that names it, which the next poll corrects.
 *   * **The calendar day is part of the version.** Two of the payload's numbers are day
 *     boundary facts — *Token spend · today* and *merged since this morning* — so a cached
 *     representation must not survive midnight even if not a single row was written. Mixing
 *     the day into the tag is what expires it.
 *
 * The queries themselves run concurrently. They are independent reads of one workspace's
 * rows, and issuing them in sequence would make the endpoint's latency the sum of eight
 * round trips rather than the slowest of them.
 */

import { Injectable } from "@nestjs/common";

import { DashboardRepository } from "./dashboard.repository";
import { strongEtag } from "./etag";
import { loopsLive, queueItemSummary, rate, runSummary, type DashboardResource } from "./resources";
import { dashboardWindows, type DashboardWindows } from "./windows";

@Injectable()
export class DashboardService {
  constructor(private readonly dashboard: DashboardRepository) {}

  /**
   * The boundaries this request's numbers are measured between.
   *
   * The clock is read here and in no other method, so a handler holds one `now` for the
   * whole of a request and a test can hand the service a moment instead of racing it.
   *
   * @returns The windows, from the current instant.
   */
  windows(): DashboardWindows {
    return dashboardWindows(new Date());
  }

  /**
   * The entity tag for what this workspace's dashboard currently says.
   *
   * Cheap by construction — four aggregate subqueries and no rows — because this is what a
   * poll that ends in `304` costs, and the dashboard is polled for as long as somebody is
   * looking at it.
   *
   * The workspace id is part of the hash as well as of the query. It changes nothing about
   * correctness, since a tag is only ever compared against one issued for the same URL by
   * the same session, and it costs nothing: what it buys is that two workspaces which happen
   * to hold identically-shaped data cannot produce the same tag, so a caching layer added in
   * front of this service later cannot conflate them.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param windows - This request's boundaries.
   * @returns A strong entity tag, quoted and ready to send.
   */
  async etag(organizationId: string, windows: DashboardWindows): Promise<string> {
    const version = await this.dashboard.version(organizationId);

    return strongEtag([
      organizationId,
      windows.day,
      version.runs,
      version.queueItems,
      version.tokenUsage,
      version.workspaceSettings,
    ]);
  }

  /**
   * The whole dashboard, in one payload.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param windows - This request's boundaries — the same ones {@link DashboardService.etag}
   *   was given, so the tag and the body describe one moment.
   * @returns The resource. Every aggregate is a number and every list is a list: an
   *   organization with nothing in it answers zeros and empty arrays, which is the
   *   acceptance criterion the empty-state work (#86) is built on.
   */
  async read(organizationId: string, windows: DashboardWindows): Promise<DashboardResource> {
    const [runs, active, recent, queue, head, tokens, autoMerge] = await Promise.all([
      this.dashboard.runStatistics(organizationId, windows),
      this.dashboard.activeRuns(organizationId),
      this.dashboard.recentRuns(organizationId),
      this.dashboard.queueTotals(organizationId),
      this.dashboard.queueHead(organizationId),
      this.dashboard.tokenTotals(organizationId, windows.day),
      this.dashboard.autoMerge(organizationId),
    ]);

    const live = loopsLive(runs.live);

    return {
      stats: {
        loopsLive: live,
        queued: { count: queue.count, estMinutes: queue.estMinutes },
        merged7d: {
          count: runs.mergedThisWeek,
          deltaVsPrior: runs.mergedThisWeek - runs.mergedPriorWeek,
        },
        tokensToday: {
          // Converted here and exactly once: the repository casts in SQL so PostgreSQL has
          // already said the value fits, and `Number` on a `bigint`'s text and a `numeric`'s
          // text is then the whole of the conversion rather than a rounding hidden in a
          // driver's type parser.
          tokens: Number(tokens.tokens),
          costCents: Number(tokens.costCents),
          providers: tokens.providers,
          unpricedEvents: tokens.unpricedEvents,
        },
      },
      pulse: {
        mergeRate: rate(runs.mergedOverRateWindow, runs.closedOverRateWindow),
        avgCycleSeconds: runs.avgCycleSeconds,
        interventions7d: runs.interventionsThisWeek,
        autoMerge,
      },
      activeRuns: active.map(runSummary),
      recentRuns: recent.map(runSummary),
      queueHead: head.map(queueItemSummary),
      activity: {
        // Read from the same figures the stat row is rendered from rather than counted
        // again: the subline saying "3 issues in flight" beside a card saying `2` would be
        // this service disagreeing with itself in one payload.
        inFlight: live.total,
        queued: queue.count,
        mergedSinceMorning: runs.mergedSinceMorning,
      },
    };
  }
}
