import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { AliasState } from "./aliases.changes";
import { AliasesRepository } from "./aliases.repository";
import type { AliasRow } from "./aliases.rows";

/**
 * Every statement, against a database that writes them down instead of running them.
 *
 * What this asserts is the property the file header claims — the workspace is a parameter of
 * every statement — plus the shape of the three statements whose shape *is* their meaning:
 * the left join that keeps an unbound alias in the list, the guard function a delete reads
 * through, and the `like` a duplicate's name is checked against. What the statements *do* is
 * `aliases.integration-spec.ts`'s question, against a migrated PostgreSQL.
 */
const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ALIAS_ID = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const CONNECTION = "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70";
const ACTOR = "user-ken";

const ROW: AliasRow = {
  id: ALIAS_ID,
  organization_id: WORKSPACE,
  alias: "coder-max",
  provider_connection_id: CONNECTION,
  model_id: "claude-fable-5",
  enabled: true,
  params: {},
  restrictions: {},
  notes: null,
  updated_by: null,
  created_at: new Date(),
  updated_at: new Date(),
  connection_kind: "anthropic",
  connection_display_name: "Anthropic Claude",
};

const STATE: AliasState = {
  alias: "coder-max",
  connectionId: CONNECTION,
  modelId: "claude-fable-5",
  enabled: true,
  params: { thinking: "max" },
  restrictions: {},
  notes: null,
};

