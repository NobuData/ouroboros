import { readFileSync } from "node:fs";
import { join } from "node:path";

import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { TelemetryRepository, type HistorySubject } from "./telemetry.repository";

/**
 * The telemetry repository's statements (#619), against a real Kysely over a recording driver:
 * the SQL asserted is the SQL PostgreSQL would receive.
 *
 * Two properties are structural and asserted over **every** statement, enumerated rather than
 * sampled: each is a `select` and nothing else — the adapter is read-only across its planes —
 * and each carries the workspace by parameter.
 */

const ORG = "org-acme";
const CASE = "a7ee68b68b6e533f32d3be7b75e4ea550bb860bfaf04e02fde18b55dd4f946d0";
const WINDOW = { from: new Date("2026-10-03T00:00:00Z"), to: new Date("2026-10-10T00:00:00Z") };
const REPO = "acme-robotics/helios-firmware";
const BY_CASE: HistorySubject = { kind: "case", caseKey: CASE };
const BY_SUITE: HistorySubject = { kind: "suite", suite: "PHYSICAL · HIL rig" };

/** One row wide enough to answer any of the statements — each reads the columns it selects. */
const ZEROS = {
  runs: "0",
  cases: "0",
  passed: "0",
  failed: "0",
  flaky: "0",
  skipped: "0",
  errored: "0",
  retries: null,
  first_observed_at: null,
  last_observed_at: null,
  scored: "0",
  max_score: null,
  healthy: "0",
  watching: "0",
  quarantined: "0",
  last_scored_at: null,
  measurements: "0",
  metrics: "0",
  baselines: "0",
  release_tag: "v2.0.4",
  window: { n: 1, median: 1, spread: 0, spread_kind: "iqr", unit: "cm", from: "a", to: "b" },
};

/** Every statement the repository can issue. */
const EVERY_STATEMENT: readonly [string, (repository: TelemetryRepository) => Promise<unknown>][] =
  [
    ["measurements", (r) => r.measurements(ORG, CASE, "overshoot_pct", WINDOW, null)],
    [
      "measurements, one repository",
      (r) => r.measurements(ORG, CASE, "overshoot_pct", WINDOW, REPO),
    ],
    ["baseline", (r) => r.baseline(ORG, `${CASE}:overshoot_pct`, "v2.0.4")],
    ["caseHistory by case", (r) => r.caseHistory(ORG, BY_CASE, WINDOW, null)],
    ["caseHistory by suite", (r) => r.caseHistory(ORG, BY_SUITE, WINDOW, REPO)],
    ["flakeContext by case", (r) => r.flakeContext(ORG, BY_CASE, WINDOW, null)],
    ["flakeContext by suite", (r) => r.flakeContext(ORG, BY_SUITE, WINDOW, REPO)],
    ["runDays", (r) => r.runDays(ORG, WINDOW, REPO)],
    ["tokenDays", (r) => r.tokenDays(ORG, WINDOW, null)],
    ["tokenDays, one repository", (r) => r.tokenDays(ORG, WINDOW, REPO)],
    ["summary", (r) => r.summary(ORG)],
  ];

