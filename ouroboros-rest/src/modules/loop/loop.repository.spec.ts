import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { LoopRepository } from "./loop.repository";

/**
 * Both statements, against a database that records instead of running them.
 *
 * The acceptance criterion this guards is organisation isolation: a workspace never learns
 * another's connection or runner state through a reason. The reasons are computed from these
 * two answers alone, so it is enough that the workspace is a bound parameter of each — and
 * that nothing else could widen them.
 */
const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

describe("the loop repository (DG.2, #1300)", () => {
  let database: RecordingDatabase;
  let repository: LoopRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new LoopRepository(database.service);
  });

  describe("invocableConnectionExists", () => {
    it("asks only within the workspace, for enabled, unpaused connections of the given kinds", async () => {
      database.answers({ rows: [{ id: "connection-1" }] });

      await expect(
        repository.invocableConnectionExists(WORKSPACE, ["anthropic", "ollama"]),
      ).resolves.toBe(true);

      const [statement] = database.statements;

      expect(statement.sql).toMatch(/from "ouroboros"\."provider_connections"/);
      expect(statement.sql).toMatch(/"organization_id" = \$1/);
      expect(statement.sql).toMatch(/"kind" in \(\$2, \$3\)/);
      expect(statement.sql).toMatch(/"enabled" = \$4/);
      expect(statement.sql).toMatch(/"status" != \$5/);
      expect(statement.sql).toMatch(/limit \$6/);
      expect(statement.parameters).toEqual([WORKSPACE, "anthropic", "ollama", true, "paused", 1]);
      // Nothing secret is read.
      expect(statement.sql).not.toContain("credentials_encrypted");
    });

    it("answers false when the workspace has none", async () => {
      database.answers({ rows: [] });

      await expect(repository.invocableConnectionExists(WORKSPACE, ["anthropic"])).resolves.toBe(
        false,
      );
    });

    it("asks nothing when no kind is cleared", async () => {
      await expect(repository.invocableConnectionExists(WORKSPACE, [])).resolves.toBe(false);
      expect(database.statements).toHaveLength(0);
    });
  });

  describe("runnerPresence", () => {
    it("reads only the workspace's active, dispatchable runners", async () => {
      database.answers({ rows: [] });

      await repository.runnerPresence(WORKSPACE);

      const [statement] = database.statements;

      expect(statement.sql).toMatch(/select "capabilities" from "ouroboros"\."runners"/);
      expect(statement.sql).toMatch(/"organization_id" = \$1/);
      expect(statement.parameters).toEqual([WORKSPACE, "active", "online", "building"]);
    });

    it("is offline with no rows", async () => {
      database.answers({ rows: [] });

      await expect(repository.runnerPresence(WORKSPACE)).resolves.toEqual({
        online: false,
        sourceCheckout: false,
      });
    });

    it("is online without source checkout for today's capability documents", async () => {
      database.answers({
        rows: [{ capabilities: { docker: true, executors: ["container"] } }, { capabilities: {} }],
      });

      await expect(repository.runnerPresence(WORKSPACE)).resolves.toEqual({
        online: true,
        sourceCheckout: false,
      });
    });

    it("sees source checkout when one runner reports it", async () => {
      database.answers({
        rows: [{ capabilities: { executors: ["shell"] } }, { capabilities: { git: true } }],
      });

      await expect(repository.runnerPresence(WORKSPACE)).resolves.toEqual({
        online: true,
        sourceCheckout: true,
      });
    });
  });
});
