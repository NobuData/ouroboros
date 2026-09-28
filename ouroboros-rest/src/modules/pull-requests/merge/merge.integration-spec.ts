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
import { VaultService } from "../../vault/vault.service";
import { CriteriaRepository } from "../criteria/criteria.repository";
import { CriteriaService } from "../criteria/criteria.service";
import { GateListeners } from "../gates/gate.listeners";
import { PrMirrorRepository } from "../pr-sync.repository";
import { PrSyncService } from "../pr-sync.service";
import { MergeExecutorService, type MergeHost } from "./merge.executor";
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
});
