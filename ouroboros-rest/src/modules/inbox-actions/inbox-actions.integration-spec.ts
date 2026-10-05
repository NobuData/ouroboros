/**
 * The action executor, against a migrated database and the real planes (#462, BN.2).
 *
 * Each acceptance criterion on the application's own services and V095/V096/V099's rules:
 *
 *   - **Allow once** completes the chain: grant → AP.3 re-judges and consumes it → AP.4 resume →
 *     the simulated run fetches the resume and proceeds past the blocked stage; the next report on
 *     the same path is refused again (single use);
 *   - **Deny** and **Retry with note** deliver through AP.4, and the text reaches the run;
 *   - **Approve & merge** records AX.5's approval and arms AX.4's existing plan, which the executor
 *     merges once the gates are green — no second merge path;
 *   - **Waive & annotate** writes AX.3's waiver and the public host annotation;
 *   - **Require bench upgrade** stores a planning draft and resolves with its ref;
 *   - two concurrent answers produce one resolution, the loser a 409 naming the winner;
 *   - a retried idempotency key does not execute twice;
 *   - the role matrix holds for direct API calls;
 *   - a failing handler leaves the item open with the attempt recorded;
 *   - every execution is audited with its outcome.
 */

import { randomUUID } from "node:crypto";

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ControlsFetchedResource } from "../controls/controls.resources";
import { SCHEMA_NAME } from "../db/schema";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS } from "../decisions/decision.kinds.fixture";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { MergeExecutorService } from "../pull-requests/merge/merge.executor";
import { PrPlaneHosts, prPlaneScene, verdict } from "../pull-requests/pr-plane.integration.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { OCTOKIT_FACTORY } from "../github/github.client.factory";
import {
  SOURCE_CONFIG,
  SOURCE_TOKEN,
  recordingFactory,
} from "../ticket-sources/providers/github.provider.fixture";
import {
  writeRecording,
  type WriteRecording,
} from "../ticket-sources/providers/github.write-recordings.fixture";
import type { InMemoryPrHost } from "../ticket-sources/providers/in-memory.pr.fixture";
import { VaultService } from "../vault/vault.service";
import { BENCH_UPGRADE_PLANNER } from "./inbox-actions.handlers";
import type { ActionResultResource } from "./inbox-actions.resources";

/** The simulated driver's credential. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** The protected path every allow-once test asks about. */
const PROTECTED = "boot/rollback_flag.c";

