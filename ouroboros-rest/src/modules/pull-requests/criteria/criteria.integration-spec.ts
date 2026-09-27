import { ApiHarness, type Person } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { AuditService } from "../../audit/audit.service";
import { SCHEMA_NAME } from "../../db/schema";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { seedIngestBench, type IngestBench } from "../../ingest/ingest.fixture";
import type { RunOpenedResource } from "../../ingest/ingest.resources";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { fixtureFile } from "../../test-results/test-results.fixture";
import { TestResultIngestService } from "../../test-results/test-results.service";
import { FIRST_PUSH } from "../../ticket-sources/conformance.pr.fixture";
import {
  IN_MEMORY_DEFAULT_BRANCH,
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
import { PrMirrorRepository } from "../pr-sync.repository";
import { PrSyncService } from "../pr-sync.service";
import { CRITERIA_ERRORS } from "./criteria.errors";
import { CriteriaRepository } from "./criteria.repository";
import type { CriteriaMatrixResource } from "./criteria.resources";
import { CriteriaService, type CriteriaActor } from "./criteria.service";

/**
 * **The criteria & evidence service against a migrated database** — AX.3
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)), one case per acceptance criterion.
 *
 * What only this scale proves: V057 accepts what the service resolves (its foreign keys and
 * `pr_criteria_evidence_resolves` agree with the service's lookups, and verified-needs-evidence
 * holds), V062 records the annotation, the audit trail carries the person, and the plan import
 * reads a pushed draft's body.
 *
 * The host is the in-memory git host — the SPI's fake — so the re-waive is counted on the host's
 * own ledger. The GitHub round trip of the same comment surface is
 * `ticket-sources/providers/github.pr.integration-spec.ts`'s, against the sandbox repository.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/pull-requests/criteria
 * ```
 */

/** The PR's two revisions' snapshots. */
const REV_1_FILES = [{ path: "drivers/can/isr_fastpath.c", additions: 3, deletions: 1 }];
const REV_2_FILES = [
  { path: "drivers/can/isr_fastpath.c", additions: 3, deletions: 1 },
  { path: "drivers/can/telemetry_buf.c", additions: 40, deletions: 12 },
];

/** #482's plan, as the pushed draft's body. */
const PLAN_BODY = [
  "- Decouple PID sampling from the telemetry drain",
  "",
  "## Acceptance criteria",
  "- [ ] Telemetry frames must arrive in ISR order under load",
  "- [ ] No regression in e-stop response envelope",
  "- [ ] Flake must not reappear across temperature range",
].join("\n");

describe("the criteria & evidence service, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Everything a case starts from. */
  interface Scene {
    readonly owner: Person;
    readonly actor: CriteriaActor;
    readonly bench: IngestBench;
    readonly org: string;
    readonly prId: string;
    readonly ticketId: string;
    readonly rev1: string;
    readonly rev2: string;
    readonly testRunId: string;
    /** A HIL case of Build 1, and one of its measurements. */
    readonly caseKey: string;
    readonly measurementId: string;
    readonly artifactId: string;
    readonly host: InMemoryPrHost;
    readonly service: CriteriaService;
  }

  /** The one row a statement returns. */
  async function one<T extends object>(text: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query<T>(text, values);

    return rows[0];
  }

  /**
   * Run #482 opened by the executor; a git-host source on the in-memory host in the same
   * workspace; PR #n on it, opened by the run and closing #482, with two revisions; Build 1's rig
   * results parsed; one uploaded artifact; and a service whose host surface is the fake.
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
    const ticket = await one<{ id: string }>(
      `select id from ${SCHEMA_NAME}.tickets where organization_id = $1 and source_id = $2`,
      [org, bench.source],
    );

    // The git host — the in-memory one, with its credential sealed as the vault binds it.
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

    const host = new InMemoryPrHost();

    host.push("loop/482-canbus-flake", FIRST_PUSH);

    const opened = host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
      branch: "loop/482-canbus-flake",
      base: IN_MEMORY_DEFAULT_BRANCH,
      title: "can: fix flaky telemetry frame order under ISR load",
      body: null,
    });
    const pr = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pull_requests
              (organization_id, source_id, external_number, external_url, title, head_branch,
               base_branch, state, run_id, ticket_id)
       values ($1, $2, $3, $4, 'can: fix flaky telemetry frame order under ISR load',
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
    const revision = (seq: number, head: string, files: unknown) =>
      one<{ id: string }>(
        `insert into ${SCHEMA_NAME}.pr_revisions (pr_id, revision_seq, head_sha, pushed_at, files)
         values ($1, $2, $3, now(), $4::jsonb) returning id`,
        [pr.id, seq, head, JSON.stringify(files)],
      );
    const rev1 = await revision(1, "3f9c2ae0", REV_1_FILES);
    const rev2 = await revision(2, "b7e41d0a", REV_2_FILES);

    const attempt = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_runs (organization_id, run_id, attempt_seq, commit_sha, status)
       values ($1, $2, 1, 'b7e41d0', 'complete') returning id`,
      [org, run.id],
    );

    await api.nest.get(TestResultIngestService).parseAttempt({
      organizationId: org,
      testRunId: attempt.id,
      files: [fixtureFile("hil-valid.json")],
    });

    const measured = await one<{ case_key: string; measurement_id: string }>(
      `select c.case_key, m.id as measurement_id
         from ${SCHEMA_NAME}.hil_measurements m
         join ${SCHEMA_NAME}.test_cases c on c.id = m.test_case_id
        where m.organization_id = $1 and c.status <> 'skipped'
        order by c.name, m.metric limit 1`,
      [org],
    );
    const artifact = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_artifacts
              (organization_id, test_run_id, name, kind, size_bytes, storage_ref, checksum,
               retained_until)
       values ($1, $2, 'rig-trace.pcap', 'capture', 1024,
               '{"driver": "local", "key": "rig-trace.pcap"}'::jsonb, $3,
               now() + interval '30 days')
       returning id`,
      [org, attempt.id, `sha256:${"a".repeat(64)}`],
    );

    const service = new CriteriaService(
      api.nest.get(CriteriaRepository),
      new PrSyncService(
        api.nest.get(PrMirrorRepository),
        new TicketSourceRegistry([new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host)]),
        api.nest.get(TicketSourcesService),
      ),
      api.nest.get(AuditService),
    );

    return {
      owner,
      actor: { id: owner.id, name: owner.displayName },
      bench,
      org,
      prId: pr.id,
      ticketId: ticket.id,
      rev1: rev1.id,
      rev2: rev2.id,
      testRunId: attempt.id,
      caseKey: measured.case_key,
      measurementId: measured.measurement_id,
      artifactId: artifact.id,
      host,
      service,
    };
  }

  /**
   * The code a refused call answered with.
   *
   * @param promise - The call.
   * @returns The domain error's code, or `accepted`.
   */
  async function code(promise: Promise<unknown>): Promise<string> {
    return promise.then(
      () => "accepted",
      (error: unknown) => (error as { code?: string }).code ?? String(error),
    );
  }

  it("runs the full lifecycle: create → attach evidence → verify → waive, audited", async () => {
    const at = await scene();
    const { service, org, prId, actor } = at;
    const claim = await service.create(org, prId, actor, {
      claim: "Telemetry frames must arrive in ISR order under load",
    });

    await service.attach(org, prId, claim.id, {
      kind: "test_case",
      caseKey: at.caseKey,
      note: "10⁶ frames, 0 reordered",
    });
    await service.attach(org, prId, claim.id, {
      kind: "hil_measurement",
      hilMeasurementId: at.measurementId,
    });
    await service.attach(org, prId, claim.id, {
      kind: "hunk",
      path: "drivers/can/telemetry_buf.c",
      lineStart: 41,
      lineEnd: 66,
    });
    await service.attach(org, prId, claim.id, {
      kind: "build_artifact",
      testArtifactId: at.artifactId,
    });

    const cited = await service.attach(org, prId, claim.id, {
      kind: "analysis_note",
      revisionId: at.rev1,
      note: "static K_MSGQ_DEFINE · stack analysis clean",
    });

    expect(cited.evidence.map((line) => line.kind)).toEqual([
      "test_case",
      "hil_measurement",
      "hunk",
      "build_artifact",
      "analysis_note",
    ]);
    expect(cited.evidence[2]).toMatchObject({
      displayText: "hunk telemetry_buf.c:41–66",
      ref: { revisionId: at.rev2, path: "drivers/can/telemetry_buf.c", lineStart: 41, lineEnd: 66 },
    });
    expect(cited.evidence[0].displayText).toMatch(/\(10⁶ frames, 0 reordered\)$/);
    expect(cited.evidence[1].displayText).toMatch(/^HIL /);
    expect(cited.evidence[3].displayText).toBe("artifact rig-trace.pcap");

    expect((await service.verify(org, prId, claim.id, actor)).status).toBe("verified");

    const waived = await service.waive(org, prId, claim.id, actor, {
      reason: "rig runs at 22°C only — thermal chamber not in bench",
    });

    expect(waived.annotation).toEqual({ state: "annotated", mode: "created", error: null });
    expect(waived.criterion.waiver?.annotation.url).toMatch(/#comment-/);

    const stored = await one<{ status: string; annotation_state: string; author: string }>(
      `select c.status, w.annotation_state, w.author
         from ${SCHEMA_NAME}.pr_criteria c
         join ${SCHEMA_NAME}.pr_waivers w on w.id = c.waiver_ref
        where c.id = $1`,
      [claim.id],
    );

    expect(stored).toEqual({ status: "waived", annotation_state: "annotated", author: actor.id });

    const { rows: trail } = await api.sql.query<{ action: string; actor_id: string }>(
      `select action, actor_id from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and subject_type = 'pr_criterion' order by occurred_at, action`,
      [org],
    );

    expect(trail).toEqual([
      { action: "pr_criterion.verified", actor_id: actor.id },
      { action: "pr_criterion.waived", actor_id: actor.id },
    ]);
  });

  it("re-waiving edits the existing comment rather than posting a second one", async () => {
    const at = await scene();
    const { service, org, prId, actor } = at;
    const { id } = await service.create(org, prId, actor, {
      claim: "Flake must not reappear across temperature range",
    });
    const first = await service.waive(org, prId, id, actor, { reason: "chamber down" });
    const second = await service.waive(org, prId, id, actor, {
      reason: "rig runs at 22°C only — thermal chamber not in bench",
    });

    expect(second.annotation.mode).toBe("edited");
    expect(at.host.ledger().comments).toHaveLength(1);
    expect(at.host.ledger().comments[0][2]).toContain("thermal chamber not in bench");

    const { rows } = await api.sql.query<{ annotation_comment_id: string; reason: string }>(
      `select annotation_comment_id, reason from ${SCHEMA_NAME}.pr_waivers
        where organization_id = $1 order by created_at`,
      [org],
    );

    expect(rows.map((row) => row.annotation_comment_id)).toEqual([
      first.criterion.waiver?.annotation.commentId,
      first.criterion.waiver?.annotation.commentId,
    ]);
    expect(second.criterion.waiver?.id).not.toBe(first.criterion.waiver?.id);
  });

  it("rejects a dangling reference for every kind, and a hunk outside the snapshot", async () => {
    const at = await scene();
    const { service, org, prId, actor } = at;
    const { id } = await service.create(org, prId, actor, { claim: "A claim" });
    const missing = "00000000-0000-4000-8000-000000000000";

    expect(
      await Promise.all([
        code(service.attach(org, prId, id, { kind: "test_case", caseKey: "d".repeat(64) })),
        code(service.attach(org, prId, id, { kind: "hil_measurement", hilMeasurementId: missing })),
        code(service.attach(org, prId, id, { kind: "build_artifact", testArtifactId: missing })),
        code(
          service.attach(org, prId, id, {
            kind: "hunk",
            revisionId: missing,
            path: "drivers/can/telemetry_buf.c",
            lineStart: 1,
            lineEnd: 2,
          }),
        ),
        code(
          service.attach(org, prId, id, { kind: "analysis_note", revisionId: missing, note: "x" }),
        ),
        code(
          service.attach(org, prId, id, {
            kind: "hunk",
            revisionId: at.rev1,
            path: "drivers/can/telemetry_buf.c",
            lineStart: 41,
            lineEnd: 66,
          }),
        ),
      ]),
    ).toEqual([
      ...Array<string>(5).fill(CRITERIA_ERRORS.evidenceUnresolved),
      CRITERIA_ERRORS.hunkOutsideSnapshot,
    ]);

    const { rows } = await api.sql.query(
      `select 1 from ${SCHEMA_NAME}.pr_criteria_evidence where criterion_id = $1`,
      [id],
    );

    expect(rows).toEqual([]);
  });

  it("holds evidence to the PR's own run — another run's case does not resolve", async () => {
    const at = await scene();
    const { service, org, prId, actor } = at;
    const { id } = await service.create(org, prId, actor, { claim: "A claim" });

    await api.sql.query(`update ${SCHEMA_NAME}.pull_requests set run_id = null where id = $1`, [
      prId,
    ]);

    expect(
      await code(service.attach(org, prId, id, { kind: "test_case", caseKey: at.caseKey })),
    ).toBe(CRITERIA_ERRORS.evidenceUnresolved);
  });

  it("cannot verify a criterion with no evidence, and demotes one whose last evidence goes", async () => {
    const at = await scene();
    const { service, org, prId, actor } = at;
    const { id } = await service.create(org, prId, actor, { claim: "Zero heap allocation" });

    expect(await code(service.verify(org, prId, id, actor))).toBe(
      CRITERIA_ERRORS.criterionEvidenceRequired,
    );

    const cited = await service.attach(org, prId, id, { kind: "analysis_note", note: "clean" });

    await service.verify(org, prId, id, actor);

    expect((await service.detach(org, prId, id, cited.evidence[0].id)).status).toBe("unverified");
  });

  it("imports the plan's criteria from seeded planning context, as plan rows", async () => {
    const at = await scene();
    const { service, org, prId, actor } = at;

    expect(await code(service.importPlan(org, prId, actor))).toBe(
      CRITERIA_ERRORS.planContextMissing,
    );

    const batch = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.draft_batches
              (organization_id, source_prompt, planner, target_source_id, status)
       values ($1, 'Fix the flaky CAN-bus telemetry test.', 'outline-v0', $2, 'pushed')
       returning id`,
      [org, at.bench.source],
    );

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.ticket_drafts
              (batch_id, local_key, title, body, push_state, pushed_ticket_id)
       values ($1, 'CAN-1', 'Fix flaky CAN-bus telemetry test', $2, 'pushed', $3)`,
      [batch.id, PLAN_BODY, at.ticketId],
    );

    const imported = await service.importPlan(org, prId, actor);
    const again = await service.importPlan(org, prId, actor);

    expect(imported.imported.map((row) => [row.claim, row.source])).toEqual([
      ["Telemetry frames must arrive in ISR order under load", "plan"],
      ["No regression in e-stop response envelope", "plan"],
      ["Flake must not reappear across temperature range", "plan"],
    ]);
    expect(again.imported).toEqual([]);
    expect(again.alreadyPresent).toHaveLength(3);
  });

  it("rejects extracted provenance in the MVP", async () => {
    const at = await scene();

    expect(
      await code(
        at.service.create(at.org, at.prId, at.actor, { claim: "A claim", source: "extracted" }),
      ),
    ).toBe(CRITERIA_ERRORS.criterionSourceInvalid);
  });

  describe("over HTTP", () => {
    /** Call the public API as somebody, in the scene's workspace. */
    function as(person: Person, at: Scene, method: "get" | "post" | "put", path: string) {
      return api.as(person)(method, path).set(TENANT_HEADER, at.bench.workspace.slug);
    }

    it("lets a member author, cite and verify, a viewer read, and only an admin waive", async () => {
      const at = await scene();
      const member = await api.signUp();
      const viewer = await api.signUp();

      await api.join(at.org, member, "member");
      await api.join(at.org, viewer, "viewer");

      const base = `/api/v1/pull-requests/${at.prId}/criteria`;
      const created = bodyOf<{ id: string }>(
        await as(member, at, "post", base).send({ claim: "Zero heap allocation" }).expect(201),
      );

      await as(member, at, "post", `${base}/${created.id}/verify`)
        .expect(409)
        .expect((response) => {
          expect((response.body as { code: string }).code).toBe(
            CRITERIA_ERRORS.criterionEvidenceRequired,
          );
        });
      await as(member, at, "post", `${base}/${created.id}/evidence`)
        .send({ kind: "analysis_note", note: "static K_MSGQ_DEFINE · stack analysis clean" })
        .expect(201);
      await as(member, at, "post", `${base}/${created.id}/verify`).expect(200);
      await as(viewer, at, "post", base).send({ claim: "Nope" }).expect(403);
      await as(member, at, "post", `${base}/${created.id}/waive`)
        .send({ reason: "chamber down" })
        .expect(403);
      await as(at.owner, at, "post", `${base}/${created.id}/waive`)
        .send({ reason: "chamber down" })
        .expect(201);

      const matrix = bodyOf<CriteriaMatrixResource>(await as(viewer, at, "get", base).expect(200));

      expect(matrix.counts).toEqual({ total: 1, verified: 0, waived: 1, unverified: 0 });
      expect(matrix.criteria[0].waiver?.annotation.state).toBe("failed");
    });
  });
});
