import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ACTIVE_RUN_STATUSES } from "../db/schema";
import { RunsRepository } from "./runs.repository";

/**
 * The three statements, and the properties the endpoints rest on.
 *
 * Real Kysely over a recording driver, per `dashboard.repository.spec.ts`'s argument: this
 * layer holds statements, not rules, so what is asserted is the SQL PostgreSQL would
 * receive — above all that **every statement is scoped to one workspace**, which is both
 * the isolation criterion and, for `find`, the whole of the no-existence-leak `404`.
 */

const WORKSPACE = "acme-robotics-id";
const REPO = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

/** The default window, spelled out — what `windowOf({})` resolves to. */
const WINDOW = { limit: 25, offset: 0 };

describe("the runs repository", () => {
  let database: RecordingDatabase;
  let runs: RunsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    runs = new RunsRepository(database.service);
  });

  describe("scoping", () => {
    /**
     * Every read this repository can perform, as a callable — the assertion is over the
     * surface, not a sample, so a method added without the predicate fails on the day it
     * is written.
     */
    const everyRead: readonly [string, (repository: RunsRepository) => Promise<unknown>][] = [
      ["list", (repository) => repository.list(WORKSPACE, { status: "active" }, WINDOW)],
      [
        "count",
        (repository) => {
          database.answers({ rows: [{ total: "0" }] });
          return repository.count(WORKSPACE, { status: "active" });
        },
      ],
      ["find", (repository) => repository.find(WORKSPACE, RUN)],
    ];

    it.each(everyRead)("%s is scoped to the workspace", async (_name, read) => {
      await read(runs);

      expect(database.statements[0].sql).toContain('"organization_id" = $');
      expect(database.statements[0].parameters).toContain(WORKSPACE);
    });
  });

  describe("the active listing", () => {
    it("selects the active statuses and orders down the pipeline, oldest first", async () => {
      // The *Active loops* card's order, extended past its limit: lifecycle position, then
      // longest-running first, then id so two runs started in the same millisecond do not
      // swap places between pages.
      await runs.list(WORKSPACE, { status: "active" }, WINDOW);

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain('"status" in ($');
      expect(sql).toContain("array_position(");
      expect(sql).toMatch(/order by array_position\(.+\), "started_at" asc, "id" asc/);
      expect(parameters).toEqual(expect.arrayContaining([...ACTIVE_RUN_STATUSES]));
    });
  });

  describe("the terminal listing", () => {
    it("asks for a finished_at rather than enumerating the terminal statuses", async () => {
      // V008's `runs_terminal_finished_at` makes "has stopped" and "has a finished_at" the
      // same set, and the shorter question is the one the index answers.
      await runs.list(WORKSPACE, { status: "terminal" }, WINDOW);

      const { sql } = database.statements[0];
      expect(sql).toContain('"finished_at" is not null');
      expect(sql).toMatch(/order by "finished_at" desc, "id" asc/);
      expect(sql).not.toContain("array_position");
    });
  });

  describe("the window", () => {
    it("applies the limit and the offset the service resolved", async () => {
      await runs.list(WORKSPACE, { status: "terminal" }, { limit: 10, offset: 30 });

      const { sql, parameters } = database.statements[0];
      expect(sql).toMatch(/limit \$\d+ offset \$\d+/);
      expect(parameters).toEqual(expect.arrayContaining([10, 30]));
    });
  });

  describe("the repo filter", () => {
    it("narrows both the page and the total by the same predicate", async () => {
      // A total counted without the filter would make "page 1 of 9" a claim about rows the
      // listing will never show.
      await runs.list(WORKSPACE, { status: "active", repoId: REPO }, WINDOW);
      database.answers({ rows: [{ total: "0" }] });
      await runs.count(WORKSPACE, { status: "active", repoId: REPO });

      for (const statement of database.statements) {
        expect(statement.sql).toContain('"github_repo_id" = $');
        expect(statement.parameters).toContain(REPO);
      }
    });

    it("is absent when nothing narrows", async () => {
      await runs.list(WORKSPACE, { status: "active" }, WINDOW);

      expect(database.statements[0].sql).not.toContain("github_repo_id");
    });
  });

  describe("the count", () => {
    it("branches on the family exactly as the listing does", async () => {
      // The property the file header promises: the count and the page agree about what
      // matches, or the total lies.
      database.answers({ rows: [{ total: "0" }] }, { rows: [{ total: "0" }] });
      await runs.count(WORKSPACE, { status: "active" });
      await runs.count(WORKSPACE, { status: "terminal" });

      expect(database.statements[0].sql).toContain('"status" in ($');
      expect(database.statements[1].sql).toContain('"finished_at" is not null');
    });
  });

  describe("finding one", () => {
    it("requires the run to belong to the workspace", async () => {
      // A run id that exists under a different workspace must answer exactly as one that
      // exists nowhere — the predicate is the 404.
      await runs.find(WORKSPACE, RUN);

      expect(database.statements[0].sql).toContain('"organization_id" = $1 and "id" = $2');
      expect(database.statements[0].parameters).toEqual([WORKSPACE, RUN]);
    });
  });
});
