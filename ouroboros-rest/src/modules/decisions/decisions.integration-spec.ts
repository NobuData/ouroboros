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
import { FIXTURE_KIND, MOCKUP_PROSE, SEEDED_PAYLOADS, SHIPPED_KINDS } from "./decision.kinds.fixture";
import type { DecisionRef } from "./decision.types";
import type { InboxFeedResource } from "./inbox.feed";

/** The fixture kind this suite registers — `decision_kinds` persists across suites, so its own id. */
const SUITE_KIND = "custom:bn1-suite-oven";

/** Policy v7's document, as the dev seed publishes it — `human_review` is *refactor, or effort ≥ L*. */
const POLICY_V7 = {
  auto_merge: { enabled: true, conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] } },
  human_review: { enabled: true, conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] } },
  protected_paths: { enabled: true, conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] } },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};

describe("the decision registry and its emitters, against a migrated database", () => {
  const hosts = new PrPlaneHosts();
  let api: ApiHarness;
  let host: InMemoryPrHost;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" }, hosts.overrides());
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
      await api.sql.query<{ action: string; subject_id: string; actor_id: string | null; detail: Record<string, unknown> }>(
        `select action, subject_id, actor_id, detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action like 'decision.%' order by occurred_at, id`,
        [org],
      )
    ).rows;
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
    expect((await trail(bench.workspace.id)).map((row) => [row.action, row.subject_id, row.actor_id])).toEqual([
      ["decision.filed", filed[0].id, null],
    ]);
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

    expect(await feed()).toMatchObject({ open: 1, bySeverity: { err: 0, warn: 1, info: 0 }, snoozed: 0 });

    const [item] = await items(bench.workspace.id);
    await api.sql.query(`select ${SCHEMA_NAME}.decision_item_snooze($1, now() + interval '1 hour', $2, null)`, [
      item.id,
      owner.id,
    ]);

    expect(await feed()).toMatchObject({ open: 0, snoozed: 1, nextWakeAt: expect.any(String) });
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
      source: "standard-fix@v1 pin + org policy: refactor → human review",
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

    expect((await registry().register({ ...declaration, kindId: SUITE_KIND })).version).toBe(published.version);

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
      protected_path_allow_once: [run, { type: "path", id: "boot/rollback_flag.c", label: "boot/rollback_flag.c" }],
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

    const view = await api.sql.query<{ kind_id: string; question: string; why: string; tags: string[] }>(
      `select kind_id, question, why, tags from ${SCHEMA_NAME}.decision_items_rendered
        where organization_id = $1`,
      [at.org],
    );

    expect(view.rows).toHaveLength(Object.keys(refsFor).length);
    for (const row of view.rows) {
      expect({ question: row.question, why: row.why, tags: row.tags }).toEqual(MOCKUP_PROSE[row.kind_id]);
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
      message: expect.stringContaining("payload.matrix_state"),
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
    expect((await registry().kinds()).find((kind) => kind.kind.kindId === "spend_approval")?.dormant).toBe(true);
  });
});
