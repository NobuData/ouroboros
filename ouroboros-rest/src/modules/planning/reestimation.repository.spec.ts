import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ReestimationRepository } from "./reestimation.repository";

/**
 * The nightly job's statements (AL.5, #281), asserted as SQL: the night claim that stops a fleet
 * multiplying the batch, the bounded and shared-out batch read, and the run record written in one
 * transaction. `planning.integration-spec.ts` runs them against PostgreSQL.
 */

const RUN = "c2810000-0000-4000-8000-000000000001";

describe("ReestimationRepository", () => {
  let database: RecordingDatabase;
  let repository: ReestimationRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new ReestimationRepository(database.service);
  });

  describe("claiming a night", () => {
    it("inserts the night and does nothing on a conflict, returning the id only to the first", async () => {
      database.answers({ rows: [{ id: RUN }] });

      await expect(repository.startRun("2026-09-17", 100)).resolves.toBe(RUN);

      const [sql] = database.sql();
      expect(sql).toBe(
        'insert into "ouroboros"."reestimation_runs" ("night", "batch_limit") values ($1, $2) ' +
          'on conflict ("night") do nothing returning "id"',
      );
      expect(database.statements[0]?.parameters).toEqual(["2026-09-17", 100]);
    });

    it("answers undefined when another replica already has the night", async () => {
      await expect(repository.startRun("2026-09-17", 100)).resolves.toBeUndefined();
    });
  });

  describe("choosing the batch", () => {
    it("selects open, unsized tickets only, bounded by the limit", async () => {
      await repository.unsizedTickets(100);

      const [sql] = database.sql();
      expect(sql).toContain('from "ouroboros"."tickets"');
      expect(sql).toContain('where "state" = $1 and "sizing_status" = $2');
      expect(sql).toMatch(/limit \$3$/);
      expect(database.statements[0]?.parameters).toEqual(["open", "unsized", 100]);
    });

    it("shares the batch out across workspaces — rank within a workspace first, age second", async () => {
      await repository.unsizedTickets(100);

      const [sql] = database.sql();
      expect(sql).toContain(
        'row_number() over (partition by "organization_id" order by "source_created_at", "id") as "rank"',
      );
      expect(sql).toContain(
        'order by "ranked"."rank", "ranked"."source_created_at", "ranked"."id"',
      );
    });

    it("answers each ticket with its workspace", async () => {
      database.answers({ rows: [{ ticketId: "t1", organizationId: "org-acme" }] });

      await expect(repository.unsizedTickets(1)).resolves.toEqual([
        { ticketId: "t1", organizationId: "org-acme" },
      ]);
    });
  });

  describe("recording a run", () => {
    it("writes every workspace's counts and settles the run in one transaction, on the database's clock", async () => {
      await repository.finishRun(RUN, "succeeded", [
        { organizationId: "org-acme", found: 4, queued: 3, inFlight: 1 },
        { organizationId: "org-globex", found: 2, queued: 2, inFlight: 0 },
      ]);

      const sql = database.sql();
      expect(sql[0]).toBe("begin");
      expect(sql[1]).toContain('insert into "ouroboros"."reestimation_run_counts"');
      expect(database.statements[1]?.parameters).toEqual([
        RUN,
        "org-acme",
        4,
        3,
        1,
        RUN,
        "org-globex",
        2,
        2,
        0,
      ]);
      expect(sql[2]).toBe(
        'update "ouroboros"."reestimation_runs" set "status" = $1, "finished_at" = now() where "id" = $2',
      );
      expect(database.statements[2]?.parameters).toEqual(["succeeded", RUN]);
      expect(sql[3]).toBe("commit");
    });

    it("writes no counts for a run that found nothing, and still settles it", async () => {
      await repository.finishRun(RUN, "failed", []);

      const sql = database.sql();
      expect(sql).toHaveLength(3);
      expect(sql[1]).toContain('update "ouroboros"."reestimation_runs"');
      expect(database.statements[1]?.parameters).toEqual(["failed", RUN]);
    });
  });
});
