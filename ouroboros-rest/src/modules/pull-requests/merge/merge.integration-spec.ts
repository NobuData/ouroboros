import type { PoolClient } from "pg";

import { ApiHarness } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { AuditService } from "../../audit/audit.service";
import { SCHEMA_NAME } from "../../db/schema";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { seedIngestBench } from "../../ingest/ingest.fixture";
import type { RunOpenedResource } from "../../ingest/ingest.resources";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  IN_MEMORY_MERGER,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
  pullUrl,
} from "../../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
} from "../../ticket-sources/providers/in-memory.provider.fixture";
import { TicketSourceRegistry } from "../../ticket-sources/ticket-source.registry";
import { TicketSourcesService } from "../../ticket-sources/ticket-sources.service";
import { OrgPolicyService } from "../../policies/org-policy.service";
import { VaultService } from "../../vault/vault.service";
import { CriteriaRepository } from "../criteria/criteria.repository";
import { CriteriaService } from "../criteria/criteria.service";
import { GateListeners } from "../gates/gate.listeners";
import { PrMirrorRepository } from "../pr-sync.repository";
import { PrSyncService } from "../pr-sync.service";
import { MergeExecutorService, refusedEdit, type MergeHost } from "./merge.executor";
import { MergeRepository } from "./merge.repository";

/**
 * **The merge executor against a migrated database** — AX.4
 * ([#360](https://github.com/NobuData/ouroboros/issues/360)).
 *
 * What only this scale proves: V058 and V064 accept what the executor writes (the arm, the
 * re-check's disarm with its reason, `merged_result` and its identity CHECK, the epic note), the
 * audit trigger names an actor for every arm, disarm and merge, the run is finalized as the
 * dashboard's `merged`, and — the one the issue insists on — **the re-check's transaction really
 * holds the PR row**: a gate write taking the gate engine's own `for update` lock waits for the
 * merge to commit.
 *
 * And for the plan's edit (AY.7, [#369](https://github.com/NobuData/ouroboros/issues/369)): V058
 * accepts each field, its trigger audits the edit with its actor and the columns that changed, and
 * the two constraints that refuse an epic are named the way `refusedEdit` reads them.
 *
 * The host is the in-memory git host, reached through the real `PrSyncService` and vault.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/pull-requests/merge
 * ```
 */

