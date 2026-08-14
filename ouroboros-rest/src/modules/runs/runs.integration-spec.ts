import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { RunSummary } from "../dashboard/resources";
import type { DashboardResource } from "../dashboard/resources";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { Page } from "../tenancy/pagination";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";

/**
 * `/api/v1/runs`, over a socket and against a migrated database
 * ([#71](https://github.com/NobuData/ouroboros/issues/71)).
 *
 * Two of the ticket's criteria only exist end to end, and they are what this suite is for.
 * **The contract test**: the aggregate's `activeRuns` and `recentRuns` are required to be
 * *equal as JSON* to the heads of these listings over one population — which is what holds
 * the two repositories' independently-stated orderings together, since the dashboard module
 * deliberately shares no provider. **The existence leak**: a run id belonging to another
 * workspace answers exactly as one that never existed, asserted over two real workspaces in
 * one database.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surfaces under test, and the aggregate the contract is against. */
const RUNS = "/api/v1/runs";
const DASHBOARD = "/api/v1/dashboard";

/** A workspace with somewhere for its runs to have happened. */
interface Workspace {
  readonly id: string;
  readonly slug: string;
  readonly repoId: string;
}

describe("the runs endpoints", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace, a GitHub organisation inside it, and a repository inside that — all three,
   * because `runs.github_repo_id` is held to the workspace by a trigger, and a fixture that
   * skipped the middle row would be refused by the database rather than by this suite.
   *
   * @param owner - Who owns it.
   * @returns The workspace, and the repository its runs hang off.
   */
  async function workspaceWithRepo(
    owner: Awaited<ReturnType<typeof api.signIn>>,
  ): Promise<Workspace> {
    const workspace = await api.workspace(owner);

    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, $2, true) returning id`,
      [workspace.id, workspace.slug],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true) returning id`,
      [orgs[0].id],
    );

    return { id: workspace.id, slug: workspace.slug, repoId: repos[0].id };
  }

  /** A second repository in the same workspace, for the filter cases. */
  async function secondRepo(workspace: Workspace): Promise<string> {
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `select id from ouroboros.github_orgs where organization_id = $1`,
      [workspace.id],
    );
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_repos (org_id, name, enabled)
       values ($1, 'atlas-control', true) returning id`,
      [orgs[0].id],
    );

    return rows[0].id;
  }

  /** What an inserted run may vary in — everything else is a stable filler. */
  interface RunSeed {
    readonly issue: number;
    readonly status: string;
    /** Seconds ago it started. */
    readonly startedAgo: number;
    /** Seconds ago it finished, for a terminal row; omitted for a live one. */
    readonly finishedAgo?: number;
    readonly repoId?: string;
  }

  /**
   * One run, written the way the ingestion bridge (#91) will write them.
   *
   * @param workspace - Whose.
   * @param seed - What this row is about.
   * @returns The run's id.
   */
  async function insertRun(workspace: Workspace, seed: RunSeed): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total, started_at, finished_at,
                                   pr_number, checks_passed, checks_total)
       values ($1, $2, $3::int, 'Issue ' || $3::int, 'standard-fix', 'claude-fable-5', $4,
               'Stage', 1, 6, now() - make_interval(secs => $5),
               case when $6::float8 is null then null
                    else now() - make_interval(secs => $6::float8) end,
               case when $6::float8 is null then null else 100 + $3::int end,
               case when $6::float8 is null then null else 6 end,
               case when $6::float8 is null then null else 6 end)
       returning id`,
      [
        workspace.id,
        seed.repoId ?? workspace.repoId,
        seed.issue,
        seed.status,
        seed.startedAgo,
        seed.finishedAgo ?? null,
      ],
    );

    return rows[0].id;
  }

  /** Read a runs URL as somebody, in a named workspace. */
  function read(person: Parameters<typeof api.as>[0], workspace: Workspace, url: string) {
    return api.as(person)("get", url).set(TENANT_HEADER, workspace.slug);
  }

  describe("who may ask", () => {
    it("refuses a stranger, on both routes", async () => {
      await api.anonymous("get", `${RUNS}?status=active`).expect(401);
      await api.anonymous("get", `${RUNS}/5eed0009-0000-4000-8000-000000000482`).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", `${RUNS}?status=active`).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });
  });

  describe("the listing", () => {
    it("orders the active family down the pipeline, oldest first within a stage", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      // Written out of order on purpose: the ordering under test is the query's, not the
      // insertion's.
      await insertRun(workspace, { issue: 3, status: "review", startedAgo: 500 });
      await insertRun(workspace, { issue: 1, status: "coding", startedAgo: 300 });
      await insertRun(workspace, { issue: 4, status: "building", startedAgo: 100 });
      await insertRun(workspace, { issue: 2, status: "coding", startedAgo: 100 });

      const response = await read(owner, workspace, `${RUNS}?status=active`).expect(200);
      const page = bodyOf<Page<RunSummary>>(response);

      expect(page.items.map((run) => run.issueNumber)).toEqual([1, 2, 4, 3]);
      expect(page.total).toBe(4);
    });

    it("orders the terminal family newest-stopped first", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      await insertRun(workspace, { issue: 1, status: "merged", startedAgo: 900, finishedAgo: 600 });
      await insertRun(workspace, { issue: 2, status: "failed", startedAgo: 900, finishedAgo: 60 });
      await insertRun(workspace, {
        issue: 3,
        status: "needs_human",
        startedAgo: 900,
        finishedAgo: 300,
      });

      const response = await read(owner, workspace, `${RUNS}?status=terminal`).expect(200);
      const page = bodyOf<Page<RunSummary>>(response);

      expect(page.items.map((run) => run.issueNumber)).toEqual([2, 3, 1]);
    });

    it("pages per the #31 convention, echoing the window it applied", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      for (let issue = 1; issue <= 7; issue += 1) {
        await insertRun(workspace, {
          issue,
          status: "merged",
          startedAgo: 1000 + issue,
          finishedAgo: issue * 10,
        });
      }

      const response = await read(
        owner,
        workspace,
        `${RUNS}?status=terminal&limit=3&offset=3`,
      ).expect(200);
      const page = bodyOf<Page<RunSummary>>(response);

      // Newest-stopped first over finishedAgo 10..70 is issues 1..7; the second window of
      // three is 4, 5, 6.
      expect(page.items.map((run) => run.issueNumber)).toEqual([4, 5, 6]);
      expect(page.total).toBe(7);
      expect(page.limit).toBe(3);
      expect(page.offset).toBe(3);
    });

    it("narrows the page and the total to the repository the filter names", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      const atlas = await secondRepo(workspace);
      await insertRun(workspace, { issue: 1, status: "coding", startedAgo: 300 });
      await insertRun(workspace, { issue: 2, status: "coding", startedAgo: 200, repoId: atlas });
      await insertRun(workspace, { issue: 3, status: "coding", startedAgo: 100, repoId: atlas });

      const response = await read(owner, workspace, `${RUNS}?status=active&repo=${atlas}`).expect(
        200,
      );
      const page = bodyOf<Page<RunSummary>>(response);

      expect(page.items.map((run) => run.issueNumber)).toEqual([2, 3]);
      expect(page.total).toBe(2);
    });

    it("answers an empty page for a repository that is not this workspace's", async () => {
      // The filter is a predicate under the org scope, not a resource lookup: somebody
      // else's repo id narrows to nothing rather than confirming it exists.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      await insertRun(workspace, { issue: 1, status: "coding", startedAgo: 300 });

      const other = await api.signIn();
      const elsewhere = await workspaceWithRepo(other);

      const response = await read(
        owner,
        workspace,
        `${RUNS}?status=active&repo=${elsewhere.repoId}`,
      ).expect(200);
      const page = bodyOf<Page<RunSummary>>(response);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it("refuses a request that names no family, naming the field", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);

      const response = await read(owner, workspace, RUNS).expect(422);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe("validation_failed");
      expect(Object.keys(envelope.details)).toContain("status");
    });
  });

  describe("the contract with the aggregate", () => {
    it("serves the aggregate's slices as the heads of these listings, byte for byte", async () => {
      // The ticket's row-shape criterion, held where it can actually break: the dashboard
      // module and this one state their orderings independently, so this equality over one
      // population is what keeps them one sentence. Ten actives and eight terminals — one
      // more than each slice carries — so the comparison also proves the slices are *heads*
      // of these listings rather than merely subsets.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      const statuses = ["coding", "building", "review"];
      for (let issue = 1; issue <= 11; issue += 1) {
        await insertRun(workspace, {
          issue,
          status: statuses[issue % 3],
          startedAgo: 5000 - issue * 100,
        });
      }
      for (let issue = 101; issue <= 109; issue += 1) {
        await insertRun(workspace, {
          issue,
          status: "merged",
          startedAgo: 9000,
          finishedAgo: issue * 10,
        });
      }

      const dashboard = bodyOf<DashboardResource>(
        await read(owner, workspace, DASHBOARD).expect(200),
      );
      const actives = bodyOf<Page<RunSummary>>(
        await read(owner, workspace, `${RUNS}?status=active&limit=10`).expect(200),
      );
      const terminals = bodyOf<Page<RunSummary>>(
        await read(owner, workspace, `${RUNS}?status=terminal&limit=8`).expect(200),
      );

      expect(dashboard.activeRuns).toHaveLength(10);
      expect(dashboard.recentRuns).toHaveLength(8);
      expect(actives.items).toEqual(dashboard.activeRuns);
      expect(terminals.items).toEqual(dashboard.recentRuns);
      // And the listings see past the card limits, which is their whole reason to exist.
      expect(actives.total).toBe(11);
      expect(terminals.total).toBe(9);
    });
  });

  describe("the detail", () => {
    it("answers a run of this workspace's, in the listing's own shape", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      const id = await insertRun(workspace, {
        issue: 482,
        status: "merged",
        startedAgo: 900,
        finishedAgo: 40,
      });

      const detail = bodyOf<RunSummary>(await read(owner, workspace, `${RUNS}/${id}`).expect(200));
      const listed = bodyOf<Page<RunSummary>>(
        await read(owner, workspace, `${RUNS}?status=terminal`).expect(200),
      );

      expect(detail.id).toBe(id);
      expect(detail.issueNumber).toBe(482);
      expect(detail.prNumber).toBe(582);
      // One shape everywhere: the detail is the listing's row, not a third rendering.
      expect(detail).toEqual(listed.items[0]);
    });

    it("answers another workspace's run exactly as one that never existed", async () => {
      // The criterion the ticket states outright: 404, not 403 — no existence leak. Both
      // absences are asserted to the same envelope, so nothing distinguishes them.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);

      const other = await api.signIn();
      const elsewhere = await workspaceWithRepo(other);
      const foreign = await insertRun(elsewhere, { issue: 9, status: "coding", startedAgo: 60 });

      const cross = await read(owner, workspace, `${RUNS}/${foreign}`).expect(404);
      const absent = await read(
        owner,
        workspace,
        `${RUNS}/00000000-0000-4000-8000-000000000000`,
      ).expect(404);

      expect(bodyOf<ErrorEnvelope>(cross).code).toBe("run_not_found");
      const crossEnvelope = bodyOf<ErrorEnvelope>(cross);
      const absentEnvelope = bodyOf<ErrorEnvelope>(absent);
      expect(crossEnvelope.message).toBe(absentEnvelope.message);
      expect(crossEnvelope.details).toEqual({ runId: foreign });
    });

    it("refuses a malformed id before reading anything", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);

      const response = await read(owner, workspace, `${RUNS}/not-a-uuid`).expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
    });
  });
});
