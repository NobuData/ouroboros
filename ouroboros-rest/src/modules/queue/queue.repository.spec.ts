import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { QueueRepository } from "./queue.repository";

/**
 * The two statements, and the properties the endpoint rests on.
 *
 * Real Kysely over a recording driver, per `dashboard.repository.spec.ts`'s argument: this
 * layer holds statements, not rules, so what is asserted is the SQL PostgreSQL would
 * receive — above all that **every statement is scoped to one workspace**, which is the
 * isolation criterion, and that the totals are the stat row's own sentence, which is the
 * cannot-disagree criterion.
 */

const WORKSPACE = "acme-robotics-id";
const REPO = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** The default window, spelled out — what `windowOf({})` resolves to. */
const WINDOW = { limit: 25, offset: 0 };

/** What the totals statement answers with when nothing is queued. */
const EMPTY_TOTALS = { rows: [{ count: 0, estMinutes: 0 }] };

describe("the queue repository", () => {
  let database: RecordingDatabase;
  let queue: QueueRepository;

  beforeEach(() => {
    database = recordingDatabase();
    queue = new QueueRepository(database.service);
  });

  describe("scoping", () => {
    /**
     * Every read this repository can perform, as a callable — the assertion is over the
     * surface, not a sample, so a method added without the predicate fails on the day it
     * is written.
     */
    const everyRead: readonly [string, (repository: QueueRepository) => Promise<unknown>][] = [
      ["list", (repository) => repository.list(WORKSPACE, {}, WINDOW)],
      [
        "totals",
        (repository) => {
          database.answers(EMPTY_TOTALS);
          return repository.totals(WORKSPACE, {});
        },
      ],
    ];

    it.each(everyRead)("%s is scoped to the workspace", async (_name, read) => {
      await read(queue);

      expect(database.statements[0].sql).toContain('"organization_id" = $');
      expect(database.statements[0].parameters).toContain(WORKSPACE);
    });
  });

  describe("the listing", () => {
    it("orders by position ascending, and by nothing else", async () => {
      // V009 makes `position` unique within the workspace, so the order is total without a
      // tiebreak — two rows cannot swap places because two rows cannot share a place.
      await queue.list(WORKSPACE, {}, WINDOW);

      const { sql } = database.statements[0];
      expect(sql).toMatch(/order by "position" asc limit/);
    });

    it("applies the limit and the offset the service resolved", async () => {
      await queue.list(WORKSPACE, {}, { limit: 10, offset: 30 });

      const { sql, parameters } = database.statements[0];
      expect(sql).toMatch(/limit \$\d+ offset \$\d+/);
      expect(parameters).toEqual(expect.arrayContaining([10, 30]));
    });
  });

  describe("the totals", () => {
    it("counts and sums in one pass, with the stat row's own sentence", async () => {
      // The cannot-disagree criterion: `coalesce(sum(est_minutes), 0)::int` is exactly what
      // the dashboard repository's `queueTotals` computes for `stats.queued.estMinutes`, so
      // the two agree by construction. `sum` skips the unsized rows; `coalesce` covers the
      // empty queue, where the sum itself is null.
      database.answers(EMPTY_TOTALS);
      await queue.totals(WORKSPACE, {});

      const { sql } = database.statements[0];
      expect(sql).toContain("count(*)::int");
      expect(sql).toContain('coalesce(sum(est_minutes), 0)::int as "estMinutes"');
      expect(sql).not.toContain("limit");
    });
  });

  describe("the repo filter", () => {
    it("narrows the page and the totals by the same predicate", async () => {
      // Totals computed without the filter would make the page describe rows it will
      // never show.
      await queue.list(WORKSPACE, { repoId: REPO }, WINDOW);
      database.answers(EMPTY_TOTALS);
      await queue.totals(WORKSPACE, { repoId: REPO });

      for (const statement of database.statements) {
        expect(statement.sql).toContain('"github_repo_id" = $');
        expect(statement.parameters).toContain(REPO);
      }
    });

    it("is absent when nothing narrows", async () => {
      await queue.list(WORKSPACE, {}, WINDOW);
      database.answers(EMPTY_TOTALS);
      await queue.totals(WORKSPACE, {});

      for (const statement of database.statements) {
        expect(statement.sql).not.toContain("github_repo_id");
      }
    });
  });
});
