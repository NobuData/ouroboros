import { ApiHarness } from "../../testing/harness.fixture";
import { workspaceWithRepo } from "../../testing/dashboard.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { FIXTURE_TOKEN } from "../github/github.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { BacklogSyncService } from "./backlog-sync.service";
import {
  FIXTURE_OWNER,
  FIXTURE_REPO,
  issuePayload,
  pullRequestPayload,
  stubIssues,
  type IssuesStub,
} from "./backlog-sync.fixture";
import { SYNC_NO_REPOSITORIES } from "./sync.report";
import { GITHUB_FAILURES } from "../github/github.errors";

/**
 * The sync against a migrated database and the real Octokit
 * ([#102](https://github.com/NobuData/ouroboros/issues/102)).
 *
 * The unit suites run this code over recorded statements and a scripted `OctokitLike`, and
 * that is exactly what makes this one necessary. Five things can only be asserted here, and
 * four of them are acceptance criteria:
 *
 *   * **A cold import lands every open issue, with pull requests excluded** — over the real
 *     `Link`-header pagination, into the real `github_issues`, through V014's CHECKs. A unit
 *     test cannot say whether the row the mapping produced is a row the server accepts.
 *   * **A second poll with no upstream changes costs one request and touches no rows.** The
 *     *touches no rows* half is a claim about `updated_at`, which only a trigger can move —
 *     so only a database can prove it did not.
 *   * **An edit appears within one poll, and a close flips `state`.** Both come back through
 *     `since`, which is stored, read back and sent again — a round trip through a `text`
 *     column that no unit test crosses.
 *   * **Freshness is the real `synced_at` and never claims a failed sync.** The stamp and the
 *     rows move in one transaction, so this is a question about what is left behind when a
 *     poll fails partway.
 *   * **A GitHub App's `[bot]` login is storable** — V028, the constraint this ticket found by
 *     being the table's first writer.
 *
 * ---------------------------------------------------------------------------
 * **The cycle is driven from the injector rather than by waiting for the scheduler.** The
 * loop's own behaviour is `backlog-sync.scheduler.spec.ts`'s, under fake timers; a suite that
 * waited a real jittered five minutes for each assertion would take an hour. The harness is
 * started with a day-long interval so the application's own loop cannot fire a competing
 * cycle mid-test.
 *
 * The token is stored through the **real** `PUT /api/v1/settings/github-token`, sealed by the
 * real vault, so what the poll decrypts is what an administrator actually pasted.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const TOKEN_PATH = "/api/v1/settings/github-token";

/** One mirrored row, as an assertion reads it. */
interface StoredIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  author_login: string | null;
  sizing_status: string;
  synced_at: Date;
  updated_at: Date;
}

/** The repository's freshness columns. */
interface StoredRepo {
  issues_synced_at: Date | null;
  issues_sync_cursor: string | null;
}

