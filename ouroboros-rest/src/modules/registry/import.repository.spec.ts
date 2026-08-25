import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ImportRepository } from "./import.repository";

/**
 * The two statements bulk import adds
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)), over the recording driver —
 * `registry.repository.spec.ts` carries the argument for why this layer is asserted on the SQL
 * rather than through a mocked method.
 *
 * Two properties, and both are correctness rather than style. The workspace reaches the `where`
 * of each, because a read that did not carry it would mark one workspace's candidates with
 * another's aliases. And the names read are the **workspace's**, not the connection's, because
 * V015's uniqueness is per workspace — a suggestion checked only against this connection would
 * collide with an alias bound elsewhere and the wizard would offer a name the create refuses.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

describe("the import repository", () => {
  let database: RecordingDatabase;
  let imports: ImportRepository;

  beforeEach(() => {
    database = recordingDatabase();
    imports = new ImportRepository(database.service);
  });

  const everyStatement: readonly [string, (repository: ImportRepository) => Promise<unknown>][] = [
    ["aliasesOn", (repository) => repository.aliasesOn(WORKSPACE, CONNECTION)],
    ["aliasNames", (repository) => repository.aliasNames(WORKSPACE)],
  ];

  it.each(everyStatement)("carries the workspace into %s, by parameter", async (_name, issue) => {
    database.answers({ rows: [] });

    await issue(imports);

    const [statement] = database.statements;
    expect(statement.sql).toContain("organization_id");
    expect(statement.parameters).toContain(WORKSPACE);
    // Not interpolated. Every value this repository sends is a placeholder.
    expect(statement.sql).not.toContain(WORKSPACE);
  });

  it.each(everyStatement)("writes nothing in %s", async (_name, issue) => {
    database.answers({ rows: [] });

    await issue(imports);

    for (const sql of database.sql()) {
      expect(sql).toMatch(/^select/i);
    }
  });

  describe("aliasesOn", () => {
    it("reads the connection's aliases with the model each names, ordered by name", async () => {
      database.answers({
        rows: [
          { id: "alias-1", alias: "coder-max", model_id: "claude-fable-5" },
          { id: "alias-2", alias: "sizer", model_id: "claude-haiku-4-5" },
        ],
      });

      const rows = await imports.aliasesOn(WORKSPACE, CONNECTION);

      expect(database.statements).toHaveLength(1);
      const [statement] = database.statements;
      expect(statement.sql).toContain('"ouroboros"."model_aliases"');
      expect(statement.sql).toContain('"provider_connection_id" = $2');
      // Ordered so a model named by two aliases is marked with the same one on every read.
      expect(statement.sql).toContain('order by "alias"');
      expect(statement.parameters).toEqual([WORKSPACE, CONNECTION]);
      expect(rows).toHaveLength(2);
    });

    it("does not name the credential column", async () => {
      database.answers({ rows: [] });

      await imports.aliasesOn(WORKSPACE, CONNECTION);

      for (const sql of database.sql()) {
        expect(sql).not.toContain("credentials_encrypted");
        expect(sql).not.toMatch(/select\s+\*/i);
      }
    });
  });

  describe("aliasNames", () => {
    it("reads every name in the workspace, unbound aliases included", async () => {
      database.answers({ rows: [{ alias: "coder-max" }, { alias: "gpt5-experiments" }] });

      const names = await imports.aliasNames(WORKSPACE);

      expect(database.statements).toHaveLength(1);
      const [statement] = database.statements;
      // No connection predicate, deliberately: `gpt5-experiments` occupies its name whether or
      // not anything is on the other end of it, and V015's unique key does not care either.
      expect(statement.sql).not.toContain("provider_connection_id");
      expect(statement.parameters).toEqual([WORKSPACE]);
      expect(names).toEqual(["coder-max", "gpt5-experiments"]);
    });
  });
});
