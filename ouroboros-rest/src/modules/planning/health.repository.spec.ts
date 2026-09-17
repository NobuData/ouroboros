import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { BacklogHealthRepository } from "./health.repository";

/**
 * The Backlog Health statements (AL.5, #281), asserted as SQL — where a missing workspace predicate
 * or a `count(*)` over edges shows up. `planning.integration-spec.ts` proves `38/42 · 4 · 6` against
 * PostgreSQL.
 */

const ORG = "org-acme";
const STALE_BEFORE = new Date("2026-08-18T00:00:00.000Z");

describe("BacklogHealthRepository", () => {
  let database: RecordingDatabase;
  let repository: BacklogHealthRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new BacklogHealthRepository(database.service);
  });

  describe("the meters", () => {
    it("counts all three over open tickets, in one statement held to the workspace", async () => {
      await repository.metrics(ORG, STALE_BEFORE);

      const sql = database.sql();
      expect(sql).toHaveLength(1);
      expect(sql[0]).toContain('from "ouroboros"."tickets" as "t"');
      expect(sql[0]).toContain('where "t"."organization_id" = $');
      expect(sql[0]).toContain('and "t"."state" = $');
      expect(sql[0]).toContain('count(*) filter(where "t"."sizing_status" = $');
      expect(sql[0]).toContain('count(*) filter(where "t"."source_updated_at" < $');
      expect(database.statements[0]?.parameters).toEqual(
        expect.arrayContaining([ORG, "open", "sized", STALE_BEFORE]),
      );
    });

    it("counts a blocked ticket once, through an exists over its edges — never a join over them", async () => {
      await repository.metrics(ORG, STALE_BEFORE);

      const [sql] = database.sql();
      expect(sql).toContain("count(*) filter(where exists (select");
      expect(sql).toContain('from "ouroboros"."ticket_dependencies" as "d"');
      expect(sql).toContain('"d"."blocked_ticket_id" = "t"."id"');
      // Both origins: nothing in the statement narrows by `origin`.
      expect(sql).not.toContain("origin");
    });

    it("holds the edges to the workspace too", async () => {
      await repository.metrics(ORG, STALE_BEFORE);

      const [sql] = database.sql();
      expect(sql).toContain('"d"."organization_id" = $');
      expect(database.statements[0]?.parameters.filter((value) => value === ORG)).toHaveLength(2);
    });

    it("treats an open ticket blocker, or a draft blocker in a live batch, as unresolved", async () => {
      await repository.metrics(ORG, STALE_BEFORE);

      const [sql] = database.sql();
      expect(sql).toContain('left join "ouroboros"."tickets" as "blocker"');
      expect(sql).toContain('"blocker"."state" = $');
      expect(sql).toContain('"d"."blocker_draft_id" is not null');
      expect(sql).toContain('"batch"."status" != $');
      expect(database.statements[0]?.parameters).toEqual(expect.arrayContaining(["abandoned"]));
    });

    it("maps the bigint strings pg answers with", async () => {
      database.answers({ rows: [{ open: "42", sized: "38", blocked: "4", stale: "6" }] });

      await expect(repository.metrics(ORG, STALE_BEFORE)).resolves.toEqual({
        open: 42,
        sized: 38,
        blocked: 4,
        stale: 6,
      });
    });

    it("answers zeros — not undefined — for a workspace with no tickets", async () => {
      database.answers({ rows: [{ open: "0", sized: "0", blocked: "0", stale: "0" }] });

      await expect(repository.metrics(ORG, STALE_BEFORE)).resolves.toEqual({
        open: 0,
        sized: 0,
        blocked: 0,
        stale: 0,
      });
    });
  });

  describe("the last run", () => {
    it("reads the latest run, and joins only this workspace's counts", async () => {
      await repository.lastRun(ORG);

      const [sql] = database.sql();
      expect(sql).toContain('from "ouroboros"."reestimation_runs" as "r"');
      expect(sql).toContain('left join "ouroboros"."reestimation_run_counts" as "c"');
      expect(sql).toContain('"c"."run_id" = "r"."id" and "c"."organization_id" = $1');
      expect(sql).toContain('order by "r"."started_at" desc limit $2');
      expect(database.statements[0]?.parameters).toEqual([ORG, 1]);
    });

    it("answers undefined before the job has ever run", async () => {
      await expect(repository.lastRun(ORG)).resolves.toBeUndefined();
    });

    it("reads zero counts for a run that found nothing in this workspace", async () => {
      const at = new Date("2026-09-17T02:14:00.000Z");
      database.answers({
        rows: [
          {
            startedAt: at,
            finishedAt: at,
            status: "succeeded",
            found: null,
            queued: null,
            inFlight: null,
          },
        ],
      });

      await expect(repository.lastRun(ORG)).resolves.toEqual({
        startedAt: at,
        finishedAt: at,
        status: "succeeded",
        found: 0,
        queued: 0,
        inFlight: 0,
      });
    });
  });
});
