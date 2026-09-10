import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import {
  FIXTURE_OWNER,
  FIXTURE_REPO,
  issuePayload,
  stubIssues,
  type IssuesStub,
} from "../backlog-sync/backlog-sync.fixture";
import { BacklogSyncService } from "../backlog-sync/backlog-sync.service";
import { SYNC_NO_REPOSITORIES } from "../backlog-sync/sync.report";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { FIXTURE_TOKEN } from "../github/github.fixture";
import { GITHUB_FAILURES } from "../github/github.errors";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { MINIMUM_SYNC_INTERVAL_SECONDS } from "./debounce";
import { BACKLOG_SYNC_ERRORS } from "./sync.errors";
import type { SyncStatusResource } from "./sync.resources";

/**
 * The two routes over the whole pipeline
 * ([#113](https://github.com/NobuData/ouroboros/issues/113)) — session guard, tenant guard,
 * roles guard, handler, error filter — against a migrated database and the real Octokit.
 *
 * The unit suites cover the composition rule and both guards over stand-ins. Three of this
 * ticket's four acceptance criteria have a half that only a running service can answer, and
 * they are what this file is:
 *
 *   * **The trigger runs a cycle and `syncedAt` advances afterwards.** `synced_at` is a column
 *     a transaction writes; a unit test can prove a cycle was *driven* and nothing more.
 *   * **Member+ is enforced.** Delete `@Roles()` from the controller and every unit spec in
 *     this module still passes, because none of them goes through the router that reads the
 *     metadata. `roles.integration-spec.ts` makes the same argument for the tenancy API.
 *   * **The debounce is verified as an answer** — a `409` with a code and a retry hint, read
 *     off the wire by whoever clicked.
 *
 * **The whole trigger story is one test on purpose, and it arranges its own clock.** The
 * minimum-interval guard is process-wide and lives in this process's memory, which `truncate`
 * cannot reach — so a suite that asserted the accepted case and the refused case in two tests
 * would have the second depending on the first's side effect, and every one of them depending
 * on whether an earlier test happened to run a cycle. Instead the test runs one cycle on a
 * **backdated** clock — `BacklogSyncService.cycle()` takes one, precisely so a test can place
 * an instant without waiting — then triggers, waits for the stamp to move, and asks again.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const STATUS_PATH = "/api/v1/backlog/sync-status";
const SYNC_PATH = "/api/v1/backlog/sync";
const TOKEN_PATH = "/api/v1/settings/github-token";

/** How long a test waits for a cycle it did not start to finish. */
const CYCLE_DEADLINE_MS = 10_000;

/**
 * How far back a test dates the cycle it runs to arrange one.
 *
 * Comfortably past {@link MINIMUM_SYNC_INTERVAL_SECONDS}, so the trigger under test is refused
 * by nothing that came before it. `BacklogSyncService.cycle()` takes its clock as an argument
 * for exactly this reason — every stamp in one cycle is the same instant, and a test can place
 * it without waiting.
 */
const BACKDATED_MS = (MINIMUM_SYNC_INTERVAL_SECONDS + 30) * 1000;

