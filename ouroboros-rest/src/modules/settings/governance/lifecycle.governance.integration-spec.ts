import { ApiHarness, HARNESS_PASSWORD, type Person } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { sessionTokenIn } from "../../auth/session.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import { DispatchService } from "../../farm/dispatch/dispatcher";
import type { BuildJobResource } from "../../farm/dispatch/jobs.resources";
import { certificationRequest } from "../../farm/farm.fixture";
import type { EnrollmentResource, MintedTokenResource } from "../../farm/farm.resources";
import { FakeAgent, isRefused } from "../../farm/gateway/fake.agent.fixture";
import { fixtureFrame } from "../../farm/gateway/gateway.fixture";
import { uuidOf } from "../../farm/protocol/ulid";
import { seedIngestBench, type IngestBench } from "../../ingest/ingest.fixture";
import type { RunOpenedResource } from "../../ingest/ingest.resources";
import { WORKSPACE_AUTH_STORE, type WorkspaceAuthStore } from "../../lifecycle/lifecycle.auth";
import { LifecyclePurge } from "../../lifecycle/lifecycle.purge";
import { LifecycleRepository } from "../../lifecycle/lifecycle.repository";
import type { LifecycleResource } from "../../lifecycle/lifecycle.resources";
import { STEP_UP_MAX_AGE_SECONDS } from "../../provider-connections/step-up";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { VaultKeyError } from "../../vault/vault.errors";
import { VaultService } from "../../vault/vault.service";

/**
 * The workspace lifecycle as governance (BR.6,
 * [#490](https://github.com/NobuData/ouroboros/issues/490)) — mockup 17's *"running loops finish
 * their stage"* and *30-day recovery*, held against every dispatch point and the purge's failure
 * modes. `lifecycle.integration-spec.ts` walks each operation once; this suite is written so that
 * removing a control turns it red:
 *
 *   * **every BR.5 dispatch point, in both holding states** — a run opening (`POST /internal/runs`),
 *     a stage starting, and farm dispatch through the real `DispatchService` to a connected agent —
 *     refuses new work while `paused` and while `pending_delete`; the stage in flight still
 *     finishes; resuming (or restoring) releases exactly what was held, once;
 *   * **deletion** needs the owner, the exactly-typed name and a step-up — a wrong password on a
 *     stale session is refused like an absent one;
 *   * **recovery** works on day 29 and — decided with the user — after the window closed but
 *     before the sweep ran; it is refused once the purge has begun, so a tenant whose keys may be
 *     gone never comes back half-shredded;
 *   * **the purge** destroys the DEK (a sealed value no longer decrypts), leaves another tenant's
 *     keys and rows untouched, and **resumes** after a failure injected at each step on the real
 *     database: the tombstone is written first with the key count from before the shred, the next
 *     sweep finishes it, and exactly one `audit.workspace.purged` is queued.
 *
 * Not gated, deliberately (BR.5's scope — "queued stays queued"): build submission and the backlog
 * queue accept work while paused; webhook, notification and sync schedulers keep running.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/settings/governance/lifecycle
 * ```
 */

const LIFECYCLE = "/api/v1/settings/lifecycle";
const SIMULATOR_SECRET = "integration-run-simulator-secret";
const CERT_HEADER = "x-ouro-client-cert";
const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";
const DAY_MS = 86_400_000;

/** The two states that hold new work, and the move that releases each. */
const HOLDS = [
  { state: "paused", release: "resume", code: "workspace_paused" },
  { state: "pending_delete", release: "restore", code: "workspace_pending_delete" },
] as const;

/** One holding state. */
type Hold = (typeof HOLDS)[number];

