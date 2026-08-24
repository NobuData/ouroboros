/**
 * The stats service — one window, two aggregates, and one cached answer that the matrix and the
 * spend card are both drawn from ([#198](https://github.com/NobuData/ouroboros/issues/198)).
 *
 * ```
 * stats.window.ts        the thirty days, computed once per read
 * stats.repository.ts    the two aggregates, and no write
 * stats.ts               rows → the matrix's numerics and the spend card
 * stats.cache.ts         the short TTL that keeps polling off the ledger
 * stats.service.ts       this: load, compose, remember
 * ```
 *
 * ---------------------------------------------------------------------------
 * **One snapshot, because the page is one screen.**
 *
 * Mockup 06 draws `$/run avg` and `p50 latency` on every matrix row, the **Spend by provider ·
 * 30d** meters beside them, and *"Local models served 31% of all tokens"* underneath. Those are
 * four claims about the same thirty days, and {@link RoutingStatsSnapshot} is all four measured
 * together: one `now`, one boundary, two statements issued in parallel against it. A page cannot
 * therefore show a call inside one figure and outside another, which two independently timed
 * reads would eventually do.
 *
 * It is also why `GET /api/v1/routing` carries the spend card rather than leaving it to a second
 * request. The endpoint's own reasoning — *one request rather than one per card, because they
 * are one screen* — applies with more force here than it does to the rules, since the cards
 * genuinely are aggregates over one population.
 *
 * ---------------------------------------------------------------------------
 * **What this service refuses to do.**
 *
 * It never invents a figure. Every null it publishes came from a null the database answered
 * with — see `stats.repository.ts`'s table — and the only arithmetic it performs is addition
 * over numbers PostgreSQL already produced. Decision **M7** in one sentence: *a figure the
 * product cannot compute is a figure it does not print*.
 *
 * It also never writes. There is no `insert`, `update` or `delete` anywhere in this file or in
 * its repository, which is the same posture `routing.repository.ts` holds for resolution and
 * for the same reason: a service that aggregates a ledger has no business appending to it.
 */

import { Injectable } from "@nestjs/common";

import type { RoutingSpendResource } from "./resources";
import { routeStatsByTaskKind, toRoutingSpend, type RoutingStatsSnapshot } from "./stats";
import { RoutingStatsCache } from "./stats.cache";
import { RoutingStatsRepository } from "./stats.repository";
import { statsWindow, STATS_WINDOW_DAYS } from "./stats.window";

@Injectable()
export class RoutingStatsService {
  /**
   * @param stats - The two aggregates.
   * @param cache - The short TTL. Injected rather than constructed here so a suite can watch
   *   what it absorbed, and so the bound is one map per process rather than one per service
   *   instance.
   */
  constructor(
    private readonly stats: RoutingStatsRepository,
    private readonly cache: RoutingStatsCache,
  ) {}

  /**
   * What the window measured for this workspace — from the cache when it is still warm.
   *
   * **The clock is read once**, here, and both statements are given the same boundary. A
   * `Date` handed down as a parameter rather than `now()` evaluated inside each statement is
   * what makes the four figures consistent with each other; see `stats.window.ts`.
   *
   * The two reads are issued in parallel: they are independent aggregates over one workspace,
   * so there is nothing for a transaction to protect that a page which polls would notice, and
   * issuing them in sequence would double the latency of a payload that is already the slowest
   * part of this page.
   *
   * @param organizationId - The workspace, from the tenant context. Carried into both
   *   statements and into the cache key — another workspace's usage cannot reach either.
   * @param now - The request instant. Defaults to the clock; a parameter so a suite can assert
   *   the window arithmetic without owning time.
   * @returns The snapshot. Empty maps and zero-states for a workspace that has spent nothing —
   *   never `$0.00` for usage nobody priced.
   */
  async read(organizationId: string, now: Date = new Date()): Promise<RoutingStatsSnapshot> {
    const cached = this.cache.get(organizationId, STATS_WINDOW_DAYS);

    if (cached !== undefined) {
      return cached;
    }

    const window = statsWindow(now);
    const [kinds, providers] = await Promise.all([
      this.stats.byTaskKind(organizationId, window.since),
      this.stats.byProvider(organizationId, window.since),
    ]);

    const snapshot: RoutingStatsSnapshot = {
      byTaskKind: routeStatsByTaskKind(kinds),
      spend: toRoutingSpend(providers, window),
    };

    this.cache.set(organizationId, STATS_WINDOW_DAYS, snapshot);

    return snapshot;
  }

  /**
   * The spend card alone — `GET /api/v1/routing/spend`, and AB.4's data source.
   *
   * The same snapshot the matrix is drawn from, narrowed. A second aggregation for the report
   * would be a second opinion about one invoice, which is the failure this whole surface is
   * built to avoid; sharing the cache is the same argument at a smaller scale.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param now - The request instant. See {@link RoutingStatsService.read}.
   * @returns The card, its footnote, and the window it was measured over.
   */
  async spend(organizationId: string, now: Date = new Date()): Promise<RoutingSpendResource> {
    return (await this.read(organizationId, now)).spend;
  }
}
