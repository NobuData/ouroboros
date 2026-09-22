import type { AppConfigService } from "../config/config.service";
import { runSummary } from "../dashboard/resources";
import type { DomainError } from "../errors/error.envelope";
import { readFixture } from "../workflows/dsl.golden.fixture";
import {
  RUN_EVENTS_PAGE_DEFAULT,
  RUN_EVENTS_POLL_LIVE_SECONDS,
  RUN_EXPORT_BATCH,
  RUN_EXPORT_WATERMARK,
} from "./console.policy";
import type { ConsoleRepository } from "./console.repository";
import { ConsoleService, isLive, type ConsoleTenant } from "./console.service";
import {
  commitRow,
  eventRow,
  fileRow,
  into,
  mockupGuardrails,
  mockupStages,
  RUN_ID,
  runRow,
  STARTED,
} from "./runs.fixture";
import type { RunsRepository } from "./runs.repository";

/**
 * The console's three reads, over mocked statements.
 *
 * What is asserted is what the service decides: that every read starts from the org-scoped
 * `find` (so another workspace's run is the same `404` on all three routes), how the page is
 * assembled from the statements — including the route lookup through the pinned document — and
 * the two transcript contracts: the tail's cursor arithmetic and liveness, and the export's
 * laziness, which is what keeps its memory flat.
 */

const TENANT: ConsoleTenant = { id: "acme-robotics-id", slug: "acme-robotics" };

/** The shared poll cadence the configuration answers with. */
const SHARED_CADENCE = 15;

/** Collect an async iterable. */
async function collect(chunks: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
}

/** The error a promise rejected with. */
async function failureOf(promise: Promise<unknown>): Promise<DomainError> {
  return promise.then(
    () => {
      throw new Error("resolved when it should have been refused");
    },
    (thrown: DomainError) => thrown,
  );
}

