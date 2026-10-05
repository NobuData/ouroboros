import type { QueueItem, Run } from "../db/schema";
import { metricsAnswering, type MetricsStub } from "../insights/metrics/metrics.fixture";
import type { MetricWindow } from "../insights/metrics/metrics.types";
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

/** The seeded workspace's live split, as the one-pass statement returns it. */
const SEEDED: RunStatistics = { live: { coding: 1, building: 1, review: 1 } };

/** A workspace with no history at all. */
const EMPTY: RunStatistics = { live: { coding: 0, building: 0, review: 0 } };

/**
 * The seeded workspace's shared metrics, as `MetricsService` answers them: 27 merged (8 more than
 * the prior week, 6 of them today), a 92% merge rate, a 14m 20s median cycle, 2 interventions.
 */
const SEEDED_METRICS: Readonly<Record<string, Partial<MetricWindow>>> = {
  merged_prs: {
    value: 27,
    prior: 19,
    delta: 8,
    series: [
      { day: "2026-08-12", value: 21, meta: {} },
      { day: "2026-08-13", value: 6, meta: {} },
    ],
  },
  merge_rate: { value: 92, components: { numerator: 46, denominator: 50 } },
  cycle_time: { value: 860_000 },
  human_interventions: { value: 2 },
};

/** An empty workspace's metrics: no rate, no median, sums of nothing. */
const EMPTY_METRICS: Readonly<Record<string, Partial<MetricWindow>>> = {
  merged_prs: {
    value: 0,
    prior: 0,
    delta: 0,
    series: [{ day: "2026-08-13", value: 0, meta: {} }],
  },
  merge_rate: { value: null, prior: null, delta: null },
  cycle_time: { value: null, prior: null, delta: null },
  human_interventions: { value: 0 },
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
  pullRequests: "40 2026-08-13T09:00:00.000Z",
  interventionEvents: "2 2026-08-13T09:00:00.000Z",
  metricRollups: "8 2026-08-13T09:00:00.000Z",
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
  loop_seq: 1847,
  branch_name: "loop/482-canbus-flake",
  workflow_version_pin: 14,
  simulated: false,
  event_seq: 9,
  event_bytes: "862",
  event_cap: 20000,
  event_byte_cap: "33554432",
  events_elided_at: null,
  merge_strategy: "squash",
  reserved_build_job_id: null,
  event_hint: 0,
  change_set_seq: 0,
  playbook_id: null,
  events_swept_at: null,
};

