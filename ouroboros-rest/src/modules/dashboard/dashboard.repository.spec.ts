import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ACTIVE_RUN_STATUSES } from "../db/schema";
import {
  ACTIVE_RUNS_LIMIT,
  DashboardRepository,
  QUEUE_HEAD_LIMIT,
  RECENT_RUNS_LIMIT,
} from "./dashboard.repository";
import { dashboardWindows } from "./windows";

/**
 * The statements, and the properties a card's numbers rest on.
 *
 * This layer holds no rules — it holds statements — which is exactly why a mocked *method*
 * would prove nothing here: `expect(repository.runStatistics).toHaveBeenCalled()` says
 * nothing about whether the SQL it issued was scoped to one workspace, and *scoped to one
 * workspace* is the acceptance criterion the whole endpoint rests on. So these run against a
 * real Kysely over a recording driver: the compiler is real, the SQL asserted is the SQL
 * PostgreSQL would receive, and nothing is sent.
 *
 * Whether the server accepts these statements and answers correctly is
 * `dashboard.integration-spec.ts`'s question, against the same seeds the mockup was drawn
 * from.
 */

const WORKSPACE = "acme-robotics-id";

/** One request's boundaries, from a moment with nothing round about it. */
const WINDOWS = dashboardWindows(new Date("2026-08-13T14:37:41.532Z"));

