import { RoutingStatsCache } from "./stats.cache";
import type { RoutingStatsRepository } from "./stats.repository";
import { RoutingStatsService } from "./stats.service";

/**
 * The orchestration — the three things the statements and the pure functions cannot say between
 * them, and each of them is one of the ticket's criteria.
 *
 * **One clock, one boundary.** The window is computed once per read and handed to both
 * statements, so the matrix's average and the card's total are over the same population. Two
 * statements each asking the database for `now()` would eventually put a call on the boundary
 * inside one figure and outside the other, and nothing downstream could detect it.
 *
 * **The cache is consulted before the ledger is grouped**, which is the *matrix polling does not
 * re-aggregate each time* half of the caching criterion — asserted as *the repository was not
 * called*, because that is the cost the criterion is about.
 *
 * **The workspace reaches both statements and the cache key.** The isolation criterion, checked
 * at the seam where an id could be dropped rather than only in the SQL that carries it.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const OTHER = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
const NOW = new Date("2026-08-23T09:58:12.004Z");

describe("the routing stats service", () => {
  let repository: jest.Mocked<RoutingStatsRepository>;
  let cache: RoutingStatsCache;
  let service: RoutingStatsService;

  beforeEach(() => {
    repository = {
      byTaskKind: jest.fn().mockResolvedValue([
        {
          task_kind: "implement",
          cost_cents_avg: "87.0000",
          latency_p50_ms: 41_000,
          priced_calls: 15,
          unpriced_calls: 0,
          timed_calls: 15,
        },
      ]),
      byProvider: jest.fn().mockResolvedValue([
        {
          provider: "anthropic",
          spend_cents: "41280.0000",
          tokens: "35000000",
          priced_calls: 101,
          unpriced_calls: 0,
        },
      ]),
    } as unknown as jest.Mocked<RoutingStatsRepository>;

    cache = new RoutingStatsCache();
    service = new RoutingStatsService(repository, cache);
  });

  describe("what a read measures", () => {
    it("hands both statements one boundary, computed from one instant", async () => {
      await service.read(WORKSPACE, NOW);

      const [, kindSince] = repository.byTaskKind.mock.calls[0];
      const [, providerSince] = repository.byProvider.mock.calls[0];

      expect(kindSince).toEqual(providerSince);
      expect(kindSince.toISOString()).toBe("2026-07-24T09:58:12.004Z");
    });

    it("carries the workspace into both statements", async () => {
      await service.read(WORKSPACE, NOW);

      expect(repository.byTaskKind).toHaveBeenCalledWith(WORKSPACE, expect.any(Date));
      expect(repository.byProvider).toHaveBeenCalledWith(WORKSPACE, expect.any(Date));
    });

    it("keys the matrix's figures by task kind, and the card by provider", async () => {
      const snapshot = await service.read(WORKSPACE, NOW);

      expect(snapshot.byTaskKind.get("implement")).toEqual({
        costCentsPerRunAvg: 87,
        latencyP50Ms: 41_000,
        pricedCalls: 15,
        unpricedCalls: 0,
        timedCalls: 15,
      });
      expect(snapshot.spend.providers[0]).toMatchObject({ key: "anthropic", spendCents: 41_280 });
    });

    it("publishes the window the figures were measured over", async () => {
      const snapshot = await service.read(WORKSPACE, NOW);

      expect(snapshot.spend.window).toEqual({
        days: 30,
        since: "2026-07-24T09:58:12.004Z",
        until: "2026-08-23T09:58:12.004Z",
      });
    });

    it("answers zero-states, not zeros, for a workspace that has spent nothing", async () => {
      repository.byTaskKind.mockResolvedValue([]);
      repository.byProvider.mockResolvedValue([]);

      const snapshot = await service.read(WORKSPACE, NOW);

      expect(snapshot.byTaskKind.size).toBe(0);
      expect(snapshot.spend.providers).toEqual([]);
      expect(snapshot.spend.totalSpendCents).toBeNull();
      expect(snapshot.spend.localTokenShare).toBeNull();
    });
  });

  describe("what the cache saves", () => {
    it("does not group the ledger twice for one page's polls", async () => {
      await service.read(WORKSPACE, NOW);
      await service.read(WORKSPACE, NOW);

      expect(repository.byTaskKind).toHaveBeenCalledTimes(1);
      expect(repository.byProvider).toHaveBeenCalledTimes(1);
    });

    it("serves the cached snapshot with the instant it was measured at, not the one asked about", async () => {
      // Refreshing the label on the way out would make a stale answer claim to be fresh, which
      // is the one property a cache must never add.
      await service.read(WORKSPACE, NOW);

      const later = await service.read(WORKSPACE, new Date("2026-08-23T09:58:42.003Z"));

      expect(later.spend.window.until).toBe("2026-08-23T09:58:12.004Z");
    });

    it("does not answer one workspace out of another's cached snapshot", async () => {
      await service.read(WORKSPACE, NOW);
      await service.read(OTHER, NOW);

      expect(repository.byProvider).toHaveBeenCalledTimes(2);
      expect(repository.byProvider).toHaveBeenLastCalledWith(OTHER, expect.any(Date));
    });
  });

  describe("the spend endpoint's read", () => {
    it("narrows the same snapshot rather than aggregating a second time", async () => {
      // A report that re-aggregated for itself would be a second opinion about one invoice.
      const snapshot = await service.read(WORKSPACE, NOW);

      await expect(service.spend(WORKSPACE, NOW)).resolves.toBe(snapshot.spend);
      expect(repository.byProvider).toHaveBeenCalledTimes(1);
    });
  });
});