describe("the inbox action executor, against a migrated database and the real planes", () => {
  const hosts = new PrPlaneHosts();
  let api: ApiHarness;
  let host: InMemoryPrHost;

  beforeAll(async () => {
    api = await ApiHarness.start(
      {
        OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
        OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
      },
      hosts.overrides(),
    );
  });

  afterAll(() => api.close());

  beforeEach(() => {
    host = hosts.reset();
  });

  afterEach(() => api.truncate());

  /** Call the internal channel as the simulated driver. */
  function simulator(method: "post" | "put", path: string, body: unknown = {}) {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET)
      .send(body as object);
  }

  /** Press an action as somebody, in a workspace. */
  function press(
    person: Person,
    slug: string,
    itemId: string,
    actionId: string,
    body: Record<string, unknown> = {},
  ) {
    return api
      .as(person)("post", `/api/v1/inbox/items/${itemId}/actions/${actionId}`)
      .set(TENANT_HEADER, slug)
      .send(body);
  }

  /** @returns The application's registry. */
  function registry(): DecisionKindRegistry {
    return api.nest.get(DecisionKindRegistry, { strict: false });
  }

  /** Somebody else, holding `role` in the workspace. */
  async function colleague(org: string, role: "admin" | "member" | "viewer"): Promise<Person> {
    const person = await api.signUp();

    await api.join(org, person, role);

    return person;
  }

  /** One item's status, resolution and attempts. */
  async function state(itemId: string) {
    const item = await api.sql.query<{ status: string }>(
      `select status from ${SCHEMA_NAME}.decision_items where id = $1`,
      [itemId],
    );
    const resolutions = await api.sql.query<{
      action_id: string;
      resolver: string;
      resolved_by_user: string | null;
      channel: string;
      note: string | null;
      outcome: Record<string, unknown>;
    }>(
      `select action_id, resolver, resolved_by_user, channel, note, outcome
         from ${SCHEMA_NAME}.decision_resolutions where item_id = $1`,
      [itemId],
    );
    const attempts = await api.sql.query<{
      status: string;
      error_code: string | null;
      idempotency_key: string;
    }>(
      `select status, error_code, idempotency_key from ${SCHEMA_NAME}.decision_action_attempts
        where item_id = $1 order by started_at, id`,
      [itemId],
    );

    return { status: item.rows[0]?.status, resolutions: resolutions.rows, attempts: attempts.rows };
  }

  /** A workspace's answer audit lines. */
  async function answers(org: string) {
    return (
      await api.sql.query<{
        action: string;
        actor_id: string | null;
        detail: Record<string, unknown>;
      }>(
        `select action, actor_id, detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action in ('decision.answered', 'decision.answer_failed')
          order by occurred_at, id`,
        [org],
      )
    ).rows;
  }

  /** The run's steer and resume controls, as the driver fetches them. */
  async function fetch(run: string): Promise<ControlsFetchedResource> {
    return bodyOf<ControlsFetchedResource>(
      await simulator("post", `/internal/runs/${run}/controls/fetch`).expect(200),
    );
  }

  /**
   * A run in `implement` whose repository protects `boot/**`, which reported a change-set touching
   * the protected path — so AP.3 failed `allowed_paths` and the guardrails plane filed its card.
   */
  async function blockedRun(): Promise<{
    owner: Person;
    bench: IngestBench;
    run: string;
    item: string;
  }> {
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
      await simulator("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(
        201,
      ),
    );

    await simulator("post", `/internal/runs/${run.id}/stage-transitions`, {
      idempotencyKey: "implement",
      stageKey: "implement",
      status: "active",
    }).expect(200);
    await simulator("put", `/internal/runs/${run.id}/files`, {
      idempotencyKey: "files-1",
      files: [{ path: PROTECTED, status: "modified", additions: 2, deletions: 1 }],
    }).expect(200);

    const filed = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.decision_items
        where organization_id = $1 and kind_id = 'protected_path_allow_once'`,
      [bench.workspace.id],
    );

    expect(filed.rows).toHaveLength(1);

    return { owner, bench, run: run.id, item: filed.rows[0].id };
  }

  /** The run's latest verdict for one check. */
  async function latest(run: string, check: string): Promise<string | undefined> {
    const { rows } = await api.sql.query<{ verdict: string }>(
      `select verdict from ${SCHEMA_NAME}.v_run_guardrails_latest where run_id = $1 and "check" = $2`,
      [run, check],
    );

    return rows[0]?.verdict;
  }

  it("allows once: grant → AP.3 re-judges and spends it → AP.4 resumes, and the run proceeds past the stage", async () => {
    const { owner, bench, run, item } = await blockedRun();

    expect(await latest(run, "allowed_paths")).toBe("fail");

    const answer = bodyOf<ActionResultResource>(
      await press(owner, bench.workspace.slug, item, "allow_once").expect(200),
    );

    expect(answer).toMatchObject({
      itemId: item,
      status: "resolved",
      replayed: false,
      resolution: {
        actionId: "allow_once",
        resolver: "human",
        actor: { id: owner.id },
        channel: "web",
      },
    });

    const outcome = answer.resolution.outcome as Record<string, string>;
    const grant = await api.sql.query<{
      path_glob: string;
      used_by_evaluation: string | null;
      used_at: Date | null;
    }>(
      `select path_glob, used_by_evaluation, used_at from ${SCHEMA_NAME}.guardrail_exceptions where id = $1`,
      [outcome.exception_id],
    );

    // The inbox decided nothing about writability: AP.3's own allowed_paths verdict spent the grant.
    expect(grant.rows[0]).toMatchObject({
      path_glob: PROTECTED,
      used_by_evaluation: outcome.evaluation_id,
    });
    expect(grant.rows[0].used_at).not.toBeNull();
    expect(await latest(run, "allowed_paths")).toBe("pass");
    expect(await state(item)).toMatchObject({
      status: "resolved",
      attempts: [{ status: "succeeded", error_code: null }],
    });

    // The driver: the resume is waiting for it; it acks and carries on past `implement`.
    const fetched = await fetch(run);
    const resume = fetched.controls.find((control) => control.id === outcome.control_id);

    expect(resume?.kind).toBe("resume");
    await simulator("post", `/internal/runs/${run}/controls/${outcome.control_id}/ack`, {}).expect(
      200,
    );
    await simulator("post", `/internal/runs/${run}/stage-transitions`, {
      idempotencyKey: "implement-done",
      stageKey: "implement",
      status: "succeeded",
    }).expect(200);
    await simulator("post", `/internal/runs/${run}/stage-transitions`, {
      idempotencyKey: "checks",
      stageKey: "checks-green",
      status: "active",
    }).expect(200);

    const stage = await api.sql.query<{ stage_key: string; status: string }>(
      `select stage_key, status from ${SCHEMA_NAME}.run_stage_current where run_id = $1`,
      [run],
    );

    expect(stage.rows[0]).toMatchObject({ stage_key: "checks-green", status: "active" });

    // Single use: the next report touching the same path is refused again.
    await simulator("put", `/internal/runs/${run}/files`, {
      idempotencyKey: "files-2",
      files: [{ path: PROTECTED, status: "modified", additions: 3, deletions: 1 }],
    }).expect(200);

    expect(await latest(run, "allowed_paths")).toBe("fail");
    expect((await answers(bench.workspace.id)).map((row) => [row.action, row.actor_id])).toEqual([
      ["decision.answered", owner.id],
    ]);
    expect((await answers(bench.workspace.id))[0].detail).toMatchObject({
      action: "allow_once",
      outcome_exception_id: outcome.exception_id,
    });
  });

  it("denies through AP.4: the run receives the reason as steering, and the path stays protected", async () => {
    const { owner, bench, run, item } = await blockedRun();

    const answer = bodyOf<ActionResultResource>(
      await press(owner, bench.workspace.slug, item, "deny").expect(200),
    );
    const steer = (await fetch(run)).controls.find(
      (control) => control.id === (answer.resolution.outcome as Record<string, string>).control_id,
    );

    expect(steer?.kind).toBe("steer");
    expect(steer?.payload).toContain(`${PROTECTED}: it stays protected`);
    expect(await latest(run, "allowed_paths")).toBe("fail");
    expect(
      (
        await api.sql.query(`select 1 from ${SCHEMA_NAME}.guardrail_exceptions where run_id = $1`, [
          run,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it("delivers Retry with note's text to the run through AP.4's correction round", async () => {
    const { owner, bench, run } = await blockedRun();
    const { itemId } = await registry().emit({
      organizationId: bench.workspace.id,
      kindId: "run_needs_human",
      payload: SEEDED_PAYLOADS.run_needs_human,
      refs: [{ type: "run", id: run, label: "loop #1" }],
      key: { plane: "runs", sourceRef: `run:${run}` },
    });

    await press(owner, bench.workspace.slug, itemId ?? "", "retry_with_note", {
      note: "Cap the reconnect backoff at 30 s.",
    }).expect(200);

    const steer = (await fetch(run)).controls.find((control) => control.kind === "steer");

    expect(steer?.payload).toBe("Cap the reconnect backoff at 30 s.");
    expect((await state(itemId ?? "")).resolutions[0]).toMatchObject({
      action_id: "retry_with_note",
      note: "Cap the reconnect backoff at 30 s.",
    });
  });

  it("gives two concurrent answers one resolution; the loser's 409 names who answered", async () => {
    const { owner, bench, item } = await blockedRun();
    const priya = await colleague(bench.workspace.id, "admin");

    const [first, second] = await Promise.all([
      press(owner, bench.workspace.slug, item, "deny"),
      press(priya, bench.workspace.slug, item, "deny"),
    ]);
    const statuses = [first.status, second.status].sort();
    const loser = bodyOf<ErrorEnvelope>(first.status === 409 ? first : second);

    expect(statuses).toEqual([200, 409]);
    expect(["decision_already_answered", "decision_action_in_progress"]).toContain(loser.code);
    expect(JSON.stringify(loser.details)).toMatch(/"actor":\{"id":"[^"]+","name":"[^"]+"\}/);
    expect(JSON.stringify(loser.details)).toMatch(/"actionId":"deny"/);

    const after = await state(item);

    expect(after.resolutions).toHaveLength(1);
    expect(after.attempts.filter((attempt) => attempt.status === "succeeded")).toHaveLength(1);
  });

  it("holds first-answer-wins under load: five people answering at once leave one resolution", async () => {
    const { owner, bench, run, item } = await blockedRun();
    const admins = [owner];

    for (let i = 0; i < 4; i += 1) {
      admins.push(await colleague(bench.workspace.id, "admin"));
    }

    const responses = await Promise.all(
      admins.map((person) => press(person, bench.workspace.slug, item, "deny")),
    );
    const statuses = responses.map((response) => response.status).sort();
    const steers = await api.sql.query(
      `select 1 from ${SCHEMA_NAME}.run_controls where run_id = $1 and kind = 'steer'`,
      [run],
    );
    const after = await state(item);

    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    expect(after.resolutions).toHaveLength(1);
    expect(after.attempts.filter((attempt) => attempt.status === "succeeded")).toHaveLength(1);
    // One steer reached the run: the plane was called once.
    expect(steers.rows).toHaveLength(1);
  });

  it("does not execute a retried idempotency key twice", async () => {
    const { owner, bench, run, item } = await blockedRun();
    const key = randomUUID();

    const first = bodyOf<ActionResultResource>(
      await press(owner, bench.workspace.slug, item, "deny", { idempotencyKey: key }).expect(200),
    );
    const again = bodyOf<ActionResultResource>(
      await press(owner, bench.workspace.slug, item, "deny", { idempotencyKey: key }).expect(200),
    );
    const steers = await api.sql.query(
      `select 1 from ${SCHEMA_NAME}.run_controls where run_id = $1 and kind = 'steer'`,
      [run],
    );

    expect(again).toMatchObject({
      replayed: true,
      attempt: first.attempt,
      resolution: first.resolution,
    });
    expect(steers.rows).toHaveLength(1);
    expect((await state(item)).attempts).toHaveLength(1);
  });

  it("enforces the declared roles server-side, whatever the UI shows", async () => {
    const { bench, item } = await blockedRun();
    const member = await colleague(bench.workspace.id, "member");
    const viewer = await colleague(bench.workspace.id, "viewer");

    const refused = await press(member, bench.workspace.slug, item, "allow_once").expect(403);
    await press(viewer, bench.workspace.slug, item, "deny").expect(403);

    expect(refused.body).toMatchObject({
      code: "decision_action_forbidden",
      details: { required: "approver" },
    });
    expect(await state(item)).toMatchObject({ status: "open", attempts: [] });
  });

  it("refuses a link, a missing note and an unknown item before any plane is called", async () => {
    const { owner, bench, item } = await blockedRun();

    await press(owner, bench.workspace.slug, item, "view_diff").expect(422);
    await press(owner, bench.workspace.slug, item, "deny", { note: "Not this way." }).expect(422);
    await press(owner, bench.workspace.slug, randomUUID(), "deny").expect(404);
    await api.anonymous("post", `/api/v1/inbox/items/${item}/actions/deny`).expect(401);

    expect(await state(item)).toMatchObject({ status: "open", attempts: [] });
  });

  it("leaves the item open when the plane refuses, with the failure recorded and audited", async () => {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const { itemId } = await registry().emit({
      organizationId: bench.workspace.id,
      kindId: "fact_review",
      payload: SEEDED_PAYLOADS.fact_review,
      refs: [],
      key: { plane: "facts", sourceRef: `fact:${randomUUID()}:proposed` },
    });

    const refused = await press(owner, bench.workspace.slug, itemId ?? "", "confirm");

    expect(refused.status).toBe(404);
    expect(await state(itemId ?? "")).toMatchObject({
      status: "open",
      resolutions: [],
      attempts: [{ status: "failed", error_code: bodyOf<ErrorEnvelope>(refused).code }],
    });
    expect(
      (await answers(bench.workspace.id)).map((row) => [row.action, row.detail.error]),
    ).toEqual([["decision.answer_failed", bodyOf<ErrorEnvelope>(refused).code]]);
  });

  it("answers 501 for a declared action whose plane has no operation, leaving the item open", async () => {
    const { owner, bench, run } = await blockedRun();
    const { itemId } = await registry().emit({
      organizationId: bench.workspace.id,
      kindId: "plan_sign_off",
      payload: SEEDED_PAYLOADS.plan_sign_off,
      refs: [{ type: "run", id: run, label: "loop #1" }],
      key: { plane: "workflows", sourceRef: `run:${run}:stage:plan` },
    });

    const refused = await press(owner, bench.workspace.slug, itemId ?? "", "sign_off").expect(501);

    expect(bodyOf<ErrorEnvelope>(refused).code).toBe("decision_action_unbound");
    expect((await state(itemId ?? "")).status).toBe("open");
  });

  describe("the PR plane", () => {
    it("approves through AX.5 and arms AX.4's existing plan, which the executor merges once the gates are green", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const { itemId } = await registry().emit({
        organizationId: at.org,
        kindId: "merge_approval",
        payload: SEEDED_PAYLOADS.merge_approval,
        refs: [
          { type: "run", id: at.runId, label: "loop #1" },
          { type: "pr", id: at.prId, label: `PR #${String(at.prNumber)}` },
        ],
        key: { plane: "pr.gates", sourceRef: `pr:${at.prId}` },
      });

      const answer = bodyOf<ActionResultResource>(
        await press(at.owner, at.bench.workspace.slug, itemId ?? "", "approve_merge").expect(200),
      );

      expect(answer.resolution.outcome).toMatchObject({
        pr_id: at.prId,
        merge: "armed",
        merge_sha: null,
      });

      const approval = await api.sql.query<{ state: string }>(
        `select state from ${SCHEMA_NAME}.pr_approvals where pr_id = $1`,
        [at.prId],
      );
      const plan = await api.sql.query<{ armed: boolean }>(
        `select armed from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1`,
        [at.prId],
      );

      expect(approval.rows.map((row) => row.state)).toContain("approved");
      expect(plan.rows[0]).toEqual({ armed: true });

      // The gates go green; AX.4's executor merges the armed plan — the one merge path.
      const pending = await api.sql.query<{ definition_id: string }>(
        `select definition_id from ${SCHEMA_NAME}.pr_gate_results_latest
          where revision_id = $1 and required
            and verdict not in ('green', 'waived', 'not_required')`,
        [at.revisionId],
      );

      for (const gate of pending.rows) {
        await verdict(api, gate.definition_id, at.revisionId, "green");
      }

      const merged = await api.nest
        .get(MergeExecutorService)
        .run(at.org, at.prId, { kind: "armed" });

      expect(merged.kind).toBe("merged");
      await api.nest.get(MergeExecutorService).settled();
      // The person's answer stands; the PR-merged watcher found it answered.
      expect((await state(itemId ?? "")).resolutions).toEqual([
        expect.objectContaining({ action_id: "approve_merge", resolver: "human" }),
      ]);
    });

    it("waives through AX.3 and posts the public host annotation the card warns about", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const criterion = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.pr_criteria (pr_id, claim, source, status, sort_order, created_by)
         values ($1, 'Flake must not reappear across temperature range', 'plan', 'unverified', 5, $2)
         returning id`,
        [at.prId, at.owner.id],
      );
      const { itemId } = await registry().emit({
        organizationId: at.org,
        kindId: "claim_waiver",
        payload: SEEDED_PAYLOADS.claim_waiver,
        refs: [{ type: "pr", id: at.prId, label: `PR #${String(at.prNumber)}` }],
        key: { plane: "pr.criteria", sourceRef: `pr:${at.prId}:criterion:${criterion.rows[0].id}` },
      });

      const answer = bodyOf<ActionResultResource>(
        await press(at.owner, at.bench.workspace.slug, itemId ?? "", "waive_annotate", {
          note: "rig runs at 22°C only — thermal chamber not in bench",
        }).expect(200),
      );
      const comments = host.ledger().comments.map(([, , body]) => body);

      expect(answer.resolution.outcome).toMatchObject({ waived: true, annotation: "annotated" });
      expect(comments.some((body) => body.includes("thermal chamber not in bench"))).toBe(true);
      expect(
        (
          await api.sql.query<{ status: string }>(
            `select status from ${SCHEMA_NAME}.pr_criteria where id = $1`,
            [criterion.rows[0].id],
          )
        ).rows[0],
      ).toEqual({ status: "waived" });
    });

    it("refuses a bench upgrade into a tracker planning cannot write, leaving the item open", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const { itemId } = await registry().emit({
        organizationId: at.org,
        kindId: "claim_waiver",
        payload: SEEDED_PAYLOADS.claim_waiver,
        refs: [{ type: "pr", id: at.prId, label: `PR #${String(at.prNumber)}` }],
        key: { plane: "pr.criteria", sourceRef: `pr:${at.prId}:criterion:${randomUUID()}` },
      });

      const refused = await press(
        at.owner,
        at.bench.workspace.slug,
        itemId ?? "",
        "require_bench_upgrade",
      );

      expect(refused.status).toBe(409);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("planning_target_read_only");
      expect((await state(itemId ?? "")).status).toBe("open");
    });
  });
});

