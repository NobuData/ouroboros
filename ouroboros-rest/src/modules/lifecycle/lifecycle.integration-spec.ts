import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { sessionExists, sessionTokenIn } from "../auth/session.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { FARM_DISPATCH_GATE, type DispatchGate } from "../farm/dispatch/dispatch.gate";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { STEP_UP_MAX_AGE_SECONDS } from "../provider-connections/step-up";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { VaultKeyError } from "../vault/vault.errors";
import { VaultService } from "../vault/vault.service";
import { LifecyclePurge } from "./lifecycle.purge";
import type { DisconnectPreviewResource, LifecycleResource } from "./lifecycle.resources";

/**
 * The Danger zone end to end, on a fixture tenant against a migrated database (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)) — and the **purge rehearsal**: the one
 * operation with no undo is exercised here, in CI, before it is ever exercised in production.
 *
 * ```
 * pause ─▶ the stage in flight finishes · the next stage holds · the queue holds · no dispatch
 * resume ─▶ the held stage starts · the held run opens · nothing duplicated
 * delete ─▶ pending_delete · non-owner sessions revoked · every surface frozen ─▶ restore
 * delete ─▶ day 30 ─▶ purge: DEK destroyed (sealed data unreadable) · zero rows left · tombstone
 * ```
 *
 * ```bash
 * yarn test:integration src/modules/lifecycle
 * ```
 */

const LIFECYCLE = "/api/v1/settings/lifecycle";
const SIMULATOR_SECRET = "integration-run-simulator-secret";

