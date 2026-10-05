/**
 * Allow-once exceptions, against a migrated database and AP.3's real evaluation (#459, #462, #465).
 *
 * *"Allow once"* has to mean once, here, now. Each property the grant promises, observed where it
 * is enforced — AP.3's `allowed_paths` verdict on the run's next report:
 *
 *   - **scope**: a grant on one run lifts nothing for a second run touching the same path;
 *   - **TTL**: an expired grant permits nothing and is never consumed;
 *   - **single use**: the first evaluation spends it; the next report on the same path fails again;
 *   - **revocation**: a grant withdrawn before use permits nothing;
 *   - **the audit chain**: card → grant (`granted_via`) → consumption (`used_by_evaluation`, an
 *     `allowed_paths` verdict of the grant's own run) → the resolution's receipt naming the grant.
 */

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { plantGrant } from "../guardrails/guardrails.exceptions.integration.fixture";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { ActionResultResource } from "./inbox-actions.resources";

/** The simulated driver's credential. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** The protected path every case touches. */
const PROTECTED = "boot/rollback_flag.c";

describe("allow-once exceptions, judged by AP.3", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
      OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
    });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Call the internal channel as the simulated driver. */
  function simulator(method: "post" | "put", path: string, body: unknown = {}) {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET)
      .send(body as object);
  }

  /** A workspace whose repository protects `boot/**`. */
  async function protectedBench(): Promise<{ owner: Person; bench: IngestBench }> {
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

    return { owner, bench };
  }

  /** Open a run of the bench and move it into `implement`. */
  async function implementing(bench: IngestBench, key: string): Promise<string> {
    const run = bodyOf<RunOpenedResource>(
      await simulator("post", "/internal/runs", { idempotencyKey: key, ...bench.open }).expect(201),
    );

    await simulator("post", `/internal/runs/${run.id}/stage-transitions`, {
      idempotencyKey: `${key}-implement`,
      stageKey: "implement",
      status: "active",
    }).expect(200);

    return run.id;
  }

  /** Report a change-set touching the protected path; answer AP.3's latest allowed_paths verdict. */
  async function touch(run: string, key: string): Promise<string | undefined> {
    await simulator("put", `/internal/runs/${run}/files`, {
      idempotencyKey: key,
      files: [{ path: PROTECTED, status: "modified", additions: 2, deletions: 1 }],
    }).expect(200);

    const { rows } = await api.sql.query<{ verdict: string }>(
      `select verdict from ${SCHEMA_NAME}.v_run_guardrails_latest
        where run_id = $1 and "check" = 'allowed_paths'`,
      [run],
    );

    return rows[0]?.verdict;
  }

  /** A grant's consumption. */
  async function grant(id: string) {
    const { rows } = await api.sql.query<{
      used_at: Date | null;
      used_by_evaluation: string | null;
      revoked_at: Date | null;
      granted_via: string;
    }>(
      `select used_at, used_by_evaluation, revoked_at, granted_via
         from ${SCHEMA_NAME}.guardrail_exceptions where id = $1`,
      [id],
    );

    return rows[0];
  }

  it("is scoped to one run: a second run touching the same path stays blocked", async () => {
    const { bench } = await protectedBench();
    const first = await implementing(bench, "open-1");
    const second = await implementing(bench, "open-2");
    const planted = await plantGrant(api, {
      organizationId: bench.workspace.id,
      runId: first,
      pathGlob: PROTECTED,
    });

    expect(await touch(second, "second-1")).toBe("fail");
    expect((await grant(planted.grantId))?.used_at).toBeNull();

    expect(await touch(first, "first-1")).toBe("pass");
    expect((await grant(planted.grantId))?.used_at).not.toBeNull();
  });

  it("is single-use: the first evaluation spends it, the next report fails again", async () => {
    const { bench } = await protectedBench();
    const run = await implementing(bench, "open");
    const planted = await plantGrant(api, {
      organizationId: bench.workspace.id,
      runId: run,
      pathGlob: PROTECTED,
    });

    expect(await touch(run, "files-1")).toBe("pass");
    expect(await touch(run, "files-2")).toBe("fail");

    const evaluations = await api.sql.query<{ id: string; verdict: string }>(
      `select id, verdict from ${SCHEMA_NAME}.guardrail_evaluations
        where run_id = $1 and "check" = 'allowed_paths' order by change_set_seq`,
      [run],
    );

    expect(evaluations.rows.map((row) => row.verdict)).toEqual(["pass", "fail"]);
    expect((await grant(planted.grantId))?.used_by_evaluation).toBe(evaluations.rows[0]?.id);
  });

  it("expires: a lapsed grant permits nothing and is never consumed", async () => {
    const { bench } = await protectedBench();
    const run = await implementing(bench, "open");
    const planted = await plantGrant(api, {
      organizationId: bench.workspace.id,
      runId: run,
      pathGlob: PROTECTED,
    });

    // What was granted never changes (V096), so the clock is moved under the row, as no
    // application path could.
    await api.sql.query(
      `alter table ${SCHEMA_NAME}.guardrail_exceptions disable trigger guardrail_exceptions_history;
       update ${SCHEMA_NAME}.guardrail_exceptions
          set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
        where id = '${planted.grantId}';
       alter table ${SCHEMA_NAME}.guardrail_exceptions enable trigger guardrail_exceptions_history;`,
    );

    expect(await touch(run, "files-1")).toBe("fail");
    expect((await grant(planted.grantId))?.used_at).toBeNull();
  });

  it("can be revoked before use, after which it permits nothing", async () => {
    const { owner, bench } = await protectedBench();
    const run = await implementing(bench, "open");
    const planted = await plantGrant(api, {
      organizationId: bench.workspace.id,
      runId: run,
      pathGlob: PROTECTED,
    });

    await api.sql.query(
      `update ${SCHEMA_NAME}.guardrail_exceptions set revoked_at = now(), revoked_by = $2 where id = $1`,
      [planted.grantId, owner.id],
    );

    expect(await touch(run, "files-1")).toBe("fail");
    expect(await grant(planted.grantId)).toMatchObject({ used_at: null });
    expect((await grant(planted.grantId))?.revoked_at).not.toBeNull();
  });

  it("keeps the audit chain card → grant → consumption → receipt", async () => {
    const { owner, bench } = await protectedBench();
    const run = await implementing(bench, "open");

    expect(await touch(run, "files-1")).toBe("fail");

    const card = (
      await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.decision_items
          where organization_id = $1 and kind_id = 'protected_path_allow_once'`,
        [bench.workspace.id],
      )
    ).rows[0]?.id;
    const answer = bodyOf<ActionResultResource>(
      await api
        .as(owner)("post", `/api/v1/inbox/items/${card ?? ""}/actions/allow_once`)
        .set(TENANT_HEADER, bench.workspace.slug)
        .send({})
        .expect(200),
    );
    const outcome = answer.resolution.outcome as Record<string, string>;
    const spent = await grant(outcome.exception_id);
    const evaluation = await api.sql.query<{ run_id: string; check: string; verdict: string }>(
      `select run_id, "check", verdict from ${SCHEMA_NAME}.guardrail_evaluations where id = $1`,
      [spent?.used_by_evaluation],
    );
    const audited = await api.sql.query<{ detail: Record<string, unknown> }>(
      `select detail from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = 'decision.answered' and subject_id = $2`,
      [bench.workspace.id, card],
    );

    expect(spent?.granted_via).toBe(card);
    expect(evaluation.rows[0]).toEqual({ run_id: run, check: "allowed_paths", verdict: "pass" });
    expect(audited.rows[0]?.detail).toMatchObject({
      action: "allow_once",
      outcome_exception_id: outcome.exception_id,
      outcome_evaluation_id: spent?.used_by_evaluation,
    });
  });
});