describe("Require bench upgrade and Approve split, with a tracker planning can write to", () => {
  let api: ApiHarness;
  let github: WriteRecording;

  // The default provider registry, whose GitHub provider writes — the PR plane's harness above
  // registers only the in-memory host, which planning cannot push to. GitHub itself is the write
  // kit's recording, so a push is observed where it lands.
  beforeAll(async () => {
    github = writeRecording();
    api = await ApiHarness.start(
      {
        OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
      },
      [{ provide: OCTOKIT_FACTORY, useValue: recordingFactory(github.octokit).factory }],
    );
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  it("drafts the bench upgrade into planning and resolves carrying the draft's ref", async () => {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await api
        .anonymous("post", "/internal/runs")
        .set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET)
        .send({ idempotencyKey: "open", ...bench.open })
        .expect(201),
    );
    const pr = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pull_requests
              (organization_id, source_id, external_number, external_url, title, head_branch,
               base_branch, state, run_id, ticket_id)
       select $1, t.source_id, 514, 'https://github.com/acme/helios/pull/514', 'can: fix flake',
              'loop/482', 'main', 'verifying', $2, t.id
         from ${SCHEMA_NAME}.tickets t where t.organization_id = $1
       returning id`,
      [bench.workspace.id, run.id],
    );
    const registry = api.nest.get(DecisionKindRegistry, { strict: false });
    const { itemId } = await registry.emit({
      organizationId: bench.workspace.id,
      kindId: "claim_waiver",
      payload: SEEDED_PAYLOADS.claim_waiver,
      refs: [{ type: "pr", id: pr.rows[0].id, label: "PR #514" }],
      key: { plane: "pr.criteria", sourceRef: `pr:${pr.rows[0].id}:criterion:${randomUUID()}` },
    });

    const answer = bodyOf<ActionResultResource>(
      await api
        .as(owner)("post", `/api/v1/inbox/items/${itemId ?? ""}/actions/require_bench_upgrade`)
        .set(TENANT_HEADER, bench.workspace.slug)
        .send({})
        .expect(200),
    );
    const outcome = answer.resolution.outcome as Record<string, string>;
    const batch = await api.sql.query<{
      planner: string;
      target_source_id: string;
      drafts: string;
    }>(
      `select b.planner, b.target_source_id, count(d.id)::text as drafts
         from ${SCHEMA_NAME}.draft_batches b
         join ${SCHEMA_NAME}.ticket_drafts d on d.batch_id = b.id
        where b.id = $1 group by b.planner, b.target_source_id`,
      [outcome.draft_batch_id],
    );

    expect(batch.rows[0]).toEqual({
      planner: BENCH_UPGRADE_PLANNER,
      target_source_id: bench.source,
      drafts: "1",
    });
    expect(outcome.draft_id).toEqual(expect.any(String));
    expect(answer.resolution).toMatchObject({
      actionId: "require_bench_upgrade",
      resolver: "human",
    });
  });

  it("approves a split through AL.3's push: the drafts become issues on the tracker", async () => {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const source = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub · acme-robotics', $2::jsonb) returning id`,
      [bench.workspace.id, JSON.stringify(SOURCE_CONFIG)],
    );
    const sourceId = source.rows[0].id;
    const sealed = await api.nest
      .get(VaultService)
      .encryptText(bench.workspace.id, sourceId, SOURCE_TOKEN);

    await api.sql.query(
      `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
      [sourceId, sealed],
    );

    const batch = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.draft_batches
              (organization_id, source_prompt, planner, target_source_id, status, created_by)
       values ($1, 'Telemetry v2', 'split-v1', $2, 'sized', $3) returning id`,
      [bench.workspace.id, sourceId, owner.id],
    );
    const batchId = batch.rows[0].id;

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.ticket_drafts (batch_id, local_key, title)
       values ($1, 'T1', 'Telemetry v2: frame schema'), ($1, 'T2', 'Telemetry v2: uplink')`,
      [batchId],
    );

    const { itemId } = await api.nest.get(DecisionKindRegistry, { strict: false }).emit({
      organizationId: bench.workspace.id,
      kindId: "split_approval",
      payload: SEEDED_PAYLOADS.split_approval,
      refs: [],
      key: { plane: "planning", sourceRef: `batch:${batchId}` },
    });
    const before = github.issues.length;
    const answer = bodyOf<ActionResultResource>(
      await api
        .as(owner)("post", `/api/v1/inbox/items/${itemId ?? ""}/actions/approve_split`)
        .set(TENANT_HEADER, bench.workspace.slug)
        .send({})
        .expect(200),
    );
    const drafts = await api.sql.query<{ push_state: string }>(
      `select push_state from ${SCHEMA_NAME}.ticket_drafts where batch_id = $1 order by local_key`,
      [batchId],
    );

    // The downstream effect: two issues on the tracker, both drafts pushed.
    expect(github.issues.slice(before).map((issue) => issue.title)).toEqual([
      "Telemetry v2: frame schema",
      "Telemetry v2: uplink",
    ]);
    expect(drafts.rows.map((row) => row.push_state)).toEqual(["pushed", "pushed"]);
    expect(answer.resolution).toMatchObject({
      actionId: "approve_split",
      outcome: { draft_batch_id: batchId, pushed: 2 },
    });
  });
});
