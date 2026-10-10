/**
 * The decision kind registry and its emitters, against a migrated database (#461, BN.1).
 *
 * Each acceptance criterion, on the application's own services and V093/V095/V097's real rules:
 *
 *   - an AP.3 evaluation fired three times for one stage files **one** protected-path card;
 *   - the refactor label makes the gate engine require human review, and the card names the policy;
 *   - merging that PR out of band on its host closes the card as `policy(source_resolved)`;
 *   - a fixture kind registers, files and renders with no inbox-core change;
 *   - every shipped kind's seeded payload renders the mockup's prose — in the database's view too;
 *   - a payload failing its schema is refused and files nothing;
 *   - spend_approval is registered and inert;
 *   - the feed counts what the queue would, leaving snoozed items out;
 *   - every emission and closure is in the audit trail.
 */

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { SpendApprovalEmitter } from "../ingest/spend-approval.emitter";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { PrPlaneHosts, prPlaneScene } from "../pull-requests/pr-plane.integration.fixture";
import { PrSyncService } from "../pull-requests/pr-sync.service";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { InMemoryPrHost } from "../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
} from "../ticket-sources/providers/in-memory.provider.fixture";
import { DecisionKindRegistry } from "./decision-kind.registry";
import {
  FIXTURE_KIND,
  MOCKUP_PROSE,
  SEEDED_PAYLOADS,
  SHIPPED_KINDS,
} from "./decision.kinds.fixture";
import type { DecisionRef } from "./decision.types";
import { DecisionSourceWatcher } from "./decision.watchers";
import type { InboxQueueResource, InboxResolvedResource } from "./inbox.queue";
import type { InboxFeedResource } from "./inbox.feed";

/** The fixture kind this suite registers — `decision_kinds` persists across suites, so its own id. */
const SUITE_KIND = "custom:bn1-suite-oven";

/** Policy v7's document, as the dev seed publishes it — `human_review` is *refactor, or effort ≥ L*. */
const POLICY_V7 = {
  auto_merge: {
    enabled: true,
    conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
  },
  human_review: {
    enabled: true,
    conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
  },
  protected_paths: {
    enabled: true,
    conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] },
  },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};

