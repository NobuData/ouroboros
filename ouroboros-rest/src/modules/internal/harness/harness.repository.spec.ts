import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { HarnessRepository, type CredentialBinding } from "./harness.repository";

const BINDING = { id: "c1", organizationId: "acme" } as CredentialBinding;

describe("the harness repository", () => {
  let database: RecordingDatabase;
  let repository: HarnessRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new HarnessRepository(database.service);
  });

  it("looks a credential up by its digest only, with its run's status", async () => {
    const digest = Buffer.alloc(32, 7);

    await repository.byDigest(digest);

    const [statement] = database.statements;
    expect(statement.sql).toContain('"h"."token_hash" = $1');
    expect(statement.sql).toContain('inner join "ouroboros"."runs" as "r"');
    expect(statement.parameters).toEqual([digest]);
  });

  it("stores the digest it is given and returns the id", async () => {
    database.answers({ rows: [{ id: "c1" }] });

    await expect(
      repository.insert({
        organizationId: "acme",
        runId: "r1",
        stage: "implement",
        alias: "coder-max",
        attempt: 1,
        digest: Buffer.alloc(32, 1),
        expiresAt: new Date("2026-10-14T11:00:00.000Z"),
      }),
    ).resolves.toBe("c1");
    expect(database.statements[0].sql).toContain('"token_hash"');
  });

  it("revokes once, keeping the first time", async () => {
    await repository.revoke("c1", new Date("2026-10-14T10:00:00.000Z"));

    expect(database.statements[0].sql).toContain('"revoked_at" is null');
  });

  it("sums a credential's usage within its workspace, per alias and model", async () => {
    database.answers({
      rows: [
        {
          alias: "coder-max",
          model: "claude-sonnet-4-5",
          input_tokens: "100",
          output_tokens: "20",
          cache_read_tokens: "5",
          cache_write_tokens: "0",
          calls: 2,
        },
      ],
    });

    await expect(repository.recorded(BINDING)).resolves.toEqual([
      {
        alias: "coder-max",
        model: "claude-sonnet-4-5",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 0,
        calls: 2,
      },
    ]);
    expect(database.statements[0].parameters).toEqual(expect.arrayContaining(["acme", "c1"]));
  });

  describe("the token budget's reads (#315)", () => {
    const ATTEMPT = {
      id: "c1",
      organizationId: "acme",
      runId: "r1",
      stage: "implement",
      attempt: 2,
    } as CredentialBinding;

    it("reads the run's pinned document within its workspace, by slug and pinned version", async () => {
      database.answers({ rows: [{ definition: { nodes: [] } }] });

      await expect(repository.pinnedDefinition(ATTEMPT)).resolves.toEqual({ nodes: [] });
      const [statement] = database.statements;
      expect(statement.sql).toContain('"w"."slug" = "r"."workflow_tag"');
      expect(statement.sql).toContain('"v"."version" = "r"."workflow_version_pin"');
      expect(statement.parameters).toEqual(["r1", "acme"]);
    });

    it("answers no document for a run with no pin", async () => {
      database.answers({ rows: [] });

      await expect(repository.pinnedDefinition(ATTEMPT)).resolves.toBeUndefined();
    });

    it("sums input and output tokens over the run, stage and attempt", async () => {
      database.answers({ rows: [{ spent: "412000" }] });

      await expect(repository.attemptTokens(ATTEMPT)).resolves.toBe(412_000);
      const [statement] = database.statements;
      expect(statement.sql).toContain("sum(tokens_in + tokens_out)");
      expect(statement.parameters).toEqual(["acme", "r1", "implement", 2]);
    });

    it("answers 0 before the attempt's first call", async () => {
      database.answers({ rows: [{ spent: null }] });

      await expect(repository.attemptTokens(ATTEMPT)).resolves.toBe(0);
    });
  });
});