describe("the merge executor, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The one row a statement returns. */
  async function one<T extends object>(text: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query<T>(text, values);

    return rows[0];
  }

  /** Everything a case starts from. */
  interface Scene {
    readonly ownerId: string;
    readonly org: string;
    readonly runId: string;
    readonly prId: string;
    readonly revisionId: string;
    readonly buildId: string;
    readonly testId: string;
    readonly epicId: string;
    readonly host: InMemoryPrHost;
    readonly prNumber: number;
    readonly issue: number;
    readonly executor: MergeExecutorService;
    /** Hold the next merge until {@link Scene.release} — for the lock case. */
    readonly pause: () => void;
    readonly release: () => void;
  }

  /**
   * Run #482; a git-host source on the in-memory host; PR #n on it closing issue #1, verifying at
   * revision 1, with two required gates — build green, tests pending; an epic; and the executor
   * over the real repository and sync service.
   *
   * @returns The scene.
   */
  async function scene(): Promise<Scene> {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const org = bench.workspace.id;
    const run = bodyOf<RunOpenedResource>(
      await api
        .anonymous("post", "/internal/runs")
        .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
        .send({ idempotencyKey: "open", ...bench.open })
        .expect(201),
    );
    const host = new InMemoryPrHost();
    const issue = host.openIssue();
    // The canonical ticket is the host's issue, so `Closes #1.` closes it.
    const ticket = await one<{ id: string }>(
      `update ${SCHEMA_NAME}.tickets set external_key = $3
        where organization_id = $1 and source_id = $2 returning id`,
      [org, bench.source, `#${String(issue)}`],
    );
    const hostSource = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'custom', 'Sandbox host', $2::jsonb) returning id`,
      [org, JSON.stringify({ project: IN_MEMORY_PROJECT })],
    );
    const sealed = await api.nest
      .get(VaultService)
      .encryptText(org, hostSource.id, IN_MEMORY_TOKEN);

    await api.sql.query(
      `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
      [hostSource.id, sealed],
    );
    host.push("loop/482-canbus-flake", [
      { path: "drivers/can/telemetry_buf.c", additions: 40, deletions: 12 },
    ]);

    const opened = host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
      branch: "loop/482-canbus-flake",
      base: IN_MEMORY_DEFAULT_BRANCH,
      title: "fix(can): preserve ISR frame order in telemetry path",
      body: null,
    });
    const pr = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pull_requests
              (organization_id, source_id, external_number, external_url, title, head_branch,
               base_branch, state, run_id, ticket_id)
       values ($1, $2, $3, $4, 'fix(can): preserve ISR frame order in telemetry path',
               'loop/482-canbus-flake', 'main', 'verifying', $5, $6)
       returning id`,
      [
        org,
        hostSource.id,
        opened.number,
        pullUrl(IN_MEMORY_PROJECT, opened.number),
        run.id,
        ticket.id,
      ],
    );
    const revision = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pr_revisions (pr_id, revision_seq, head_sha, pushed_at)
       values ($1, 1, $2, now()) returning id`,
      [pr.id, host.headOf(opened)],
    );
    const definition = (key: string, label: string, order: number) =>
      one<{ id: string }>(
        `insert into ${SCHEMA_NAME}.pr_gate_definitions
                (pr_id, gate_key, source, required, sort_order, label)
         values ($1, $2, 'standard-fix@v14 pin', true, $3, $4) returning id`,
        [pr.id, key, order, label],
      );
    const build = await definition("build", "Build", 1);
    const test = await definition("test_suite", "Test suite", 2);
    const epic = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.planning_epics (organization_id, name, sort_order)
       values ($1, 'OTA hardening', 1) returning id`,
      [org],
    );

    let held: Promise<void> | undefined;
    let release: () => void = () => undefined;
    const sync = new PrSyncService(
      api.nest.get(PrMirrorRepository),
      new TicketSourceRegistry([new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host)]),
      api.nest.get(TicketSourcesService),
    );
    const hostSurface: MergeHost = {
      get: (...args) => sync.get(...args),
      merge: async (...args) => {
        await held;
        return sync.merge(...args);
      },
      comment: (...args) => sync.comment(...args),
      sync: (...args) => sync.sync(...args),
    };
    const executor = new MergeExecutorService(
      api.nest.get(MergeRepository),
      hostSurface,
      new CriteriaService(api.nest.get(CriteriaRepository), sync, api.nest.get(AuditService)),
      new GateListeners(),
      api.nest.get(OrgPolicyService),
    );

    await verdict(build.id, revision.id, "green");
    await verdict(test.id, revision.id, "pending");

    return {
      ownerId: owner.id,
      org,
      runId: run.id,
      prId: pr.id,
      revisionId: revision.id,
      buildId: build.id,
      testId: test.id,
      epicId: epic.id,
      host,
      prNumber: opened.number,
      issue,
      executor,
      pause: () => {
        held = new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      release: () => {
        release();
      },
    };
  }

  /**
   * Append one gate verdict — what the gate engine writes.
   *
   * @param definitionId - The gate.
   * @param revisionId - The revision.
   * @param value - The verdict.
   * @param client - A client holding a transaction, or the pool.
   */
  async function verdict(
    definitionId: string,
    revisionId: string,
    value: "green" | "red" | "pending",
    client: Pick<PoolClient, "query"> = api.sql,
  ): Promise<void> {
    await client.query(
      `insert into ${SCHEMA_NAME}.pr_gate_results
              (definition_id, revision_id, verdict, evidence, provider_version, evaluated_at)
       values ($1, $2, $3, $4, 'gate-test@1.0.0', clock_timestamp())`,
      [definitionId, revisionId, value, `${value} by the suite`],
    );
  }

  /** The plan row. */
  function plan(prId: string) {
    return one<{
      armed: boolean;
      disarm_reason: string | null;
      merged_result: { sha: string; identity_used: string; actions_executed: string[] } | null;
    }>(
      `select armed, disarm_reason, merged_result from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1`,
      [prId],
    );
  }

  /** The plan's audit trail, oldest first. */
  async function trail(prId: string): Promise<{ action: string; actor_id: string | null }[]> {
    const { rows } = await api.sql.query<{ action: string; actor_id: string | null }>(
      `select e.action, e.actor_id from ${SCHEMA_NAME}.audit_events e
         join ${SCHEMA_NAME}.pr_merge_plans p on p.id::text = e.subject_id
        where p.pr_id = $1 and e.subject_type = 'pr_merge_plan'
        order by e.occurred_at, e.action`,
      [prId],
    );

    return rows;
  }

  it("merges an armed PR when the last gate flips, with every action and an audited actor", async () => {
    const at = await scene();

    await at.executor.plan(at.org, at.prId);
    await api.sql.query(
      `update ${SCHEMA_NAME}.pr_merge_plans set back_annotate_epic = true, epic_id = $2
        where pr_id = $1`,
      [at.prId, at.epicId],
    );
    await at.executor.arm(at.org, at.prId, { id: at.ownerId, roles: ["owner"] }, at.revisionId);
    await at.executor.settled();

    expect(await plan(at.prId)).toMatchObject({ armed: true, merged_result: null });

    await verdict(at.testId, at.revisionId, "green");
    at.executor.gateEvaluated({
      prId: at.prId,
      organizationId: at.org,
      revisionId: at.revisionId,
      state: "armed",
      mergeReady: true,
      redCount: 0,
    });
    await at.executor.settled();

    const merged = await plan(at.prId);

    expect(merged.merged_result).toMatchObject({
      identity_used: IN_MEMORY_MERGER,
      actions_executed: ["close_ticket", "comment_evidence", "back_annotate_epic", "delete_branch"],
    });
    expect(at.host.ledger()).toMatchObject({
      merged: [at.prNumber],
      closedIssues: [at.issue],
    });
    expect(at.host.ledger().comments).toHaveLength(1);
    expect(
      await one<{ state: string }>(`select state from ${SCHEMA_NAME}.pull_requests where id = $1`, [
        at.prId,
      ]),
    ).toEqual({ state: "merged" });
    expect(
      await one<{ status: string; pr_number: number; finished: boolean }>(
        `select status, pr_number, finished_at is not null as finished
           from ${SCHEMA_NAME}.runs where id = $1`,
        [at.runId],
      ),
    ).toEqual({ status: "merged", pr_number: at.prNumber, finished: true });
    expect(
      await one<{ body: string }>(
        `select body from ${SCHEMA_NAME}.planning_epic_notes where epic_id = $1 and pr_id = $2`,
        [at.epicId, at.prId],
      ),
    ).toMatchObject({
      body: expect.stringContaining(`merged PR #${String(at.prNumber)}`) as unknown,
    });
    expect(await trail(at.prId)).toEqual(
      expect.arrayContaining([
        { action: "pr_merge_plan.armed", actor_id: at.ownerId },
        { action: "pr_merge_plan.merged", actor_id: at.ownerId },
      ]),
    );
  });

  it("holds to the dry-run policy (#382): refused, re-checked at execution, workflow untouched, restored", async () => {
    const at = await scene();
    const policies = api.nest.get(OrgPolicyService);
    const owner = { id: at.ownerId, roles: ["owner" as const] };
    const pinned = () =>
      one<{ definition: unknown }>(
        `select v.definition from ${SCHEMA_NAME}.runs r
           join ${SCHEMA_NAME}.workflows w
             on w.organization_id = r.organization_id and w.slug = r.workflow_tag
           join ${SCHEMA_NAME}.workflow_versions v
             on v.workflow_id = w.id and v.version = r.workflow_version_pin
          where r.id = $1`,
        [at.runId],
      );
    const before = await pinned();

    // Armed while dry-run is off; then an owner turns it on and the last gate flips.
    await at.executor.arm(at.org, at.prId, owner, at.revisionId);
    await at.executor.settled();
    await policies.setDryRun(at.org, at.ownerId, true);
    await verdict(at.testId, at.revisionId, "green");
    at.executor.gateEvaluated({
      prId: at.prId,
      organizationId: at.org,
      revisionId: at.revisionId,
      state: "armed",
      mergeReady: true,
      redCount: 0,
    });
    await at.executor.settled();

    expect(at.host.ledger().merged).toEqual([]);
    expect(await plan(at.prId)).toMatchObject({
      armed: false,
      disarm_reason: expect.stringMatching(
        /^dry_run_policy_active: dry-run policy active/,
      ) as unknown,
    });

    // Arming again is refused with the designed reason; the plan renders the override.
    await expect(at.executor.arm(at.org, at.prId, owner, at.revisionId)).rejects.toMatchObject({
      response: { code: "dry_run_policy_active" },
    });
    await expect(at.executor.plan(at.org, at.prId)).resolves.toMatchObject({
      dryRun: { active: true, autoMerge: { requested: true, effective: false, overridden: true } },
    });
    // Overridden, never mutated: the pinned document is byte-for-byte what it was.
    expect(await pinned()).toEqual(before);

    // Flip off: the workflow's auto-merge is back exactly, and the merge goes through.
    await policies.setDryRun(at.org, at.ownerId, false);
    await expect(at.executor.plan(at.org, at.prId)).resolves.toMatchObject({
      dryRun: { active: false, autoMerge: { requested: true, effective: true, overridden: false } },
    });
    await at.executor.arm(at.org, at.prId, owner, at.revisionId);
    await at.executor.settled();

    expect(at.host.ledger().merged).toEqual([at.prNumber]);
    expect(await pinned()).toEqual(before);
  });

  it("disarms, never merges, when a gate goes red between arm and fire — and says why", async () => {
    const at = await scene();

    await at.executor.arm(at.org, at.prId, { id: at.ownerId, roles: ["owner"] }, at.revisionId);
    await at.executor.settled();
    await verdict(at.buildId, at.revisionId, "red");
    await verdict(at.testId, at.revisionId, "green");

    const outcome = await at.executor.run(at.org, at.prId, { kind: "armed" });

    expect(outcome).toMatchObject({ kind: "refused", disarmed: true });
    expect(at.host.ledger().merged).toEqual([]);
    expect(await plan(at.prId)).toMatchObject({
      armed: false,
      disarm_reason: "gate_red: Build is red on revision 1.",
      merged_result: null,
    });
    expect((await trail(at.prId)).at(-1)).toEqual({
      action: "pr_merge_plan.disarmed",
      actor_id: null,
    });
    expect(
      await one<{ state: string }>(`select state from ${SCHEMA_NAME}.pull_requests where id = $1`, [
        at.prId,
      ]),
    ).toEqual({ state: "verifying" });
  });

  it("holds the PR row through the merge: a concurrent gate write waits for it to commit", async () => {
    const at = await scene();

    await at.executor.arm(at.org, at.prId, { id: at.ownerId, roles: ["owner"] }, at.revisionId);
    await at.executor.settled();
    await verdict(at.testId, at.revisionId, "green");
    at.pause();

    const running = at.executor.run(at.org, at.prId, { kind: "armed" });

    // Give the executor time to lock, re-check and reach the host's merge.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The gate engine's transaction: the same row lock, then a red verdict.
    const client = await api.sql.connect();
    let landed = false;
    const evaluation = (async () => {
      try {
        await client.query("begin");
        await client.query(`select id from ${SCHEMA_NAME}.pull_requests where id = $1 for update`, [
          at.prId,
        ]);
        await verdict(at.buildId, at.revisionId, "red", client);
        await client.query("commit");
        landed = true;
      } finally {
        client.release();
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(landed).toBe(false);

    at.release();

    expect((await running).kind).toBe("merged");
    await evaluation;
    expect(landed).toBe(true);
    expect(at.host.ledger().merged).toEqual([at.prNumber]);
    expect((await plan(at.prId)).merged_result).not.toBeNull();
  });

  describe("editing the plan (#369)", () => {
    /** The plan's editable columns. */
    function edited(prId: string) {
      return one<{
        commit_message: string;
        close_ticket: boolean;
        comment_evidence: boolean;
        back_annotate_epic: boolean;
        epic_id: string | null;
        updated_by: string | null;
      }>(
        `select commit_message, close_ticket, comment_evidence, back_annotate_epic, epic_id,
                updated_by
           from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1`,
        [prId],
      );
    }

    /** What each edit's audit row recorded, oldest first. */
    async function editTrail(prId: string) {
      const { rows } = await api.sql.query<{ actor_id: string | null; detail: object }>(
        `select e.actor_id, e.detail from ${SCHEMA_NAME}.audit_events e
           join ${SCHEMA_NAME}.pr_merge_plans p on p.id::text = e.subject_id
          where p.pr_id = $1 and e.action = 'pr_merge_plan.edited'
          order by e.occurred_at`,
        [prId],
      );

      return rows;
    }

    it("round-trips the message, the toggles and the epic, and audits each with its actor", async () => {
      const at = await scene();
      const owner = { id: at.ownerId, roles: ["owner" as const] };

      await at.executor.edit(at.org, at.prId, owner, { commitMessage: "fix(can): reworded" });
      await at.executor.edit(at.org, at.prId, owner, { closeTicket: false });
      await at.executor.edit(at.org, at.prId, owner, { commentEvidence: false });
      await at.executor.edit(at.org, at.prId, owner, { epicId: at.epicId });

      const annotated = await at.executor.edit(at.org, at.prId, owner, { backAnnotateEpic: true });

      expect(annotated).toMatchObject({
        commitMessage: "fix(can): reworded",
        closeTicket: false,
        commentEvidence: false,
        backAnnotateEpic: true,
        epicId: at.epicId,
        armed: false,
      });
      expect(await edited(at.prId)).toEqual({
        commit_message: "fix(can): reworded",
        close_ticket: false,
        comment_evidence: false,
        back_annotate_epic: true,
        epic_id: at.epicId,
        updated_by: at.ownerId,
      });
      expect(await at.executor.plan(at.org, at.prId)).toEqual(annotated);

      const cleared = await at.executor.edit(at.org, at.prId, owner, { epicId: null });

      expect(cleared).toMatchObject({ epicId: null, backAnnotateEpic: false });

      const trail = await editTrail(at.prId);

      expect(trail.map((row) => row.actor_id)).toEqual(Array(6).fill(at.ownerId));
      expect(trail.map((row) => (row.detail as { fields: string[] }).fields)).toEqual([
        ["commit_message"],
        ["close_ticket"],
        ["comment_evidence"],
        ["epic_id"],
        ["back_annotate_epic"],
        ["back_annotate_epic", "epic_id"],
      ]);
      // A closed field set: the message itself never reaches the trail.
      expect(JSON.stringify(trail)).not.toContain("reworded");
    });

    it("writes no audit row for an edit that changes nothing", async () => {
      const at = await scene();
      const owner = { id: at.ownerId, roles: ["owner" as const] };
      const before = await at.executor.plan(at.org, at.prId);

      expect(await at.executor.edit(at.org, at.prId, owner, {})).toEqual(before);
      expect(await at.executor.edit(at.org, at.prId, owner, { closeTicket: true })).toEqual(before);
      expect(await editTrail(at.prId)).toEqual([]);
    });

    it("refuses another workspace's epic, a missing one, and back-annotate with none", async () => {
      const at = await scene();
      const owner = { id: at.ownerId, roles: ["owner" as const] };
      const elsewhere = await api.workspace(await api.signUp());
      const foreign = await one<{ id: string }>(
        `insert into ${SCHEMA_NAME}.planning_epics (organization_id, name, sort_order)
         values ($1, 'Somebody else''s roadmap', 1) returning id`,
        [elsewhere.id],
      );

      await expect(
        at.executor.edit(at.org, at.prId, owner, { epicId: foreign.id }),
      ).rejects.toMatchObject({ status: 422, code: "merge_plan_epic_not_found" });
      await expect(
        at.executor.edit(at.org, at.prId, owner, {
          epicId: "00000000-0000-4000-8000-000000000000",
        }),
      ).rejects.toMatchObject({ status: 422, code: "merge_plan_epic_not_found" });
      await expect(
        at.executor.edit(at.org, at.prId, owner, { backAnnotateEpic: true }),
      ).rejects.toMatchObject({ status: 422, code: "merge_plan_epic_required" });

      // Each refusal rolled its transaction back — not even the default plan was left behind.
      expect(await edited(at.prId)).toBeUndefined();
      expect(await editTrail(at.prId)).toEqual([]);

      // And a plan that exists is left exactly as it was.
      await at.executor.plan(at.org, at.prId);
      await expect(
        at.executor.edit(at.org, at.prId, owner, { epicId: foreign.id, closeTicket: false }),
      ).rejects.toMatchObject({ code: "merge_plan_epic_not_found" });
      expect(await edited(at.prId)).toMatchObject({
        epic_id: null,
        back_annotate_epic: false,
        close_ticket: true,
      });
    });

    it("is refused by V058 under the names refusedEdit reads, when the check is raced past", async () => {
      const at = await scene();
      const store = api.nest.get(MergeRepository);
      const elsewhere = await api.workspace(await api.signUp());
      const foreign = await one<{ id: string }>(
        `insert into ${SCHEMA_NAME}.planning_epics (organization_id, name, sort_order)
         values ($1, 'Somebody else''s roadmap', 1) returning id`,
        [elsewhere.id],
      );

      await at.executor.plan(at.org, at.prId);

      /** Write straight past the executor's own checks, as a race would. */
      const write = (changes: Parameters<typeof refusedEdit>[1] | object) =>
        store
          .transaction(async (tx) => {
            const locked = await tx.lock(at.org, at.prId);

            return tx.edit(locked?.plan?.id ?? "", at.ownerId, changes as never);
          })
          .catch((error: unknown) => refusedEdit(at.prId, null, error));

      expect(await write({ epicId: foreign.id })).toMatchObject({
        code: "merge_plan_epic_not_found",
      });
      expect(await write({ epicId: "00000000-0000-4000-8000-000000000000" })).toMatchObject({
        code: "merge_plan_epic_not_found",
      });
      expect(await write({ backAnnotateEpic: true })).toMatchObject({
        code: "merge_plan_epic_required",
      });
    });

    it("refuses editing an armed plan and a merged one, and names who armed", async () => {
      const at = await scene();
      const owner = { id: at.ownerId, roles: ["owner" as const] };
      const armed = await at.executor.arm(at.org, at.prId, owner, at.revisionId);

      await at.executor.settled();

      expect(armed.armedByPerson).toMatchObject({ id: at.ownerId });
      expect(armed.armedByPerson?.name).toEqual(expect.any(String));
      await expect(
        at.executor.edit(at.org, at.prId, owner, { closeTicket: false }),
      ).rejects.toMatchObject({ status: 409, code: "merge_plan_armed" });

      await verdict(at.testId, at.revisionId, "green");

      expect((await at.executor.run(at.org, at.prId, { kind: "armed" })).kind).toBe("merged");
      await expect(
        at.executor.edit(at.org, at.prId, owner, { closeTicket: false }),
      ).rejects.toMatchObject({ status: 409, code: "merge_plan_merged" });
      expect(await edited(at.prId)).toMatchObject({ close_ticket: true });
    });
  });
});