describe("the dashboard repository", () => {
  let database: RecordingDatabase;
  let dashboard: DashboardRepository;

  beforeEach(() => {
    database = recordingDatabase();
    dashboard = new DashboardRepository(database.service);
  });

  describe("scoping", () => {
    /**
     * Every read this repository can perform, as a callable.
     *
     * Enumerated so the assertion below is over the surface rather than over a sample: a
     * method added without a workspace predicate is a method that would answer with somebody
     * else's numbers, and it should fail this suite on the day it is written.
     */
    const everyRead: readonly [string, (repository: DashboardRepository) => Promise<unknown>][] = [
      ["version", (repository) => repository.version(WORKSPACE)],
      ["runStatistics", (repository) => repository.runStatistics(WORKSPACE)],
      ["activeRuns", (repository) => repository.activeRuns(WORKSPACE)],
      ["recentRuns", (repository) => repository.recentRuns(WORKSPACE)],
      ["queueTotals", (repository) => repository.queueTotals(WORKSPACE)],
      ["queueHead", (repository) => repository.queueHead(WORKSPACE)],
      ["tokenTotals", (repository) => repository.tokenTotals(WORKSPACE, WINDOWS.day)],
      ["autoMerge", (repository) => repository.autoMerge(WORKSPACE)],
    ];

    it.each(everyRead)("scopes %s to one workspace, by parameter", async (_name, read) => {
      database.answers({ rows: [{}] });

      await read(dashboard);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"organization_id" = $');
      // By parameter, never by interpolation: the id is the tenant context's and this is
      // what makes it impossible for one to be spliced into SQL.
      expect(statement.parameters).toContain(WORKSPACE);
    });

    it("names the workspace once per source in the version statement", async () => {
      database.answers({ rows: [{}] });

      await dashboard.version(WORKSPACE);

      const [statement] = database.statements;
      expect(statement.parameters.filter((value) => value === WORKSPACE)).toHaveLength(7);
    });
  });

  describe("the version source", () => {
    it("counts rows and reads the newest change, and returns no row from any table", async () => {
      database.answers({ rows: [{ runs: "3 x", queueItems: "12 x", tokenUsage: "12 x" }] });

      await dashboard.version(WORKSPACE);

      const { sql } = database.statements[0];
      // What a `304` costs. A statement that selected rows here would make the cheap answer
      // as expensive as the expensive one, which is the whole point of a version source.
      expect(sql).toContain("count(*)");
      expect(sql).toContain("max(updated_at)");
      expect(sql).not.toContain("select *");
    });

    it("fingerprints token_usage on created_at, which is the only column it has", async () => {
      // V010's ledger is append-only and carries no `updated_at`. `occurred_at` would be
      // wrong for a different reason: an event back-filled from a provider's export is new
      // while its `occurred_at` is old, so a tag over it would survive the write it exists
      // to notice.
      database.answers({ rows: [{}] });

      await dashboard.version(WORKSPACE);

      expect(database.statements[0].sql).toContain("max(created_at)");
    });

    it("reads all seven sources in one statement, the shared metrics' included", async () => {
      // The pulse and the merged stat are `MetricsService` windows (#437) over the PR plane,
      // the intervention events and the rollups, so each of those must move the tag.
      database.answers({ rows: [{}] });

      await dashboard.version(WORKSPACE);

      expect(database.statements).toHaveLength(1);
      for (const table of [
        "runs",
        "queue_items",
        "token_usage",
        "workspace_settings",
        "pull_requests",
        "intervention_events",
        "metric_rollup_state",
      ]) {
        expect(database.statements[0].sql).toContain(`"ouroboros"."${table}"`);
      }
    });
  });

  describe("the live split over runs", () => {
    beforeEach(() => {
      database.answers({ rows: [{ live_coding: 1, live_building: 2, live_review: 3 }] });
    });

    it("counts every active status in a single pass", async () => {
      await dashboard.runStatistics(WORKSPACE);

      expect(database.statements).toHaveLength(1);
      expect(database.statements[0].sql.match(/filter \(/g)).toHaveLength(3);
    });

    it("computes no shared metric — those are the metrics service's (#437)", async () => {
      // A merged count, a mean cycle or a rate here would be a second implementation of a
      // registry metric, which is exactly what the amendment removed.
      await dashboard.runStatistics(WORKSPACE);

      const { sql } = database.statements[0];
      expect(sql).not.toContain("finished_at");
      expect(sql).not.toContain("avg(");
    });

    it("maps the row onto a record with every active status in it", async () => {
      const statistics = await dashboard.runStatistics(WORKSPACE);

      expect(Object.keys(statistics.live).sort()).toEqual([...ACTIVE_RUN_STATUSES].sort());
      expect(statistics.live).toEqual({ coding: 1, building: 2, review: 3 });
    });
  });

  describe("the two run lists", () => {
    it("draws the active card in lifecycle order, longest-running first", async () => {
      await dashboard.activeRuns(WORKSPACE);

      const { sql, parameters } = database.statements[0];
      // The rank comes from the constant rather than from a hand-written `case`, so widening
      // the lifecycle reorders the card without anybody editing SQL.
      expect(sql).toContain("array_position(");
      expect(sql).toContain("order by array_position");
      expect(sql).toContain('"started_at" asc');
      // …and `id` last, so two runs started in the same millisecond do not swap places
      // between polls and change the payload for no reason.
      expect(sql).toContain('"id" asc');
      expect(parameters).toContainEqual([...ACTIVE_RUN_STATUSES]);
      // Parameterised, like every other value Kysely emits — the limit is a constant of this
      // module and it still travels as a parameter rather than as text spliced into SQL.
      expect(parameters).toContain(ACTIVE_RUNS_LIMIT);
    });

    it("selects only the runs that are still in flight", async () => {
      await dashboard.activeRuns(WORKSPACE);

      expect(database.statements[0].sql).toContain('"status" in (');
    });

    it("draws the completions card newest first, off the index that orders it", async () => {
      await dashboard.recentRuns(WORKSPACE);

      const { sql } = database.statements[0];
      expect(sql).toContain('"finished_at" is not null');
      expect(sql).toContain('order by "finished_at" desc');
      expect(database.statements[0].parameters).toContain(RECENT_RUNS_LIMIT);
    });
  });

  describe("the queue", () => {
    it("sums the estimates and counts the rows, skipping what nobody sized", async () => {
      database.answers({ rows: [{ count: 12, estMinutes: 580 }] });

      const totals = await dashboard.queueTotals(WORKSPACE);

      expect(totals).toEqual({ count: 12, estMinutes: 580 });
      // `sum` skips nulls without being asked; `coalesce` is for the queue that is empty.
      expect(database.statements[0].sql).toContain("coalesce(sum(est_minutes), 0)");
    });

    it("takes the head in queue order", async () => {
      await dashboard.queueHead(WORKSPACE);

      const { sql } = database.statements[0];
      expect(sql).toContain('order by "position" asc');
      expect(database.statements[0].parameters).toContain(QUEUE_HEAD_LIMIT);
    });
  });

  describe("the day's token spend", () => {
    it("reads the view, which is what fixes the day to UTC", async () => {
      database.answers({
        rows: [{ tokens: "4200000", costCents: "1860.0000", providers: 4, unpricedEvents: 3 }],
      });

      const totals = await dashboard.tokenTotals(WORKSPACE, "2026-08-13");

      expect(totals).toEqual({
        tokens: "4200000",
        costCents: "1860.0000",
        providers: 4,
        unpricedEvents: 3,
      });
      expect(database.statements[0].sql).toContain('"ouroboros"."token_usage_daily"');
    });

    it("compares the day as text cast to date, never as an instant", async () => {
      // `pg` parses a `date` column into a `Date` at the *process's* local midnight, so a
      // `Date` computed in UTC and handed to this predicate would select the wrong day on
      // any machine whose `TZ` is not UTC — silently, and only for part of the day.
      database.answers({ rows: [{}] });

      await dashboard.tokenTotals(WORKSPACE, "2026-08-13");

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain('"day" = $2::date');
      expect(parameters).toEqual([WORKSPACE, "2026-08-13"]);
    });

    it("counts providers rather than events, which is what the subline says", async () => {
      database.answers({ rows: [{}] });

      await dashboard.tokenTotals(WORKSPACE, "2026-08-13");

      expect(database.statements[0].sql).toContain("count(distinct provider)");
    });

    it("leaves the wide numbers as text for the service to convert exactly once", async () => {
      database.answers({ rows: [{}] });

      await dashboard.tokenTotals(WORKSPACE, "2026-08-13");

      const { sql } = database.statements[0];
      expect(sql).toContain("::bigint::text");
      expect(sql).toContain("::numeric(14, 4)::text");
    });
  });

  describe("the auto-merge switch", () => {
    it("reads the effective view, so a workspace that never answered still has one", async () => {
      database.answers({ rows: [{ auto_merge_on_checks: true }] });

      expect(await dashboard.autoMerge(WORKSPACE)).toBe(true);
      expect(database.statements[0].sql).toContain('"ouroboros"."workspace_settings_effective"');
    });

    it("reads a workspace with no row at all as off", async () => {
      // Unreachable through the pipeline — the tenant guard has already established that the
      // workspace exists — and the direction of the fallback is the point: the safe default
      // for "merge without review" is never yes.
      database.answers({ rows: [] });

      expect(await dashboard.autoMerge(WORKSPACE)).toBe(false);
    });

    it("writes nothing, here or anywhere else in this repository", async () => {
      // The module's claim, as an assertion: every statement it issues is a `select`.
      database.answers({ rows: [{}] }, { rows: [{}] }, { rows: [{}] }, { rows: [{}] });

      await dashboard.autoMerge(WORKSPACE);
      await dashboard.queueHead(WORKSPACE);
      await dashboard.version(WORKSPACE);
      await dashboard.runStatistics(WORKSPACE);

      for (const statement of database.sql()) {
        expect(statement).toMatch(/^select /);
      }
    });
  });
});
