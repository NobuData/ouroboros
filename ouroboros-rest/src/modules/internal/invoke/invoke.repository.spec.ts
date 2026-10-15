import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { InvokeRepository, type InvokeSubject } from "./invoke.repository";

const ORG = "acme-robotics";
const ID = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const SUBJECT: InvokeSubject = { organizationId: ORG, kind: "dry_run", id: ID };

describe("the chain executor's repository", () => {
  let database: RecordingDatabase;
  let repository: InvokeRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new InvokeRepository(database.service);
  });

  describe("subjectOf", () => {
    it("looks in runs, Copilot sessions, dry runs and investigations, in that order", async () => {
      await expect(repository.subjectOf(ID)).resolves.toBeUndefined();

      expect(database.sql().map((sql) => /from "ouroboros"\."(\w+)"/.exec(sql)?.[1])).toEqual([
        "runs",
        "copilot_sessions",
        "dry_runs",
        "investigations",
      ]);
    });

    it("stops at the first table that has the id", async () => {
      database.answers({ rows: [] }, { rows: [{ organization_id: ORG }] });

      await expect(repository.subjectOf(ID)).resolves.toEqual({
        organizationId: ORG,
        kind: "copilot_session",
        id: ID,
      });
      expect(database.statements).toHaveLength(2);
    });
  });

  it("sums a subject's priced spend within its workspace", async () => {
    database.answers({ rows: [{ spent: "12.5000" }] });

    await expect(repository.subjectSpent(SUBJECT)).resolves.toBe(12.5);

    const [statement] = database.statements;
    expect(statement.sql).toContain('"subject_kind" = $');
    expect(statement.parameters).toEqual(expect.arrayContaining([ORG, "dry_run", ID]));
  });

  it("answers 0 for a subject with no priced spend", async () => {
    database.answers({ rows: [{ spent: null }] });

    await expect(repository.subjectSpent(SUBJECT)).resolves.toBe(0);
  });

  it("sums a provider kind's month the way the card's meter does", async () => {
    const since = new Date("2026-10-01T00:00:00.000Z");

    database.answers({ rows: [{ spent: "600.0000" }] });

    await expect(repository.providerMonthSpent(ORG, "anthropic", since)).resolves.toBe(600);
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining([ORG, "anthropic", since]),
    );
  });

  it("reads an alias's binding within the workspace", async () => {
    database.answers({
      rows: [
        {
          alias: "sizer",
          model_id: "m",
          params: {},
          enabled: true,
          connection_id: "c",
          kind: "anthropic",
        },
      ],
    });

    await expect(repository.aliasBinding(ORG, "sizer")).resolves.toEqual({
      alias: "sizer",
      modelId: "m",
      params: {},
      enabled: true,
      connectionId: "c",
      kind: "anthropic",
    });
    expect(database.statements[0].sql).toContain('"a"."organization_id" = $');
  });

  it("writes a snapshot's chain and rules as JSON and returns its id", async () => {
    database.answers({ rows: [{ id: "snap-1" }] });

    await expect(
      repository.insertSnapshot(ORG, ID, {
        shape_version: 1,
        task_kind: "implement",
        route_tag: "implement-primary",
        outcome: "resolved",
        duration_ms: null,
        chain: [],
        rules: [],
      }),
    ).resolves.toBe("snap-1");
    expect(database.statements[0].parameters).toEqual(expect.arrayContaining([ORG, ID, "[]"]));
  });
});
