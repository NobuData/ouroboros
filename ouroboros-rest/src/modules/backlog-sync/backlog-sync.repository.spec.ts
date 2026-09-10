import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { FIXTURE_NOW, FIXTURE_REPO_ID, FIXTURE_WORKSPACE, target } from "./backlog-sync.fixture";
import { BacklogSyncRepository } from "./backlog-sync.repository";
import type { MirroredIssue } from "./issue.mapping";

/**
 * The statements, asserted as SQL — for the reason `provider-health.repository.spec.ts` gives:
 * this layer holds statements rather than rules, so mocking a method would prove nothing about
 * the two things that can actually be wrong here.
 *
 * Three properties are load-bearing and each is a property of a statement rather than of
 * anything above it:
 *
 *   * **A repository is in scope only when its own `enabled` and its org's are both true.** A
 *     workspace that turned a GitHub organisation off expects every repository under it to stop
 *     being read, and that is a join and two predicates or it is nothing.
 *   * **The whole poll is one transaction.** Decision K2 asks for the rows, the cursor and the
 *     freshness stamp to move together; `begin` and `commit` around all of them is what makes
 *     *"freshness can never claim a sync that partly failed"* structural.
 *   * **An unchanged issue produces no statement at all.** `github_issues_touch_updated_at` is
 *     unconditional, so the only way to keep `updated_at` meaning *"GitHub changed this"* is to
 *     not issue the update — and the acceptance criterion *"touches no rows"* is that, counted.
 */

const ROW_ID = "d1000000-0000-0000-0000-000000000485";

/**
 * One mirrored issue, as `issue.mapping.ts` produces it.
 *
 * @param overrides - What differs.
 * @returns The issue.
 */
function issue(overrides: Partial<MirroredIssue> = {}): MirroredIssue {
  return {
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    body: "Unit 07 in the Fremont pilot rebooted 14 times.",
    state: "open",
    labels: ["bug", "i2c"],
    authorLogin: "field-support",
    ghCreatedAt: new Date("2026-09-06T10:00:00.000Z"),
    ghUpdatedAt: new Date("2026-09-08T07:00:00.000Z"),
    ghUrl: "https://github.com/acme-robotics/helios-firmware/issues/485",
    ...overrides,
  };
}

/**
 * The stored row a comparison runs against, in the database's own column names.
 *
 * @param overrides - What differs from a row identical to {@link issue}'s output.
 * @returns The row.
 */
function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const mirrored = issue();

  return {
    id: ROW_ID,
    number: mirrored.number,
    title: mirrored.title,
    body: mirrored.body,
    state: mirrored.state,
    labels: [...mirrored.labels],
    author_login: mirrored.authorLogin,
    gh_created_at: mirrored.ghCreatedAt,
    gh_updated_at: mirrored.ghUpdatedAt,
    gh_url: mirrored.ghUrl,
    ...overrides,
  };
}

