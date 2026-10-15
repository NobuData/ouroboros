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
});
