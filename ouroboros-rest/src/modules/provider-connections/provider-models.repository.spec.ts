import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { FAKE_MODELS } from "../providers/adapters/fake.adapter.fixture";
import { FIXTURE_CONNECTION, FIXTURE_WORKSPACE } from "./connection.fixture";
import {
  CONTEXT_TOKENS_KEY,
  PROVIDER_MODEL_COLUMNS,
  ProviderModelsRepository,
  TIER_KEY,
  metaOf,
  rowOf,
} from "./provider-models.repository";

/**
 * V017's upsert, as statements ([#230](https://github.com/NobuData/ouroboros/issues/230)).
 *
 * The recording database answers what a case queues and keeps every statement it was sent,
 * so the suite holds the shape of the write — the lock, the `on conflict`, the delete of what
 * the report did not name — without a PostgreSQL. The integration suite is what proves the
 * statements against a migrated schema.
 */

const AT = new Date("2026-08-25T10:00:00.000Z");

describe("one discovered model as the row the upsert writes", () => {
  it("maps the four V017 columns from the four NormalizedModel fields", () => {
    const row = rowOf(FIXTURE_CONNECTION, FAKE_MODELS[1], AT);

    expect(row).toMatchObject({
      provider_connection_id: FIXTURE_CONNECTION,
      model_id: "fake/large",
      display: "Fake Large",
      size_bytes: "19327352832",
      discovered_at: AT,
    });
  });

  it("stores the context length under the key model_prices.meta already uses", () => {
    expect(metaOf(FAKE_MODELS[0])).toEqual({ [CONTEXT_TOKENS_KEY]: 200_000 });
  });

  it("stores a tier the provider reported, and nothing where it reported none", () => {
    expect(metaOf({ ...FAKE_MODELS[0], tier: "priority" })).toEqual({
      [CONTEXT_TOKENS_KEY]: 200_000,
      [TIER_KEY]: "priority",
    });
    expect(metaOf(FAKE_MODELS[0])).not.toHaveProperty(TIER_KEY);
  });

  it("writes no key for an absent fact — P8: report what was said or say nothing", () => {
    const model = { id: "x", display: "X", contextLength: null, tier: null, sizeBytes: null };

    expect(rowOf(FIXTURE_CONNECTION, model, AT).size_bytes).toBeNull();
    expect(metaOf(model)).toEqual({});
  });
});

describe("the provider models repository", () => {
  let database: RecordingDatabase;
  let repository: ProviderModelsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new ProviderModelsRepository(database.service);
  });

  describe("reading a connection's catalog", () => {
    it("enters through the connection, carrying the workspace as a predicate", async () => {
      database.answers({ rows: [] });

      await repository.forConnection(FIXTURE_WORKSPACE, FIXTURE_CONNECTION);

      const [statement] = database.statements;
      expect(statement.sql).toContain("provider_connections");
      expect(statement.sql).toContain("organization_id");
      expect(statement.parameters).toContain(FIXTURE_WORKSPACE);
      expect(statement.parameters).toContain(FIXTURE_CONNECTION);
      expect(statement.sql).not.toContain(FIXTURE_WORKSPACE);
    });

    it("selects the catalog's columns by name, ordered by model id", async () => {
      database.answers({ rows: [] });

      await repository.forConnection(FIXTURE_WORKSPACE, FIXTURE_CONNECTION);

      const [statement] = database.statements;
      for (const column of PROVIDER_MODEL_COLUMNS) {
        expect(statement.sql).toContain(`"${column}"`);
      }
      expect(statement.sql).not.toMatch(/select\s+\*/i);
      expect(statement.sql).toMatch(/order by "m"\."model_id"/);
    });
  });

  describe("replacing a connection's catalog", () => {
    it("locks the connection for this workspace before it writes anything", async () => {
      database.answers(
        { rows: [{ id: FIXTURE_CONNECTION }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      );

      await repository.replace(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, [...FAKE_MODELS], AT);

      const reads = database.sql();
      const lock = reads.find((sql) => /for update/i.test(sql));
      expect(lock).toBeDefined();
      expect(lock).toContain("organization_id");
      expect(reads.indexOf(lock!)).toBeLessThan(reads.findIndex((sql) => /^\s*insert/i.test(sql)));
    });

    it("writes nothing, and answers undefined, for a connection this workspace does not have", async () => {
      database.answers({ rows: [] });

      const before = await repository.replace(
        FIXTURE_WORKSPACE,
        FIXTURE_CONNECTION,
        [...FAKE_MODELS],
        AT,
      );

      expect(before).toBeUndefined();
      expect(database.sql().some((sql) => /^\s*(insert|delete)/i.test(sql))).toBe(false);
    });

    it("upserts on V017's key, moving every column the report can change", async () => {
      database.answers(
        { rows: [{ id: FIXTURE_CONNECTION }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      );

      await repository.replace(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, [...FAKE_MODELS], AT);

      const insert = database.sql().find((sql) => /^\s*insert/i.test(sql))!;
      expect(insert).toMatch(/on conflict \("provider_connection_id", "model_id"\) do update/);
      for (const column of ["display", "size_bytes", "meta", "discovered_at"]) {
        expect(insert).toContain(`"${column}" = "excluded"."${column}"`);
      }
      expect(insert).toContain("::jsonb");
    });

    it("deletes what the report did not name, and only on this connection", async () => {
      database.answers(
        { rows: [{ id: FIXTURE_CONNECTION }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      );

      await repository.replace(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, [...FAKE_MODELS], AT);

      const [statement] = database.statements.filter((s) => /^\s*delete/i.test(s.sql));
      expect(statement.sql).toContain('"provider_connection_id" = ');
      expect(statement.sql).toMatch(/"model_id" not in \(/);
      expect(statement.parameters).toEqual(
        expect.arrayContaining([FIXTURE_CONNECTION, "fake/small", "fake/large"]),
      );
    });

    it("empties the catalog for a report of nothing, with no `not in ()` to refuse", async () => {
      database.answers({ rows: [{ id: FIXTURE_CONNECTION }] }, { rows: [] }, { rows: [] });

      await repository.replace(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, [], AT);

      const statements = database.sql();
      expect(statements.some((sql) => /^\s*insert/i.test(sql))).toBe(false);
      const remove = statements.find((sql) => /^\s*delete/i.test(sql))!;
      expect(remove).not.toContain("not in");
      expect(remove).toContain('"provider_connection_id" = ');
    });

    it("answers what the catalog held before, which is what a caller diffs against", async () => {
      database.answers(
        { rows: [{ id: FIXTURE_CONNECTION }] },
        { rows: [{ model_id: "fake/gone" }, { model_id: "fake/small" }] },
        { rows: [] },
        { rows: [] },
      );

      const before = await repository.replace(
        FIXTURE_WORKSPACE,
        FIXTURE_CONNECTION,
        [...FAKE_MODELS],
        AT,
      );

      expect(before).toEqual(["fake/gone", "fake/small"]);
    });

    it("never interpolates an id, and never selects a star", async () => {
      database.answers(
        { rows: [{ id: FIXTURE_CONNECTION }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      );

      await repository.replace(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, [...FAKE_MODELS], AT);

      for (const sql of database.sql()) {
        expect(sql).not.toContain(FIXTURE_CONNECTION);
        expect(sql).not.toContain(FIXTURE_WORKSPACE);
        expect(sql).not.toMatch(/select\s+\*/i);
      }
    });
  });
});