describe("the backlog surface, against a migrated database", () => {
  let api: ApiHarness;
  let github: IssuesStub;

  beforeAll(async () => {
    // A day, so the application's own loop cannot fire a cycle in the middle of a test — and
    // so the minimum-interval guard is only ever tripped by a trigger a test made.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
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
   * The token goes in through the **real** `PUT /api/v1/settings/github-token`, sealed by the
   * real vault, so what a poll decrypts is what an administrator actually pasted.
   *
   * @param owner - Who owns it.
   * @returns The workspace, with the repository the sync will poll.
   */
  async function configured(owner: Person): Promise<SeededWorkspace> {
    const workspace = await workspaceWithRepo(api, owner, FIXTURE_REPO);

    // The GitHub organisation `workspaceWithRepo` created is named after the workspace slug;
    // the sync sends it as the route's `owner`, so it has to be the login the stub answers for.
    await api.sql.query(
      `update ${SCHEMA_NAME}.github_orgs set login = $1 where organization_id = $2`,
      [FIXTURE_OWNER, workspace.id],
    );

    await api
      .as(owner)("put", TOKEN_PATH)
      .set(TENANT_HEADER, workspace.slug)
      .send({ token: FIXTURE_TOKEN })
      .expect(200);

    return workspace;
  }

  /**
   * Read the status as somebody.
   *
   * @param person - Who is asking.
   * @param workspace - Which workspace.
   * @returns The resource.
   */
  async function status(person: Person, workspace: SeededWorkspace): Promise<SyncStatusResource> {
    const response = await api
      .as(person)("get", STATUS_PATH)
      .set(TENANT_HEADER, workspace.slug)
      .expect(200);

    return bodyOf<SyncStatusResource>(response);
  }

  /**
   * Wait for the freshness stamp to become something other than what it was.
   *
   * The `202` answers before the cycle has finished — that is what the status code means — so
   * a test that read the column immediately would be asserting the race rather than the
   * outcome.
   *
   * @param person - Who is asking.
   * @param workspace - Which workspace.
   * @param before - The stamp as it stood when the trigger was accepted.
   * @returns The stamp once it has moved.
   * @throws {Error} When it has not moved inside {@link CYCLE_DEADLINE_MS}, which is the
   *   honest failure: the trigger did not run a cycle.
   */
  async function freshnessAdvances(
    person: Person,
    workspace: SeededWorkspace,
    before: string | null,
  ): Promise<string> {
    const deadline = Date.now() + CYCLE_DEADLINE_MS;

    while (Date.now() < deadline) {
      const current = await status(person, workspace);

      if (current.syncedAt !== null && current.syncedAt !== before) {
        return current.syncedAt;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error("the trigger was accepted and the freshness stamp never moved");
  }

  describe("reading the status", () => {
    it("says `not_configured` for a workspace with no token, rather than failing", async () => {
      // Never a 404. The endpoint exists to name *which* nothing this is, and this one is the
      // nothing a reader can fix in one click.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner, FIXTURE_REPO);

      const answer = await status(owner, workspace);

      expect(answer).toMatchObject({
        syncedAt: null,
        state: "paused",
        pause: GITHUB_FAILURES.notConfigured,
        running: false,
      });
      expect(answer.message).toContain("no GitHub token");
    });

    it("says `no_repositories` for a token pointed at nothing", async () => {
      // The other *off* state, and deliberately a different word: the two are fixed on two
      // different screens.
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);

      const answer = await status(owner, { ...workspace, repoId: "" });

      expect(answer.pause).toBe(SYNC_NO_REPOSITORIES);
      expect(answer.repositories).toEqual([]);
    });

    it("publishes the columns a real poll wrote", async () => {
      const owner = await api.signIn();
      const workspace = await configured(owner);
      github.answer([issuePayload({ number: 485 })]);

      await api.nest.get(BacklogSyncService).cycle();

      const answer = await status(owner, workspace);

      expect(answer.state).toBe("ok");
      expect(answer.syncedAt).not.toBeNull();
      expect(answer.repositories).toHaveLength(1);
      expect(answer.repositories[0]).toMatchObject({
        githubRepoId: workspace.repoId,
        repository: `${FIXTURE_OWNER}/${FIXTURE_REPO}`,
        state: "ok",
        pause: null,
        lastResult: { imported: 1, updated: 0, unchanged: 0, enqueued: 1 },
      });
      // The watermark is GitHub's own timeline, stored and read back through a text column.
      expect(answer.repositories[0].cursor).not.toBeNull();
    });

    it("shows a workspace its own repositories and nobody else's", async () => {
      const owner = await api.signIn();
      const workspace = await configured(owner);
      const stranger = await api.signIn({ email: "second-owner@ouroboros.invalid" });
      const other = await workspaceWithRepo(api, stranger, "atlas-control");

      github.answer([issuePayload({ number: 485 })]);
      await api.nest.get(BacklogSyncService).cycle();

      expect((await status(owner, workspace)).repositories).toHaveLength(1);
      // A second workspace with no token of its own: its own state, and none of the first's
      // rows. Tenancy is a scope rather than a filter applied afterwards.
      const theirs = await status(stranger, other);

      expect(theirs.pause).toBe(GITHUB_FAILURES.notConfigured);
      expect(theirs.repositories.map((repository) => repository.repository)).toEqual([
        `${other.slug}/atlas-control`,
      ]);
    });
  });

  describe("triggering a sync", () => {
    it("runs a cycle, advances freshness, and refuses an immediate repeat", async () => {
      const owner = await api.signIn();
      const member = await api.signIn({ email: "member@ouroboros.invalid" });
      const workspace = await configured(owner);

      await api.join(workspace.id, member, "member");
      github.answer([issuePayload({ number: 485 })]);

      // One cycle on a backdated clock, which does two things this test needs and does them
      // without waiting: it writes a freshness stamp to advance *from*, and it leaves the
      // minimum-interval guard's clock a minute in the past. The guard is process-wide and
      // lives in this process's memory, so without this the test would depend on whether any
      // earlier test in the file had run a cycle.
      await api.nest.get(BacklogSyncService).cycle(new Date(Date.now() - BACKDATED_MS));

      const before = (await status(member, workspace)).syncedAt;

      expect(before).not.toBeNull();

      // Member+, and a member is the *only* interesting half of that: an owner would pass
      // under `ADMINISTRATORS` too, and would not prove the list was widened.
      const accepted = await api
        .as(member)("post", SYNC_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .expect(202);

      // The body is the status at acceptance: the cycle is running and has moved nothing yet.
      expect(bodyOf<SyncStatusResource>(accepted)).toMatchObject({
        running: true,
        syncedAt: before,
      });

      const after = await freshnessAdvances(member, workspace, before);

      expect(after).not.toBe(before);
      expect(github.calls.length).toBeGreaterThan(0);

      // And now the debounce, from the state the first half left behind.
      const refused = await api
        .as(member)("post", SYNC_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .expect(409);
      const envelope = bodyOf<ErrorEnvelope>(refused);

      expect(envelope.code).toBe(BACKLOG_SYNC_ERRORS.tooSoon);
      expect(envelope.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(envelope.details.retryAfterSeconds).toBeLessThanOrEqual(MINIMUM_SYNC_INTERVAL_SECONDS);
    });

    it("lets a viewer read the status and refuses them the trigger", async () => {
      // The role gate, which no unit suite can see: a `@Roles()` deleted from the controller
      // leaves them all green. A `viewer` is a role that exists to be able to look, and
      // starting a cycle spends the workspace's hourly GitHub budget.
      const owner = await api.signIn();
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
      const workspace = await configured(owner);

      await api.join(workspace.id, viewer, "viewer");

      await api.as(viewer)("get", STATUS_PATH).set(TENANT_HEADER, workspace.slug).expect(200);

      const refused = await api
        .as(viewer)("post", SYNC_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .expect(403);

      // A `403` rather than a `404`: they have already proved they are a member, so the
      // workspace is no secret from them and their role is the only thing left to tell them.
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("forbidden");
    });

    it("refuses a stranger the way it refuses a workspace that does not exist", async () => {
      const owner = await api.signIn();
      const workspace = await configured(owner);
      const stranger = await api.signIn({ email: "stranger@ouroboros.invalid" });

      await api.as(stranger)("post", SYNC_PATH).set(TENANT_HEADER, workspace.slug).expect(404);
      await api.as(stranger)("get", STATUS_PATH).set(TENANT_HEADER, workspace.slug).expect(404);
    });

    it("answers a browser with no session at all with a 401", async () => {
      await api.anonymous("post", SYNC_PATH).expect(401);
      await api.anonymous("get", STATUS_PATH).expect(401);
    });
  });
});