describe("the backlog sync, against a migrated database", () => {
  let api: ApiHarness;
  let sync: BacklogSyncService;
  let github: IssuesStub;

  beforeAll(async () => {
    // A day, so the application's own loop cannot fire a cycle in the middle of a test.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
    sync = api.nest.get(BacklogSyncService);
  });

  afterAll(() => api.close());

  beforeEach(() => {
    github = stubIssues();
  });

  afterEach(async () => {
    github.restore();
    await api.truncate();
  });

  /**
   * A workspace with an owner, an enabled repository, and a stored GitHub token.
   *
   * @returns The workspace id and the repository row's id.
   */
  async function configured(): Promise<{ id: string; repoId: string; slug: string }> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner, FIXTURE_REPO);

    // The GitHub organisation `workspaceWithRepo` created is named after the workspace slug;
    // the sync sends it as the route's `owner`, so it has to be the login the stub answers
    // for. Renamed here rather than in the shared fixture, which a dozen dashboard suites use.
    await api.sql.query(
      `update ${SCHEMA_NAME}.github_orgs set login = $1 where organization_id = $2`,
      [FIXTURE_OWNER, workspace.id],
    );

    await api
      .as(owner)("put", TOKEN_PATH)
      .set(TENANT_HEADER, workspace.slug)
      .send({ token: FIXTURE_TOKEN })
      .expect(200);

    return { id: workspace.id, repoId: workspace.repoId, slug: workspace.slug };
  }

  /**
   * Every mirrored issue in a repository, lowest number first.
   *
   * @param repoId - The repository.
   * @returns The rows.
   */
  async function issues(repoId: string): Promise<StoredIssue[]> {
    const { rows } = await api.sql.query<StoredIssue>(
      `select number, title, body, state, labels, author_login, sizing_status, synced_at, updated_at
         from ${SCHEMA_NAME}.github_issues where github_repo_id = $1 order by number`,
      [repoId],
    );

    return rows;
  }

  /**
   * A repository's freshness columns.
   *
   * @param repoId - The repository.
   * @returns The stamp and the watermark.
   */
  async function repo(repoId: string): Promise<StoredRepo> {
    const { rows } = await api.sql.query<StoredRepo>(
      `select issues_synced_at, issues_sync_cursor from ${SCHEMA_NAME}.github_repos where id = $1`,
      [repoId],
    );

    return rows[0];
  }

  describe("the cold import", () => {
    it("lands every open issue, and no pull request", async () => {
      const workspace = await configured();

      github.answer(
        [issuePayload({ number: 483 }), pullRequestPayload({ number: 900 })],
        [issuePayload({ number: 485 }), issuePayload({ number: 491 })],
      );

      const report = await sync.cycle();
      const stored = await issues(workspace.repoId);

      expect(stored.map((issue) => issue.number)).toEqual([483, 485, 491]);
      expect(report.organizations[0].repositories[0]).toMatchObject({
        imported: 3,
        pullRequests: 1,
        unusable: 0,
      });
    });

    it("walks GitHub's own Link-header pagination", async () => {
      const workspace = await configured();

      github.answer(
        [issuePayload({ number: 1 })],
        [issuePayload({ number: 2 })],
        [issuePayload({ number: 3 })],
      );

      await sync.cycle();

      expect(github.calls).toHaveLength(3);
      expect(github.calls[0].query).toMatchObject({
        state: "open",
        sort: "updated",
        direction: "asc",
      });
      expect(github.calls[0].query).not.toHaveProperty("since");
      expect((await issues(workspace.repoId)).map((issue) => issue.number)).toEqual([1, 2, 3]);
    });

    it("stores what mockup 03's panel renders", async () => {
      const workspace = await configured();

      github.answer([issuePayload()]);

      await sync.cycle();
      const [stored] = await issues(workspace.repoId);

      expect(stored).toMatchObject({
        number: 485,
        title: "Watchdog reset on I²C bus lockup",
        body: "Unit 07 in the Fremont pilot rebooted 14 times.",
        state: "open",
        labels: ["bug", "i2c", "watchdog"],
        author_login: "field-support",
      });
    });

    it("mirrors an issue opened by a GitHub App, which V014's rule refused (V028)", async () => {
      // The constraint this ticket found by being the table's first writer. Renovate's
      // dependency dashboard and everything a workflow files are issues a backlog must hold.
      const workspace = await configured();

      github.answer([
        issuePayload({ number: 1, login: "dependabot[bot]" }),
        issuePayload({ number: 2, login: "github-actions[bot]" }),
      ]);

      const report = await sync.cycle();

      expect(report.organizations[0].repositories[0].unusable).toBe(0);
      expect((await issues(workspace.repoId)).map((issue) => issue.author_login)).toEqual([
        "dependabot[bot]",
        "github-actions[bot]",
      ]);
    });

    it("arrives unsized, which is what the estimation pipeline claims work by", async () => {
      // The sync writes issues, not estimates. The other half of *"a new issue automatically
      // enters the estimation pipeline"* is L.3's (#107) to verify — this is the state it
      // finds.
      const workspace = await configured();

      github.answer([issuePayload()]);

      const report = await sync.cycle();

      expect((await issues(workspace.repoId))[0].sizing_status).toBe("unsized");
      expect(report.organizations[0].repositories[0].enqueued).toBe(1);
    });

    it("stamps freshness and the watermark GitHub's own timestamps produced", async () => {
      const workspace = await configured();

      github.answer([
        issuePayload({ number: 1, updatedAt: "2026-09-08T07:00:00Z" }),
        issuePayload({ number: 2, updatedAt: "2026-09-08T09:30:00Z" }),
      ]);

      const before = new Date();
      await sync.cycle();
      const stored = await repo(workspace.repoId);

      expect(stored.issues_sync_cursor).toBe("2026-09-08T09:30:00.000Z");
      expect(stored.issues_synced_at?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });

    it("stamps freshness with no watermark for a repository whose backlog is empty", async () => {
      // `github_repos_issues_cursor_after_sync` reads *synced, no cursor* as the legitimate
      // state it is: the poll ran, and there was nothing to resume from.
      const workspace = await configured();

      github.answer([]);

      await sync.cycle();
      const stored = await repo(workspace.repoId);

      expect(stored.issues_synced_at).not.toBeNull();
      expect(stored.issues_sync_cursor).toBeNull();
    });

    it("skips a payload the mirror cannot represent without losing the page", async () => {
      const workspace = await configured();

      github.answer([
        issuePayload({ number: 1 }),
        issuePayload({ number: 2, url: "javascript:alert(1)" }),
        issuePayload({ number: 3 }),
      ]);

      const report = await sync.cycle();

      expect((await issues(workspace.repoId)).map((issue) => issue.number)).toEqual([1, 3]);
      expect(report.organizations[0].repositories[0].unusable).toBe(1);
    });
  });

  describe("the second poll", () => {
    it("costs one request and touches no rows when nothing changed", async () => {
      const workspace = await configured();

      github.answer([issuePayload()]);
      await sync.cycle();

      const [first] = await issues(workspace.repoId);

      // GitHub's `since` is inclusive, so the issue sitting exactly on the watermark comes
      // back — and writing it would move `updated_at` on a row nothing had changed.
      github.answer([issuePayload()]);
      const report = await sync.cycle();

      const [second] = await issues(workspace.repoId);

      expect(github.calls).toHaveLength(2);
      expect(github.calls[1].query.state).toBe("all");
      expect(github.calls[1].query.since).toBe("2026-09-08T07:00:00.000Z");
      expect(report.organizations[0].repositories[0]).toMatchObject({
        imported: 0,
        updated: 0,
        unchanged: 1,
      });
      expect(second.updated_at.getTime()).toBe(first.updated_at.getTime());
      expect(second.synced_at.getTime()).toBe(first.synced_at.getTime());
    });

    it("still moves the repository's freshness, because we looked", async () => {
      const workspace = await configured();

      github.answer([issuePayload()]);
      await sync.cycle();

      const first = await repo(workspace.repoId);

      github.answer([]);
      await sync.cycle();

      const second = await repo(workspace.repoId);

      expect(second.issues_synced_at?.getTime()).toBeGreaterThan(
        first.issues_synced_at?.getTime() ?? 0,
      );
      expect(second.issues_sync_cursor).toBe(first.issues_sync_cursor);
    });

    it("brings an upstream edit down within one poll", async () => {
      const workspace = await configured();

      github.answer([issuePayload()]);
      await sync.cycle();

      github.answer([
        issuePayload({
          title: "Watchdog reset on I²C bus lockup (still)",
          updatedAt: "2026-09-08T11:00:00Z",
        }),
      ]);
      const report = await sync.cycle();

      const [stored] = await issues(workspace.repoId);

      expect(stored.title).toBe("Watchdog reset on I²C bus lockup (still)");
      expect(report.organizations[0].repositories[0].updated).toBe(1);
      expect((await repo(workspace.repoId)).issues_sync_cursor).toBe("2026-09-08T11:00:00.000Z");
    });

    it("flips `state` when the issue is closed upstream", async () => {
      // Only reachable because an incremental poll asks for `state=all`: a closed issue simply
      // leaves an `open` listing, and the mirror would hold it open forever.
      const workspace = await configured();

      github.answer([issuePayload()]);
      await sync.cycle();

      github.answer([issuePayload({ state: "closed", updatedAt: "2026-09-08T11:00:00Z" })]);
      await sync.cycle();

      expect((await issues(workspace.repoId))[0].state).toBe("closed");
    });

    it("hands a reopened issue back to the estimation pipeline", async () => {
      const workspace = await configured();

      github.answer([issuePayload()]);
      await sync.cycle();

      github.answer([issuePayload({ state: "closed", updatedAt: "2026-09-08T11:00:00Z" })]);
      const closing = await sync.cycle();

      github.answer([issuePayload({ state: "open", updatedAt: "2026-09-08T12:00:00Z" })]);
      const reopening = await sync.cycle();

      expect(closing.organizations[0].repositories[0].enqueued).toBe(0);
      expect(reopening.organizations[0].repositories[0].enqueued).toBe(1);
      expect((await issues(workspace.repoId))[0].state).toBe("open");
    });

    it("does not import a closed issue it has never seen", async () => {
      // `state=all` widens what the sync learns without widening what it keeps: the mirror is
      // of a backlog.
      const workspace = await configured();

      github.answer([issuePayload({ number: 1 })]);
      await sync.cycle();

      github.answer([
        issuePayload({ number: 1, updatedAt: "2026-09-08T11:00:00Z" }),
        issuePayload({ number: 777, state: "closed", updatedAt: "2026-09-08T11:30:00Z" }),
      ]);
      await sync.cycle();

      expect((await issues(workspace.repoId)).map((issue) => issue.number)).toEqual([1]);
    });
  });

  describe("freshness is never optimistic", () => {
    it("is not moved at all by a poll that failed", async () => {
      const workspace = await configured();

      github.answer([issuePayload()]);
      await sync.cycle();

      const before = await repo(workspace.repoId);

      github.fail(500);
      const report = await sync.cycle();

      const after = await repo(workspace.repoId);

      expect(report.organizations[0].repositories[0].pause).toBe(GITHUB_FAILURES.upstreamError);
      expect(after.issues_synced_at?.getTime()).toBe(before.issues_synced_at?.getTime());
      expect(after.issues_sync_cursor).toBe(before.issues_sync_cursor);
    });

    it("survives a token GitHub rejects, as a pause rather than a crash", async () => {
      const workspace = await configured();

      github.fail(401);
      const report = await sync.cycle();

      expect(report.organizations[0].repositories[0].pause).toBe(GITHUB_FAILURES.unauthorized);
      expect((await repo(workspace.repoId)).issues_synced_at).toBeNull();
    });
  });

  describe("when there is nothing to poll, it says why", () => {
    it("reports `not_configured` for a workspace whose token was cleared", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner, FIXTURE_REPO);

      const report = await sync.cycle();

      expect(report.organizations).toEqual([
        {
          organizationId: workspace.id,
          pause: GITHUB_FAILURES.notConfigured,
          repositories: [],
        },
      ]);
      expect(github.calls).toEqual([]);
    });

    it("reports `no_repositories` for a configured workspace with nothing enabled", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);

      const report = await sync.cycle();

      expect(report.organizations).toEqual([
        { organizationId: workspace.id, pause: SYNC_NO_REPOSITORIES, repositories: [] },
      ]);
      expect(github.calls).toEqual([]);
    });

    it("skips a repository whose GitHub organisation has been turned off", async () => {
      // A repository is in scope only when its own `enabled` and its org's are both true.
      const workspace = await configured();

      await api.sql.query(
        `update ${SCHEMA_NAME}.github_orgs set enabled = false where organization_id = $1`,
        [workspace.id],
      );

      const report = await sync.cycle();

      expect(report.organizations[0].pause).toBe(SYNC_NO_REPOSITORIES);
      expect(github.calls).toEqual([]);
    });
  });

  describe("what a status endpoint will read", () => {
    it("remembers the last cycle for M.4 to render", async () => {
      await configured();

      github.answer([issuePayload()]);
      const report = await sync.cycle();

      expect(sync.lastCycle()).toBe(report);
      expect(report.organizations[0].repositories[0].repository).toBe(
        `${FIXTURE_OWNER}/${FIXTURE_REPO}`,
      );
    });
  });
});