describe("the aliases repository", () => {
  let database: RecordingDatabase;
  let repository: AliasesRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new AliasesRepository(database.service);
  });

  const reads: readonly [string, (repository: AliasesRepository) => Promise<unknown>][] = [
    ["list", (r) => r.list(WORKSPACE)],
    ["find", (r) => r.find(WORKSPACE, ALIAS_ID)],
    ["findByName", (r) => r.findByName(WORKSPACE, "coder-max")],
    ["references", (r) => r.references(WORKSPACE, [ALIAS_ID])],
    ["connection", (r) => r.connection(WORKSPACE, CONNECTION)],
    ["modelOptions", (r) => r.modelOptions(WORKSPACE, CONNECTION)],
    ["namesStartingWith", (r) => r.namesStartingWith(WORKSPACE, "coder-max-copy")],
  ];

  const writes: readonly [string, (repository: AliasesRepository) => Promise<unknown>][] = [
    [
      "insert",
      (r) => database.service.transaction((trx) => r.insert(trx, WORKSPACE, ACTOR, STATE)),
    ],
    [
      "update",
      (r) =>
        database.service.transaction((trx) => r.update(trx, WORKSPACE, ALIAS_ID, ACTOR, STATE)),
    ],
    ["delete", (r) => database.service.transaction((trx) => r.delete(trx, WORKSPACE, ALIAS_ID))],
    [
      "guardedReferences",
      (r) => database.service.transaction((trx) => r.guardedReferences(trx, WORKSPACE, ALIAS_ID)),
    ],
    [
      "recordRevision",
      (r) =>
        database.service.transaction((trx) =>
          r.recordRevision(trx, {
            organizationId: WORKSPACE,
            aliasId: ALIAS_ID,
            alias: "coder-max",
            actor: ACTOR,
            action: "edited",
            diff: { notes: { from: null, to: "x" } },
          }),
        ),
    ],
  ];

  /** The statement a call issued, skipping the transaction's own `begin`. */
  function statementOf(): { sql: string; parameters: readonly unknown[] } {
    const statement = database.statements.find(
      (candidate) => !/^(begin|commit|rollback)/i.test(candidate.sql),
    );

    if (statement === undefined) {
      throw new Error("no statement was issued");
    }

    return statement;
  }

  describe("scoping", () => {
    it.each([...reads, ...writes])(
      "carries the workspace into %s, by parameter",
      async (_name, issue) => {
        database.answers({ rows: [{ ...ROW, numAffectedRows: 1n }], numAffectedRows: 1n });
        await issue(repository);

        const statement = statementOf();

        expect(statement.parameters).toContain(WORKSPACE);
        expect(statement.sql).not.toContain(WORKSPACE);
      },
    );
  });

  describe("what the statements never ask for", () => {
    it.each([...reads, ...writes])(
      "does not name the credential column in %s",
      async (_name, issue) => {
        database.answers({ rows: [ROW], numAffectedRows: 1n });
        await issue(repository);

        for (const sql of database.sql()) {
          expect(sql).not.toContain("credentials_encrypted");
          expect(sql).not.toMatch(/select\s+\*/i);
        }
      },
    );
  });

  describe("the shapes that are the meaning", () => {
    it("lists through a left join, so an unbound alias is a row and not an absence", async () => {
      await repository.list(WORKSPACE);

      const { sql } = statementOf();

      expect(sql).toMatch(/left join\s+"ouroboros"\."provider_connections"/i);
      expect(sql).toMatch(/order by\s+"a"\."alias"/i);
    });

    it("reads references through the view, routes before rules", async () => {
      await repository.references(WORKSPACE, [ALIAS_ID]);

      const { sql } = statementOf();

      expect(sql).toContain(`"${SCHEMA_NAME}"."alias_references"`);
      expect(sql).toMatch(/order by\s+"kind"\s+desc,\s+"ref_label"/i);
    });

    it("answers no references for no aliases without a round trip", async () => {
      await expect(repository.references(WORKSPACE, [])).resolves.toEqual([]);
      expect(database.statements).toHaveLength(0);
    });

    it("reads a guarded list through the locking function, inside the transaction", async () => {
      await database.service.transaction((trx) =>
        repository.guardedReferences(trx, WORKSPACE, ALIAS_ID),
      );

      const { sql, parameters } = statementOf();

      expect(sql).toContain(`"${SCHEMA_NAME}".alias_reference_guard(`);
      expect(parameters).toEqual([WORKSPACE, ALIAS_ID]);
      expect(database.sql()[0]).toMatch(/^begin/i);
    });

    it("asks discovery the trigger's own question", async () => {
      database.answers({ rows: [{ discovered: false, catalogued: true }] });

      await expect(repository.discovery(CONNECTION, "claude-fable-5")).resolves.toEqual({
        discovered: false,
        catalogued: true,
      });

      const { sql, parameters } = statementOf();

      expect(sql).toContain("provider_model_discovered(");
      expect(parameters).toEqual([CONNECTION, "claude-fable-5", CONNECTION]);
    });

    it("answers an honest no when discovery answers nothing at all", async () => {
      await expect(repository.discovery(CONNECTION, "x")).resolves.toEqual({
        discovered: false,
        catalogued: false,
      });
    });

    it("checks a duplicate's name against every name sharing its prefix", async () => {
      database.answers({ rows: [{ alias: "coder-max-copy" }] });

      await expect(repository.namesStartingWith(WORKSPACE, "coder-max-copy")).resolves.toEqual([
        "coder-max-copy",
      ]);

      const { sql, parameters } = statementOf();

      expect(sql).toMatch(/"alias"\s+like\s+\$2/i);
      expect(parameters).toContain("coder-max-copy%");
    });

    it("writes both documents as jsonb, never as text", async () => {
      database.answers({ rows: [{ id: ALIAS_ID }] });

      await database.service.transaction((trx) => repository.insert(trx, WORKSPACE, ACTOR, STATE));

      const { sql, parameters } = statementOf();

      expect(sql.match(/::jsonb/g)).toHaveLength(2);
      expect(parameters).toContain(JSON.stringify(STATE.params));
      expect(parameters).toContain(ACTOR);
    });

    it("says whether an update or a delete reached a row", async () => {
      database.answers({ numAffectedRows: 0n }, { numAffectedRows: 1n });

      await expect(
        database.service.transaction((trx) =>
          repository.update(trx, WORKSPACE, ALIAS_ID, ACTOR, STATE),
        ),
      ).resolves.toBe(false);
      await expect(
        database.service.transaction((trx) => repository.delete(trx, WORKSPACE, ALIAS_ID)),
      ).resolves.toBe(true);
    });

    it("records a revision as one insert into alias_revisions, diff as jsonb", async () => {
      database.answers({ rows: [{ id: "a1000000-0000-0000-0000-000000000001" }] });

      await expect(
        database.service.transaction((trx) =>
          repository.recordRevision(trx, {
            organizationId: WORKSPACE,
            aliasId: null,
            alias: "coder-max",
            actor: null,
            action: "deleted",
            diff: { alias: { from: "coder-max", to: null } },
          }),
        ),
      ).resolves.toBe("a1000000-0000-0000-0000-000000000001");

      const { sql, parameters } = statementOf();

      expect(sql).toContain(`"${SCHEMA_NAME}"."alias_revisions"`);
      expect(sql).toContain("::jsonb");
      expect(parameters).toContain("deleted");
      expect(parameters).toContain(JSON.stringify({ alias: { from: "coder-max", to: null } }));
    });
  });
});