describe("workspace lifecycle governance", () => {
  let api: ApiHarness;
  const agents: FakeAgent[] = [];

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
      OURO_FARM_CLIENT_CERT_HEADER: CERT_HEADER,
    });
  });

  afterAll(() => api.close());

  afterEach(async () => {
    for (const agent of agents.splice(0)) agent.drop();
    await api.truncate();
  });

  /** A request from somebody, acting in a workspace. */
  const acting = (person: Person, slug: string) => (method: "get" | "post", path: string) =>
    api.as(person)(method, path).set(TENANT_HEADER, slug);

  /** A request on the engine's internal surface. */
  const engine = (path: string, body: object) =>
    api.anonymous("post", path).set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET).send(body);

  /** Open a run on the engine's surface. */
  const openRun = (seeded: IngestBench, key: string) =>
    engine("/internal/runs", { idempotencyKey: key, ...seeded.open });

  /** Move a stage on the engine's surface. */
  const move = (run: string, key: string, stageKey: string, status: string) =>
    engine(`/internal/runs/${run}/stage-transitions`, { idempotencyKey: key, stageKey, status });

  /** A workspace with a ticket and a pinned workflow, owned by somebody with a password. */
  async function bench(): Promise<{ owner: Person; seeded: IngestBench; slug: string }> {
    const owner = await api.signUp();
    const seeded = await seedIngestBench(api, owner);

    return { owner, seeded, slug: seeded.workspace.slug };
  }

  /**
   * Put a workspace into a holding state through its own route, as its owner.
   *
   * @param owner - The owner, on a fresh session (a step-up in itself).
   * @param slug - The workspace.
   * @param hold - Which state.
   */
  async function enter(owner: Person, slug: string, hold: Hold): Promise<void> {
    const request =
      hold.state === "paused"
        ? acting(owner, slug)("post", `${LIFECYCLE}/pause`).send({ confirm: true })
        : acting(owner, slug)("post", `${LIFECYCLE}/delete`).send({
            confirmName: "Harness Workspace",
          });

    expect(bodyOf<LifecycleResource>(await request.expect(200)).state).toBe(hold.state);
  }

  /**
   * Release a held workspace through its own route.
   *
   * @param owner - The owner.
   * @param slug - The workspace.
   * @param hold - Which state it is in.
   */
  async function release(owner: Person, slug: string, hold: Hold): Promise<void> {
    const released = bodyOf<LifecycleResource>(
      await acting(owner, slug)("post", `${LIFECYCLE}/${hold.release}`).expect(200),
    );
    expect(released.state).toBe("active");
  }

  /** A session older than the step-up window. */
  async function staleSession(person: Person): Promise<string> {
    const cookie = await api.session(person.id);

    await api.sql.query(
      `update ${SCHEMA_NAME}.session set "createdAt" = now() - make_interval(secs => $2)
        where "token" = $1`,
      [sessionTokenIn(cookie), STEP_UP_MAX_AGE_SECONDS * 4],
    );

    return cookie;
  }

  /** The workspace's `audit.workspace.*` outbox events, oldest first. */
  async function outbox(organizationId: string): Promise<string[]> {
    const { rows } = await api.sql.query<{ event_type: string }>(
      `select event_type from ${SCHEMA_NAME}.webhook_outbox
        where organization_id = $1 and event_type like 'audit.workspace.%'
        order by occurred_at, id`,
      [organizationId],
    );
    return rows.map((row) => row.event_type);
  }

  /** A workspace's tombstone, or `undefined`. */
  async function tombstone(organizationId: string): Promise<
    | {
        purged_at: Date | null;
        dek_versions_destroyed: number;
        rows_remaining: number;
      }
    | undefined
  > {
    const { rows } = await api.sql.query<{
      purged_at: Date | null;
      dek_versions_destroyed: number;
      rows_remaining: number;
    }>(
      `select purged_at, dek_versions_destroyed, rows_remaining
         from ${SCHEMA_NAME}.workspace_tombstones where organization_id = $1`,
      [organizationId],
    );
    return rows[0];
  }

  /** How many rows a table holds for a workspace. */
  async function count(table: string, organizationId: string): Promise<number> {
    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*) as count from ${SCHEMA_NAME}.${table} where organization_id = $1`,
      [organizationId],
    );
    return Number(rows[0].count);
  }

  describe("every dispatch point holds", () => {
    it.each(HOLDS)(
      "while $state: the stage in flight finishes, no stage starts and no run opens — then $release releases each once",
      async (hold) => {
        const { owner, seeded, slug } = await bench();
        const run = bodyOf<RunOpenedResource>(await openRun(seeded, "open-1").expect(201));
        await move(run.id, "t1", "analyze", "active").expect(200);

        await enter(owner, slug, hold);

        // Work in flight lands.
        await move(run.id, "t2", "analyze", "succeeded").expect(200);
        // Nothing new starts, by the very next request.
        const held = await move(run.id, "t3", "implement", "active").expect(409);
        expect(bodyOf<ErrorEnvelope>(held).code).toBe(hold.code);
        const queued = await openRun(seeded, "open-2").expect(409);
        expect(bodyOf<ErrorEnvelope>(queued).code).toBe(hold.code);
        expect(await count("runs", seeded.workspace.id)).toBe(1);

        await release(owner, slug, hold);

        // The same requests, retried with the same keys, now go through — once.
        await move(run.id, "t3", "implement", "active").expect(200);
        await move(run.id, "t3", "implement", "active").expect(200);
        await openRun(seeded, "open-2").expect(201);
        await openRun(seeded, "open-2").expect(201);
        const stages = await api.sql.query<{ stage_key: string; status: string }>(
          `select stage_key, status from ${SCHEMA_NAME}.run_stages where run_id = $1 order by stage_key`,
          [run.id],
        );
        expect(stages.rows).toEqual([
          { stage_key: "analyze", status: "succeeded" },
          { stage_key: "implement", status: "active" },
        ]);
        expect(await count("runs", seeded.workspace.id)).toBe(2);
      },
    );

    it.each(HOLDS)(
      "while $state: farm dispatch leaves a queued build queued, and offers it once $release releases it",
      async (hold) => {
        const owner = await api.signIn();
        const workspace = await api.workspace(owner);
        await api.sql.query(
          `insert into ${SCHEMA_NAME}.runner_pools
             (organization_id, name, executor, image, max_concurrency, default_command, enabled)
           values ($1, 'pool-a', 'container', 'img:0.17', 1, 'make all', true)`,
          [workspace.id],
        );
        const { rows: orgs } = await api.sql.query<{ id: string }>(
          `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
           values ($1, 'acme-robotics', true) returning id`,
          [workspace.id],
        );
        await api.sql.query(
          `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled)
           values ($1, 'helios-firmware', true)`,
          [orgs[0].id],
        );
        const as = acting(owner, workspace.slug);

        // Queued before any runner is connected, so nothing can take it yet.
        const job = bodyOf<BuildJobResource>(
          await as("post", "/api/v1/farm/jobs")
            .send({
              pool: "pool-a",
              repository: "acme-robotics/helios-firmware",
              ref: "refs/heads/main",
              commit: COMMIT,
            })
            .expect(201),
        );
        const minted = bodyOf<MintedTokenResource>(
          await as("post", "/api/v1/farm/enrollment-tokens").send({ pool: "pool-a" }).expect(201),
        );

        const enrollment = bodyOf<EnrollmentResource>(
          await api
            .anonymous("post", "/api/v1/farm/registrations")
            .send({
              token: minted.token,
              name: "forge-01",
              arch: "linux/x86_64",
              csr: certificationRequest(),
            })
            .expect(201),
        );

        await enter(owner, workspace.slug, hold);

        // A runner that could take it connects — its hello kicks dispatch — and a tick runs.
        const agent = await FakeAgent.connect(api.baseUrl, {
          certificate: enrollment.certificate as string,
          header: CERT_HEADER,
        });
        if (isRefused(agent)) throw new Error(`refused: ${String(agent.status)} ${agent.code}`);
        agents.push(agent);
        const hello = fixtureFrame("valid/hello.json");
        Object.assign(hello.payload.capabilities as object, { docker: true });
        agent.send(hello);
        await agent.next("ack");
        await api.nest.get(DispatchService).tick();

        const statusOf = async () =>
          (
            await api.sql.query<{ status: string }>(
              `select status from ${SCHEMA_NAME}.build_jobs where id = $1`,
              [job.id],
            )
          ).rows[0].status;
        expect(await statusOf()).toBe("queued");

        await release(owner, workspace.slug, hold);
        await api.nest.get(DispatchService).tick();

        const offer = await agent.next("job.offer");
        expect(uuidOf("job", offer.payload.job)).toBe(job.id);
        expect(await statusOf()).not.toBe("queued");
      },
    );
  });

  describe("deletion", () => {
    it("needs the owner, the exactly-typed name and a step-up — a wrong password is no step-up", async () => {
      const { owner, seeded, slug } = await bench();
      const admin = await api.signUp();
      await api.join(seeded.workspace.id, admin, "admin");
      const asStale = (cookie: string) =>
        api.anonymous("post", `${LIFECYCLE}/delete`).set("Cookie", cookie).set(TENANT_HEADER, slug);

      const notOwner = await acting(admin, slug)("post", `${LIFECYCLE}/delete`)
        .send({ confirmName: "Harness Workspace" })
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(notOwner).code).toBe("forbidden");
      const misnamed = await acting(owner, slug)("post", `${LIFECYCLE}/delete`)
        .send({ confirmName: "Harness Workspace " })
        .expect(422);
      expect(bodyOf<ErrorEnvelope>(misnamed).code).toBe("workspace_name_mismatch");
      const wrong = await asStale(await staleSession(owner))
        .send({ confirmName: "Harness Workspace", password: "not-the-password-0001" })
        .expect(401);
      expect(bodyOf<ErrorEnvelope>(wrong).code).toBe("step_up_required");

      const state = await api.sql.query(
        `select 1 from ${SCHEMA_NAME}.workspace_lifecycle
          where organization_id = $1 and state = 'pending_delete'`,
        [seeded.workspace.id],
      );
      expect(state.rowCount).toBe(0);

      await asStale(await staleSession(owner))
        .send({ confirmName: "Harness Workspace", password: HARNESS_PASSWORD })
        .expect(200);
    });
  });

  describe("recovery", () => {
    it("restores on day 29, when the sweep finds nothing due", async () => {
      const { owner, seeded, slug } = await bench();
      await enter(owner, slug, HOLDS[1]);

      await expect(
        api.nest.get(LifecyclePurge).sweep(new Date(Date.now() + 29 * DAY_MS)),
      ).resolves.toEqual([]);

      await release(owner, slug, HOLDS[1]);
      expect(await tombstone(seeded.workspace.id)).toBeUndefined();
    });

    it("still restores after the window closed but before the sweep ran — recoverable until the purge begins", async () => {
      const { owner, seeded, slug } = await bench();
      await enter(owner, slug, HOLDS[1]);
      await api.sql.query(
        `update ${SCHEMA_NAME}.workspace_lifecycle set purge_after = now() - interval '1 minute'
          where organization_id = $1`,
        [seeded.workspace.id],
      );

      await release(owner, slug, HOLDS[1]);
    });
  });

  describe("the purge", () => {
    /**
     * A workspace pending deletion with a sealed value, and the instant its window has closed.
     *
     * @returns The bench, the sealed value, and day 31.
     */
    async function doomed(): Promise<{
      owner: Person;
      organizationId: string;
      slug: string;
      sealed: string;
      day31: Date;
    }> {
      const { owner, seeded, slug } = await bench();
      const organizationId = seeded.workspace.id;
      const sealed = await api.nest
        .get(VaultService)
        .encryptText(organizationId, "governance-record", "sealed-before-purge");
      await openRun(seeded, "open-1").expect(201);
      await enter(owner, slug, HOLDS[1]);

      return { owner, organizationId, slug, sealed, day31: new Date(Date.now() + 31 * DAY_MS) };
    }

    it("destroys the DEK so sealed data no longer decrypts, and leaves another tenant untouched", async () => {
      const other = await bench();
      const vault = api.nest.get(VaultService);
      const theirs = await vault.encryptText(other.seeded.workspace.id, "theirs", "still-theirs");
      const theirRuns = bodyOf<RunOpenedResource>(
        await openRun(other.seeded, "open-1").expect(201),
      );
      const { organizationId, sealed, day31 } = await doomed();

      const reports = await api.nest.get(LifecyclePurge).sweep(day31);

      expect(reports).toEqual([
        expect.objectContaining({ organizationId, dekVersionsDestroyed: 1, rowsRemaining: 0 }),
      ]);
      await expect(
        vault.decryptText(organizationId, "governance-record", sealed),
      ).rejects.toBeInstanceOf(VaultKeyError);
      await expect(vault.decryptText(other.seeded.workspace.id, "theirs", theirs)).resolves.toBe(
        "still-theirs",
      );
      expect(await count("tenant_keys", other.seeded.workspace.id)).toBe(1);
      expect(await count("runs", other.seeded.workspace.id)).toBe(1);
      expect(theirRuns.id).toBeDefined();
    });

    /** Where a failure is injected, and how. */
    const FAULTS: {
      readonly step: string;
      readonly inject: (api: ApiHarness) => void;
      /** Whether the organization row still exists after the failed attempt. */
      readonly orgSurvives: boolean;
      /** Whether its keys still exist after the failed attempt. */
      readonly keysSurvive: boolean;
    }[] = [
      {
        step: "destroying the DEK",
        inject: (harness) => {
          jest
            .spyOn(harness.nest.get(VaultService), "destroy")
            .mockRejectedValueOnce(new Error("kms unavailable"));
        },
        orgSurvives: true,
        keysSurvive: true,
      },
      {
        step: "removing the organization",
        inject: (harness) => {
          jest
            .spyOn(
              harness.nest.get<WorkspaceAuthStore>(WORKSPACE_AUTH_STORE, { strict: false }),
              "removeOrganization",
            )
            .mockRejectedValueOnce(new Error("adapter unavailable"));
        },
        orgSurvives: true,
        keysSurvive: false,
      },
      {
        step: "counting what is left",
        inject: (harness) => {
          jest
            .spyOn(harness.nest.get(LifecycleRepository, { strict: false }), "residualRows")
            .mockRejectedValueOnce(new Error("statement timeout"));
        },
        orgSurvives: false,
        keysSurvive: false,
      },
      {
        step: "completing the tombstone",
        inject: (harness) => {
          jest
            .spyOn(harness.nest.get(LifecycleRepository, { strict: false }), "completePurge")
            .mockRejectedValueOnce(new Error("connection reset"));
        },
        orgSurvives: false,
        keysSurvive: false,
      },
    ];

    it.each(FAULTS)(
      "resumes after a failure $step: never half-restored, finished by the next sweep, one purged event",
      async ({ inject, orgSurvives, keysSurvive }) => {
        const { owner, organizationId, slug, sealed, day31 } = await doomed();
        const purge = api.nest.get(LifecyclePurge);
        inject(api);

        // The failed attempt is logged and swallowed by the sweep, like a timer's would be.
        await expect(purge.sweep(day31)).resolves.toEqual([]);

        // The progress record was written before anything was destroyed, with the key count.
        expect(await tombstone(organizationId)).toEqual({
          purged_at: null,
          dek_versions_destroyed: 1,
          rows_remaining: 0,
        });
        expect(await count("tenant_keys", organizationId)).toBe(keysSurvive ? 1 : 0);
        const organization = await api.sql.query(
          `select 1 from ${SCHEMA_NAME}.organization where id = $1`,
          [organizationId],
        );
        expect(organization.rowCount).toBe(orgSurvives ? 1 : 0);

        if (orgSurvives) {
          // A tenant whose shred has begun cannot be restored.
          const refused = await acting(owner, slug)("post", `${LIFECYCLE}/restore`).expect(409);
          expect(bodyOf<ErrorEnvelope>(refused)).toMatchObject({
            code: "workspace_state_conflict",
            details: { purge: "started" },
          });
        }

        const later = new Date(day31.getTime() + 60_000);
        const reports = await purge.sweep(later);

        expect(reports).toEqual([
          expect.objectContaining({ organizationId, dekVersionsDestroyed: 1, rowsRemaining: 0 }),
        ]);
        expect(await tombstone(organizationId)).toEqual({
          purged_at: later,
          dek_versions_destroyed: 1,
          rows_remaining: 0,
        });
        await expect(
          api.nest.get(VaultService).decryptText(organizationId, "governance-record", sealed),
        ).rejects.toBeInstanceOf(VaultKeyError);
        expect(await outbox(organizationId)).toEqual(["audit.workspace.purged"]);

        // And it stays finished.
        await expect(purge.sweep(new Date(later.getTime() + 60_000))).resolves.toEqual([]);
        expect(await outbox(organizationId)).toEqual(["audit.workspace.purged"]);
      },
    );
  });
});
