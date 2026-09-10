import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import { estimate, FIXTURE_ISSUE_ID, FIXTURE_WORKSPACE } from "./estimation.fixture";
import { estimateRow } from "./estimation.outcome";
import {
  EstimationRepository,
  MAX_VERSION_ATTEMPTS,
  VERSION_CONSTRAINT,
  isVersionCollision,
} from "./estimation.repository";

/**
 * The statements ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * Against `recordingDatabase()` — a real Kysely over a driver that writes statements down —
 * so what is asserted is the SQL the server would receive, `$1` placeholders and schema
 * qualification included. Two things that only show up here: a missing `where`, and whether a
 * multi-statement rule really ran inside one transaction. Whether PostgreSQL *accepts* the SQL
 * is `estimation.integration-spec.ts`'s question.
 */

/** The row a stale read or an issue read answers with. */
const ROW = {
  issueId: FIXTURE_ISSUE_ID,
  organizationId: FIXTURE_WORKSPACE,
  number: 485,
  title: "I2C bus lockup after IMU sleep/wake cycle",
  body: "…",
  labels: ["bug"],
  repo: "acme-robotics/helios-firmware",
  sizingStatus: "unsized",
};

/** A `pg` rejection, in the two fields `constraints.ts` reads. */
function refusal(code: string, constraint?: string): unknown {
  return Object.assign(new Error("refused"), { code, constraint });
}