describe("the backlog sync repository", () => {
  let database: RecordingDatabase;
  let repository: BacklogSyncRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new BacklogSyncRepository(database.service);
  });

  describe("which repositories a cycle polls", () => {
    it("takes both enabled flags, because a repo is in scope only when the org is", async () => {
      database.answers({ rows: [] });

      await repository.enabledRepositories();

      const [sql] = database.sql();

      expect(sql).toContain('inner join "ouroboros"."github_orgs"');
      expect(sql).toContain('"ouroboros"."github_repos"."enabled" = $1');
      expect(sql).toContain('"ouroboros"."github_orgs"."enabled" = $2');
      expect(database.statements[0].parameters).toEqual([true, true]);
    });

    it("reaches the workspace through the GitHub org rather than through a second column", async () => {
      database.answers({ rows: [] });

      await repository.enabledRepositories();

      expect(database.sql()[0]).toContain('"ouroboros"."github_orgs"."organization_id"');
    });

    it("puts a repository nobody has ever polled first", async () => {
      database.answers({ rows: [] });

      await repository.enabledRepositories();

      // Nulls first is what stops a newly enabled repository waiting behind the ones already
      // up to date.
      expect(database.sql()[0]).toContain(
        'order by "ouroboros"."github_repos"."issues_synced_at" asc nulls first',
      );
    });

    it("names no credential — the token belongs to `github/`", async () => {
      database.answers({ rows: [] });

      await repository.enabledRepositories();

      expect(database.sql()[0]).not.toContain("token_encrypted");
      expect(database.sql()[0]).not.toContain("github_credentials");
    });
  });

  describe("which repositories one workspace's status is about", () => {
    it("scopes the read to the workspace, and keeps both enablement flags", async () => {
      // M.4's durable half (#113). Scoped, because this one answers a request under a tenant
      // context rather than a cycle over the whole installation — and still *enabled*, so a
      // status page cannot report on repositories nothing polls.
      database.answers({ rows: [] });

      await repository.enabledRepositoriesFor(FIXTURE_WORKSPACE);

      const [sql] = database.sql();

      expect(sql).toContain('"ouroboros"."github_orgs"."organization_id" = $3');
      expect(sql).toContain('"ouroboros"."github_repos"."enabled" = $1');
      expect(sql).toContain('"ouroboros"."github_orgs"."enabled" = $2');
      expect(database.statements[0].parameters).toEqual([true, true, FIXTURE_WORKSPACE]);
    });

    it("selects the freshness stamp and the watermark, which are the answer", async () => {
      database.answers({ rows: [] });

      await repository.enabledRepositoriesFor(FIXTURE_WORKSPACE);

      expect(database.sql()[0]).toContain('"ouroboros"."github_repos"."issues_synced_at"');
      expect(database.sql()[0]).toContain('"ouroboros"."github_repos"."issues_sync_cursor"');
    });

    it("orders by `owner/name` rather than by freshness", async () => {
      // A person is reading this one. The cycle's oldest-poll-first order is a scheduling
      // decision, and reusing it here would reshuffle the page every time something synced.
      database.answers({ rows: [] });

      await repository.enabledRepositoriesFor(FIXTURE_WORKSPACE);

      expect(database.sql()[0]).toContain(
        'order by "ouroboros"."github_orgs"."login" asc, "ouroboros"."github_repos"."name" asc',
      );
    });

    it("answers with what it read", async () => {
      const row = target();
      database.answers({ rows: [row] });

      await expect(repository.enabledRepositoriesFor(FIXTURE_WORKSPACE)).resolves.toEqual([row]);
    });
  });

  describe("one poll, one transaction", () => {
    it("wraps every write, including the freshness stamp", async () => {
      database.answers({ rows: [] }, { rows: [{ id: ROW_ID }] }, { rows: [] });

      await repository.applyPoll({
        target: target(),
        issues: [issue()],
        cursor: "2026-09-08T07:00:00.000Z",
        syncedAt: FIXTURE_NOW,
      });

      const sql = database.sql();

      expect(sql[0]).toBe("begin");
      expect(sql.at(-1)).toBe("commit");
      expect(sql.some((statement) => statement.includes('update "ouroboros"."github_repos"'))).toBe(
        true,
      );
    });

    it("stamps freshness and the watermark in the same statement", async () => {
      database.answers({ rows: [] }, { rows: [] });

      await repository.applyPoll({
        target: target(),
        issues: [],
        cursor: "2026-09-08T07:00:00.000Z",
        syncedAt: FIXTURE_NOW,
      });

      const stamp = database.statements.find((statement) =>
        statement.sql.includes('update "ouroboros"."github_repos"'),
      );

      expect(stamp?.sql).toContain('"issues_synced_at"');
      expect(stamp?.sql).toContain('"issues_sync_cursor"');
      expect(stamp?.parameters).toEqual([FIXTURE_NOW, "2026-09-08T07:00:00.000Z", FIXTURE_REPO_ID]);
    });

    it("leaves the stored watermark alone when the poll produced none", async () => {
      // A poll that saw no issues learned nothing about where the next one should start, and
      // `github_repos_issues_cursor_after_sync` reads *synced, no cursor* as the legitimate
      // state it is.
      database.answers({ rows: [] }, { rows: [] });

      await repository.applyPoll({
        target: target(),
        issues: [],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      const stamp = database.statements.find((statement) =>
        statement.sql.includes('update "ouroboros"."github_repos"'),
      );

      expect(stamp?.sql).toContain('"issues_synced_at"');
      expect(stamp?.sql).not.toContain('"issues_sync_cursor"');
    });

    it("still stamps freshness on a poll that read nothing at all", async () => {
      // *"We looked and nothing had changed"* is exactly what the tag claims.
      database.answers({ rows: [] }, { rows: [] });

      const written = await repository.applyPoll({
        target: target(),
        issues: [],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written).toEqual({ imported: 0, updated: 0, unchanged: 0, estimable: [] });
      expect(database.sql()).toContain("commit");
    });
  });

  describe("what a poll writes", () => {
    it("inserts an issue this mirror has never seen, unsized", async () => {
      database.answers({ rows: [] }, { rows: [{ id: ROW_ID }] }, { rows: [] });

      const written = await repository.applyPoll({
        target: target(),
        issues: [issue()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      const insert = database.statements.find((statement) =>
        statement.sql.includes('insert into "ouroboros"."github_issues"'),
      );

      expect(written.imported).toBe(1);
      expect(insert?.parameters).toEqual([
        FIXTURE_WORKSPACE,
        FIXTURE_REPO_ID,
        485,
        "Watchdog reset on I²C bus lockup",
        "Unit 07 in the Fremont pilot rebooted 14 times.",
        "open",
        '["bug","i2c"]',
        "field-support",
        new Date("2026-09-06T10:00:00.000Z"),
        new Date("2026-09-08T07:00:00.000Z"),
        "https://github.com/acme-robotics/helios-firmware/issues/485",
        FIXTURE_NOW,
        "unsized",
      ]);
    });

    it("does not insert a closed issue it has never seen", async () => {
      // The mirror is of a *backlog*. `state=all` on an incremental poll widens what the sync
      // learns without widening what it keeps.
      database.answers({ rows: [] }, { rows: [] });

      const written = await repository.applyPoll({
        target: target(),
        issues: [issue({ state: "closed" })],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.imported).toBe(0);
      expect(database.sql().some((sql) => sql.includes("insert into"))).toBe(false);
    });

    it("writes nothing for a row GitHub returned unchanged", async () => {
      database.answers({ rows: [stored()] }, { rows: [] });

      const written = await repository.applyPoll({
        target: target(),
        issues: [issue()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written).toMatchObject({ imported: 0, updated: 0, unchanged: 1 });
      expect(database.sql().some((sql) => sql.includes('update "ouroboros"."github_issues"'))).toBe(
        false,
      );
    });

    it("rewrites a row when any mirrored column differs", async () => {
      const cases: [string, Record<string, unknown>][] = [
        ["title", { title: "Something else" }],
        ["body", { body: null }],
        ["state", { state: "closed" }],
        ["labels", { labels: ["bug"] }],
        ["label order", { labels: ["i2c", "bug"] }],
        ["author", { author_login: null }],
        ["url", { gh_url: "https://github.com/acme-robotics/helios-firmware/issues/486" }],
        ["updated_at", { gh_updated_at: new Date("2026-09-07T07:00:00.000Z") }],
        ["created_at", { gh_created_at: new Date("2026-09-05T10:00:00.000Z") }],
      ];

      for (const [what, difference] of cases) {
        database = recordingDatabase();
        repository = new BacklogSyncRepository(database.service);
        database.answers({ rows: [stored(difference)] }, { rows: [] }, { rows: [] });

        const written = await repository.applyPoll({
          target: target(),
          issues: [issue()],
          cursor: null,
          syncedAt: FIXTURE_NOW,
        });

        expect([what, written.updated]).toEqual([what, 1]);
      }
    });

    it("never writes `sizing_status` on an update — that column is the pipeline's", async () => {
      database.answers(
        { rows: [stored({ title: "Changed upstream" })] },
        { rows: [] },
        { rows: [] },
      );

      await repository.applyPoll({
        target: target(),
        issues: [issue()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      const update = database.statements.find((statement) =>
        statement.sql.includes('update "ouroboros"."github_issues"'),
      );

      expect(update?.sql).not.toContain("sizing_status");
      expect(update?.sql).toContain('"synced_at"');
    });

    it("reads the rows it is about to write inside the same transaction", async () => {
      database.answers({ rows: [] }, { rows: [{ id: ROW_ID }] }, { rows: [] });

      await repository.applyPoll({
        target: target(),
        issues: [issue()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      const sql = database.sql();
      const read = sql.findIndex((statement) => statement.includes('select "id", "number"'));

      expect(sql[0]).toBe("begin");
      expect(read).toBeGreaterThan(0);
      expect(sql[read]).toContain('"number" in ($2)');
    });

    it("asks for no rows when a poll returned no issues", async () => {
      database.answers({ rows: [] });

      await repository.applyPoll({
        target: target(),
        issues: [],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(database.sql().some((sql) => sql.includes("select"))).toBe(false);
    });
  });

  describe("what is handed to the estimation pipeline", () => {
    it("hands over an issue that has just arrived", async () => {
      database.answers({ rows: [] }, { rows: [{ id: ROW_ID }] }, { rows: [] });

      const written = await repository.applyPoll({
        target: target(),
        issues: [issue()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.estimable).toEqual([
        {
          organizationId: FIXTURE_WORKSPACE,
          issueId: ROW_ID,
          githubRepoId: FIXTURE_REPO_ID,
          number: 485,
          reason: "imported",
        },
      ]);
    });

    it("hands over an issue that reopened", async () => {
      database.answers({ rows: [stored({ state: "closed" })] }, { rows: [] }, { rows: [] });

      const written = await repository.applyPoll({
        target: target(),
        issues: [issue({ state: "open" })],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.estimable).toEqual([
        {
          organizationId: FIXTURE_WORKSPACE,
          issueId: ROW_ID,
          githubRepoId: FIXTURE_REPO_ID,
          number: 485,
          reason: "reopened",
        },
      ]);
    });

    it("hands over nothing for a close, or for an ordinary edit", async () => {
      database.answers({ rows: [stored()] }, { rows: [] }, { rows: [] });

      const closed = await repository.applyPoll({
        target: target(),
        issues: [issue({ state: "closed" })],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(closed).toMatchObject({ updated: 1, estimable: [] });

      database = recordingDatabase();
      repository = new BacklogSyncRepository(database.service);
      database.answers({ rows: [stored({ title: "Edited" })] }, { rows: [] }, { rows: [] });

      const edited = await repository.applyPoll({
        target: target(),
        issues: [issue()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(edited).toMatchObject({ updated: 1, estimable: [] });
    });
  });
});