describe("the console service", () => {
  let runs: jest.Mocked<RunsRepository>;
  let repository: jest.Mocked<ConsoleRepository>;
  let service: ConsoleService;

  beforeEach(() => {
    runs = {
      find: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RunsRepository>;

    repository = {
      repository: jest.fn().mockResolvedValue({ owner: "acme", name: "helios-firmware" }),
      stages: jest.fn().mockResolvedValue(mockupStages()),
      files: jest.fn().mockResolvedValue([fileRow()]),
      commits: jest.fn().mockResolvedValue([commitRow()]),
      spend: jest.fn().mockResolvedValue({
        tokensIn: 169_600,
        tokensOut: 42_400,
        costCents: "114.0000",
        unpricedEvents: 0,
      }),
      guardrails: jest.fn().mockResolvedValue(mockupGuardrails()),
      reservation: jest.fn().mockResolvedValue({
        id: "job-483",
        number: 483,
        status: "running",
        runnerName: "forge-02",
      }),
      pinnedDefinition: jest
        .fn()
        .mockResolvedValue({ definition: readFixture("valid/standard-fix.json") }),
      routeCap: jest.fn().mockResolvedValue({ tag: "implement-primary", maxCostCentsPerRun: 250 }),
      events: jest.fn().mockResolvedValue([]),
      jsonl: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ConsoleRepository>;

    const config = { dashboardPollSeconds: SHARED_CADENCE } as AppConfigService;

    service = new ConsoleService(runs, repository, config);
    service.now = () => into(760);
  });

  /** Make the fixture run findable, with overrides. */
  function findable(over: Parameters<typeof runRow>[0] = {}) {
    const row = runRow({ started_at: STARTED, reserved_build_job_id: "job-483", ...over });
    runs.find.mockResolvedValue(row);
    return row;
  }

  describe("isLive", () => {
    it.each(["coding", "building", "review"] as const)("is true for %s", (status) => {
      expect(isLive(status)).toBe(true);
    });

    it.each(["merged", "needs_human", "failed", "canceled"] as const)(
      "is false for %s",
      (status) => {
        expect(isLive(status)).toBe(false);
      },
    );
  });

  describe("every read", () => {
    it.each([
      ["the page", (s: ConsoleService) => s.read(TENANT, RUN_ID)],
      ["the tail", (s: ConsoleService) => s.events(TENANT.id, RUN_ID, {})],
      ["the export", (s: ConsoleService) => s.exportTranscript(TENANT.id, RUN_ID)],
    ])("answers %s of an absent or foreign run as run_not_found", async (_name, read) => {
      // The repository's find is org-scoped, so "absent" and "another workspace's" are one
      // answer — and nothing else is read for a run the caller may not see.
      const failure = await failureOf(read(service));

      expect(runs.find).toHaveBeenCalledWith(TENANT.id, RUN_ID);
      expect(failure.envelope()).toEqual({
        code: "run_not_found",
        message: "No such run.",
        details: { runId: RUN_ID },
      });
      expect(repository.stages).not.toHaveBeenCalled();
      expect(repository.events).not.toHaveBeenCalled();
      expect(repository.jsonl).not.toHaveBeenCalled();
    });
  });

  describe("the page", () => {
    it("carries the run in the listing's own shape, and the head's extra facts", async () => {
      const row = findable({ simulated: true });

      const page = await service.read(TENANT, RUN_ID);

      expect(page.asOf).toBe(into(760).toISOString());
      expect(page.run).toEqual(runSummary(row));
      expect(page.head).toEqual({
        loopSeq: 1847,
        workflowVersion: 14,
        branchName: "loop/482-canbus-flake",
        simulated: true,
        live: true,
        repository: { owner: "acme", name: "helios-firmware" },
      });
    });

    it("reads the cap through the budget stage's inherited route — implement → implement-primary", async () => {
      findable();

      const page = await service.read(TENANT, RUN_ID);

      expect(repository.pinnedDefinition).toHaveBeenCalledWith(
        "acme-robotics-id",
        "standard-fix",
        14,
      );
      expect(repository.routeCap).toHaveBeenCalledWith("acme-robotics-id", "implement");
      expect(page.resources.tokens).toMatchObject({ used: 212_000, budget: 400_000 });
      expect(page.resources.cost).toMatchObject({
        costCents: "114.0000",
        capCents: 250,
        routeTag: "implement-primary",
      });
      expect(page.resources.farm?.runnerName).toBe("forge-02");
      expect(page.resources.wallClock.elapsedSeconds).toBe(760);
    });

    it("assembles the stepper, the changes card and the guardrails footer from the statements", async () => {
      findable();

      const page = await service.read(TENANT, RUN_ID);

      expect(page.timeline.currentStageKey).toBe("implement");
      expect(page.timeline.stages).toHaveLength(6);
      expect(page.changes.totals).toEqual({ files: 1, additions: 38, deletions: 12 });
      expect(page.changes.mergeStrategy).toBe("squash");
      expect(page.guardrails.status).toBe("clean");
      expect(page.guardrails.policy).toEqual({
        workflowTag: "standard-fix",
        workflowVersion: 14,
        tenant: "acme-robotics",
      });
    });

    it("has no cap when the budget stage pins a model instead of inheriting a route", async () => {
      findable();
      repository.stages.mockResolvedValue(
        mockupStages().filter((stage) => stage.stage_key !== "implement"),
      );

      const page = await service.read(TENANT, RUN_ID);

      // `plan` is the latest model stage now, and it pins `coder-max` — no route, no cap.
      expect(page.resources.tokens.budgetStageKey).toBe("plan");
      expect(repository.routeCap).not.toHaveBeenCalled();
      expect(page.resources.cost).toMatchObject({ capCents: null, routeTag: null });
    });

    it("reads no pin for a run that has none, and no route before a model stage has started", async () => {
      findable({ workflow_version_pin: null });

      await service.read(TENANT, RUN_ID);
      expect(repository.pinnedDefinition).not.toHaveBeenCalled();

      findable();
      repository.stages.mockResolvedValue([]);
      repository.pinnedDefinition.mockClear();

      const page = await service.read(TENANT, RUN_ID);
      expect(repository.pinnedDefinition).not.toHaveBeenCalled();
      expect(page.resources.tokens.budget).toBeNull();
    });

    it("has no cap when the pinned version cannot be found", async () => {
      findable();
      repository.pinnedDefinition.mockResolvedValue(undefined);

      const page = await service.read(TENANT, RUN_ID);

      expect(repository.routeCap).not.toHaveBeenCalled();
      expect(page.resources.cost.capCents).toBeNull();
    });

    it("omits the farm row, and reads no job, for a run holding no reservation", async () => {
      findable({ reserved_build_job_id: null });

      const page = await service.read(TENANT, RUN_ID);

      expect(repository.reservation).not.toHaveBeenCalled();
      expect(page.resources).not.toHaveProperty("farm");
    });

    it("omits the repository when it cannot be read, rather than inventing a name", async () => {
      findable();
      repository.repository.mockResolvedValue(undefined);

      const page = await service.read(TENANT, RUN_ID);

      expect(page.head).not.toHaveProperty("repository");
    });

    it("answers an unpriced ledger with a token count and a null cost, never $0", async () => {
      findable();
      repository.spend.mockResolvedValue({
        tokensIn: 900,
        tokensOut: 100,
        costCents: null,
        unpricedEvents: 2,
      });

      const page = await service.read(TENANT, RUN_ID);

      expect(page.resources.tokens.used).toBe(1_000);
      expect(page.resources.cost.costCents).toBeNull();
      expect(JSON.stringify(page.resources.cost)).not.toContain('"costCents":"0');
    });

    it("says a terminal run is not live, and freezes its wall clock", async () => {
      findable({ status: "merged", finished_at: into(900) });

      const page = await service.read(TENANT, RUN_ID);

      expect(page.head.live).toBe(false);
      expect(page.resources.wallClock).toMatchObject({
        finishedAt: into(900).toISOString(),
        elapsedSeconds: 900,
      });
    });
  });

  describe("the tail", () => {
    it("reads from the start at the default page size, bounded by the run's event_seq", async () => {
      findable({ event_seq: 9 });
      repository.events.mockResolvedValue([eventRow({ seq: 1 }), eventRow({ seq: 2 })]);

      const page = await service.events(TENANT.id, RUN_ID, {});

      expect(repository.events).toHaveBeenCalledWith(RUN_ID, 0, 9, RUN_EVENTS_PAGE_DEFAULT);
      expect(page).toMatchObject({
        runId: RUN_ID,
        after: 0,
        nextAfter: 2,
        latestSeq: 9,
        hasMore: true,
        live: true,
        elided: false,
        pollAfter: RUN_EVENTS_POLL_LIVE_SECONDS,
      });
      expect(page.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    });

    it("resumes after the cursor — the issue's ?after=7 → two entries, latestSeq 9, pollAfter 5", async () => {
      findable({ event_seq: 9 });
      repository.events.mockResolvedValue([eventRow({ seq: 8 }), eventRow({ seq: 9 })]);

      const page = await service.events(TENANT.id, RUN_ID, { after: 7, limit: 50 });

      expect(repository.events).toHaveBeenCalledWith(RUN_ID, 7, 9, 50);
      expect(page).toMatchObject({
        after: 7,
        nextAfter: 9,
        latestSeq: 9,
        hasMore: false,
        live: true,
        pollAfter: 5,
      });
      expect(page.entries).toHaveLength(2);
    });

    it("keeps the cursor where it was when nothing new has arrived", async () => {
      findable({ event_seq: 9 });

      const page = await service.events(TENANT.id, RUN_ID, { after: 9 });

      expect(page).toMatchObject({ entries: [], nextAfter: 9, hasMore: false });
    });

    it("refuses a cursor past the end, saying where the end is", async () => {
      findable({ event_seq: 9 });

      const failure = await failureOf(service.events(TENANT.id, RUN_ID, { after: 10 }));

      expect(failure.envelope()).toMatchObject({
        code: "run_events_cursor_out_of_range",
        details: { latestSeq: 9 },
      });
      expect(repository.events).not.toHaveBeenCalled();
    });

    it("goes quiet for a terminal run — live false, and the shared cadence", async () => {
      findable({ status: "failed", finished_at: into(900), event_seq: 9 });

      const page = await service.events(TENANT.id, RUN_ID, { after: 9 });

      expect(page.live).toBe(false);
      expect(page.pollAfter).toBe(SHARED_CADENCE);
    });

    it("says when a cap has elided entries", async () => {
      findable({ events_elided_at: into(900), event_seq: 3 });

      expect((await service.events(TENANT.id, RUN_ID, { after: 3 })).elided).toBe(true);
    });
  });

  describe("the export", () => {
    it("opens a simulated run's file with the watermark, then the projection's lines", async () => {
      findable({ simulated: true, event_seq: 2 });
      repository.jsonl.mockResolvedValueOnce([
        { seq: 1, line: '{"seq": 1}' },
        { seq: 2, line: '{"seq": 2}' },
      ]);

      const file = await service.exportTranscript(TENANT.id, RUN_ID);

      expect(file.filename).toBe("loop-1847.jsonl");
      expect((await collect(file.chunks)).join("")).toBe(
        `${RUN_EXPORT_WATERMARK}\n{"seq": 1}\n{"seq": 2}\n`,
      );
    });

    it("writes no watermark on a run nobody simulated", async () => {
      findable({ simulated: false, event_seq: 1 });
      repository.jsonl.mockResolvedValueOnce([{ seq: 1, line: '{"seq": 1}' }]);

      const file = await service.exportTranscript(TENANT.id, RUN_ID);

      expect((await collect(file.chunks)).join("")).toBe('{"seq": 1}\n');
    });

    it("reads nothing for an empty transcript", async () => {
      findable({ simulated: false, event_seq: 0 });

      const file = await service.exportTranscript(TENANT.id, RUN_ID);

      expect(await collect(file.chunks)).toEqual([]);
      expect(repository.jsonl).not.toHaveBeenCalled();
    });

    it("reads one batch at a time, only when the previous one has been consumed", async () => {
      // Memory stays flat: however long the transcript, the export holds one batch.
      findable({ simulated: false, event_seq: RUN_EXPORT_BATCH * 2 + 1 });
      const batch = (from: number, size: number) =>
        Array.from({ length: size }, (_, index) => ({
          seq: from + index,
          line: `{"seq": ${String(from + index)}}`,
        }));
      repository.jsonl
        .mockResolvedValueOnce(batch(1, RUN_EXPORT_BATCH))
        .mockResolvedValueOnce(batch(RUN_EXPORT_BATCH + 1, RUN_EXPORT_BATCH))
        .mockResolvedValueOnce(batch(RUN_EXPORT_BATCH * 2 + 1, 1));

      const file = await service.exportTranscript(TENANT.id, RUN_ID);
      // Nothing is read until the stream is pulled.
      expect(repository.jsonl).not.toHaveBeenCalled();

      const iterator = file.chunks[Symbol.asyncIterator]();
      await iterator.next();
      expect(repository.jsonl).toHaveBeenCalledTimes(1);

      await iterator.next();
      expect(repository.jsonl).toHaveBeenCalledTimes(2);

      const rest: string[] = [];
      for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
        rest.push(next.value);
      }

      expect(repository.jsonl).toHaveBeenCalledTimes(3);
      expect(repository.jsonl.mock.calls.map((call) => call[1])).toEqual([
        0,
        RUN_EXPORT_BATCH,
        RUN_EXPORT_BATCH * 2,
      ]);
      // Every read is bounded above by the transcript as it stood when the export began, and
      // asks for at most one batch.
      for (const call of repository.jsonl.mock.calls) {
        expect(call[2]).toBe(RUN_EXPORT_BATCH * 2 + 1);
        expect(call[3]).toBe(RUN_EXPORT_BATCH);
      }
      expect(rest).toEqual([`{"seq": ${String(RUN_EXPORT_BATCH * 2 + 1)}}\n`]);
    });

    it("stops at a short read rather than looping on a transcript that shrank beneath it", async () => {
      findable({ simulated: false, event_seq: 5 });
      repository.jsonl.mockResolvedValueOnce([]);

      const file = await service.exportTranscript(TENANT.id, RUN_ID);

      expect(await collect(file.chunks)).toEqual([]);
      expect(repository.jsonl).toHaveBeenCalledTimes(1);
    });
  });
});