const QUEUED: QueueItem = {
  id: "5eed000a-0000-4000-8000-000000000485",
  organization_id: "acme",
  github_repo_id: "5eed0003-0000-4000-8000-000000000001",
  issue_number: 485,
  issue_title: "Watchdog reset on I²C bus lockup",
  effort: "m",
  workflow_tag: "standard-fix",
  workflow_version: 14,
  workflow_pin_reason: "predicate",
  playbook_id: null,
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

/**
 * The service over a stated repository and metrics service.
 *
 * @param repository - The repository stand-in.
 * @param metrics - The metrics stand-in; the seeded workspace's figures by default.
 * @returns The service.
 */
function serviceOf(
  repository: DashboardRepository,
  metrics: MetricsStub = metricsAnswering(SEEDED_METRICS),
): DashboardService {
  return new DashboardService(repository, metrics);
}

describe("the dashboard service", () => {
  describe("the windows", () => {
    it("reads the clock once, and hands the same boundaries to everything", async () => {
      const repository = repositoryAnswering();
      const metrics = metricsAnswering(SEEDED_METRICS);
      const service = serviceOf(repository, metrics);

      const windows = service.windows();
      await service.etag(WORKSPACE, windows);
      await service.read(WORKSPACE, windows);

      // The tag and the body describe one moment, and every metrics window in the body was
      // asked about the same instant — which is what keeps a stat row from disagreeing with
      // the pulse card beside it under load.
      expect(repository.runStatistics).toHaveBeenCalledWith(WORKSPACE);
      expect(metrics.window).toHaveBeenCalledTimes(4);
      for (const [, scope] of metrics.window.mock.calls) {
        expect(scope).toEqual({ organizationId: WORKSPACE, range: "7d", now: windows.now });
      }
      expect(repository.tokenTotals).toHaveBeenCalledWith(WORKSPACE, windows.day);
    });
  });

  describe("the entity tag", () => {
    it("is the same for the same state and the same day", async () => {
      const service = serviceOf(repositoryAnswering());

      expect(await service.etag(WORKSPACE, WINDOWS)).toBe(await service.etag(WORKSPACE, WINDOWS));
    });

    it("changes when any source table does", async () => {
      const before = await serviceOf(repositoryAnswering()).etag(WORKSPACE, WINDOWS);

      for (const source of [
        "runs",
        "queueItems",
        "tokenUsage",
        "workspaceSettings",
        "pullRequests",
        "interventionEvents",
        "metricRollups",
      ] as const) {
        const changed = await new DashboardService(
          repositoryAnswering({ version: { ...VERSION, [source]: "changed" } }),
          metricsAnswering(SEEDED_METRICS),
        ).etag(WORKSPACE, WINDOWS);

        expect(changed).not.toBe(before);
      }
    });

    it("changes at midnight even when nothing was written", async () => {
      // Two of the payload's numbers are day-boundary facts, so a representation cached
      // across midnight would be wrong with no row having moved. This is what expires it.
      const service = serviceOf(repositoryAnswering());
      const tomorrow = dashboardWindows(new Date("2026-08-14T00:00:01.000Z"));

      expect(await service.etag(WORKSPACE, tomorrow)).not.toBe(
        await service.etag(WORKSPACE, WINDOWS),
      );
    });

    it("differs between two workspaces holding identical data", async () => {
      const service = serviceOf(repositoryAnswering());

      expect(await service.etag("one", WINDOWS)).not.toBe(await service.etag("two", WINDOWS));
    });

    it("costs one statement", async () => {
      // The whole argument for a version source: this is what a poll that ends in `304` pays.
      const repository = repositoryAnswering();

      await serviceOf(repository).etag(WORKSPACE, WINDOWS);

      expect(repository.version).toHaveBeenCalledTimes(1);
      expect(repository.runStatistics).not.toHaveBeenCalled();
      expect(repository.activeRuns).not.toHaveBeenCalled();
    });
  });

  describe("the payload", () => {
    it("reads the pulse and the merged stat from the shared metrics service", async () => {
      // The #437 amendment: no second implementation of a shared metric. Each figure is the
      // registry metric of the same name, and nothing else.
      const metrics = metricsAnswering(SEEDED_METRICS);

      await serviceOf(repositoryAnswering(), metrics).read(WORKSPACE, WINDOWS);

      expect(metrics.window.mock.calls.map(([metricId]) => metricId).sort()).toEqual([
        "cycle_time",
        "human_interventions",
        "merge_rate",
        "merged_prs",
      ]);
    });

    it("converts the registry's units to the pulse's: pct to a fraction, ms to seconds", async () => {
      const payload = await serviceOf(
        repositoryAnswering(),
        metricsAnswering({
          ...SEEDED_METRICS,
          merge_rate: { value: 87.5 },
          cycle_time: { value: 90_500 },
        }),
      ).read(WORKSPACE, WINDOWS);

      expect(payload.pulse.mergeRate).toBe(0.875);
      expect(payload.pulse.avgCycleSeconds).toBe(90.5);
    });

    it("reproduces the mockup's numbers from the seeded workspace's rows", async () => {
      const payload = await serviceOf(repositoryAnswering()).read(WORKSPACE, WINDOWS);

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
      const payload = await serviceOf(
        repositoryAnswering({
          tokenTotals: { ...TOKENS, tokens: "4200000", costCents: "1860.0000" },
        }),
      ).read(WORKSPACE, WINDOWS);

      expect(payload.stats.tokensToday.tokens).toBe(4_200_000);
      expect(payload.stats.tokensToday.costCents).toBe(1860);
    });

    it("keeps a cost with fractions of a cent rather than truncating it", async () => {
      const payload = await serviceOf(
        repositoryAnswering({ tokenTotals: { ...TOKENS, costCents: "1860.2500" } }),
      ).read(WORKSPACE, WINDOWS);

      expect(payload.stats.tokensToday.costCents).toBe(1860.25);
    });

    it("says the same thing twice rather than counting it twice", async () => {
      // The subline and the stat row are rendered side by side; two counts of one thing are
      // two things that can disagree in one payload.
      const payload = await serviceOf(repositoryAnswering()).read(WORKSPACE, WINDOWS);

      expect(payload.activity.inFlight).toBe(payload.stats.loopsLive.total);
      expect(payload.activity.queued).toBe(payload.stats.queued.count);
      // Today's point of the same merged_prs window the stat row counts.
      expect(payload.activity.mergedSinceMorning).toBe(6);
    });

    it("renders every row through the shared shapes", async () => {
      const payload = await serviceOf(repositoryAnswering()).read(WORKSPACE, WINDOWS);

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
      const payload = await serviceOf(
        repositoryAnswering({
          runStatistics: EMPTY,
          activeRuns: [],
          recentRuns: [],
          queueTotals: { count: 0, estMinutes: 0 },
          queueHead: [],
          tokenTotals: NO_TOKENS,
          autoMerge: false,
        }),
        metricsAnswering(EMPTY_METRICS),
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
      const payload = await serviceOf(
        repositoryAnswering(),
        metricsAnswering({
          ...SEEDED_METRICS,
          merged_prs: { value: 11, prior: 19, delta: -8 },
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

      const metrics = metricsAnswering(SEEDED_METRICS);
      const reading = serviceOf(repository, metrics).read(WORKSPACE, WINDOWS);
      await Promise.resolve();

      expect(repository.activeRuns).toHaveBeenCalled();
      expect(repository.autoMerge).toHaveBeenCalled();
      expect(metrics.window).toHaveBeenCalledTimes(4);

      resolveFirst(SEEDED);
      await reading;
    });
  });
});
