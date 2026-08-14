import type { QueueItem, Run } from "../db/schema";
import {
  DashboardRepository,
  type DashboardVersion,
  type QueueTotals,
  type RunStatistics,
  type TokenTotals,
} from "./dashboard.repository";
import { DashboardService } from "./dashboard.service";
import { dashboardWindows } from "./windows";

/**
 * The assembly, and the three claims it makes.
 *
 * The repository's statements are asserted beside it and the numbers themselves are asserted
 * against a migrated database; what is left over — and what only this suite can check — is
 * what the service *does* with the answers: that one payload's figures agree with each other,
 * that the wide numbers survive the trip out of PostgreSQL exactly, and that a workspace with
 * nothing in it produces zeros and empty lists rather than nulls a card would divide by.
 */

/** The seeded workspace's figures, as the one-pass statement returns them. */
const SEEDED: RunStatistics = {
  live: { coding: 1, building: 1, review: 1 },
  mergedThisWeek: 27,
  mergedPriorWeek: 19,
  interventionsThisWeek: 2,
  mergedOverRateWindow: 46,
  closedOverRateWindow: 50,
  avgCycleSeconds: 860,
  mergedSinceMorning: 6,
};

/** A workspace with no history at all. */
const EMPTY: RunStatistics = {
  live: { coding: 0, building: 0, review: 0 },
  mergedThisWeek: 0,
  mergedPriorWeek: 0,
  interventionsThisWeek: 0,
  mergedOverRateWindow: 0,
  closedOverRateWindow: 0,
  avgCycleSeconds: 0,
  mergedSinceMorning: 0,
};

/** The seed's own day of token spend: 4.2M tokens, $18.60 priced, three unpriced events. */
const TOKENS: TokenTotals = {
  tokens: "4200000",
  costCents: "1860.0000",
  providers: 4,
  unpricedEvents: 3,
};

const NO_TOKENS: TokenTotals = {
  tokens: "0",
  costCents: "0.0000",
  providers: 0,
  unpricedEvents: 0,
};

const QUEUE: QueueTotals = { count: 12, estMinutes: 580 };

const VERSION: DashboardVersion = {
  runs: "53 2026-08-13T09:00:00.000Z",
  queueItems: "12 2026-08-13T09:00:00.000Z",
  tokenUsage: "12 2026-08-13T09:00:00.000Z",
  workspaceSettings: "1 2026-08-13T09:00:00.000Z",
};

const RUN: Run = {
  id: "5eed0009-0000-4000-8000-000000000482",
  organization_id: "acme",
  github_repo_id: "5eed0003-0000-4000-8000-000000000001",
  issue_number: 482,
  issue_title: "Fix flaky CAN-bus telemetry test",
  workflow_tag: "standard-fix",
  model: "claude-fable-5",
  status: "coding",
  stage_label: "Implementing",
  stage_index: 4,
  stage_total: 6,
  started_at: new Date("2026-08-13T14:25:01.000Z"),
  finished_at: null,
  pr_number: null,
  checks_passed: null,
  checks_total: null,
  created_at: new Date("2026-08-13T14:25:01.000Z"),
  updated_at: new Date("2026-08-13T14:37:00.000Z"),
};

const QUEUED: QueueItem = {
  id: "5eed000a-0000-4000-8000-000000000485",
  organization_id: "acme",
  github_repo_id: "5eed0003-0000-4000-8000-000000000001",
  issue_number: 485,
  issue_title: "Watchdog reset on I²C bus lockup",
  effort: "m",
  workflow_tag: "standard-fix",
  position: 1,
  est_minutes: 45,
  enqueued_at: new Date("2026-08-13T01:37:41.000Z"),
  created_at: new Date("2026-08-13T01:37:41.000Z"),
  updated_at: new Date("2026-08-13T01:37:41.000Z"),
};

const WORKSPACE = "acme-robotics-id";
const WINDOWS = dashboardWindows(new Date("2026-08-13T14:37:41.532Z"));

/**
 * A repository that answers with whatever a test states.
 *
 * A stand-in rather than the real thing over a recording driver, because what is under test
 * here is the arithmetic between the answers and the payload — the statements themselves have
 * their own suite, and asserting them again through this one would be asserting them twice
 * and testing neither properly.
 *
 * @param overrides - What this repository answers with.
 * @returns Something shaped like the repository, typed as it.
 */
