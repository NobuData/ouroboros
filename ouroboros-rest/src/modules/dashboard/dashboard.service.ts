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
 * **Shared metrics are read, not computed.** The pulse card's merge rate, cycle time and
 * interventions, and the stat row's PRs merged with its delta, are `MetricsService` windows (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437), decision I1) over
 * {@link PULSE_RANGE}, asked at this request's `now`. The Insights page and the weekly digest
 * read the same service, so no two surfaces can show different numbers for one metric.
 *
 * The queries themselves run concurrently. They are independent reads of one workspace's
 * rows, and issuing them in sequence would make the endpoint's latency the sum of eight
 * round trips rather than the slowest of them.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AdmissionService, type AdmissionSummaries } from "../admission/admission.service";

import {
  DEFAULT_ORIGIN,
  originsOf,
  originsPresent,
  type OriginFilter,
} from "../insights/metrics/metrics.origin";
import { MetricsService } from "../insights/metrics/metrics.service";
import type { MetricWindow } from "../insights/metrics/metrics.types";
import { DashboardRepository } from "./dashboard.repository";
import { strongEtag } from "./etag";
import { loopsLive, runSummary, type DashboardResource } from "./resources";
import { dashboardWindows, PULSE_RANGE, type DashboardWindows } from "./windows";

/** Milliseconds in a second — `cycle_time` is stored in milliseconds, the pulse speaks seconds. */
const MS_PER_SECOND = 1000;

/** A `pct` metric's scale — the registry stores 0–100, the pulse speaks a 0–1 fraction. */
const PCT_SCALE = 100;

@Injectable()
export class DashboardService {
  /**
   * @param dashboard - The dashboard's own statements.
   * @param metrics - The windowed metrics service the shared figures are read from.
   */
  constructor(
    private readonly dashboard: DashboardRepository,
    private readonly metrics: MetricsService,
    @Inject(AdmissionService) private readonly admission: AdmissionSummaries,
  ) {}

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
   * Cheap by construction — nine aggregate subqueries and no rows — because this is what a
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
  async etag(
    organizationId: string,
    windows: DashboardWindows,
    origin: OriginFilter = DEFAULT_ORIGIN,
  ): Promise<string> {
    const version = await this.dashboard.version(organizationId);

    return strongEtag([
      organizationId,
      windows.day,
      origin,
      version.runs,
      version.queueItems,
      version.tokenUsage,
      version.workspaceSettings,
      version.pullRequests,
      version.interventionEvents,
      version.metricRollups,
      version.workspaceLifecycle,
      version.orgPolicies,
    ]);
  }

  /**
   * The whole dashboard, in one payload.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param windows - This request's boundaries — the same ones {@link DashboardService.etag}
   *   was given, so the tag and the body describe one moment.
   * @param origin - Which data origin the aggregates count (DJ.2); `live` when omitted.
   * @returns The resource. Every list is a list, and every count of what is in flight or queued
   *   is a number; a windowed figure with no row of the asked origin is null — no data, never a
   *   zero floor (DJ.2) — and `originsPresent` says what the workspace does hold.
   */
  async read(
    organizationId: string,
    windows: DashboardWindows,
    origin: OriginFilter = DEFAULT_ORIGIN,
  ): Promise<DashboardResource> {
    const origins = originsOf(origin);
    const scope = { organizationId, range: PULSE_RANGE, origin, now: windows.now };
    const [
      runs,
      active,
      recent,
      queue,
      head,
      tokens,
      autoMerge,
      merged,
      mergeRate,
      cycleTime,
      interventions,
    ] = await Promise.all([
      this.dashboard.runStatistics(organizationId, origins),
      this.dashboard.activeRuns(organizationId, origins),
      this.dashboard.recentRuns(organizationId, origins),
      this.dashboard.queueTotals(organizationId),
      this.dashboard.queueHead(organizationId),
      this.dashboard.tokenTotals(organizationId, windows.day, origins),
      this.dashboard.autoMerge(organizationId),
      this.metrics.window("merged_prs", scope),
      this.metrics.window("merge_rate", scope),
      this.metrics.window("cycle_time", scope),
      this.metrics.window("human_interventions", scope),
    ]);

    const live = loopsLive(runs.live);
    const aggregates = [merged, mergeRate, cycleTime, interventions];
    const noTokens = tokens.events === 0;

    return {
      origin,
      originsPresent: originsPresent(
        [...aggregates.flatMap((window) => window.originsPresent), ...tokens.originsPresent].map(
          (present) => ({ origin: present }),
        ),
      ),
      mixed:
        aggregates.some((window) => window.mixed) ||
        (origin === "all" && tokens.originsPresent.length > 1),
      stats: {
        loopsLive: live,
        queued: { count: queue.count, estMinutes: queue.estMinutes },
        merged7d: {
          count: merged.value,
          deltaVsPrior: merged.delta,
        },
        tokensToday: {
          // Converted here and exactly once: the repository casts in SQL so PostgreSQL has
          // already said the value fits, and `Number` on a `bigint`'s text and a `numeric`'s
          // text is then the whole of the conversion rather than a rounding hidden in a
          // driver's type parser.
          tokens: noTokens ? null : Number(tokens.tokens),
          costCents: noTokens ? null : Number(tokens.costCents),
          providers: tokens.providers,
          unpricedEvents: tokens.unpricedEvents,
        },
      },
      pulse: {
        mergeRate: scaled(mergeRate, PCT_SCALE),
        avgCycleSeconds: scaled(cycleTime, MS_PER_SECOND),
        interventions7d: interventions.value,
        autoMerge,
      },
      activeRuns: active.map(runSummary),
      recentRuns: recent.map(runSummary),
      queueHead: await this.admission.summaries(organizationId, head, windows.now),
      activity: {
        // Read from the same figures the stat row is rendered from rather than counted
        // again: the subline saying "3 issues in flight" beside a card saying `2` would be
        // this service disagreeing with itself in one payload.
        inFlight: live.total,
        queued: queue.count,
        // Today's point of the same window the stat row's count is — one figure, not two.
        mergedSinceMorning: merged.value === null ? null : (merged.series.at(-1)?.value ?? 0),
      },
    };
  }
}

/**
 * A window's figure in the dashboard's unit.
 *
 * @param window - The window.
 * @param divisor - What the registry's unit is divided by (100 for a `pct`, 1000 for ms → s).
 * @returns The figure, or null — no data — when there was nothing of the asked origin to compute
 *   it from (DJ.2).
 */
function scaled(window: MetricWindow, divisor: number): number | null {
  return window.value === null ? null : window.value / divisor;
}
