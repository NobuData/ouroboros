import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import {
  BacklogQueueRepository,
  isPositionCollision,
  isQueuedTwice,
  type QueueAppendRow,
} from "./queue.repository";

/**
 * The statements, and the properties the endpoint rests on
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * Real Kysely over a recording driver, per `listing.repository.spec.ts`' argument: this layer
 * holds statements rather than rules, so what is asserted is the SQL PostgreSQL would receive.
 * Four things only this suite can see:
 *
 *   * **Every statement is scoped to one workspace** — the cross-org criterion, which is a
 *     `where` rather than a comparison somebody remembers to make.
 *   * **The estimate is a lateral**, so a twice-estimated issue is one candidate and not two.
 *   * **The write is one transaction**, `max(position)` read inside it, so all-or-nothing is a
 *     property of the statement rather than a claim in a comment.
 *   * **Only a position collision is retried.** A duplicate issue number is the caller's
 *     request rather than a race, and retrying it would fail identically forever.
 */

const WORKSPACE = "acme-robotics-id";
const REPO = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ISSUE = "5eed0018-0000-4000-8000-000000000485";

/** V009's two unique keys, spelled as the migration names them. */
const POSITION_CONSTRAINT = "queue_items_organization_position_key";
const ISSUE_NUMBER_CONSTRAINT = "queue_items_organization_issue_key";

/**
 * A `pg` refusal, as the driver hands one up.
 *
 * @param code - The SQLSTATE.
 * @param constraint - Which constraint refused.
 * @returns The error to throw.
 */
function refusal(code: string, constraint?: string): Error {
  return Object.assign(new Error("refused"), { code, constraint });
}

/** One row to append — mockup 03's `#485`, as the service would have decided it. */
function appendRow(overrides: Partial<QueueAppendRow> = {}): QueueAppendRow {
  return {
    githubRepoId: REPO,
    issueNumber: 485,
    issueTitle: "Watchdog reset on I²C bus lockup",
    effort: "m",
    workflowTag: "standard-fix",
    estMinutes: 45,
    ...overrides,
  };
}

