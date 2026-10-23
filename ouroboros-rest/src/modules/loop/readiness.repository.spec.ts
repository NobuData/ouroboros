import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ReadinessRepository } from "./readiness.repository";

/**
 * Every statement, against a database that records instead of running them.
 *
 * The acceptance criterion this guards is organisation isolation: a workspace never learns
 * another's repository, workflow, pool, issue or source through a reason. The reasons are computed
 * from these answers alone, so it is enough that the workspace is a bound parameter of each — on
 * every table a statement reads that carries one.
 */
const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const NOW = new Date("2026-10-23T12:00:00Z");

describe("the readiness repository (DK.1, #1318)", () => {
  let database: RecordingDatabase;
  let repository: ReadinessRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new ReadinessRepository(database.service);
  });

  describe("repository", () => {
    it("finds the repository by owner and name, case-insensitively, within the workspace", async () => {
      database.answers({
        rows: [{ id: "repo-1", login: "Acme", name: "Helios", enabled: true }],
      });

      await expect(repository.repository(WORKSPACE, "acme", "helios")).resolves.toEqual({
        id: "repo-1",
        slug: "Acme/Helios",
        owner: "Acme",
        name: "Helios",
        enabled: true,
      });

      const [statement] = database.statements;

      expect(statement.sql).toMatch(/"github_orgs"\."organization_id" = \$1/);
      expect(statement.sql).toMatch(/lower\("ouroboros"\."github_orgs"\."login"\) = lower\(\$2\)/);
      expect(statement.sql).toMatch(/lower\("ouroboros"\."github_repos"\."name"\) = lower\(\$3\)/);
      expect(statement.parameters.slice(0, 3)).toEqual([WORKSPACE, "acme", "helios"]);
    });

    it("answers undefined when the workspace has no such repository", async () => {
      await expect(repository.repository(WORKSPACE, "acme", "nope")).resolves.toBeUndefined();
    });
  });

  describe("workflow", () => {
    it("reads the version in force of the workspace's workflow", async () => {
      database.answers({ rows: [{ slug: "live-slice", version: 2, definition: { nodes: [] } }] });

      await expect(repository.workflow(WORKSPACE, "live-slice")).resolves.toEqual({
        slug: "live-slice",
        version: 2,
        definition: { nodes: [] },
      });

      const [statement] = database.statements;

      expect(statement.sql).toMatch(
        /"workflow_versions"\."version" = "ouroboros"\."workflows"\."current_version"/,
      );
      expect(statement.sql).toMatch(/"workflows"\."organization_id" = \$1/);
      expect(statement.parameters).toEqual([WORKSPACE, "live-slice"]);
    });

    it("answers no definition for a workflow with nothing published", async () => {
      database.answers({ rows: [{ slug: "draft-only", version: null, definition: null }] });

      await expect(repository.workflow(WORKSPACE, "draft-only")).resolves.toEqual({
        slug: "draft-only",
        version: null,
        definition: undefined,
      });
    });
  });

  describe("pools", () => {
    it("asks nothing for no pool", async () => {
      await expect(repository.pools(WORKSPACE, [], NOW)).resolves.toEqual([]);
      expect(database.statements).toHaveLength(0);
    });

    it("reads the workspace's pools and their dispatchable runners, windows included", async () => {
      database.answers(
        {
          rows: [
            { id: "pool-1", name: "pool-a", executor: "container", enabled: true },
            { id: "pool-2", name: "pool-b", executor: "shell", enabled: false },
          ],
        },
        {
          rows: [
            { pool_id: "pool-1", capabilities: { git: true, executors: ["container"] } },
            { pool_id: "pool-1", capabilities: { git: true, executors: ["shell"] } },
            { pool_id: "pool-1", capabilities: { executors: ["container"] } },
            { pool_id: "pool-2", capabilities: { git: true, executors: ["shell"] } },
          ],
        },
      );

      await expect(
        repository.pools(WORKSPACE, ["pool-a", "pool-b", "pool-z"], NOW),
      ).resolves.toEqual([
        { name: "pool-a", exists: true, enabled: true, online: 3, eligible: 1 },
        { name: "pool-b", exists: true, enabled: false, online: 1, eligible: 1 },
        { name: "pool-z", exists: false, enabled: false, online: 0, eligible: 0 },
      ]);

      const [pools, runners] = database.statements;

      expect(pools.sql).toMatch(/from "ouroboros"\."runner_pools"/);
      expect(pools.sql).toMatch(/"organization_id" = \$1/);
      expect(pools.parameters[0]).toBe(WORKSPACE);
      expect(runners.sql).toMatch(/r\.organization_id = p\.organization_id/);
      expect(runners.sql).toMatch(/p\.organization_id = \$1/);
      expect(runners.sql).toMatch(/w\.organization_id = r\.organization_id/);
      expect(runners.sql).toMatch(/r\.desired_state = 'active'/);
      expect(runners.parameters[0]).toBe(WORKSPACE);
      expect(runners.parameters).toEqual(
        expect.arrayContaining(["pool-1", "pool-2", "online", "building", NOW]),
      );
    });

    it("reads no runners when no named pool exists", async () => {
      database.answers({ rows: [] });

      await expect(repository.pools(WORKSPACE, ["pool-z"], NOW)).resolves.toEqual([
        { name: "pool-z", exists: false, enabled: false, online: 0, eligible: 0 },
      ]);
      expect(database.statements).toHaveLength(1);
    });
  });

  describe("pickedIssueNumber", () => {
    it("reads the wizard's pick for this repository within the workspace", async () => {
      database.answers({ rows: [{ external_id: "488" }] });

      await expect(repository.pickedIssueNumber(WORKSPACE, "acme/helios")).resolves.toBe(488);

      const [statement] = database.statements;

      expect(statement.sql).toMatch(/"onboarding_state"\."organization_id" = \$1/);
      expect(statement.sql).toMatch(/"tickets"\."organization_id" = \$2/);
      expect(statement.parameters.slice(0, 3)).toEqual([WORKSPACE, WORKSPACE, "acme/helios"]);
    });

    it("answers undefined with no pick, or a pick that is no issue number", async () => {
      await expect(repository.pickedIssueNumber(WORKSPACE, "acme/helios")).resolves.toBeUndefined();

      database.answers({ rows: [{ external_id: "PROJ-12" }] });

      await expect(repository.pickedIssueNumber(WORKSPACE, "acme/helios")).resolves.toBeUndefined();
    });
  });

  describe("issue", () => {
    it("reads the mirrored issue and its latest estimate within the workspace", async () => {
      database.answers({
        rows: [{ number: 1, title: "Greet by name", effort: "s", estimator: "heuristic-v0" }],
      });

      await expect(repository.issue(WORKSPACE, "repo-1", 1)).resolves.toEqual({
        number: 1,
        title: "Greet by name",
        size: "s",
        sizedBy: "heuristic-v0",
      });

      const [statement] = database.statements;

      expect(statement.sql).toMatch(/order by ie\.version desc/);
      expect(statement.sql).toMatch(/i\.organization_id = \$1/);
      expect(statement.parameters).toEqual([WORKSPACE, "repo-1", 1]);
    });
  });

  describe("prSource", () => {
    it("reads the oldest GitHub source mirroring the issue, within the workspace, without its secret", async () => {
      database.answers({
        rows: [
          {
            id: "source-1",
            kind: "github",
            display_name: "acme GitHub",
            config: { login: "acme" },
            sync_cursor: null,
            synced_at: null,
          },
        ],
      });

      await expect(
        repository.prSource(WORKSPACE, { owner: "acme", name: "helios" }, 1),
      ).resolves.toEqual({
        sourceId: "source-1",
        organizationId: WORKSPACE,
        kind: "github",
        displayName: "acme GitHub",
        config: { login: "acme" },
        cursor: null,
        syncedAt: null,
      });

      const [statement] = database.statements;

      expect(statement.sql).toMatch(/"tickets"\."organization_id" = \$1/);
      expect(statement.sql).toMatch(/"ticket_sources_public"\."organization_id" = \$2/);
      expect(statement.sql).toMatch(/order by "ouroboros"\."tickets"\."created_at"/);
      expect(statement.parameters.slice(0, 2)).toEqual([WORKSPACE, WORKSPACE]);
      expect(statement.sql).not.toContain("credential");
    });
  });
});
