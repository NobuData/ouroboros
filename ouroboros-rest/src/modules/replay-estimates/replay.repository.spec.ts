import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ReplayEstimateRepository } from "./replay.repository";

/**
 * The three statements (#561), against a real Kysely over a recording driver: the SQL asserted is
 * the SQL PostgreSQL would receive. What matters here is *which definitions the statements go
 * through* — the arithmetic is V121's functions, proven in `ouroboros-db/tests/constraints.sql`,
 * and a second implementation of it here would drift from the dev seed's replayed row.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";
const REPOSITORY = { id: "5eed0006-0000-4000-8000-000000000001", name: "helios-firmware" };
const CLASS =
  "pool-a · helios-firmware · container · ghcr.io/acme-robotics/zephyr-sdk · west build -b helios_mainboard app";

/** A build sample's row, as the driver returns it: `bigint` columns are strings. */
const BUILD_ROW = {
  command: "west build -b helios_mainboard app",
  similarity_class: CLASS,
  window_days: 30,
  sample_floor: 20,
  sample_count: "217",
  median_ms: "222000",
  spread_ms: "22000",
  cache_measured: "215",
  warm_count: "190",
  warm_median_ms: "219000",
  cold_count: "25",
  cold_median_ms: "405000",
};

describe("the replay estimate repository", () => {
  let database: RecordingDatabase;
  let repository: ReplayEstimateRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new ReplayEstimateRepository(database.service);
  });

  describe("a dry run's context", () => {
    it("finds the dry run by id and resolves the repository its ticket names, inside its workspace", async () => {
      database.answers({
        rows: [{ organization_id: WORKSPACE, repo_id: REPOSITORY.id, repo_name: REPOSITORY.name }],
      });

      expect(await repository.context(DRY_RUN)).toEqual({
        organizationId: WORKSPACE,
        repository: REPOSITORY,
      });

      const { sql, parameters } = database.statements[0];

      expect(parameters).toEqual([DRY_RUN]);
      expect(sql).toContain('"ouroboros".dry_runs');
      // The ticket, the mirror's organisation and the repository are all held to the dry run's
      // own workspace — a ticket naming another workspace's repository resolves to nothing.
      expect(sql).toContain("t.organization_id = r.organization_id");
      expect(sql).toContain("gh.organization_id = r.organization_id");
      expect(sql).toContain("repo.org_id = gh.id");
      expect(sql).toContain("'{github,owner}'");
      expect(sql).toContain("'{github,repo}'");
    });

    it("answers undefined when no dry run has the id", async () => {
      database.answers({ rows: [] });

      expect(await repository.context(DRY_RUN)).toBeUndefined();
    });

    it("answers a null repository when the ticket names none the workspace mirrors", async () => {
      database.answers({ rows: [{ organization_id: WORKSPACE, repo_id: null, repo_name: null }] });

      expect(await repository.context(DRY_RUN)).toEqual({
        organizationId: WORKSPACE,
        repository: null,
      });
    });
  });

  describe("a build sample", () => {
    it("asks V121's own functions, rather than re-deriving the class or the statistics", async () => {
      database.answers({ rows: [BUILD_ROW] });

      await repository.buildSample(WORKSPACE, REPOSITORY, "pool-a", null);

      const { sql } = database.statements[0];

      expect(sql).toContain('"ouroboros".build_replay_sample(');
      expect(sql).toContain('"ouroboros".build_similarity_class(');
      expect(sql).toContain('"ouroboros".replay_estimate_policy()');
      // No arithmetic and no history table of its own.
      expect(sql).not.toMatch(/percentile|build_jobs|stddev|avg\(/);
      // The window is the policy's, ending on the database's clock.
      expect(sql).toContain("now(), policy.window_days");
    });

    it("scopes the pool to the workspace, by parameter", async () => {
      database.answers({ rows: [BUILD_ROW] });

      await repository.buildSample(WORKSPACE, REPOSITORY, "pool-a", "west build -b board app");

      const { sql, parameters } = database.statements[0];

      expect(sql).toMatch(/p\.organization_id = \$\d+/);
      expect(sql).toMatch(/p\.name = \$\d+/);
      expect(parameters).toEqual(
        expect.arrayContaining([
          WORKSPACE,
          REPOSITORY.id,
          REPOSITORY.name,
          "pool-a",
          "west build -b board app",
        ]),
      );
      // Nothing the caller named is interpolated into the statement.
      expect(sql).not.toContain("pool-a");
      expect(sql).not.toContain("west build");
    });

    it("takes the pool's own executor, image and default command — what a build would run under", async () => {
      database.answers({ rows: [BUILD_ROW] });

      await repository.buildSample(WORKSPACE, REPOSITORY, "pool-a", null);

      const { sql, parameters } = database.statements[0];

      expect(sql).toContain("p.executor, p.image");
      expect(sql).toMatch(/coalesce\(\$\d+::text, p\.default_command\)/);
      expect(parameters).toContain(null);
    });

    it("reads the driver's strings as numbers", async () => {
      database.answers({ rows: [BUILD_ROW] });

      expect(await repository.buildSample(WORKSPACE, REPOSITORY, "pool-a", null)).toEqual({
        command: "west build -b helios_mainboard app",
        similarityClass: CLASS,
        policy: { windowDays: 30, sampleFloor: 20 },
        sample: { sampleCount: 217, medianMs: 222_000, spreadMs: 22_000 },
        cache: {
          measured: 215,
          warmCount: 190,
          warmMedianMs: 219_000,
          coldCount: 25,
          coldMedianMs: 405_000,
        },
      });
    });

    it("keeps null as null for a class nobody has built — never zero", async () => {
      database.answers({
        rows: [
          {
            ...BUILD_ROW,
            sample_count: "0",
            median_ms: null,
            spread_ms: null,
            cache_measured: "0",
            warm_count: "0",
            warm_median_ms: null,
            cold_count: "0",
            cold_median_ms: null,
          },
        ],
      });

      const row = await repository.buildSample(WORKSPACE, REPOSITORY, "pool-a", null);

      expect(row?.sample).toEqual({ sampleCount: 0, medianMs: null, spreadMs: null });
      expect(row?.cache).toEqual({
        measured: 0,
        warmCount: 0,
        warmMedianMs: null,
        coldCount: 0,
        coldMedianMs: null,
      });
    });

    it("answers undefined when the workspace has no pool of that name", async () => {
      database.answers({ rows: [] });

      expect(await repository.buildSample(WORKSPACE, REPOSITORY, "pool-z", null)).toBeUndefined();
    });

    it("passes through a pool with no command to compare by", async () => {
      database.answers({
        rows: [{ ...BUILD_ROW, command: null, similarity_class: null, sample_count: "0" }],
      });

      const row = await repository.buildSample(WORKSPACE, REPOSITORY, "pool-b", null);

      expect(row?.command).toBeNull();
      expect(row?.similarityClass).toBeNull();
    });
  });

  describe("a test sample", () => {
    const TEST_ROW = {
      suites: ["hil", "unit"],
      similarity_class: "helios-firmware · tests · hil + unit",
      window_days: 30,
      sample_floor: 20,
      sample_count: "6",
      median_ms: "625000",
      spread_ms: "15000",
    };

    it("reads test history through V121's test function, and no build history at all", async () => {
      database.answers({ rows: [TEST_ROW] });

      await repository.testSample(WORKSPACE, REPOSITORY, null);

      const { sql } = database.statements[0];

      expect(sql).toContain('"ouroboros".test_replay_sample(');
      expect(sql).toContain('"ouroboros".test_similarity_class(');
      expect(sql).toContain('"ouroboros".replay_estimate_policy()');
      expect(sql).not.toMatch(/build_replay_sample|build_jobs|percentile/);
    });

    it("carries the workspace, the repository and the suite set by parameter", async () => {
      database.answers({ rows: [TEST_ROW] });

      await repository.testSample(WORKSPACE, REPOSITORY, ["unit", "hil"]);

      const { sql, parameters } = database.statements[0];

      expect(parameters).toEqual(
        expect.arrayContaining([WORKSPACE, REPOSITORY.id, REPOSITORY.name]),
      );
      expect(parameters).toContainEqual(["unit", "hil"]);
      expect(sql).toMatch(/\$\d+::text\[\]/);
    });

    it("sends null for no suite set, so the database takes the last measured one", async () => {
      database.answers({ rows: [TEST_ROW] });

      await repository.testSample(WORKSPACE, REPOSITORY, null);

      expect(database.statements[0].parameters).toContain(null);
    });

    it("answers the set that was matched and the statistics as numbers", async () => {
      database.answers({ rows: [TEST_ROW] });

      expect(await repository.testSample(WORKSPACE, REPOSITORY, null)).toEqual({
        suites: ["hil", "unit"],
        similarityClass: "helios-firmware · tests · hil + unit",
        policy: { windowDays: 30, sampleFloor: 20 },
        sample: { sampleCount: 6, medianMs: 625_000, spreadMs: 15_000 },
      });
    });

    it("answers no set and no statistics for a repository with no measured test run", async () => {
      database.answers({
        rows: [
          {
            ...TEST_ROW,
            suites: null,
            similarity_class: null,
            sample_count: "0",
            median_ms: null,
            spread_ms: null,
          },
        ],
      });

      expect(await repository.testSample(WORKSPACE, REPOSITORY, null)).toMatchObject({
        suites: null,
        similarityClass: null,
        sample: { sampleCount: 0, medianMs: null, spreadMs: null },
      });
    });
  });
});
