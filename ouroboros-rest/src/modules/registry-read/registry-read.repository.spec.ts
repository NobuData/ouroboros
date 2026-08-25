import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { RegistryReadRepository } from "./registry-read.repository";

/**
 * The three statements, against a database that writes them down instead of running them.
 *
 * What this asserts is the two properties the file header claims, and neither of them is
 * visible from a passing integration test:
 *
 *   * **The workspace is a parameter of every statement** — including the discovery read, whose
 *     table has no workspace column and whose predicate therefore lives on a join;
 *   * **`credentials_encrypted` is named in one statement and never with anything else** — the
 *     shape `provider-health/provider-health.repository.ts` keeps for the same table, and the
 *     reason a leak here would be bounded by what a `select` can see.
 *
 * What the statements *do* is `registry-read.integration-spec.ts`'s question, against a migrated
 * PostgreSQL.
 */
const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

describe("the registry read repository", () => {
  let database: RecordingDatabase;
  let repository: RegistryReadRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new RegistryReadRepository(database.service);
  });

  const reads: readonly [string, (repository: RegistryReadRepository) => Promise<unknown>][] = [
    ["connections", (r) => r.connections(WORKSPACE)],
    ["discoveredModels", (r) => r.discoveredModels(WORKSPACE)],
    ["sealedCredentials", (r) => r.sealedCredentials(WORKSPACE)],
  ];

  describe("scoping", () => {
    it.each(reads)("carries the workspace into %s, by parameter", async (_name, issue) => {
      await issue(repository);

      const [statement] = database.statements;

      expect(statement.parameters).toContain(WORKSPACE);
      expect(statement.sql).not.toContain(WORKSPACE);
    });

    it("scopes the discovery read through the join, because the table has no workspace column", () => {
      // V017's argument, from this side: `provider_models` carries no `organization_id`, its
      // tenancy is the foreign key, and every read enters through a join that carries the
      // predicate. Written as the join rather than as a filter so it is visible in the SQL.
      return repository.discoveredModels(WORKSPACE).then(() => {
        const [{ sql }] = database.statements;

        expect(sql).toMatch(/inner join\s+"ouroboros"\."provider_connections"/i);
        expect(sql).toMatch(/where\s+"c"\."organization_id"\s*=/i);
      });
    });
  });

  describe("what the statements ask for, and what they never do", () => {
    it("reads the sealed column in one statement, with nothing but the id beside it", async () => {
      await repository.sealedCredentials(WORKSPACE);

      const [{ sql }] = database.statements;

      expect(sql).toContain("credentials_encrypted");
      expect(sql).toMatch(/select\s+"id",\s*"credentials_encrypted"\s+from/i);
    });

    it.each([
      ["connections", (r: RegistryReadRepository) => r.connections(WORKSPACE)],
      ["discoveredModels", (r: RegistryReadRepository) => r.discoveredModels(WORKSPACE)],
    ])("does not name the credential column in %s", async (_name, issue) => {
      await issue(repository);

      for (const sql of database.sql()) {
        expect(sql).not.toContain("credentials_encrypted");
        expect(sql).not.toMatch(/select\s+\*/i);
      }
    });

    it("selects the seven connection columns the health cell turns on, and no more", async () => {
      await repository.connections(WORKSPACE);

      const [{ sql }] = database.statements;

      for (const column of [
        "id",
        "kind",
        "display_name",
        "enabled",
        "status",
        "last_checked_at",
        "health",
      ]) {
        expect(sql).toContain(`"${column}"`);
      }

      // The columns a page does not need are the columns it cannot leak.
      expect(sql).not.toContain("monthly_cap_cents");
      expect(sql).not.toContain("added_by");
    });

    it("asks discovery for the pair and nothing else", async () => {
      await repository.discoveredModels(WORKSPACE);

      const [{ sql }] = database.statements;

      expect(sql).toContain(`"${SCHEMA_NAME}"."provider_models"`);
      expect(sql).toMatch(/select\s+"m"\."provider_connection_id",\s*"m"\."model_id"/i);
      expect(sql).not.toContain("size_bytes");
    });
  });

  describe("one round trip per question, whatever the registry holds", () => {
    it.each(reads)("issues exactly one statement for %s", async (_name, issue) => {
      await issue(repository);

      expect(database.statements).toHaveLength(1);
    });

    it("keys the envelopes by connection, keeping a connection that stores none", async () => {
      // Three answers rather than two: *no credential* and *not in this workspace* are
      // different, and a caller that had to guess would ask a second time to find out.
      database.answers({
        rows: [
          { id: "with", credentials_encrypted: "ouro.v1.1.nonce.cipher" },
          { id: "without", credentials_encrypted: null },
        ],
      });

      const envelopes = await repository.sealedCredentials(WORKSPACE);

      expect(envelopes.get("with")).toBe("ouro.v1.1.nonce.cipher");
      expect(envelopes.get("without")).toBeNull();
      expect(envelopes.has("elsewhere")).toBe(false);
    });

    it("orders connections by name, so a map is built the same way twice", async () => {
      await repository.connections(WORKSPACE);

      expect(database.statements[0].sql).toMatch(/order by\s+"display_name"/i);
    });
  });
});
