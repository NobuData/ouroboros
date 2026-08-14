import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { DashboardResource } from "../dashboard/resources";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { QueuePage } from "./queue.service";

/**
 * `/api/v1/queue`, over a socket and against a migrated database
 * ([#73](https://github.com/NobuData/ouroboros/issues/73)).
 *
 * Two of the ticket's criteria only exist end to end, and they are what this suite is for.
 * **The totals contract**: `totalEstMinutes` is required to equal the aggregate's
 * `stats.queued.estMinutes` over one population — which is what holds the two repositories'
 * independently-stated sentences together, since the dashboard module deliberately shares
 * no provider. **The isolation criterion**: another organization's queue is never visible,
 * asserted over two real workspaces in one database.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test, and the aggregate the totals contract is against. */
const QUEUE = "/api/v1/queue";
const DASHBOARD = "/api/v1/dashboard";

/** A workspace with somewhere for its queued issues to live. */
interface Workspace {
  readonly id: string;
  readonly slug: string;
  readonly repoId: string;
}

describe("the queue endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace, a GitHub organisation inside it, and a repository inside that — all three,
   * because `queue_items.github_repo_id` is held to the workspace by a trigger, and a
   * fixture that skipped the middle row would be refused by the database rather than by
   * this suite.
   *
   * @param owner - Who owns it.
   * @returns The workspace, and the repository its queue hangs off.
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

  /** What an inserted item may vary in — everything else is a stable filler. */
  interface ItemSeed {
    readonly position: number;
    readonly issue: number;
    /** Expected minutes, or `null` for an item nobody has sized — which is not zero. */
    readonly estMinutes: number | null;
    readonly repoId?: string;
  }

  /**
   * One queued issue, written the way the issues screen (mockup 03) will write them.
   *
   * @param workspace - Whose.
   * @param seed - What this row is about.
   */
  async function insertItem(workspace: Workspace, seed: ItemSeed): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.queue_items (organization_id, github_repo_id, issue_number,
                                          issue_title, effort, workflow_tag, position,
                                          est_minutes, enqueued_at)
       values ($1, $2, $3::int, 'Issue ' || $3::int, 'm', 'standard-fix', $4,
               $5, now() - make_interval(hours => $4))`,
      [workspace.id, seed.repoId ?? workspace.repoId, seed.issue, seed.position, seed.estMinutes],
    );
  }

  /** Read a queue URL as somebody, in a named workspace. */
  function read(person: Parameters<typeof api.as>[0], workspace: Workspace, url: string) {
    return api.as(person)("get", url).set(TENANT_HEADER, workspace.slug);
  }

  describe("who may ask", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", QUEUE).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", QUEUE).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });
  });

  describe("the listing", () => {
    it("orders by position ascending, whatever order the rows were written in", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      // Written out of order on purpose: the ordering under test is the query's, not the
      // insertion's.
      await insertItem(workspace, { position: 3, issue: 488, estMinutes: 15 });
      await insertItem(workspace, { position: 1, issue: 485, estMinutes: 45 });
      await insertItem(workspace, { position: 4, issue: 490, estMinutes: 180 });
      await insertItem(workspace, { position: 2, issue: 486, estMinutes: 90 });

      const response = await read(owner, workspace, QUEUE).expect(200);
      const page = bodyOf<QueuePage>(response);

      expect(page.items.map((item) => item.position)).toEqual([1, 2, 3, 4]);
      expect(page.items.map((item) => item.issueNumber)).toEqual([485, 486, 488, 490]);
      expect(page.total).toBe(4);
    });

    it("pages per the #31 convention, echoing the window it applied", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      for (let position = 1; position <= 7; position += 1) {
        await insertItem(workspace, { position, issue: 480 + position, estMinutes: 10 });
      }

      const response = await read(owner, workspace, `${QUEUE}?limit=3&offset=3`).expect(200);
      const page = bodyOf<QueuePage>(response);

      // Position ascending over 1..7; the second window of three is 4, 5, 6.
      expect(page.items.map((item) => item.position)).toEqual([4, 5, 6]);
      expect(page.total).toBe(7);
      expect(page.limit).toBe(3);
      expect(page.offset).toBe(3);
      // The totals ignore the window: page 2 still speaks for the whole queue.
      expect(page.totalEstMinutes).toBe(70);
    });

    it("counts an unsized item and does not sum it", async () => {
      // The null-versus-zero distinction, end to end: `total` speaks for four issues while
      // the sum speaks for three, which is the honest shape of a queue where something has
      // not been sized yet.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      await insertItem(workspace, { position: 1, issue: 485, estMinutes: 45 });
      await insertItem(workspace, { position: 2, issue: 486, estMinutes: 90 });
      await insertItem(workspace, { position: 3, issue: 488, estMinutes: 15 });
      await insertItem(workspace, { position: 4, issue: 496, estMinutes: null });

      const page = bodyOf<QueuePage>(await read(owner, workspace, QUEUE).expect(200));

      expect(page.total).toBe(4);
      expect(page.totalEstMinutes).toBe(150);
      expect(page.items[3].estMinutes).toBeNull();
    });

    it("answers an empty workspace with an empty page and zero totals", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);

      const page = bodyOf<QueuePage>(await read(owner, workspace, QUEUE).expect(200));

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.totalEstMinutes).toBe(0);
    });

    it("refuses a repository filter that is not a uuid, naming the field", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);

      const response = await read(owner, workspace, `${QUEUE}?repo=helios-firmware`).expect(422);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe("validation_failed");
      expect(Object.keys(envelope.details)).toContain("repo");
    });
  });

  describe("the repo filter", () => {
    it("narrows the page and both totals to the repository it names", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      const atlas = await secondRepo(workspace);
      await insertItem(workspace, { position: 1, issue: 485, estMinutes: 45 });
      await insertItem(workspace, { position: 2, issue: 486, estMinutes: 90, repoId: atlas });
      await insertItem(workspace, { position: 3, issue: 488, estMinutes: 15, repoId: atlas });

      const response = await read(owner, workspace, `${QUEUE}?repo=${atlas}`).expect(200);
      const page = bodyOf<QueuePage>(response);

      expect(page.items.map((item) => item.issueNumber)).toEqual([486, 488]);
      expect(page.total).toBe(2);
      expect(page.totalEstMinutes).toBe(105);
    });

    it("answers an empty page for a repository that is not this workspace's", async () => {
      // The filter is a predicate under the org scope, not a resource lookup: somebody
      // else's repo id narrows to nothing rather than confirming it exists.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      await insertItem(workspace, { position: 1, issue: 485, estMinutes: 45 });

      const other = await api.signIn();
      const elsewhere = await workspaceWithRepo(other);

      const response = await read(owner, workspace, `${QUEUE}?repo=${elsewhere.repoId}`).expect(
        200,
      );
      const page = bodyOf<QueuePage>(response);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.totalEstMinutes).toBe(0);
    });
  });

  describe("the contract with the aggregate", () => {
    it("agrees with the stat row's own numbers, over one population", async () => {
      // The ticket's cannot-disagree criterion, held where it can actually break: the
      // dashboard repository and this module state the totals sentence independently, so
      // this equality over one population — unsized item included — is what keeps them one
      // sentence.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      for (let position = 1; position <= 11; position += 1) {
        await insertItem(workspace, { position, issue: 480 + position, estMinutes: 45 + position });
      }
      await insertItem(workspace, { position: 12, issue: 496, estMinutes: null });

      const dashboard = bodyOf<DashboardResource>(
        await read(owner, workspace, DASHBOARD).expect(200),
      );
      const page = bodyOf<QueuePage>(await read(owner, workspace, QUEUE).expect(200));

      expect(page.totalEstMinutes).toBe(dashboard.stats.queued.estMinutes);
      expect(page.total).toBe(dashboard.stats.queued.count);
    });

    it("serves the aggregate's queueHead as the head of this listing, byte for byte", async () => {
      // Six items — one more than the card draws — so the comparison also proves the slice
      // is a *head* of this listing rather than merely a subset.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      for (let position = 1; position <= 6; position += 1) {
        await insertItem(workspace, { position, issue: 480 + position, estMinutes: 30 });
      }

      const dashboard = bodyOf<DashboardResource>(
        await read(owner, workspace, DASHBOARD).expect(200),
      );
      const page = bodyOf<QueuePage>(await read(owner, workspace, `${QUEUE}?limit=5`).expect(200));

      expect(dashboard.queueHead).toHaveLength(5);
      expect(page.items).toEqual(dashboard.queueHead);
      // And the listing sees past the card limit, which is its whole reason to exist.
      expect(page.total).toBe(6);
    });
  });

  describe("isolation", () => {
    it("never shows another organization's queue, in rows or in totals", async () => {
      // The isolation criterion the ticket states outright, over two real workspaces: no
      // row bleeds, and neither does a number.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(owner);
      await insertItem(workspace, { position: 1, issue: 485, estMinutes: 45 });

      const other = await api.signIn();
      const elsewhere = await workspaceWithRepo(other);
      await insertItem(elsewhere, { position: 1, issue: 900, estMinutes: 600 });
      await insertItem(elsewhere, { position: 2, issue: 901, estMinutes: 600 });

      const page = bodyOf<QueuePage>(await read(owner, workspace, QUEUE).expect(200));

      expect(page.items.map((item) => item.issueNumber)).toEqual([485]);
      expect(page.total).toBe(1);
      expect(page.totalEstMinutes).toBe(45);
    });
  });
});