describe("the backlog queue repository", () => {
  let database: RecordingDatabase;
  let queue: BacklogQueueRepository;

  beforeEach(() => {
    database = recordingDatabase();
    queue = new BacklogQueueRepository(database.service);
  });

  describe("scoping", () => {
    /**
     * Every statement this repository can issue, as a callable — the assertion is over the
     * surface rather than a sample, so a method added without the predicate fails on the day it
     * is written.
     */
    const everyStatement: readonly [
      string,
      (repository: BacklogQueueRepository) => Promise<unknown>,
    ][] = [
      ["selection", (repository) => repository.selection(WORKSPACE, [ISSUE])],
      ["queuedNumbers", (repository) => repository.queuedNumbers(WORKSPACE, [485])],
      ["append", (repository) => repository.append(WORKSPACE, [appendRow()])],
    ];

    it.each(everyStatement)("%s is scoped to the workspace", async (_name, run) => {
      await run(queue);

      const scoped = database.statements.filter((statement) =>
        statement.parameters.includes(WORKSPACE),
      );

      expect(scoped.length).toBeGreaterThan(0);
      expect(scoped.every((statement) => statement.sql.includes("organization_id"))).toBe(true);
    });
  });

  describe("reading the selection", () => {
    it("reads the estimate in force through a lateral, newest version first", async () => {
      // Decision K4: re-estimation is a new row and the highest version wins. A plain join
      // would make the seeded `#487` two candidates whose efforts disagree.
      await queue.selection(WORKSPACE, [ISSUE]);

      const [{ sql }] = database.statements;

      expect(sql).toContain("left join lateral");
      expect(sql).toMatch(/order by "ouroboros"\."issue_estimates"\."version" desc limit \$/);
    });

    it("keeps an issue with no estimate, because that issue has to be named in a 422", async () => {
      // `left`, not `inner`. An unsized issue silently dropped is indistinguishable to a client
      // from one that was queued, and only one of those is honest.
      await queue.selection(WORKSPACE, [ISSUE]);

      expect(database.statements[0].sql).not.toContain("inner join lateral");
    });

    it("reads `est_minutes` out of the breakdown document", async () => {
      // The acceptance criterion, at the level that can see it: the number is read from the
      // stored breakdown rather than computed from the effort chip.
      await queue.selection(WORKSPACE, [ISSUE]);

      expect(database.statements[0].sql).toContain("'est_minutes'");
    });

    it("asks for exactly the ids it was given", async () => {
      await queue.selection(WORKSPACE, [ISSUE, "5eed0018-0000-4000-8000-000000000484"]);

      const [{ sql, parameters }] = database.statements;

      expect(sql).toContain('"ouroboros"."github_issues"."id" in');
      expect(parameters).toContain(ISSUE);
      expect(parameters).toContain("5eed0018-0000-4000-8000-000000000484");
    });
  });

  describe("reading what is already queued", () => {
    it("asks the queue's own key: this workspace, these numbers", async () => {
      database.answers({ rows: [{ issue_number: 485 }] });

      await expect(queue.queuedNumbers(WORKSPACE, [485, 484])).resolves.toEqual([485]);

      const [{ sql, parameters }] = database.statements;

      expect(sql).toContain('"issue_number" in');
      expect(parameters).toEqual([WORKSPACE, 485, 484]);
    });

    it("answers nothing for a queue that holds none of them", async () => {
      await expect(queue.queuedNumbers(WORKSPACE, [485])).resolves.toEqual([]);
    });
  });

  describe("appending", () => {
    it("reads the last position and inserts inside one transaction", async () => {
      // All-or-nothing, which is the trade the ticket made deliberately: a partly-applied bulk
      // queue is far worse to reason about than a rejected one.
      database.answers({ rows: [{ last: 3 }] });

      await queue.append(WORKSPACE, [appendRow(), appendRow({ issueNumber: 484 })]);

      const sql = database.sql();

      expect(sql[0]).toBe("begin");
      expect(sql.at(-1)).toBe("commit");
      expect(sql.filter((statement) => statement.startsWith("insert"))).toHaveLength(1);
    });

    it("reads the last position inside the transaction, not before it", async () => {
      // A number read outside it is a number that was true a moment ago.
      database.answers({ rows: [{ last: 3 }] });

      await queue.append(WORKSPACE, [appendRow()]);

      expect(database.sql().indexOf("begin")).toBeLessThan(
        database.sql().findIndex((statement) => statement.includes('max("position")')),
      );
    });

    it("appends: the first new row takes the position after the last one", async () => {
      database.answers({ rows: [{ last: 3 }] });

      await queue.append(WORKSPACE, [
        appendRow({ issueNumber: 485 }),
        appendRow({ issueNumber: 484 }),
        appendRow({ issueNumber: 491 }),
      ]);

      const insert = database.statements.find((statement) => statement.sql.startsWith("insert"));

      // Density is V009's *writer's convention*, and this is the writer keeping it: 4, 5, 6.
      expect(insert?.parameters).toContain(4);
      expect(insert?.parameters).toContain(5);
      expect(insert?.parameters).toContain(6);
    });

    it("starts an empty queue at position 1, because the head of a queue is next", async () => {
      // `max()` over no rows is one row holding null rather than an empty result.
      database.answers({ rows: [{ last: null }] });

      await queue.append(WORKSPACE, [appendRow()]);

      const insert = database.statements.find((statement) => statement.sql.startsWith("insert"));

      expect(insert?.parameters).toContain(1);
    });

    it("writes the workspace onto every row, from the argument rather than the request", async () => {
      database.answers({ rows: [{ last: 0 }] });

      await queue.append(WORKSPACE, [appendRow(), appendRow({ issueNumber: 484 })]);

      const insert = database.statements.find((statement) => statement.sql.startsWith("insert"));

      expect(insert?.parameters.filter((value) => value === WORKSPACE)).toHaveLength(2);
    });

    it("returns the rows it wrote, so nothing has to be read back", async () => {
      database.answers({ rows: [{ last: 0 }] }, { rows: [{ id: "written" }] });

      await expect(queue.append(WORKSPACE, [appendRow()])).resolves.toEqual([{ id: "written" }]);
      expect(
        database.statements.find((statement) => statement.sql.startsWith("insert"))?.sql,
      ).toContain("returning");
    });

    it("retries when another append took the same positions first", async () => {
      // V009 made the position key deferrable precisely so a reorder needs no ceremony; the
      // cost is that a duplicate is reported at `commit`, and that is a race which succeeds on
      // the next attempt because the position it reads will have moved.
      const transaction = jest
        .spyOn(database.service, "transaction")
        .mockRejectedValueOnce(refusal(UNIQUE_VIOLATION, POSITION_CONSTRAINT));

      database.answers({ rows: [{ last: 7 }] });

      await queue.append(WORKSPACE, [appendRow()]);

      expect(transaction).toHaveBeenCalledTimes(2);
    });

    it("gives up after a bounded number of collisions rather than spinning", async () => {
      jest
        .spyOn(database.service, "transaction")
        .mockRejectedValue(refusal(UNIQUE_VIOLATION, POSITION_CONSTRAINT));

      await expect(queue.append(WORKSPACE, [appendRow()])).rejects.toMatchObject({
        constraint: POSITION_CONSTRAINT,
      });
    });

    it("does not retry an issue the queue already holds", async () => {
      // That is the caller's request rather than a race: it would fail identically on every
      // attempt, and `queue.service.ts` turns it into the per-issue 409 instead.
      const transaction = jest
        .spyOn(database.service, "transaction")
        .mockRejectedValue(refusal(UNIQUE_VIOLATION, ISSUE_NUMBER_CONSTRAINT));

      await expect(queue.append(WORKSPACE, [appendRow()])).rejects.toMatchObject({
        constraint: ISSUE_NUMBER_CONSTRAINT,
      });
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it("does not retry a failure that would fail identically every time", async () => {
      const transaction = jest
        .spyOn(database.service, "transaction")
        .mockRejectedValue(refusal("23514", "queue_items_est_minutes_sane"));

      await expect(queue.append(WORKSPACE, [appendRow()])).rejects.toMatchObject({
        code: "23514",
      });
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("telling the two collisions apart", () => {
    it("recognises a position collision and nothing else", () => {
      expect(isPositionCollision(refusal(UNIQUE_VIOLATION, POSITION_CONSTRAINT))).toBe(true);
      expect(isPositionCollision(refusal(UNIQUE_VIOLATION, ISSUE_NUMBER_CONSTRAINT))).toBe(false);
      expect(isPositionCollision(refusal("23514", POSITION_CONSTRAINT))).toBe(false);
      expect(isPositionCollision(new Error("connection reset"))).toBe(false);
    });

    it("recognises a duplicate enqueue and nothing else", () => {
      expect(isQueuedTwice(refusal(UNIQUE_VIOLATION, ISSUE_NUMBER_CONSTRAINT))).toBe(true);
      expect(isQueuedTwice(refusal(UNIQUE_VIOLATION, POSITION_CONSTRAINT))).toBe(false);
      expect(isQueuedTwice(refusal("23503", ISSUE_NUMBER_CONSTRAINT))).toBe(false);
      expect(isQueuedTwice(undefined)).toBe(false);
    });
  });
});
