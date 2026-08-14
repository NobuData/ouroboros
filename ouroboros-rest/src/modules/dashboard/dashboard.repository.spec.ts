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
 * The eight statements, and the properties a card's numbers rest on.
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
      ["runStatistics", (repository) => repository.runStatistics(WORKSPACE, WINDOWS)],
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
      expect(statement.parameters.filter((value) => value === WORKSPACE)).toHaveLength(4);
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

    it("reads all four sources in one statement", async () => {
      database.answers({ rows: [{}] });

      await dashboard.version(WORKSPACE);

      expect(database.statements).toHaveLength(1);
      for (const table of ["runs", "queue_items", "token_usage", "workspace_settings"]) {
        expect(database.statements[0].sql).toContain(`"ouroboros"."${table}"`);
      }
    });
  });

  describe("the windowed numbers over runs", () => {
    /** The seeded workspace's own figures, as the one-pass statement returns them. */
    const SEEDED = {
      live_coding: 1,
      live_building: 1,
      live_review: 1,
      merged_this_week: 27,
      merged_prior_week: 19,
      interventions_this_week: 2,
      merged_over_rate_window: 46,
      closed_over_rate_window: 50,
      avg_cycle_seconds: 860,
      merged_since_morning: 6,
    };

    /** The same statement against a workspace with no history at all. */
    const EMPTY = Object.fromEntries(Object.keys(SEEDED).map((column) => [column, 0]));

    beforeEach(() => {
      database.answers({ rows: [SEEDED] });
    });

    it("computes every one of them in a single pass", async () => {
      // #72's criterion, and the reason it matters here: eleven statements would be eleven
      // scans *and* eleven chances for the numbers to describe different snapshots.
      await dashboard.runStatistics(WORKSPACE, WINDOWS);

      expect(database.statements).toHaveLength(1);
      // Ten filtered aggregates: three live counts, five windowed counts, the mean, and the
      // day's merges. Counted rather than described, so a figure added by a second statement
      // fails here rather than doubling the endpoint's reads unnoticed.
      expect(database.statements[0].sql.match(/filter \(/g)).toHaveLength(10);
    });

    it("takes every boundary from the windows it was given, never from the clock", async () => {
      await dashboard.runStatistics(WORKSPACE, WINDOWS);

      const { parameters } = database.statements[0];
      expect(parameters).toContain(WINDOWS.weekStart);
      expect(parameters).toContain(WINDOWS.priorWeekStart);
      expect(parameters).toContain(WINDOWS.dayStart);
      // `now()` in the SQL would be a second clock, and the boundary a run sat on would then
      // depend on how long the statement waited for a connection.
      expect(database.statements[0].sql).not.toContain("now()");
    });

    it("counts the prior week half-open, so no run is in both weeks", async () => {
      await dashboard.runStatistics(WORKSPACE, WINDOWS);

      // `>= priorWeekStart and < weekStart`: a run that finished exactly on the boundary is
      // counted in this week and not in the one before, so the delta is a comparison rather
      // than a double count.
      expect(database.statements[0].sql).toMatch(/finished_at >= \$\d+\s+and finished_at < \$\d+/);
    });

    it("asks whether a run has stopped by asking whether it finished", async () => {
      // `runs_terminal_finished_at` (V008) makes "has a `finished_at`" and "holds a terminal
      // status" the same condition, and the shorter question is the one the
      // `(organization_id, finished_at)` index can answer.
      await dashboard.runStatistics(WORKSPACE, WINDOWS);

      expect(database.statements[0].sql).toContain("count(*) filter (where finished_at >= $");
    });

    it("averages every run that closed this week, not only the merged ones", async () => {
      // The two definitions are distinguishable against #68's seed — 14m 20s against
      // 13m 19s — so the predicate is the definition and it is asserted rather than assumed.
      await dashboard.runStatistics(WORKSPACE, WINDOWS);

      const average = /avg\(([\s\S]*?)\) filter \(where finished_at >= \$\d+\)/.exec(
        database.statements[0].sql,
      );

      expect(average).not.toBeNull();
      expect(average?.[0]).not.toContain("status");
    });

    it("returns an empty window as zero rather than as the null an average of nothing is", async () => {
      // The `beforeEach` queued the seeded row; this queues the empty one behind it, so the
      // second call is the one being asserted about.
      database.answers({ rows: [EMPTY] });
      await dashboard.runStatistics(WORKSPACE, WINDOWS);

      const statistics = await dashboard.runStatistics(WORKSPACE, WINDOWS);

      expect(statistics.avgCycleSeconds).toBe(0);
      expect(statistics.mergedThisWeek).toBe(0);
      expect(database.sql().at(-1)).toContain("coalesce(avg(");
    });

    it("maps the row onto a record with every active status in it", async () => {
      const statistics = await dashboard.runStatistics(WORKSPACE, WINDOWS);

      expect(Object.keys(statistics.live).sort()).toEqual([...ACTIVE_RUN_STATUSES].sort());
      expect(statistics.mergedThisWeek).toBe(27);
      expect(statistics.mergedPriorWeek).toBe(19);
      expect(statistics.closedOverRateWindow).toBe(50);
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
      await dashboard.runStatistics(WORKSPACE, WINDOWS);

      for (const statement of database.sql()) {
        expect(statement).toMatch(/^select /);
      }
    });
  });
});