describe("the telemetry repository", () => {
  let database: RecordingDatabase;
  let repository: TelemetryRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new TelemetryRepository(database.service);
    database.answers({ rows: [ZEROS] });
  });

  describe("is read-only, across every plane", () => {
    it.each(EVERY_STATEMENT)("issues one select and nothing else for %s", async (_name, issue) => {
      await issue(repository);

      expect(database.statements).toHaveLength(1);

      const text = database.statements[0].sql.replace(/\s+/g, " ").trim().toLowerCase();

      expect(text.startsWith("select ")).toBe(true);
      expect(text).not.toMatch(
        /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|call|copy|lock|refresh|nextval|setval|for update|for share)\b/,
      );
      expect(text).not.toContain(";");
    });

    it("has no write in its source at all — not behind a branch no test takes", () => {
      const source = readFileSync(join(__dirname, "telemetry.repository.ts"), "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        "",
      );

      expect(source).not.toMatch(/insertInto|updateTable|deleteFrom|mergeInto|\.transaction\(/);
      expect(source).not.toMatch(/\b(insert\s+into|update\s+\$|delete\s+from|truncate)\b/i);
    });

    it("exposes nothing but reads", () => {
      const members = Object.getOwnPropertyNames(TelemetryRepository.prototype).filter(
        (name) => name !== "constructor",
      );

      expect(members.toSorted()).toEqual([
        "baseline",
        "caseHistory",
        "flakeContext",
        "measurements",
        "repositories",
        "runDays",
        "subjectMatches",
        "summary",
        "tokenDays",
      ]);
    });

    it("reads only the planes it names: measurements, case history, flake scores, runs, usage, baselines", async () => {
      const tables = new Set<string>();

      for (const [, issue] of EVERY_STATEMENT) {
        database = recordingDatabase();
        database.answers({ rows: [ZEROS] });
        await issue(new TelemetryRepository(database.service));
        for (const match of database.statements[0].sql.matchAll(/"ouroboros"\.([a-z_]+)/g)) {
          tables.add(match[1]);
        }
      }

      expect([...tables].toSorted()).toEqual([
        "flake_scores",
        "github_orgs",
        "github_repos",
        "hil_measurements",
        "metric_daily",
        "regression_baselines",
        "runs",
        "test_case_history",
        "test_cases",
        "test_runs",
        "test_suites",
        "token_usage",
      ]);
    });
  });

  describe("keeps to the asking workspace", () => {
    it.each(EVERY_STATEMENT)(
      "carries the workspace into %s, by parameter",
      async (_name, issue) => {
        await issue(repository);

        const { sql, parameters } = database.statements[0];

        expect(parameters).toContain(ORG);
        // Never interpolated: the statement text holds no workspace id.
        expect(sql).not.toContain(ORG);
      },
    );

    it("filters the driving table of every statement on the workspace", async () => {
      const driving: readonly [string, (r: TelemetryRepository) => Promise<unknown>, RegExp][] = [
        [
          "measurements",
          (r) => r.measurements(ORG, CASE, "m", WINDOW, null),
          /m\.organization_id = \$\d+/,
        ],
        ["baseline", (r) => r.baseline(ORG, "merge_rate", "v1"), /b\.organization_id = \$\d+/],
        [
          "caseHistory",
          (r) => r.caseHistory(ORG, BY_SUITE, WINDOW, null),
          /h\.organization_id = \$\d+/,
        ],
        [
          "flakeContext",
          (r) => r.flakeContext(ORG, BY_CASE, WINDOW, null),
          /f\.organization_id = \$\d+/,
        ],
        ["runDays", (r) => r.runDays(ORG, WINDOW, null), /r\.organization_id = \$\d+/],
        ["tokenDays", (r) => r.tokenDays(ORG, WINDOW, null), /u\.organization_id = \$\d+/],
      ];

      for (const [, issue, predicate] of driving) {
        database = recordingDatabase();
        database.answers({ rows: [ZEROS] });
        await issue(new TelemetryRepository(database.service));

        expect(database.statements[0].sql).toMatch(predicate);
      }
    });

    it("resolves a repository inside the workspace's own mirror, so another's name matches nothing", async () => {
      await repository.runDays(ORG, WINDOW, "other-org/their-repo");

      const { sql, parameters } = database.statements[0];

      expect(sql).toMatch(/go\.organization_id = \$\d+/);
      expect(sql).toContain("lower(go.login || '/' || gr.name) = lower(");
      expect(parameters).toContain("other-org/their-repo");
      expect(sql).not.toContain("their-repo");
    });

    it("holds a suite's cases to the workspace too", async () => {
      await repository.caseHistory(ORG, BY_SUITE, WINDOW, null);

      expect(database.statements[0].sql).toMatch(/c\.organization_id = \$\d+/);
      expect(database.statements[0].parameters).toContain("PHYSICAL · HIL rig");
    });
  });

  describe("reads a window as [from, to), and fills nothing in", () => {
    it("bounds measurements by the start of the test run that took them", async () => {
      await repository.measurements(ORG, CASE, "overshoot_pct", WINDOW, null);

      const { sql, parameters } = database.statements[0];

      expect(sql).toMatch(/tr\.started_at >= \$\d+\s+and tr\.started_at < \$\d+/);
      expect(parameters).toEqual(
        expect.arrayContaining([WINDOW.from, WINDOW.to, CASE, "overshoot_pct"]),
      );
    });

    it("groups runs and usage by UTC day without generating the days in between", async () => {
      await repository.runDays(ORG, WINDOW, null);
      await repository.tokenDays(ORG, WINDOW, null);

      for (const { sql } of database.statements) {
        expect(sql).toContain("at time zone 'UTC'");
        expect(sql).not.toMatch(/generate_series|coalesce\(\s*(count|sum)/i);
      }
    });

    it("leaves a simulator's runs out of the series", async () => {
      await repository.runDays(ORG, WINDOW, null);

      expect(database.statements[0].sql).toContain("not r.simulated");
    });
  });

  describe("what it answers", () => {
    it("reads measurement values as numbers, oldest first", async () => {
      database = recordingDatabase();
      database.answers({
        rows: [
          { value: "2.4", unit: "%", verdict: "fail", at: new Date("2026-10-09T01:00:00Z") },
          { value: "1.7", unit: "%", verdict: "pass", at: new Date("2026-10-09T04:00:00Z") },
        ],
      });

      const samples = await new TelemetryRepository(database.service).measurements(
        ORG,
        CASE,
        "overshoot_pct",
        WINDOW,
        null,
      );

      expect(samples.map((sample) => sample.value)).toEqual([2.4, 1.7]);
      expect(database.statements[0].sql).toContain("order by tr.started_at");
    });

    it("answers an empty array — not a zero — when nothing was measured", async () => {
      database = recordingDatabase();
      database.answers({ rows: [] });

      expect(
        await new TelemetryRepository(database.service).measurements(ORG, CASE, "m", WINDOW, null),
      ).toEqual([]);
    });

    it("reads a baseline's stored window, the latest capture for the release", async () => {
      database = recordingDatabase();
      database.answers({
        rows: [
          {
            release_tag: "v2.0.4",
            window: {
              n: 48,
              median: 31.0,
              spread: 4.2,
              spread_kind: "iqr",
              unit: "cm",
              from: "2026-07-25T02:35:47Z",
              to: "2026-08-01T02:35:47Z",
            },
          },
        ],
      });

      const baseline = await new TelemetryRepository(database.service).baseline(
        ORG,
        `${CASE}:hover_drift_cm`,
        "v2.0.4",
      );

      expect(baseline).toEqual({
        releaseTag: "v2.0.4",
        n: 48,
        median: 31,
        spread: 4.2,
        spreadKind: "iqr",
        unit: "cm",
        from: "2026-07-25T02:35:47Z",
        to: "2026-08-01T02:35:47Z",
      });
      expect(database.statements[0].sql).toContain("order by b.captured_at desc");
      expect(database.statements[0].parameters).toEqual([ORG, `${CASE}:hover_drift_cm`, "v2.0.4"]);
    });

    it("answers undefined for a release that captured no baseline", async () => {
      database = recordingDatabase();
      database.answers({ rows: [] });

      expect(
        await new TelemetryRepository(database.service).baseline(ORG, "merge_rate", "v9"),
      ).toBeUndefined();
    });

    it("reads case-history counts as numbers and keeps the absent times null", async () => {
      expect(await repository.caseHistory(ORG, BY_CASE, WINDOW, null)).toEqual({
        runs: 0,
        cases: 0,
        passed: 0,
        failed: 0,
        flaky: 0,
        skipped: 0,
        errored: 0,
        retries: 0,
        firstObservedAt: null,
        lastObservedAt: null,
      });
    });

    it("keeps an unscored suite's highest score null — not 0, which would read as healthy", async () => {
      database = recordingDatabase();
      database.answers({ rows: [] });

      expect(
        await new TelemetryRepository(database.service).flakeContext(ORG, BY_SUITE, WINDOW, null),
      ).toEqual({
        scored: 0,
        maxScore: null,
        healthy: 0,
        watching: 0,
        quarantined: 0,
        lastScoredAt: null,
      });
    });

    it("folds the scorer's states into counts, the highest score and the latest scoring", async () => {
      database = recordingDatabase();
      database.answers({
        rows: [
          {
            state: "healthy",
            scored: "5",
            max_score: "0.1",
            last_scored_at: new Date("2026-10-08T03:00:00Z"),
          },
          {
            state: "watching",
            scored: "2",
            max_score: "0.42",
            last_scored_at: new Date("2026-10-09T03:00:00Z"),
          },
          {
            state: "quarantined",
            scored: "1",
            max_score: "0.9",
            last_scored_at: new Date("2026-10-07T03:00:00Z"),
          },
        ],
      });

      expect(
        await new TelemetryRepository(database.service).flakeContext(ORG, BY_SUITE, WINDOW, null),
      ).toEqual({
        scored: 8,
        maxScore: 0.9,
        healthy: 5,
        watching: 2,
        quarantined: 1,
        lastScoredAt: new Date("2026-10-09T03:00:00Z"),
      });
      // It names no state: the scorer is the only code that spells one beside an equals sign.
      expect(database.statements[0].sql).toContain("group by f.state");
      expect(database.statements[0].sql).not.toMatch(/'(quarantined|watching|healthy)'/);
    });

    it("keeps a day's cost null when none of its calls was priced", async () => {
      database = recordingDatabase();
      database.answers({
        rows: [
          {
            day: "2026-10-07",
            events: "2",
            tokens_in: "4000",
            tokens_out: "700",
            cost_cents: null,
            unpriced_events: "2",
          },
        ],
      });

      expect(await new TelemetryRepository(database.service).tokenDays(ORG, WINDOW, null)).toEqual([
        {
          day: "2026-10-07",
          events: 2,
          tokensIn: 4000,
          tokensOut: 700,
          costCents: null,
          unpricedEvents: 2,
        },
      ]);
    });
  });
});