describe("EstimationRepository", () => {
  let database: RecordingDatabase;
  let repository: EstimationRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new EstimationRepository(database.service);
  });

  describe("reading one issue", () => {
    it("joins the repository and its organisation to build `owner/name`", async () => {
      database.answers({ rows: [ROW] });

      await repository.issue(FIXTURE_ISSUE_ID);

      const [sql] = database.sql();
      expect(sql).toContain('from "ouroboros"."github_issues"');
      expect(sql).toContain('inner join "ouroboros"."github_repos"');
      expect(sql).toContain('inner join "ouroboros"."github_orgs"');
      // `owner/name` is the one shape the L.1 contract's `issue.repo` accepts, and it is built
      // in the statement so the read stays one round trip.
      expect(sql).toContain("|| '/' ||");
      expect(database.statements[0]?.parameters).toEqual([FIXTURE_ISSUE_ID]);
    });

    it("answers undefined for an issue that is gone", async () => {
      // Ordinary rather than exceptional: the sync hands work over after committing, and a
      // repository that left scope in between takes its issues with it.
      await expect(repository.issue(FIXTURE_ISSUE_ID)).resolves.toBeUndefined();
    });
  });

  describe("claiming", () => {
    it("writes `estimating` against the issue, unconditionally", async () => {
      // Unconditional on purpose: the recovery sweep's whole job is to re-claim rows that are
      // *already* `estimating`, and a claim that refused one would make recovery impossible.
      database.answers({ numAffectedRows: 1n });

      await expect(repository.claim(FIXTURE_ISSUE_ID)).resolves.toBe(true);

      // Written out whole rather than matched loosely, because what makes this claim
      // unconditional is the `where` clause having exactly one predicate in it — and a
      // `toContain` cannot say that a second one is absent.
      expect(database.statements[0]?.sql).toBe(
        'update "ouroboros"."github_issues" set "sizing_status" = $1 where "id" = $2',
      );
      expect(database.statements[0]?.parameters).toEqual(["estimating", FIXTURE_ISSUE_ID]);
    });

    it("answers false when the row is gone", async () => {
      await expect(repository.claim(FIXTURE_ISSUE_ID)).resolves.toBe(false);
    });
  });

  describe("settling without an estimate", () => {
    it("moves the status and writes no estimate row at all", async () => {
      // The failure path. `issue_estimates` has no nullable effort and no "unknown", so a row
      // invented here would put an effort chip on an issue nothing sized.
      database.answers({ numAffectedRows: 1n });

      await expect(repository.settle(FIXTURE_ISSUE_ID, "needs_human")).resolves.toBe(true);

      expect(database.sql()).toHaveLength(1);
      expect(database.sql()[0]).toContain('update "ouroboros"."github_issues"');
      expect(database.sql().join(" ")).not.toContain("issue_estimates");
    });
  });

  describe("persisting", () => {
    /** Answer the version read, the insert and the status update of one successful attempt. */
    function successfulAttempt(highest: number | null) {
      database.answers({ rows: [{ highest }] }, {}, { numAffectedRows: 1n });
    }

    it("writes the estimate and moves the status inside one transaction", async () => {
      successfulAttempt(null);

      await repository.persist(FIXTURE_ISSUE_ID, "sized", (version) =>
        estimateRow(FIXTURE_ISSUE_ID, version, estimate(), new Date()),
      );

      // There is no instant in which an issue reads `sized` and its newest estimate is the
      // previous one — which is the acceptance criterion about provenance, seen from the side
      // that could have broken it.
      const sql = database.sql();
      expect(sql[0]).toBe("begin");
      expect(sql[1]).toContain('select max("version")');
      expect(sql[2]).toContain('insert into "ouroboros"."issue_estimates"');
      expect(sql[3]).toContain('update "ouroboros"."github_issues" set "sizing_status"');
      expect(sql[4]).toBe("commit");
    });

    it("asks for version 1 when the issue has no estimate yet", async () => {
      // `max()` over no rows is one row holding null, not an empty result.
      successfulAttempt(null);

      await expect(
        repository.persist(FIXTURE_ISSUE_ID, "sized", (version) =>
          estimateRow(FIXTURE_ISSUE_ID, version, estimate(), new Date()),
        ),
      ).resolves.toBe(1);
    });

    it("asks for the next version above the highest stored", async () => {
      successfulAttempt(4);

      await expect(
        repository.persist(FIXTURE_ISSUE_ID, "sized", (version) =>
          estimateRow(FIXTURE_ISSUE_ID, version, estimate(), new Date()),
        ),
      ).resolves.toBe(5);
    });

    it("reads the highest version inside the transaction, not before it", async () => {
      // A number read outside would be a number that was true a moment ago, and the whole
      // retry below rests on the read and the write being one atomic guess.
      successfulAttempt(1);

      await repository.persist(FIXTURE_ISSUE_ID, "sized", (version) =>
        estimateRow(FIXTURE_ISSUE_ID, version, estimate(), new Date()),
      );

      expect(database.sql().indexOf("begin")).toBeLessThan(
        database.sql().findIndex((sql) => sql.includes('select max("version")')),
      );
    });

    it("retries with a fresh version when another writer took it first", async () => {
      // V026 is emphatic that this is the writer's case to handle: two callers re-estimating
      // one issue collide on `issue_estimates_issue_version_key`, "which is a retry rather
      // than a corruption". This is the acceptance criterion about concurrent estimation.
      const asked: number[] = [];

      database.answers({ rows: [{ highest: 1 }] });
      database.answers({ rows: [{ highest: 2 }] }, {}, { numAffectedRows: 1n });

      let first = true;
      const version = await repository.persist(FIXTURE_ISSUE_ID, "sized", (next) => {
        asked.push(next);

        if (first) {
          first = false;
          throw refusal(UNIQUE_VIOLATION, VERSION_CONSTRAINT);
        }

        return estimateRow(FIXTURE_ISSUE_ID, next, estimate(), new Date());
      });

      expect(asked).toEqual([2, 3]);
      expect(version).toBe(3);
      expect(database.sql()).toContain("rollback");
    });

    it("gives up after a bounded number of collisions rather than spinning", async () => {
      for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt += 1) {
        database.answers({ rows: [{ highest: attempt }] });
      }

      await expect(
        repository.persist(FIXTURE_ISSUE_ID, "sized", () => {
          throw refusal(UNIQUE_VIOLATION, VERSION_CONSTRAINT);
        }),
      ).rejects.toMatchObject({ constraint: VERSION_CONSTRAINT });
    });

    it("does not retry a failure that would fail identically every time", async () => {
      // A check violation is an estimator producing something V026 forbids. Retrying it would
      // turn a clear failure into a slow one, and would keep the row `estimating` for longer.
      database.answers({ rows: [{ highest: null }] });

      await expect(
        repository.persist(FIXTURE_ISSUE_ID, "sized", () => {
          throw refusal("23514", "issue_estimates_breakdown_shape");
        }),
      ).rejects.toMatchObject({ code: "23514" });

      expect(database.sql().filter((sql) => sql === "begin")).toHaveLength(1);
    });
  });

  describe("the stale read", () => {
    it("selects only rows claimed before the cutoff, oldest first, bounded", async () => {
      const cutoff = new Date("2026-09-10T09:00:00.000Z");
      database.answers({ rows: [{ id: FIXTURE_ISSUE_ID }] });

      await expect(repository.staleIssues(cutoff, 50)).resolves.toEqual([FIXTURE_ISSUE_ID]);

      const [statement] = database.statements;
      expect(statement?.sql).toContain('"sizing_status" = $1');
      expect(statement?.sql).toContain('"updated_at" < $2');
      expect(statement?.sql).toContain('order by "updated_at" asc');
      expect(statement?.sql).toContain("limit");
      // The cutoff is the caller's clock rather than the statement's `now()`, so a spec can
      // state the boundary instead of waiting for it.
      expect(statement?.parameters).toEqual(["estimating", cutoff, 50]);
    });

    it("selects ids and joins nothing — the payload is re-read when the work starts", async () => {
      // Minutes may pass in the queue, and the title, the labels and the status may all have
      // moved by then. Two joins here would fetch a copy that is thrown away.
      await repository.staleIssues(new Date(), 50);

      expect(database.sql()[0]).not.toContain("inner join");
      expect(database.sql()[0]).toContain('select "id" from "ouroboros"."github_issues"');
    });
  });
});

describe("isVersionCollision", () => {
  it("is true only for a unique violation on the version key", () => {
    expect(isVersionCollision(refusal(UNIQUE_VIOLATION, VERSION_CONSTRAINT))).toBe(true);
  });

  it.each([
    ["another table's unique key", refusal(UNIQUE_VIOLATION, "github_issues_repo_number_key")],
    ["a check violation", refusal("23514", "issue_estimates_effort")],
    ["a foreign-key violation", refusal("23503", VERSION_CONSTRAINT)],
    ["something that is not a database failure", new Error("nope")],
    ["a thrown string", "23505"],
  ])("is false for %s", (_what, error) => {
    expect(isVersionCollision(error)).toBe(false);
  });
});
