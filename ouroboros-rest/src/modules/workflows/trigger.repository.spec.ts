import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { TriggerRepository } from "./trigger.repository";

/**
 * The one statement behind R.1's pins ([#143](https://github.com/NobuData/ouroboros/issues/143)).
 *
 * Real Kysely over a recording driver, for `stats.repository.spec.ts`' reason: a mocked method
 * says nothing about whether the SQL was scoped to one workspace, and *a workflow never claims
 * another workspace's ticket* rests on exactly that `where`. Which rows may match is the
 * service's rule and `trigger.service.spec.ts`' question; whether PostgreSQL accepts the jsonb
 * expression is the integration suite's.
 */

const WORKSPACE = "acme-robotics-id";

describe("the trigger repository", () => {
  let database: RecordingDatabase;
  let repository: TriggerRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new TriggerRepository(database.service);
  });

  describe("scoping", () => {
    it("scopes the read to one workspace, by parameter", async () => {
      await repository.triggers(WORKSPACE);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"w"."organization_id" = $');
      // By parameter, never by interpolation: the id is the tenant context's.
      expect(statement.parameters).toEqual([WORKSPACE]);
    });
  });

  describe("the read", () => {
    it("is one statement for the whole queue write, however many issues it holds", async () => {
      await repository.triggers(WORKSPACE);

      expect(database.statements).toHaveLength(1);
    });

    it("reaches the trigger through `current_version`, not through the newest version", async () => {
      // A rollback moves the pointer to an older version, and that is what a pin must name.
      await repository.triggers(WORKSPACE);

      const { sql } = database.statements[0];
      expect(sql).toContain('"v"."workflow_id" = "w"."id"');
      expect(sql).toContain('"v"."version" = "w"."current_version"');
    });

    it("joins the version rather than requiring one, so a draft-only workflow still answers", async () => {
      // Its `null` version is what lets an explicit choice of it pin nothing rather than fail.
      await repository.triggers(WORKSPACE);

      expect(database.statements[0].sql).toContain("left join");
    });

    it("sends only the trigger, never the definition it lives in", async () => {
      // A definition carries a prompt template per model stage, and this read is on the path of
      // every queue write.
      await repository.triggers(WORKSPACE);

      const { sql } = database.statements[0];
      expect(sql).toContain(`"v"."definition" -> 'trigger'`);
      expect(sql).not.toContain('"v"."definition" as');
      expect(sql).not.toContain('"v"."definition",');
    });

    it("returns every status, because the version lookup answers for a suggestion too", async () => {
      // Which rows may *match* is the service's rule; filtering here would leave a suggestion that
      // names a paused workflow with no version to pin.
      await repository.triggers(WORKSPACE);

      expect(database.statements[0].sql).not.toContain('"status" =');
      expect(database.statements[0].sql).not.toContain('"status" !=');
    });

    it("orders by slug, so the answer does not reshuffle between reads", async () => {
      await repository.triggers(WORKSPACE);

      expect(database.statements[0].sql).toContain('order by "w"."slug" asc');
    });

    it("hands back the rows as they were selected", async () => {
      const rows = [
        {
          slug: "standard-fix",
          status: "active",
          current_version: 14,
          trigger: { event: "ticket_queued", conditions: { effort_lte: "m" } },
        },
        { slug: "release-train", status: "active", current_version: null, trigger: null },
      ];
      database.answers({ rows });

      await expect(repository.triggers(WORKSPACE)).resolves.toEqual(rows);
    });
  });
});
