import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { InsightsPageRepository } from "./page.repository";

/**
 * The page's own statements: the workspace's enabled connections' caps, summed (BJ.2, #438), and
 * its rollups' freshness (BK.6, #447).
 */

const ORG = "org-insights";

describe("the insights page repository", () => {
  let database: RecordingDatabase;
  let repository: InsightsPageRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new InsightsPageRepository(database.service);
  });

  it("sums the caps of the workspace's enabled connections, and counts the capped ones", async () => {
    database.answers({ rows: [{ monthly_cap_cents: "81500", connections: "3" }] });

    await expect(repository.caps(ORG)).resolves.toEqual({
      monthlyCapCents: 81_500,
      connections: 3,
    });

    const [{ sql, parameters }] = database.statements;

    expect(sql).toContain('sum("monthly_cap_cents")');
    // count(column), not count(*): an uncapped connection is not a capped one.
    expect(sql).toContain('count("monthly_cap_cents")');
    expect(sql).toContain('"organization_id" = $1');
    expect(sql).toContain('"enabled" = $2');
    expect(parameters).toEqual([ORG, true]);
  });

  it("answers a null cap — not zero — when no connection has one", async () => {
    database.answers({ rows: [{ monthly_cap_cents: null, connections: "0" }] });

    await expect(repository.caps(ORG)).resolves.toEqual({ monthlyCapCents: null, connections: 0 });
  });

  it("summarizes the workspace's rollup bookkeeping over every family (#447)", async () => {
    const at = new Date("2026-08-08T13:05:00.000Z");
    database.answers({
      rows: [
        {
          families: "4",
          filled_families: "3",
          earliest_filled_day: "2026-08-06",
          last_succeeded_at: at,
          failing: true,
        },
      ],
    });

    await expect(repository.freshness(ORG)).resolves.toEqual({
      families: 4,
      filledFamilies: 3,
      earliestFilledDay: "2026-08-06",
      lastSucceededAt: at,
      failing: true,
    });

    const [{ sql, parameters }] = database.statements;

    expect(sql).toContain("from ouroboros.metric_rollup_state");
    // The stalest family names the page's day; only a succeeded run counts as a fill.
    expect(sql).toContain("min(last_filled_day)");
    expect(sql).toContain("filter (where last_run_status = 'succeeded')");
    expect(parameters).toEqual([ORG]);
  });

  it("answers zeros and nulls for a workspace no rollup job has touched", async () => {
    database.answers({
      rows: [
        {
          families: "0",
          filled_families: "0",
          earliest_filled_day: null,
          last_succeeded_at: null,
          failing: null,
        },
      ],
    });

    await expect(repository.freshness(ORG)).resolves.toEqual({
      families: 0,
      filledFamilies: 0,
      earliestFilledDay: null,
      lastSucceededAt: null,
      failing: false,
    });
  });
});