describe("the decision registry and its emitters, against a migrated database", () => {
  const hosts = new PrPlaneHosts();
  let api: ApiHarness;
  let host: InMemoryPrHost;

  beforeAll(async () => {
    api = await ApiHarness.start(
      { OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" },
      hosts.overrides(),
    );
  });

  afterAll(() => api.close());

  beforeEach(() => {
    host = hosts.reset();
  });

  afterEach(() => api.truncate());

  /** Post as the executor. */
  function post(method: "post" | "put", path: string, body: unknown) {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body as object);
  }

  /** @returns The application's registry. */
  function registry(): DecisionKindRegistry {
    return api.nest.get(DecisionKindRegistry, { strict: false });
  }

  /** A workspace's items, oldest first. */
  async function items(org: string) {
    return (
      await api.sql.query<{
        id: string;
        kind_id: string;
        status: string;
        severity: string;
        payload: Record<string, unknown>;
        refs: DecisionRef[];
        emitted_by: string;
        source_ref: string;
      }>(
        `select id, kind_id, status, severity, payload, refs, emitted_by, source_ref
           from ${SCHEMA_NAME}.decision_items where organization_id = $1 order by created_at, id`,
        [org],
      )
    ).rows;
  }

  /** A workspace's decision audit trail, oldest first. */
  async function trail(org: string) {
    return (
      await api.sql.query<{
        action: string;
        subject_id: string;
        actor_id: string | null;
        detail: Record<string, unknown>;
      }>(
        `select action, subject_id, actor_id, detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action like 'decision.%' order by occurred_at, id`,
        [org],
      )
    ).rows;
  }

  /** @returns The application's out-of-band watcher. */
  function watcher(): DecisionSourceWatcher {
    return api.nest.get(DecisionSourceWatcher, { strict: false });
  }

  /** Wait for a condition a listener reaches asynchronously. */
  async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 5000;
    let value = await read();

    while (!done(value) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      value = await read();
    }

    return value;
  }

  /** A bench with a run in `implement`, its repository's `boot/**` protected. */
  async function protectedRun(): Promise<{ bench: IngestBench; owner: Person; run: string }> {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.protected_path_policies (organization_id, repo_ref, path_glob)
       select $1, o.login || '/' || r.name, 'boot/**'
         from ${SCHEMA_NAME}.github_repos r
         join ${SCHEMA_NAME}.github_orgs o on o.id = r.org_id
        where r.id = $2`,
      [bench.workspace.id, bench.workspace.repoId],
    );

    const run = bodyOf<RunOpenedResource>(
      await post("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(201),
    );

    await post("post", `/internal/runs/${run.id}/stage-transitions`, {
      idempotencyKey: "implement",
      stageKey: "implement",
      status: "active",
    }).expect(200);

    return { bench, owner, run: run.id };
  }

  it("files one protected-path card for an AP.3 evaluation fired three times on one stage, audited once", async () => {
    const { bench, run } = await protectedRun();
    const files = [{ path: "boot/rollback_flag.c", status: "modified", additions: 1 }];

    for (const key of ["files-1", "files-2", "files-3"]) {
      await post("put", `/internal/runs/${run}/files`, { idempotencyKey: key, files }).expect(200);
    }

    const filed = await items(bench.workspace.id);

    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      kind_id: "protected_path_allow_once",
      status: "open",
      severity: "warn",
      emitted_by: "guardrails",
      source_ref: `run:${run}:path:boot/rollback_flag.c`,
      payload: {
        subject: "Fix flaky CAN-bus telemetry test",
        edit_summary: "add one line",
        path: "boot/rollback_flag.c",
        diff_lines: 1,
      },
    });
    expect(filed[0].refs.map((ref) => ref.type)).toEqual(["run", "path"]);
    expect(
      (await trail(bench.workspace.id)).map((row) => [row.action, row.subject_id, row.actor_id]),
    ).toEqual([["decision.filed", filed[0].id, null]]);
  });

  it("counts the feed as the queue would, snooze-aware, for every member", async () => {
    const { bench, owner, run } = await protectedRun();

    await post("put", `/internal/runs/${run}/files`, {
      idempotencyKey: "files-1",
      files: [{ path: "boot/rollback_flag.c", status: "modified", additions: 1 }],
    }).expect(200);

    const feed = async () =>
      bodyOf<InboxFeedResource>(
        await api
          .as(owner)("get", "/api/v1/inbox/feed")
          .set(TENANT_HEADER, bench.workspace.slug)
          .expect(200),
      );

    expect(await feed()).toMatchObject({
      open: 1,
      bySeverity: { err: 0, warn: 1, info: 0 },
      snoozed: 0,
    });

    const [item] = await items(bench.workspace.id);
    await api.sql.query(
      `select ${SCHEMA_NAME}.decision_item_snooze($1, now() + interval '1 hour', $2, null)`,
      [item.id, owner.id],
    );

    expect(await feed()).toMatchObject({
      open: 0,
      snoozed: 1,
      nextWakeAt: expect.any(String) as string,
    });
    await api.anonymous("get", "/api/v1/inbox/feed").expect(401);
  });

  it("requires review of a refactor PR under the published policy, files the card naming it, and closes it when the PR merges on its host", async () => {
    const at = await prPlaneScene(api, host, "engine");

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels,
               gh_created_at, gh_updated_at, gh_url, sizing_status)
       values ($1, $2, 482, 'Refactor the telemetry ring buffer', null, 'open', '["refactor"]'::jsonb,
               now(), now(), 'https://github.com/acme/helios/issues/482', 'unsized')`,
      [at.org, at.bench.workspace.repoId],
    );
    await api.sql.query(`select ${SCHEMA_NAME}.org_policy_publish($1, $2::jsonb, $3, 'v7')`, [
      at.org,
      JSON.stringify(POLICY_V7),
      at.owner.id,
    ]);

    await api.nest.get(PrSyncService).sync(at.org, at.sourceId, at.prNumber);

    const human = await api.sql.query<{ required: boolean; source: string }>(
      `select required, source from ${SCHEMA_NAME}.pr_gate_definitions
        where pr_id = $1 and gate_key = 'human_approval'`,
      [at.prId],
    );

    expect(human.rows[0]).toEqual({
      required: true,
      source: "standard-fix@v1 pin + org policy v1: refactor → human review",
    });

    const filed = await eventually(
      () => items(at.org),
      (rows) => rows.length > 0,
    );

    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      kind_id: "merge_approval",
      severity: "err",
      emitted_by: "pr.gates",
      source_ref: `pr:${at.prId}`,
      payload: { pr_kind: "refactor", policy_label: "refactor", added: 68, removed: 15, files: 3 },
    });

    const rendered = await api.sql.query<{ question: string; why: string; tags: string[] }>(
      `select question, why, tags from ${SCHEMA_NAME}.decision_items_rendered where id = $1`,
      [filed[0].id],
    );

    expect(rendered.rows[0].question).toBe("Approve merge for a refactor PR?");
    expect(rendered.rows[0].why).toMatch(/^Policy: anything labeled refactor needs a human\. /);
    expect(rendered.rows[0].tags).toEqual(["refactor"]);

    // Merged directly on the host, then mirrored: the card is settled, as a policy closure.
    host.merge(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, at.prNumber, "squash", "refactor: ring buffer");
    await api.nest.get(PrSyncService).sync(at.org, at.sourceId, at.prNumber);

    const resolution = await api.sql.query<{
      resolver: string;
      resolved_by_policy: string;
      action_id: string;
      channel: string;
      outcome: Record<string, string>;
      status: string;
    }>(
      `select r.resolver, r.resolved_by_policy, r.action_id, r.channel, r.outcome, i.status
         from ${SCHEMA_NAME}.decision_resolutions r
         join ${SCHEMA_NAME}.decision_items i on i.id = r.item_id
        where r.item_id = $1`,
      [filed[0].id],
    );

    expect(resolution.rows).toEqual([
      {
        resolver: "policy",
        resolved_by_policy: "source_resolved",
        action_id: "source_resolved",
        channel: "github",
        outcome: { source: "pr_merged" },
        status: "resolved",
      },
    ]);
    expect((await trail(at.org)).map((row) => row.action)).toEqual([
      "decision.filed",
      "decision.source_resolved",
    ]);
  });

  it("registers a fixture kind, files and renders it — the database's view agreeing with the registry", async () => {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await post("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(201),
    );
    const { version: _version, ...declaration } = FIXTURE_KIND;
    const published = await registry().register({ ...declaration, kindId: SUITE_KIND });

    expect((await registry().register({ ...declaration, kindId: SUITE_KIND })).version).toBe(
      published.version,
    );

    const payload = { rig: "helios-rig-02", minutes: 20, drift_c: 1.5 };
    const { itemId, status } = await registry().emit({
      organizationId: bench.workspace.id,
      kindId: SUITE_KIND,
      payload,
      refs: [{ type: "run", id: run.id, label: "loop #1" }],
      key: { plane: "farm", sourceRef: `run:${run.id}:soak` },
    });
    const view = await api.sql.query<{ question: string; why: string; tags: string[] }>(
      `select question, why, tags from ${SCHEMA_NAME}.decision_items_rendered where id = $1`,
      [itemId],
    );

    expect(status).toBe("filed");
    expect(view.rows[0]).toEqual(registry().render(published, payload));
  });

  it("renders every shipped kind's seeded payload as the mockup's prose, in the database's view", async () => {
    const at = await prPlaneScene(api, host, "manual");
    const run: DecisionRef = { type: "run", id: at.runId, label: "loop #1" };
    const pr: DecisionRef = { type: "pr", id: at.prId, label: "PR #1" };
    const ticket: DecisionRef = { type: "ticket", id: at.ticketId, label: "issue #1" };
    const refsFor: Record<string, DecisionRef[]> = {
      merge_approval: [run, pr],
      protected_path_allow_once: [
        run,
        { type: "path", id: "boot/rollback_flag.c", label: "boot/rollback_flag.c" },
      ],
      claim_waiver: [pr],
      plan_sign_off: [run],
      fact_review: [],
      run_needs_human: [run],
      split_approval: [],
      resize_review: [ticket],
    };

    for (const [kindId, refs] of Object.entries(refsFor)) {
      await registry().emit({
        organizationId: at.org,
        kindId,
        payload: SEEDED_PAYLOADS[kindId],
        refs,
        key: { plane: "suite", sourceRef: kindId },
      });
    }

    const view = await api.sql.query<{
      kind_id: string;
      question: string;
      why: string;
      tags: string[];
    }>(
      `select kind_id, question, why, tags from ${SCHEMA_NAME}.decision_items_rendered
        where organization_id = $1`,
      [at.org],
    );

    expect(view.rows).toHaveLength(Object.keys(refsFor).length);
    for (const row of view.rows) {
      expect({ question: row.question, why: row.why, tags: row.tags }).toEqual(
        MOCKUP_PROSE[row.kind_id],
      );
      expect(registry().render(SHIPPED_KINDS[row.kind_id], SEEDED_PAYLOADS[row.kind_id])).toEqual(
        MOCKUP_PROSE[row.kind_id],
      );
    }
  });

  it("refuses a payload failing its schema with a useful error, and files nothing", async () => {
    const at = await prPlaneScene(api, host, "manual");
    const { matrix_state: _matrix, ...payload } = SEEDED_PAYLOADS.merge_approval;

    await expect(
      registry().emit({
        organizationId: at.org,
        kindId: "merge_approval",
        payload,
        refs: [
          { type: "run", id: at.runId, label: "loop" },
          { type: "pr", id: at.prId, label: "PR" },
        ],
        key: { plane: "pr.gates", sourceRef: `pr:${at.prId}` },
      }),
    ).rejects.toMatchObject({
      code: "decision_emission_invalid",
      message: expect.stringContaining("payload.matrix_state") as string,
    });
    expect(await items(at.org)).toEqual([]);
    expect(await trail(at.org)).toEqual([]);
  });

  it("keeps spend_approval registered and inert: it emits nothing", async () => {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await post("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(201),
    );

    const outcome = await api.nest
      .get(SpendApprovalEmitter, { strict: false })
      .capCrossed(run.id, 261, 250);

    expect(outcome).toEqual({ status: "dormant", itemId: null });
    expect(await items(bench.workspace.id)).toEqual([]);
    expect(
      (await registry().kinds()).find((kind) => kind.kind.kindId === "spend_approval")?.dormant,
    ).toBe(true);
  });

  describe("generality and out-of-band closure (#465)", () => {
    /** A kind id of its own per test — `decision_kinds` outlives `truncate()`. */
    const freshKind = (stem: string) => `custom:bn5-${stem}-${Date.now().toString(36)}`;

    it("queues, answers the actions of, and closes a fixture kind through a plane's own detector — no inbox-core change", async () => {
      const owner = await api.signUp();
      const bench = await seedIngestBench(api, owner);
      const run = bodyOf<RunOpenedResource>(
        await post("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(201),
      );
      const kindId = freshKind("oven");
      const { version: _version, ...declaration } = FIXTURE_KIND;

      await registry().register({ ...declaration, kindId });
      const payload = { rig: "helios-rig-02", minutes: 20, drift_c: 1.5 };
      const { itemId } = await registry().emit({
        organizationId: bench.workspace.id,
        kindId,
        payload,
        refs: [{ type: "run", id: run.id, label: "loop #1" }],
        key: { plane: "farm", sourceRef: `soak:${run.id}` },
      });
      const queue = bodyOf<InboxQueueResource>(
        await api
          .as(owner)("get", "/api/v1/inbox")
          .set(TENANT_HEADER, bench.workspace.slug)
          .expect(200),
      );
      const card = queue.items.find((item) => item.id === itemId);

      expect(card).toMatchObject({
        kindId,
        question: "Let the oven at helios-rig-02 run 20 minutes over?",
        tags: ["helios-rig-02", "farm"],
      });
      expect(card?.actions.map((action) => [action.id, action.allowed])).toEqual([
        ["extend", true],
        ["open_rig", true],
        ["abort", true],
      ]);

      // The farm plane's detector — registered at runtime, as an amendment would ship one.
      const unregister = watcher().register({
        name: "fixture-oven-soak-ended",
        kinds: [kindId],
        settled: (asking) =>
          Promise.resolve(
            asking.map((item) => ({
              itemId: item.id,
              organizationId: item.organizationId,
              settlement: "run_terminated" as const,
              channel: "web" as const,
            })),
          ),
      });

      try {
        expect(await watcher().sweep(bench.workspace.id)).toBe(1);
      } finally {
        unregister();
      }

      const resolved = bodyOf<InboxResolvedResource>(
        await api
          .as(owner)("get", "/api/v1/inbox/resolved")
          .set(TENANT_HEADER, bench.workspace.slug)
          .expect(200),
      );

      expect(resolved.rows.find((row) => row.itemId === itemId)).toMatchObject({
        resolver: "policy",
        policy: "source_resolved",
        summary: "Let the oven at helios-rig-02 run 20 minutes over? — closed — settled elsewhere",
      });
    });

    it("keeps an open item rendering at its pinned version after the kind is bumped", async () => {
      const owner = await api.signUp();
      const bench = await seedIngestBench(api, owner);
      const run = bodyOf<RunOpenedResource>(
        await post("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(201),
      );
      const kindId = freshKind("pin");
      const { version: _version, ...declaration } = FIXTURE_KIND;
      const v1 = await registry().register({ ...declaration, kindId });
      const payload = { rig: "helios-rig-02", minutes: 20, drift_c: 1.5 };
      const first = await registry().emit({
        organizationId: bench.workspace.id,
        kindId,
        payload,
        refs: [{ type: "run", id: run.id, label: "loop #1" }],
        key: { plane: "farm", sourceRef: "soak:first" },
      });
      const v2 = await registry().register({
        ...declaration,
        kindId,
        questionTemplate: "Extend the soak at {rig} by {minutes} minutes?",
      });
      const second = await registry().emit({
        organizationId: bench.workspace.id,
        kindId,
        payload,
        refs: [{ type: "run", id: run.id, label: "loop #1" }],
        key: { plane: "farm", sourceRef: "soak:second" },
      });
      const queue = bodyOf<InboxQueueResource>(
        await api
          .as(owner)("get", "/api/v1/inbox")
          .set(TENANT_HEADER, bench.workspace.slug)
          .expect(200),
      );
      const byId = new Map(queue.items.map((item) => [item.id, item]));
      const view = await api.sql.query<{ id: string; question: string }>(
        `select id, question from ${SCHEMA_NAME}.decision_items_rendered where id = any($1::uuid[])`,
        [[first.itemId, second.itemId]],
      );

      expect([v1.version, v2.version]).toEqual([1, 2]);
      expect(byId.get(first.itemId ?? "")).toMatchObject({
        kindVersion: 1,
        question: "Let the oven at helios-rig-02 run 20 minutes over?",
      });
      expect(byId.get(second.itemId ?? "")).toMatchObject({
        kindVersion: 2,
        question: "Extend the soak at helios-rig-02 by 20 minutes?",
      });
      expect(Object.fromEntries(view.rows.map((row) => [row.id, row.question]))).toEqual({
        [first.itemId ?? ""]: "Let the oven at helios-rig-02 run 20 minutes over?",
        [second.itemId ?? ""]: "Extend the soak at helios-rig-02 by 20 minutes?",
      });
    });

    it("closes a run's needs-human card as policy(source_resolved) when the run is cancelled from the console", async () => {
      const { bench, owner, run } = await protectedRun();
      const loop = await api.sql.query<{ loop_seq: number }>(
        `select loop_seq from ${SCHEMA_NAME}.runs where id = $1`,
        [run],
      );
      const { itemId } = await registry().emit({
        organizationId: bench.workspace.id,
        kindId: "run_needs_human",
        payload: SEEDED_PAYLOADS.run_needs_human,
        refs: [{ type: "run", id: run, label: "loop #1" }],
        key: { plane: "runs", sourceRef: `run:${run}` },
      });

      // The console's abort — not the card's button — then the driver honours it.
      const control = bodyOf<{ id: string }>(
        await api
          .as(owner)("post", `/api/v1/runs/${run}/controls`)
          .set(TENANT_HEADER, bench.workspace.slug)
          .send({ kind: "abort", confirmation: String(loop.rows[0]?.loop_seq) })
          .expect(202),
      );

      await post("post", `/internal/runs/${run}/controls/fetch`, {}).expect(200);
      await post("post", `/internal/runs/${run}/controls/${control.id}/ack`, {}).expect(200);
      await watcher().sweep(bench.workspace.id);

      const [item] = (await items(bench.workspace.id)).filter((row) => row.id === itemId);
      const resolution = await api.sql.query<{
        resolver: string;
        resolved_by_policy: string;
        outcome: Record<string, unknown>;
      }>(
        `select resolver, resolved_by_policy, outcome from ${SCHEMA_NAME}.decision_resolutions where item_id = $1`,
        [itemId],
      );

      expect(item?.status).toBe("resolved");
      expect(resolution.rows[0]).toMatchObject({
        resolver: "policy",
        resolved_by_policy: "source_resolved",
        outcome: { source: "run_moved_on" },
      });
    });

    it("closes a fact's review card when the fact is confirmed on the knowledge page", async () => {
      const owner = await api.signUp();
      const bench = await seedIngestBench(api, owner);
      const repo = await api.sql.query<{ ref: string }>(
        `select o.login || '/' || r.name as ref from ${SCHEMA_NAME}.github_repos r
           join ${SCHEMA_NAME}.github_orgs o on o.id = r.org_id where r.id = $1`,
        [bench.workspace.repoId],
      );
      const fact = bodyOf<{ id: string }>(
        await api
          .as(owner)("post", "/api/v1/facts")
          .set(TENANT_HEADER, bench.workspace.slug)
          .send({ text: "CAN frames are DMA-backed", repoRef: repo.rows[0]?.ref })
          .expect(201),
      );
      const filed = await eventually(
        () => items(bench.workspace.id),
        (rows) => rows.some((row) => row.kind_id === "fact_review"),
      );
      const card = filed.find((row) => row.kind_id === "fact_review");

      expect(card).toMatchObject({ status: "open", source_ref: `fact:${fact.id}:proposed` });

      await api
        .as(owner)("post", `/api/v1/facts/${fact.id}/confirm`)
        .set(TENANT_HEADER, bench.workspace.slug)
        .send({})
        .expect(200);
      await watcher().sweep(bench.workspace.id);

      const after = (await items(bench.workspace.id)).find((row) => row.id === card?.id);
      const resolution = await api.sql.query<{
        resolver: string;
        outcome: Record<string, unknown>;
      }>(`select resolver, outcome from ${SCHEMA_NAME}.decision_resolutions where item_id = $1`, [
        card?.id,
      ]);

      expect(after?.status).toBe("resolved");
      expect(resolution.rows[0]).toMatchObject({
        resolver: "policy",
        outcome: { source: "fact_resolved" },
      });
    });
  });
});
