import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { BacklogDetailRepository } from "./detail.repository";

/**
 * The two statements, and the properties the endpoint rests on.
 *
 * Real Kysely over a recording driver, per `listing.repository.spec.ts`' argument: this layer
 * holds statements rather than rules, so what is asserted is the SQL PostgreSQL would receive.
 * Three things only this suite can see:
 *
 *   * **Both statements are scoped to one workspace** — the ticket's *404, not 403, across orgs*
 *     criterion, which is a `where` rather than a comparison somebody remembers to make. The
 *     estimates read is the interesting half: `issue_estimates` has no `organization_id`, so the
 *     predicate has to be reached through a join, and a read that skipped the join would answer
 *     another workspace's versions for a guessed id.
 *   * **The estimates read asks for every version in one statement**, which is what makes the
 *     panel's estimate and the history summary incapable of disagreeing. A `limit 1` here would
 *     pass every assertion about content and quietly turn the history into a list of one.
 *   * **It orders by `version`, not by `created_at`.** Version is what decision K4 makes
 *     latest-wins turn on, and it is unique within the issue where a timestamp is not.
 */

const WORKSPACE = "acme-robotics-id";
const ISSUE = "5eed0018-0000-4000-8000-000000000485";

describe("the backlog detail repository", () => {
  let database: RecordingDatabase;
  let detail: BacklogDetailRepository;

  beforeEach(() => {
    database = recordingDatabase();
    detail = new BacklogDetailRepository(database.service);
  });

  /**
   * Every read this repository can perform, as a callable — the assertion is over the surface
   * rather than a sample, so a method added without the predicate fails on the day it is
   * written.
   */
  const everyRead: readonly [string, (repository: BacklogDetailRepository) => Promise<unknown>][] =
    [
      ["issue", (repository) => repository.issue(WORKSPACE, ISSUE)],
      ["estimates", (repository) => repository.estimates(WORKSPACE, ISSUE)],
    ];

  describe("scoping", () => {
    it.each(everyRead)("%s is scoped to the workspace", async (_name, read) => {
      await read(detail);

      expect(database.statements[0].sql).toContain("organization_id");
      expect(database.statements[0].parameters).toContain(WORKSPACE);
    });

    it.each(everyRead)("%s names the issue as a parameter, never as text", async (_name, read) => {
      // Kysely parameterises everything, so an id that is not a uuid costs a round trip and
      // answers nothing rather than reaching a `where` clause as SQL.
      await read(detail);

      expect(database.statements[0].parameters).toContain(ISSUE);
      expect(database.statements[0].sql).not.toContain(ISSUE);
    });
  });

  describe("the issue", () => {
    it("joins the repository and its GitHub organisation, for `owner/name`", async () => {
      await detail.issue(WORKSPACE, ISSUE);

      const { sql } = database.statements[0];

      expect(sql).toContain("github_repos");
      expect(sql).toContain("github_orgs");
      expect(sql).toContain("login");
    });

    it("asks for the four fields the listing deliberately does not carry", async () => {
      await detail.issue(WORKSPACE, ISSUE);

      const { sql } = database.statements[0];

      expect(sql).toContain("body");
      expect(sql).toContain("author_login");
      expect(sql).toContain("gh_created_at");
      expect(sql).toContain("gh_url");
    });

    it("asks for no update timestamp, because the panel has nowhere to print one", async () => {
      await detail.issue(WORKSPACE, ISSUE);

      expect(database.statements[0].sql).not.toContain("gh_updated_at");
    });

    it("reads one issue rather than a page of them", async () => {
      // The path names a row. A statement that could return two would be a panel that had to
      // choose.
      database.answers({ rows: [] });

      expect(await detail.issue(WORKSPACE, ISSUE)).toBeUndefined();
    });

    it("decides the queued pill inside the same statement", async () => {
      // The opposite of what the listing does, and for a reason that only holds here: this
      // statement answers one row by primary key, so the semi-join is a single index probe and
      // there is no page for a separate read to run concurrently with.
      await detail.issue(WORKSPACE, ISSUE);

      const [{ sql }] = database.statements;

      expect(sql).toContain("exists (");
      expect(sql).toContain('"ouroboros".queue_items');
      expect(sql).toContain("q.issue_number");
    });

    it("matches the queue on the repository as well as the number", async () => {
      // `queue_items` holds one `#485` per workspace however many repositories number one —
      // V009's deliberate over-reach. For display that key is too wide.
      await detail.issue(WORKSPACE, ISSUE);

      expect(database.statements[0].sql).toContain("q.github_repo_id");
    });
  });

  describe("the estimates", () => {
    it("reaches the workspace through the issue, because the table has no column for it", async () => {
      // `issue_estimates` is tenanted by its issue — `on delete cascade`, and nothing else. The
      // join is what makes *another workspace's versions* unreachable by a guessed id, and it is
      // deliberately not left to the issue read having found a row first: the two run
      // concurrently, so there is no first.
      await detail.estimates(WORKSPACE, ISSUE);

      const { sql } = database.statements[0];

      expect(sql).toContain("github_issues");
      expect(sql).toContain("organization_id");
    });

    it("asks for every version, so the estimate and the history are the same rows", async () => {
      await detail.estimates(WORKSPACE, ISSUE);

      expect(database.statements[0].sql).not.toContain("limit");
    });

    it("orders by version ascending, which is the key latest-wins turns on", async () => {
      await detail.estimates(WORKSPACE, ISSUE);

      const { sql } = database.statements[0];

      expect(sql).toContain('order by "ouroboros"."issue_estimates"."version" asc');
      expect(sql).not.toContain('order by "ouroboros"."issue_estimates"."created_at"');
    });

    it("asks for both stored documents and the row's own timestamp", async () => {
      await detail.estimates(WORKSPACE, ISSUE);

      const { sql } = database.statements[0];

      expect(sql).toContain("breakdown");
      expect(sql).toContain("trace");
      expect(sql).toContain("created_at");
    });

    it("answers an empty list for an issue that has never been sized", async () => {
      database.answers({ rows: [] });

      expect(await detail.estimates(WORKSPACE, ISSUE)).toEqual([]);
    });
  });
});
