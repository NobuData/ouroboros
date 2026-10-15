import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { DashboardResource } from "../dashboard/resources";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { INGEST_ERRORS } from "./ingest.errors";
import {
  WORKFLOW_TAG,
  WORKFLOW_VERSION,
  seedIngestBench,
  type IngestBench,
} from "./ingest.fixture";
import type { QueueItemClaimedResource, RunOpenedResource } from "./ingest.resources";

/**
 * **Consuming the queue, over a socket and against a migrated database** — #91 (J.3, narrowed
 * by its DG.1 amendment).
 *
 *   * two workers claiming at once never both get the head;
 *   * a lease that ran out is claimable again, and the late holder's open is refused;
 *   * claim, then open, removes the item and records where the run came from;
 *   * a claim is refused while the deployment switch is off or the workspace is paused;
 *   * spend reported with a stage lands in `token_usage.stage`;
 *   * the dashboard reflects the claim, and the run ingested from it.
 *
 * ```bash
 * yarn test:integration src/modules/ingest/queue-claim.integration-spec.ts
 * ```
 */

const CLAIM = "/internal/queue/claim";
const DASHBOARD = "/api/v1/dashboard";

describe("consuming the queue (#91)", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_LIVE_EXECUTION_ENABLED: "true" });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Post as the engine. */
  function post(path: string, body: object): ReturnType<ApiHarness["anonymous"]> {
    return api
      .anonymous("post", path)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body);
  }

  /**
   * A claim of `workspace`'s next admissible item by `worker`, under `key` — declaring one
   * registered executor, as a worker that can run anything does (#1312).
   */
  function claim(workspace: string, key: string, worker = "engine-worker-a") {
    return post(CLAIM, { idempotencyKey: key, workspace, worker, executors: ["native"] });
  }

  /**
   * Make the bench's workspace pass live-run admission (DI.4, #1312): the dry-run policy on, and
   * a connection cleared for invocation behind routes for the two task kinds the bench workflow's
   * model stages inherit (`implement`, `split`). Items still need confirming.
   *
   * @param workspaceId - The bench's workspace.
   */
  async function admissible(workspaceId: string): Promise<void> {
    const client = await api.sql.connect();

    try {
      await client.query("begin");
      await client.query(
        `insert into ${SCHEMA_NAME}.org_policies (organization_id, dry_run) values ($1, true)
         on conflict (organization_id) do update set dry_run = true`,
        [workspaceId],
      );
      const { rows: connections } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.provider_connections
           (organization_id, kind, display_name, base_url, status)
         values ($1, 'ollama', 'Local Ollama', 'http://localhost:11434', 'unknown')
         returning id`,
        [workspaceId],
      );
      const { rows: aliases } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.model_aliases
           (organization_id, alias, provider_connection_id, model_id, enabled)
         values ($1, 'local-coder', $2, 'qwen2.5-coder:32b', true)
         returning id`,
        [workspaceId, connections[0].id],
      );

      for (const [order, kind] of ["implement", "split"].entries()) {
        const { rows: kinds } = await client.query<{ id: string }>(
          `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
           values ($1, $2, $3, $4) returning id`,
          [workspaceId, kind, `Everything ${kind} needs`, order + 1],
        );
        const { rows: routes } = await client.query<{ id: string }>(
          `insert into ${SCHEMA_NAME}.routes
             (organization_id, task_kind_id, tag, max_cost_cents_per_run)
           values ($1, $2, $3, 250) returning id`,
          [workspaceId, kinds[0].id, `${kind}-local`],
        );
        await client.query(
          `insert into ${SCHEMA_NAME}.route_hops
             (organization_id, route_id, position, model_alias_id, note)
           values ($1, $2, 1, $3, null)`,
          [workspaceId, routes[0].id, aliases[0].id],
        );
      }

      await client.query("commit");
    } catch (failure) {
      await client.query("rollback");
      throw failure;
    } finally {
      client.release();
    }
  }

  /**
   * Queue one more issue behind the head, confirmed unless told otherwise.
   *
   * @param seeded - The bench.
   * @param number - Its issue number.
   * @param position - Its place.
   * @param confirmed - Whether a member has confirmed it for a live run.
   * @returns Its id.
   */
  async function enqueue(
    seeded: IngestBench,
    number: number,
    position: number,
    confirmed = true,
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.queue_items
         (organization_id, github_repo_id, issue_number, issue_title, effort, workflow_tag,
          workflow_version, workflow_pin_reason, position, est_minutes, confirmed_at)
       values ($1, $2, $3, 'Another queued issue', 's', $4, $5, 'explicit', $6, 30,
               case when $7 then now() end)
       returning id`,
      [
        seeded.workspace.id,
        seeded.workspace.repoId,
        number,
        WORKFLOW_TAG,
        WORKFLOW_VERSION,
        position,
        confirmed,
      ],
    );

    return rows[0].id;
  }

  /**
   * A bench whose mirrored ticket names the bench's repository, and #482 queued at the head.
   *
   * `seedIngestBench`'s ticket carries no `meta`, and the claim finds a queued issue's ticket
   * by the owner and repository GitHub mirrored onto it — so the meta is filled in here.
   */
  async function queued(): Promise<{ owner: Person; seeded: IngestBench; item: string }> {
    const owner = await api.signUp();
    const seeded = await seedIngestBench(api, owner);

    await api.sql.query(
      `update ${SCHEMA_NAME}.tickets t
          set meta = jsonb_build_object('github',
                       jsonb_build_object('owner', o.login, 'repo', r.name))
         from ${SCHEMA_NAME}.github_repos r
         join ${SCHEMA_NAME}.github_orgs o on o.id = r.org_id
        where r.id = $2 and t.organization_id = $1`,
      [seeded.workspace.id, seeded.workspace.repoId],
    );

    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.queue_items
         (organization_id, github_repo_id, issue_number, issue_title, effort, workflow_tag,
          workflow_version, workflow_pin_reason, position, est_minutes, confirmed_at)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', 'm', $3, $4, 'explicit', 1, 90,
               now())
       returning id`,
      [seeded.workspace.id, seeded.workspace.repoId, WORKFLOW_TAG, WORKFLOW_VERSION],
    );
    await admissible(seeded.workspace.id);

    return { owner, seeded, item: rows[0].id };
  }

  /** Open the run a claim leased. */
  function open(seeded: IngestBench, claimed: QueueItemClaimedResource, key = "open-1") {
    return post("/internal/runs", {
      idempotencyKey: key,
      ...seeded.open,
      queueItem: { id: claimed.id, claimToken: claimed.claimToken },
    });
  }

  /** The item's row, or `undefined` once it is gone. */
  async function row(id: string) {
    const { rows } = await api.sql.query<{ claimed_by: string | null; claim_key: string | null }>(
      `select claimed_by, claim_key from ${SCHEMA_NAME}.queue_items where id = $1`,
      [id],
    );
    return rows[0];
  }

  describe("claiming", () => {
    it("leases the head to one of two workers claiming at once, and nothing to the other", async () => {
      const { seeded, item } = await queued();

      const answers = await Promise.all([
        claim(seeded.workspace.slug, "worker-a-claim-1", "engine-worker-a"),
        claim(seeded.workspace.slug, "worker-b-claim-1", "engine-worker-b"),
      ]);

      // One slot (the default ceiling): the loser finds it taken by the winner's lease.
      expect(answers.map((answer) => answer.status).toSorted()).toEqual([200, 409]);
      const winner = answers.find((answer) => answer.status === 200);
      const claimed = bodyOf<QueueItemClaimedResource>(winner!);
      expect(claimed).toMatchObject({
        id: item,
        organizationId: seeded.workspace.id,
        repository: seeded.workspace.repoId,
        issueNumber: 482,
        workflow: { tag: WORKFLOW_TAG, version: WORKFLOW_VERSION },
        ticket: seeded.open.ticket,
      });
      expect((await row(item))?.claimed_by).toMatch(/^engine-worker-[ab]$/);
    });

    it("answers a replayed claim with the item its key already leases", async () => {
      const { seeded } = await queued();

      const first = bodyOf<QueueItemClaimedResource>(
        await claim(seeded.workspace.id, "worker-a-claim-1").expect(200),
      );
      const replay = bodyOf<QueueItemClaimedResource>(
        await claim(seeded.workspace.id, "worker-a-claim-1").expect(200),
      );

      expect(replay).toEqual(first);
    });

    it("leases an item again once its lease has run out, and refuses the late holder's open", async () => {
      const { seeded, item } = await queued();
      const lapsed = bodyOf<QueueItemClaimedResource>(
        await claim(seeded.workspace.slug, "worker-a-claim-1", "engine-worker-a").expect(200),
      );
      await api.sql.query(
        `update ${SCHEMA_NAME}.queue_items
            set claimed_at = now() - interval '10 minutes',
                claim_expires_at = now() - interval '5 minutes'
          where id = $1`,
        [item],
      );

      const fresh = bodyOf<QueueItemClaimedResource>(
        await claim(seeded.workspace.slug, "worker-b-claim-1", "engine-worker-b").expect(200),
      );

      expect(fresh.id).toBe(item);
      expect(fresh.claimToken).not.toBe(lapsed.claimToken);
      expect(await row(item)).toEqual({
        claimed_by: "engine-worker-b",
        claim_key: "worker-b-claim-1",
      });
      const refusal = bodyOf<ErrorEnvelope>(await open(seeded, lapsed).expect(409));
      expect(refusal.code).toBe(INGEST_ERRORS.queueClaimLost);
    });

    it("answers 204 when the queue is empty", async () => {
      const { seeded, item } = await queued();
      await api.sql.query(`delete from ${SCHEMA_NAME}.queue_items where id = $1`, [item]);

      await claim(seeded.workspace.slug, "worker-a-claim-1").expect(204);
    });

    it("refuses a claim in a paused workspace and leaves the item unheld", async () => {
      const { seeded, item } = await queued();
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.workspace_lifecycle (organization_id, state)
         values ($1, 'paused')`,
        [seeded.workspace.id],
      );

      const refusal = bodyOf<ErrorEnvelope>(
        await claim(seeded.workspace.slug, "worker-a-claim-1").expect(409),
      );

      expect(refusal.code).toBe("workspace_paused");
      expect((await row(item))?.claimed_by).toBeNull();
    });

    it("holds the ceiling under concurrent claims: two workers, two items, one slot (#1312)", async () => {
      const { seeded } = await queued();
      await enqueue(seeded, 483, 2);

      const answers = await Promise.all([
        claim(seeded.workspace.slug, "worker-a-claim-1", "engine-worker-a"),
        claim(seeded.workspace.slug, "worker-b-claim-1", "engine-worker-b"),
      ]);

      expect(answers.map((answer) => answer.status).toSorted()).toEqual([200, 409]);
      const refused = answers.find((answer) => answer.status === 409);
      expect(bodyOf<ErrorEnvelope>(refused!)).toMatchObject({
        code: INGEST_ERRORS.concurrencyCeiling,
        details: { taken: 1, ceiling: 1 },
      });
    });

    it("gives two workers an item each under a ceiling of two (#1312)", async () => {
      const { seeded } = await queued();
      await enqueue(seeded, 483, 2);
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.workspace_settings (organization_id, live_run_ceiling)
         values ($1, 2)`,
        [seeded.workspace.id],
      );

      const answers = await Promise.all([
        claim(seeded.workspace.slug, "worker-a-claim-1", "engine-worker-a"),
        claim(seeded.workspace.slug, "worker-b-claim-1", "engine-worker-b"),
      ]);

      expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
      const ids = answers.map((answer) => bodyOf<QueueItemClaimedResource>(answer).id);
      expect(new Set(ids).size).toBe(2);
    });

    it("skips an item nobody confirmed and takes the confirmed one behind it (#1312)", async () => {
      const { seeded, item } = await queued();
      await api.sql.query(
        `update ${SCHEMA_NAME}.queue_items set confirmed_at = null where id = $1`,
        [item],
      );
      const behind = await enqueue(seeded, 483, 2);

      const claimed = bodyOf<QueueItemClaimedResource>(
        await claim(seeded.workspace.slug, "worker-a-claim-1").expect(200),
      );

      expect(claimed.id).toBe(behind);
      expect((await row(item))?.claimed_by).toBeNull();
    });

    it("claims nothing from a repository whose policy is not dry-run (#1312)", async () => {
      const { seeded } = await queued();
      await api.sql.query(
        `update ${SCHEMA_NAME}.org_policies set dry_run = false where organization_id = $1`,
        [seeded.workspace.id],
      );

      await claim(seeded.workspace.slug, "worker-a-claim-1").expect(204);
    });

    it("refuses a worker that registered no executor (#1312)", async () => {
      const { seeded } = await queued();

      const refusal = bodyOf<ErrorEnvelope>(
        await post(CLAIM, {
          idempotencyKey: "k",
          workspace: seeded.workspace.slug,
          worker: "engine-worker-a",
          executors: [],
        }).expect(409),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.noExecutor);
    });

    it("says why the queue is waiting where the queue is read (#1312)", async () => {
      // The read model asks the engine for its executors (a claim takes the worker's word);
      // the harness runs no engine, so the workspace reason outranks the item's own.
      const { owner, seeded, item } = await queued();

      const page = bodyOf<{ items: { id: string; waiting: unknown }[] }>(
        await api
          .as(owner)("get", "/api/v1/queue")
          .set("X-Ouro-Tenant", seeded.workspace.slug)
          .expect(200),
      );

      expect(page.items).toEqual([
        expect.objectContaining({
          id: item,
          waiting: { reason: "no_executor", scope: "workspace" },
        }),
      ]);
    });

    it("refuses a workspace that does not exist", async () => {
      const refusal = bodyOf<ErrorEnvelope>(await claim("no-such-workspace", "k").expect(404));

      expect(refusal.code).toBe(INGEST_ERRORS.workspaceNotFound);
    });

    it("refuses a claim carrying no key", async () => {
      await api.anonymous("post", CLAIM).send({}).expect(401);
    });
  });

  describe("opening the run from the claim", () => {
    it("removes the item, records it on the run, and attributes spend to its stage", async () => {
      const { owner, seeded, item } = await queued();
      const claimed = bodyOf<QueueItemClaimedResource>(
        await claim(seeded.workspace.slug, "worker-a-claim-1").expect(200),
      );

      // The dashboard shows the item as held, still in its place.
      const before = bodyOf<DashboardResource>(
        await api
          .as(owner)("get", DASHBOARD)
          .set("X-Ouro-Tenant", seeded.workspace.slug)
          .expect(200),
      );
      expect(before.queueHead.map((head) => [head.id, head.claimed?.by])).toEqual([
        [item, "engine-worker-a"],
      ]);

      const run = bodyOf<RunOpenedResource>(await open(seeded, claimed).expect(201));

      expect(await row(item)).toBeUndefined();
      const { rows } = await api.sql.query<{ queue_item_id: string }>(
        `select queue_item_id from ${SCHEMA_NAME}.runs_with_stage where id = $1`,
        [run.id],
      );
      expect(rows[0].queue_item_id).toBe(item);

      // A replayed open answers the same run rather than failing on the item it removed.
      expect(bodyOf<RunOpenedResource>(await open(seeded, claimed).expect(201)).id).toBe(run.id);

      await post(`/internal/runs/${run.id}/stage-transitions`, {
        idempotencyKey: "t1",
        stageKey: "implement",
        status: "active",
      }).expect(200);
      await post(`/internal/runs/${run.id}/resources`, {
        idempotencyKey: "spend-1",
        spend: {
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          tokensIn: 1200,
          tokensOut: 80,
          stage: "implement",
          attempt: 1,
        },
      }).expect(200);

      const { rows: usage } = await api.sql.query<{
        run_id: string;
        stage: string;
        attempt: number;
      }>(`select run_id, stage, attempt from ${SCHEMA_NAME}.token_usage where run_id = $1`, [
        run.id,
      ]);
      expect(usage).toEqual([{ run_id: run.id, stage: "implement", attempt: 1 }]);

      // And the dashboard reflects the run ingested from it: live, out of the queue, and its
      // spend in today's tokens.
      const after = bodyOf<DashboardResource>(
        await api
          .as(owner)("get", DASHBOARD)
          .set("X-Ouro-Tenant", seeded.workspace.slug)
          .expect(200),
      );
      expect(after.queueHead).toEqual([]);
      expect(after.stats.queued.count).toBe(0);
      expect(after.activeRuns.map((active) => active.id)).toContain(run.id);
      expect(after.stats.loopsLive.total).toBeGreaterThanOrEqual(1);
      expect(after.stats.tokensToday.tokens).toBeGreaterThanOrEqual(1280);
    });

    it("refuses an open whose request does not match the item it names", async () => {
      const { seeded, item } = await queued();
      const claimed = bodyOf<QueueItemClaimedResource>(
        await claim(seeded.workspace.slug, "worker-a-claim-1").expect(200),
      );
      await api.sql.query(
        `update ${SCHEMA_NAME}.queue_items set issue_number = 999 where id = $1`,
        [item],
      );

      const refusal = bodyOf<ErrorEnvelope>(await open(seeded, claimed).expect(422));

      expect(refusal.code).toBe(INGEST_ERRORS.queueItemMismatch);
      expect(await row(item)).toBeDefined();
    });
  });
});

describe("consuming the queue with live execution off (#91)", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  it("refuses every claim while the deployment does not run live loops", async () => {
    const seeded = await seedIngestBench(api, await api.signUp());

    const refusal = bodyOf<ErrorEnvelope>(
      await api
        .anonymous("post", CLAIM)
        .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
        .send({ idempotencyKey: "k", workspace: seeded.workspace.slug, worker: "engine-worker-a" })
        .expect(409),
    );

    expect(refusal.code).toBe(INGEST_ERRORS.deploymentDisabled);
  });
});