describe("the workspace lifecycle", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** A request from somebody, acting in a workspace. */
  const acting = (person: Person, slug: string) => (method: "get" | "post", path: string) =>
    api.as(person)(method, path).set(TENANT_HEADER, slug);

  /** A request on the engine's internal surface. */
  const engine = (path: string, body: object) =>
    api.anonymous("post", path).set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET).send(body);

  /** A workspace with a ticket and a pinned workflow, owned by somebody with a password. */
  async function bench(): Promise<{ owner: Person; seeded: IngestBench; slug: string }> {
    const owner = await api.signUp();
    const seeded = await seedIngestBench(api, owner);

    return { owner, seeded, slug: seeded.workspace.slug };
  }

  /** Open a run on the engine's surface. */
  const openRun = (seeded: IngestBench, key: string) =>
    engine("/internal/runs", { idempotencyKey: key, ...seeded.open });

  /** Move a stage on the engine's surface. */
  const move = (run: string, key: string, stageKey: string, status: string) =>
    engine(`/internal/runs/${run}/stage-transitions`, { idempotencyKey: key, stageKey, status });

  /** The workspace's audit actions and outbox events, oldest first. */
  async function trail(organizationId: string): Promise<{ audit: string[]; outbox: string[] }> {
    const audit = await api.sql.query<{ action: string }>(
      `select action from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and subject_type = 'workspace' order by occurred_at, id`,
      [organizationId],
    );
    const outbox = await api.sql.query<{ event_type: string }>(
      `select event_type from ${SCHEMA_NAME}.audit_event_outbox
        where organization_id = $1 order by occurred_at, id`,
      [organizationId],
    );

    return {
      audit: audit.rows.map((row) => row.action),
      outbox: outbox.rows.map((row) => row.event_type),
    };
  }

  /** A session older than the step-up window, acting in the workspace by header. */
  async function staleSession(person: Person): Promise<string> {
    const cookie = await api.session(person.id);

    await api.sql.query(
      `update ${SCHEMA_NAME}.session set "createdAt" = now() - make_interval(secs => $2)
        where "token" = $1`,
      [sessionTokenIn(cookie), STEP_UP_MAX_AGE_SECONDS * 4],
    );

    return cookie;
  }

  /** Point a person's session at the workspace, as switching to it in the UI does. */
  async function actIn(person: Person, organizationId: string): Promise<void> {
    await api.sql.query(
      `update ${SCHEMA_NAME}.session set "activeOrganizationId" = $2 where "token" = $1`,
      [sessionTokenIn(person.cookie), organizationId],
    );
  }

  describe("pausing all loops", () => {
    it("lets the stage in flight finish, then holds the next stage, the queue and the farm", async () => {
      const { owner, seeded, slug } = await bench();
      const run = bodyOf<RunOpenedResource>(await openRun(seeded, "open-1").expect(201));
      await move(run.id, "t1", "analyze", "active").expect(200);

      const paused = bodyOf<LifecycleResource>(
        await acting(owner, slug)("post", `${LIFECYCLE}/pause`).send({ confirm: true }).expect(200),
      );
      expect(paused.state).toBe("paused");

      // The hold is honoured by the very next request — inside any poll interval.
      await move(run.id, "t2", "analyze", "succeeded").expect(200);
      const held = await move(run.id, "t3", "implement", "active").expect(409);
      expect(bodyOf<ErrorEnvelope>(held).code).toBe("workspace_paused");
      const queued = await openRun(seeded, "open-2").expect(409);
      expect(bodyOf<ErrorEnvelope>(queued).code).toBe("workspace_paused");
      await expect(
        api.nest.get<DispatchGate>(FARM_DISPATCH_GATE).admits(seeded.workspace.id),
      ).resolves.toBe(false);

      // The banner, for every member.
      const viewer = await api.signIn();
      await api.join(seeded.workspace.id, viewer, "viewer");
      const seen = bodyOf<LifecycleResource>(
        await acting(viewer, slug)("get", LIFECYCLE).expect(200),
      );
      expect(seen.banner?.kind).toBe("paused");

      // Resume releases everything that was held, and nothing is lost or duplicated.
      await acting(owner, slug)("post", `${LIFECYCLE}/resume`).expect(200);
      await move(run.id, "t3", "implement", "active").expect(200);
      await openRun(seeded, "open-2").expect(201);
      await expect(
        api.nest.get<DispatchGate>(FARM_DISPATCH_GATE).admits(seeded.workspace.id),
      ).resolves.toBe(true);

      const stages = await api.sql.query<{ stage_key: string; status: string }>(
        `select stage_key, status from ${SCHEMA_NAME}.run_stages where run_id = $1 order by stage_key`,
        [run.id],
      );
      expect(stages.rows).toEqual([
        { stage_key: "analyze", status: "succeeded" },
        { stage_key: "implement", status: "active" },
      ]);
      const runs = await api.sql.query<{ count: string }>(
        `select count(*) as count from ${SCHEMA_NAME}.runs where organization_id = $1`,
        [seeded.workspace.id],
      );
      expect(runs.rows[0].count).toBe("2");
      expect(await trail(seeded.workspace.id)).toEqual({
        audit: ["workspace.paused", "workspace.resumed"],
        outbox: ["audit.workspace.paused", "audit.workspace.resumed"],
      });
    });

    it("is an administrator's: a member is refused and nothing changes", async () => {
      const { seeded, slug } = await bench();
      const member = await api.signIn();
      await api.join(seeded.workspace.id, member, "member");

      await acting(member, slug)("post", `${LIFECYCLE}/pause`).send({ confirm: true }).expect(403);

      expect((await trail(seeded.workspace.id)).audit).toEqual([]);
    });
  });

  describe("disconnecting GitHub", () => {
    it("previews live counts, then pauses, stops syncing and leaves open PRs untouched", async () => {
      const { owner, seeded, slug } = await bench();
      const run = bodyOf<RunOpenedResource>(await openRun(seeded, "open-1").expect(201));
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.pull_requests
           (organization_id, source_id, external_number, external_url, title, head_branch,
            base_branch, run_id, state)
         values ($1, $2, 77, 'https://github.com/acme/repo/pull/77', 'Loop 77', 'loop/77', 'main',
                 $3, 'open')`,
        [seeded.workspace.id, seeded.source, run.id],
      );

      const preview = bodyOf<DisconnectPreviewResource>(
        await acting(owner, slug)("get", `${LIFECYCLE}/disconnect-preview`).expect(200),
      );
      expect(preview).toMatchObject({
        openPullRequests: 1,
        activeRuns: 1,
        syncingSources: 1,
        enabledRepositories: 1,
        tokenStored: false,
      });

      await acting(owner, slug)("post", `${LIFECYCLE}/disconnect`)
        .send({ confirm: true })
        .expect(200);

      const state = bodyOf<LifecycleResource>(
        await acting(owner, slug)("get", LIFECYCLE).expect(200),
      );
      expect(state.state).toBe("paused");
      const sources = await api.sql.query<{ status: string }>(
        `select status from ${SCHEMA_NAME}.ticket_sources where id = $1`,
        [seeded.source],
      );
      expect(sources.rows[0].status).toBe("paused");
      const prs = await api.sql.query<{ state: string }>(
        `select state from ${SCHEMA_NAME}.pull_requests where organization_id = $1`,
        [seeded.workspace.id],
      );
      expect(prs.rows).toEqual([{ state: "open" }]);
      expect((await trail(seeded.workspace.id)).audit).toEqual(["workspace.disconnected"]);
    });
  });

  describe("deleting a workspace", () => {
    it("is refused without the owner role", async () => {
      const { seeded, slug } = await bench();
      const admin = await api.signUp();
      await api.join(seeded.workspace.id, admin, "admin");

      const response = await acting(admin, slug)("post", `${LIFECYCLE}/delete`)
        .send({ confirmName: "Harness Workspace" })
        .expect(403);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("forbidden");
    });

    it("is refused without the exactly-typed name", async () => {
      const { owner, slug } = await bench();

      const response = await acting(owner, slug)("post", `${LIFECYCLE}/delete`)
        .send({ confirmName: "harness workspace" })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("workspace_name_mismatch");
    });

    it("is refused without a step-up, and accepted once the password confirms it", async () => {
      const { owner, seeded, slug } = await bench();
      const stale = await staleSession(owner);
      const asStale = () =>
        api.anonymous("post", `${LIFECYCLE}/delete`).set("Cookie", stale).set(TENANT_HEADER, slug);

      const refused = await asStale().send({ confirmName: "Harness Workspace" }).expect(401);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("step_up_required");
      expect((await trail(seeded.workspace.id)).audit).toEqual([]);

      await asStale()
        .send({ confirmName: "Harness Workspace", password: "harness-password-0001" })
        .expect(200);
    });

    it("revokes non-owner sessions, freezes every surface, and lets the owner restore", async () => {
      const { owner, seeded, slug } = await bench();
      const member = await api.signIn();
      await api.join(seeded.workspace.id, member, "member");
      await actIn(member, seeded.workspace.id);
      await actIn(owner, seeded.workspace.id);
      const viewer = await api.signIn();
      await api.join(seeded.workspace.id, viewer, "viewer");

      const deleted = bodyOf<LifecycleResource>(
        await acting(owner, slug)("post", `${LIFECYCLE}/delete`)
          .send({ confirmName: "Harness Workspace" })
          .expect(200),
      );
      expect(deleted.state).toBe("pending_delete");
      expect(deleted.purgeAfter).not.toBeNull();

      // The member acting in it is signed out; the owner is not.
      expect(await sessionExists(api.sql, member.cookie)).toBe(false);
      expect(await sessionExists(api.sql, owner.cookie)).toBe(true);

      // Every surface is frozen — for a non-owner everywhere, for the owner outside recovery.
      const frozen = await acting(viewer, slug)("get", LIFECYCLE).expect(403);
      expect(bodyOf<ErrorEnvelope>(frozen)).toMatchObject({
        code: "workspace_pending_delete",
        details: { restorable: false },
      });
      const ownerFrozen = await acting(owner, slug)("get", "/api/v1/settings/auto-merge").expect(
        403,
      );
      expect(bodyOf<ErrorEnvelope>(ownerFrozen).details).toMatchObject({ restorable: true });
      await acting(owner, slug)("get", LIFECYCLE).expect(200);

      // All dispatch stopped.
      const refused = await openRun(seeded, "open-1").expect(409);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("workspace_pending_delete");

      const restored = bodyOf<LifecycleResource>(
        await acting(owner, slug)("post", `${LIFECYCLE}/restore`).expect(200),
      );
      expect(restored).toMatchObject({ state: "active", purgeAfter: null, banner: null });
      await acting(viewer, slug)("get", LIFECYCLE).expect(200);
      expect(await trail(seeded.workspace.id)).toEqual({
        audit: ["workspace.delete_requested", "workspace.restored"],
        outbox: ["audit.workspace.delete_requested", "audit.workspace.restored"],
      });
    });
  });

  describe("the purge rehearsal", () => {
    it("destroys the DEK, deletes every row and keeps a tombstone — sealed data stays unreadable", async () => {
      const { owner, seeded, slug } = await bench();
      const organizationId = seeded.workspace.id;
      const vault = api.nest.get(VaultService);
      const sealed = await vault.encryptText(
        organizationId,
        "rehearsal-record",
        "sealed-before-purge",
      );
      await openRun(seeded, "open-1").expect(201);

      await acting(owner, slug)("post", `${LIFECYCLE}/delete`)
        .send({ confirmName: "Harness Workspace" })
        .expect(200);

      // A purge before the window closes does nothing.
      const purge = api.nest.get(LifecyclePurge);
      await expect(purge.sweep(new Date())).resolves.toEqual([]);

      // Day 30.
      const day30 = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
      const reports = await purge.sweep(day30);

      expect(reports).toEqual([
        expect.objectContaining({ organizationId, dekVersionsDestroyed: 1, rowsRemaining: 0 }),
      ]);
      await expect(
        vault.decryptText(organizationId, "rehearsal-record", sealed),
      ).rejects.toBeInstanceOf(VaultKeyError);

      const keys = await api.sql.query(
        `select 1 from ${SCHEMA_NAME}.tenant_keys where organization_id = $1`,
        [organizationId],
      );
      expect(keys.rowCount).toBe(0);
      const organization = await api.sql.query(
        `select 1 from ${SCHEMA_NAME}.organization where id = $1`,
        [organizationId],
      );
      expect(organization.rowCount).toBe(0);
      const tombstones = await api.sql.query<{
        name: string;
        requested_by: string;
        dek_versions_destroyed: number;
        rows_remaining: number;
      }>(
        `select name, requested_by, dek_versions_destroyed, rows_remaining
           from ${SCHEMA_NAME}.workspace_tombstones where organization_id = $1`,
        [organizationId],
      );
      expect(tombstones.rows).toEqual([
        {
          name: "Harness Workspace",
          requested_by: owner.id,
          dek_versions_destroyed: 1,
          rows_remaining: 0,
        },
      ]);
      expect((await trail(organizationId)).outbox).toEqual(["audit.workspace.purged"]);

      // Running again finds nothing to do.
      await expect(purge.sweep(day30)).resolves.toEqual([]);
    });
  });
});