function repositoryAnswering(
  overrides: Partial<Record<string, unknown>> = {},
): DashboardRepository {
  const answers = {
    version: VERSION,
    runStatistics: SEEDED,
    activeRuns: [RUN],
    recentRuns: [],
    queueTotals: QUEUE,
    queueHead: [QUEUED],
    tokenTotals: TOKENS,
    autoMerge: true,
    ...overrides,
  };

  return {
    version: jest.fn().mockResolvedValue(answers.version),
    runStatistics: jest.fn().mockResolvedValue(answers.runStatistics),
    activeRuns: jest.fn().mockResolvedValue(answers.activeRuns),
    recentRuns: jest.fn().mockResolvedValue(answers.recentRuns),
    queueTotals: jest.fn().mockResolvedValue(answers.queueTotals),
    queueHead: jest.fn().mockResolvedValue(answers.queueHead),
    tokenTotals: jest.fn().mockResolvedValue(answers.tokenTotals),
    autoMerge: jest.fn().mockResolvedValue(answers.autoMerge),
  } as unknown as DashboardRepository;
}

describe("the dashboard service", () => {
  describe("the windows", () => {
    it("reads the clock once, and hands the same boundaries to everything", async () => {
      const repository = repositoryAnswering();
      const service = new DashboardService(repository);

      const windows = service.windows();
      await service.etag(WORKSPACE, windows);
      await service.read(WORKSPACE, windows);

      // The tag and the body describe one moment, and every statement in the body was
      // answered about the same week — which is what keeps a stat row from disagreeing with
      // the pulse card beside it under load.
      expect(repository.runStatistics).toHaveBeenCalledWith(WORKSPACE, windows);
      expect(repository.tokenTotals).toHaveBeenCalledWith(WORKSPACE, windows.day);
    });
  });

  describe("the entity tag", () => {
    it("is the same for the same state and the same day", async () => {
      const service = new DashboardService(repositoryAnswering());

      expect(await service.etag(WORKSPACE, WINDOWS)).toBe(await service.etag(WORKSPACE, WINDOWS));
    });

    it("changes when any source table does", async () => {
      const before = await new DashboardService(repositoryAnswering()).etag(WORKSPACE, WINDOWS);

      for (const source of ["runs", "queueItems", "tokenUsage", "workspaceSettings"] as const) {
        const changed = await new DashboardService(
          repositoryAnswering({ version: { ...VERSION, [source]: "changed" } }),
        ).etag(WORKSPACE, WINDOWS);

        expect(changed).not.toBe(before);
      }
    });

    it("changes at midnight even when nothing was written", async () => {
      // Two of the payload's numbers are day-boundary facts, so a representation cached
      // across midnight would be wrong with no row having moved. This is what expires it.
      const service = new DashboardService(repositoryAnswering());
      const tomorrow = dashboardWindows(new Date("2026-08-14T00:00:01.000Z"));

      expect(await service.etag(WORKSPACE, tomorrow)).not.toBe(
        await service.etag(WORKSPACE, WINDOWS),
      );
    });

    it("differs between two workspaces holding identical data", async () => {
      const service = new DashboardService(repositoryAnswering());

      expect(await service.etag("one", WINDOWS)).not.toBe(await service.etag("two", WINDOWS));
    });

    it("costs one statement", async () => {
      // The whole argument for a version source: this is what a poll that ends in `304` pays.
      const repository = repositoryAnswering();

      await new DashboardService(repository).etag(WORKSPACE, WINDOWS);

      expect(repository.version).toHaveBeenCalledTimes(1);
      expect(repository.runStatistics).not.toHaveBeenCalled();
      expect(repository.activeRuns).not.toHaveBeenCalled();
    });
  });

  describe("the payload", () => {
    it("reproduces the mockup's numbers from the seeded workspace's rows", async () => {
      const payload = await new DashboardService(repositoryAnswering()).read(WORKSPACE, WINDOWS);

      expect(payload.stats.loopsLive).toEqual({
        total: 3,
        byStatus: { coding: 1, building: 1, review: 1 },
      });
      expect(payload.stats.queued).toEqual({ count: 12, estMinutes: 580 });
      expect(payload.stats.merged7d).toEqual({ count: 27, deltaVsPrior: 8 });
      expect(payload.stats.tokensToday).toEqual({
        tokens: 4_200_000,
        costCents: 1860,
        providers: 4,
        unpricedEvents: 3,
      });
      expect(payload.pulse).toEqual({
        mergeRate: 0.92,
        avgCycleSeconds: 860,
        interventions7d: 2,
        autoMerge: true,
      });
    });

    it("converts the wide numbers exactly, rather than rounding them through a float", async () => {
      // `bigint` and `numeric` arrive as text because neither fits a JavaScript number in
      // general. The conversion happens once, here, on values PostgreSQL has already said fit.
      const payload = await new DashboardService(
        repositoryAnswering({
          tokenTotals: { ...TOKENS, tokens: "4200000", costCents: "1860.0000" },
        }),
      ).read(WORKSPACE, WINDOWS);

      expect(payload.stats.tokensToday.tokens).toBe(4_200_000);
      expect(payload.stats.tokensToday.costCents).toBe(1860);
    });

    it("keeps a cost with fractions of a cent rather than truncating it", async () => {
      const payload = await new DashboardService(
        repositoryAnswering({ tokenTotals: { ...TOKENS, costCents: "1860.2500" } }),
      ).read(WORKSPACE, WINDOWS);

      expect(payload.stats.tokensToday.costCents).toBe(1860.25);
    });

    it("says the same thing twice rather than counting it twice", async () => {
      // The subline and the stat row are rendered side by side; two counts of one thing are
      // two things that can disagree in one payload.
      const payload = await new DashboardService(repositoryAnswering()).read(WORKSPACE, WINDOWS);

      expect(payload.activity.inFlight).toBe(payload.stats.loopsLive.total);
      expect(payload.activity.queued).toBe(payload.stats.queued.count);
      expect(payload.activity.mergedSinceMorning).toBe(6);
    });

    it("renders every row through the shared shapes", async () => {
      const payload = await new DashboardService(repositoryAnswering()).read(WORKSPACE, WINDOWS);

      expect(payload.activeRuns).toEqual([
        expect.objectContaining({ issueNumber: 482, status: "coding", finishedAt: null }),
      ]);
      expect(payload.queueHead).toEqual([
        expect.objectContaining({ issueNumber: 485, effort: "m", estMinutes: 45 }),
      ]);
    });

    it("answers an empty organization with zeros and empty lists, never nulls", async () => {
      // The acceptance criterion, at the layer that decides it. A card is rendered from this
      // without a fallback branch, so a `null` here is a crash there.
      const payload = await new DashboardService(
        repositoryAnswering({
          runStatistics: EMPTY,
          activeRuns: [],
          recentRuns: [],
          queueTotals: { count: 0, estMinutes: 0 },
          queueHead: [],
          tokenTotals: NO_TOKENS,
          autoMerge: false,
        }),
      ).read(WORKSPACE, WINDOWS);

      expect(payload).toEqual({
        stats: {
          loopsLive: { total: 0, byStatus: { coding: 0, building: 0, review: 0 } },
          queued: { count: 0, estMinutes: 0 },
          merged7d: { count: 0, deltaVsPrior: 0 },
          tokensToday: { tokens: 0, costCents: 0, providers: 0, unpricedEvents: 0 },
        },
        pulse: { mergeRate: 0, avgCycleSeconds: 0, interventions7d: 0, autoMerge: false },
        activeRuns: [],
        recentRuns: [],
        queueHead: [],
        activity: { inFlight: 0, queued: 0, mergedSinceMorning: 0 },
      });

      // …and nothing in it is a value JSON cannot carry, which is how a `NaN` reaches a card
      // as `null` and a meter as a width of `NaN%`.
      expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    });

    it("reports a week that merged less than the one before as a negative delta", async () => {
      const payload = await new DashboardService(
        repositoryAnswering({
          runStatistics: { ...SEEDED, mergedThisWeek: 11, mergedPriorWeek: 19 },
        }),
      ).read(WORKSPACE, WINDOWS);

      expect(payload.stats.merged7d.deltaVsPrior).toBe(-8);
    });

    it("issues its reads concurrently rather than one after another", async () => {
      // Eight sequential round trips would make the endpoint's latency their sum. The
      // property is observable: every call is made before the first answer is awaited.
      let resolveFirst: (value: RunStatistics) => void = () => {};
      const repository = repositoryAnswering();
      (repository.runStatistics as jest.Mock).mockReturnValue(
        new Promise<RunStatistics>((resolve) => (resolveFirst = resolve)),
      );

      const reading = new DashboardService(repository).read(WORKSPACE, WINDOWS);
      await Promise.resolve();

      expect(repository.activeRuns).toHaveBeenCalled();
      expect(repository.autoMerge).toHaveBeenCalled();

      resolveFirst(SEEDED);
      await reading;
    });
  });
});
