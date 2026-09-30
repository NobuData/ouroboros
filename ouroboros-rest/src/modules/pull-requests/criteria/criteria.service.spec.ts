import type { AuditService } from "../../audit/audit.service";
import type { AuditRecord } from "../../audit/audit.events";
import type {
  NewPrCriterionEvidence,
  PrCriterion,
  PrCriterionEvidence,
  PrCriterionStatus,
  PrWaiver,
} from "../../db/schema";
import { DomainError } from "../../errors/error.envelope";
import { FIRST_PUSH } from "../../ticket-sources/conformance.pr.fixture";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
} from "../../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
} from "../../ticket-sources/providers/in-memory.provider.fixture";
import { TicketSourceError } from "../../ticket-sources/ticket-source.errors";
import type { TicketSyncContext } from "../../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../../ticket-sources/ticket-source.registry";
import type { SyncSource } from "../../ticket-sources/ticket-sources.repository";
import type { PrMirrorStore } from "../pr-sync.repository";
import { PrSyncService, type PrSourceOpener } from "../pr-sync.service";
import type { FactSourceObserver } from "../../fact-proposers/proposers.observer";
import { waiverAnnotationKey } from "./criteria.annotation";
import type { AttachEvidenceDto } from "./criteria.dto";
import { CRITERIA_ERRORS } from "./criteria.errors";
import type {
  CriteriaPrRow,
  CriteriaRepository,
  NewCriterionRow,
  PlanDraftRow,
  ResolvedArtifact,
  ResolvedCase,
  ResolvedMeasurement,
  ResolvedRevision,
  WaiveWrite,
} from "./criteria.repository";
import { CriteriaService, annotationError, type CriteriaActor } from "./criteria.service";

/**
 * The criteria & evidence service (#359) over an in-memory store and the in-memory git host — the
 * rules it applies before any statement, and what it asks the store and the host. The statements
 * themselves, and V057/V062's own refusals, are `criteria.integration-spec.ts`'s.
 */

const ORG = "org-359";
const SOURCE_ID = "b0590000-0000-4000-8000-000000000359";
const PR_ID = "5eed003a-0000-4000-8000-000000000514";
const RUN_ID = "5eed0012-0000-4000-8000-000000000482";
const TICKET_ID = "5eed0010-0000-4000-8000-000000000482";
const REV_1 = "5eed003b-0000-4000-8000-000000005141";
const REV_2 = "5eed003b-0000-4000-8000-000000005142";
const CASE_KEY = "c".repeat(64);
const KEN: CriteriaActor = { id: "user-ken", name: "Ken S" };

/** The source the PR lives on. */
const SOURCE: SyncSource = {
  sourceId: SOURCE_ID,
  organizationId: ORG,
  kind: "custom",
  displayName: "Sandbox host",
  config: { project: IN_MEMORY_PROJECT },
  cursor: null,
  syncedAt: null,
};

/** A store holding rows in memory, answering the service's reads the way the statements would. */
class MemoryStore {
  prs = new Map<string, CriteriaPrRow>();
  rows: PrCriterion[] = [];
  lines: PrCriterionEvidence[] = [];
  waiverRows: PrWaiver[] = [];
  cases: (ResolvedCase & { key: string })[] = [];
  measurements: ResolvedMeasurement[] = [];
  artifacts: ResolvedArtifact[] = [];
  revisions: ResolvedRevision[] = [];
  draft: PlanDraftRow | undefined;
  /** What the next evidence insert throws, once. */
  insertFailure: Error | undefined = undefined;
  private ids = 0;

  /** @returns A fresh id. */
  private id(): string {
    this.ids += 1;
    return `00000000-0000-4000-8000-${String(this.ids).padStart(12, "0")}`;
  }

  pr(organizationId: string, prId: string): Promise<CriteriaPrRow | undefined> {
    const pr = this.prs.get(prId);
    return Promise.resolve(pr?.organization_id === organizationId ? pr : undefined);
  }

  criteria(prId: string): Promise<PrCriterion[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.pr_id === prId).sort((a, b) => a.sort_order - b.sort_order),
    );
  }

  criterion(prId: string, criterionId: string): Promise<PrCriterion | undefined> {
    return Promise.resolve(this.rows.find((row) => row.pr_id === prId && row.id === criterionId));
  }

  evidence(criterionIds: readonly string[]): Promise<PrCriterionEvidence[]> {
    return Promise.resolve(this.lines.filter((line) => criterionIds.includes(line.criterion_id)));
  }

  waivers(ids: readonly string[]): Promise<PrWaiver[]> {
    return Promise.resolve(this.waiverRows.filter((row) => ids.includes(row.id)));
  }

  insertCriteria(prId: string, rows: readonly NewCriterionRow[]): Promise<PrCriterion[]> {
    const next = Math.max(-1, ...this.rows.map((row) => row.sort_order)) + 1;
    const written: PrCriterion[] = rows.map((row, index) => ({
      id: this.id(),
      pr_id: prId,
      claim: row.claim,
      source: row.source,
      status: "unverified",
      waiver_ref: null,
      sort_order: next + index,
      created_by: row.createdBy,
      created_at: new Date(),
      updated_at: new Date(),
    }));

    this.rows.push(...written);
    return Promise.resolve(written);
  }

  updateClaim(criterionId: string, claim: string): Promise<PrCriterion> {
    return Promise.resolve(this.patch(criterionId, { claim }));
  }

  deleteCriterion(criterionId: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== criterionId);
    this.lines = this.lines.filter((line) => line.criterion_id !== criterionId);
    return Promise.resolve();
  }

  reorder(_prId: string, ids: readonly string[]): Promise<void> {
    ids.forEach((id, index) => this.patch(id, { sort_order: index }));
    return Promise.resolve();
  }

  caseByKey(
    _org: string,
    _run: string,
    key: string,
    testRunId: string | null,
  ): Promise<ResolvedCase | undefined> {
    return Promise.resolve(
      this.cases
        .filter((row) => row.key === key && (testRunId === null || row.test_run_id === testRunId))
        .sort((a, b) => b.attempt_seq - a.attempt_seq)[0],
    );
  }

  measurement(_org: string, _run: string, id: string): Promise<ResolvedMeasurement | undefined> {
    return Promise.resolve(this.measurements.find((row) => row.id === id));
  }

  artifact(_org: string, _run: string, id: string): Promise<ResolvedArtifact | undefined> {
    return Promise.resolve(this.artifacts.find((row) => row.id === id));
  }

  revision(_prId: string, revisionId: string | null): Promise<ResolvedRevision | undefined> {
    const sorted = [...this.revisions].sort((a, b) => b.revision_seq - a.revision_seq);
    return Promise.resolve(
      revisionId === null ? sorted[0] : sorted.find((row) => row.id === revisionId),
    );
  }

  insertEvidence(row: NewPrCriterionEvidence): Promise<PrCriterionEvidence> {
    if (this.insertFailure !== undefined) {
      const failure = this.insertFailure;

      this.insertFailure = undefined;
      return Promise.reject(failure);
    }

    const line: PrCriterionEvidence = {
      id: this.id(),
      criterion_id: row.criterion_id,
      kind: row.kind,
      test_case_id: row.test_case_id ?? null,
      hil_measurement_id: row.hil_measurement_id ?? null,
      test_artifact_id: row.test_artifact_id ?? null,
      revision_id: row.revision_id ?? null,
      hunk_path: row.hunk_path ?? null,
      hunk_line_start: row.hunk_line_start ?? null,
      hunk_line_end: row.hunk_line_end ?? null,
      display_text: row.display_text,
      created_at: new Date(),
    };

    this.lines.push(line);
    return Promise.resolve(line);
  }

  deleteEvidence(criterionId: string, evidenceId: string): Promise<boolean> {
    const before = this.lines.length;

    this.lines = this.lines.filter(
      (line) => !(line.criterion_id === criterionId && line.id === evidenceId),
    );

    // V057's demotion.
    const criterion = this.rows.find((row) => row.id === criterionId);

    if (
      criterion?.status === "verified" &&
      !this.lines.some((line) => line.criterion_id === criterionId)
    ) {
      this.patch(criterionId, { status: "unverified" });
    }

    return Promise.resolve(this.lines.length < before);
  }

  setStatus(
    criterionId: string,
    from: PrCriterionStatus,
    to: "verified" | "unverified",
  ): Promise<PrCriterion | undefined> {
    const row = this.rows.find((candidate) => candidate.id === criterionId);

    return Promise.resolve(
      row?.status === from ? this.patch(criterionId, { status: to }) : undefined,
    );
  }

  planDraft(): Promise<PlanDraftRow | undefined> {
    return Promise.resolve(this.draft);
  }

  waive(
    organizationId: string,
    runId: string,
    criterionId: string,
    author: string,
    reason: string,
  ): Promise<WaiveWrite> {
    const previous = this.rows.find((row) => row.id === criterionId)?.status ?? "unverified";
    const waiver: PrWaiver = {
      id: this.id(),
      organization_id: organizationId,
      run_id: runId,
      author,
      reason,
      case_keys: [],
      annotation_state: "pending_pr_plane",
      annotation_comment_id: null,
      annotation_url: null,
      annotated_at: null,
      created_at: new Date(),
    };

    this.waiverRows.push(waiver);

    return Promise.resolve({
      criterion: this.patch(criterionId, { status: "waived", waiver_ref: waiver.id }),
      waiver,
      previous,
    });
  }

  markAnnotated(id: string, commentId: string, url: string | null, at: Date): Promise<PrWaiver> {
    return Promise.resolve(
      this.patchWaiver(id, {
        annotation_state: "annotated",
        annotation_comment_id: commentId,
        annotation_url: url,
        annotated_at: at,
      }),
    );
  }

  markAnnotationFailed(id: string): Promise<PrWaiver> {
    return Promise.resolve(this.patchWaiver(id, { annotation_state: "failed" }));
  }

  /**
   * @param id - A criterion.
   * @param change - What to set.
   * @returns The criterion, changed.
   */
  patch(id: string, change: Partial<PrCriterion>): PrCriterion {
    const index = this.rows.findIndex((row) => row.id === id);
    const row = { ...this.rows[index], ...change, updated_at: new Date() };

    this.rows[index] = row;
    return row;
  }

  /**
   * @param id - A waiver.
   * @param change - What to set.
   * @returns The waiver, changed.
   */
  private patchWaiver(id: string, change: Partial<PrWaiver>): PrWaiver {
    const index = this.waiverRows.findIndex((row) => row.id === id);
    const row = { ...this.waiverRows[index], ...change };

    this.waiverRows[index] = row;
    return row;
  }
}

/** Hands the provider the fake's token. */
const OPENER: PrSourceOpener = {
  withCredentials<T>(source: SyncSource, run: (context: TicketSyncContext) => Promise<T>) {
    return run({
      sourceId: source.sourceId,
      organizationId: source.organizationId,
      config: source.config,
      credentials: IN_MEMORY_TOKEN,
    });
  },
};

/** The mirror's store — only `source` is read, by the comment surface. */
const MIRROR: PrMirrorStore = {
  source: (org, id) => Promise.resolve(org === ORG && id === SOURCE_ID ? SOURCE : undefined),
  mirrored: () => Promise.resolve(undefined),
  applySync: () => Promise.reject(new Error("the criteria service never syncs")),
};

/**
 * The service over a store holding PR #514 (opened by run #482, on the fake host) with two
 * revisions, and the audit trail it writes.
 *
 * @param factSources - BF.3's source observer (#412), when a case listens for it.
 * @returns Everything a case needs.
 */
function build(factSources?: FactSourceObserver) {
  const store = new MemoryStore();
  const host = new InMemoryPrHost();
  const audit: AuditRecord[] = [];

  host.push("loop/482-canbus-flake", FIRST_PUSH);

  const prNumber = host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
    branch: "loop/482-canbus-flake",
    base: IN_MEMORY_DEFAULT_BRANCH,
    title: "can: fix flaky telemetry frame order under ISR load",
    body: null,
  }).number;

  store.prs.set(PR_ID, {
    id: PR_ID,
    organization_id: ORG,
    source_id: SOURCE_ID,
    external_number: prNumber,
    run_id: RUN_ID,
    ticket_id: TICKET_ID,
  });
  store.revisions.push(
    { id: REV_1, revision_seq: 1, files: [{ path: "src/a.c", additions: 1, deletions: 0 }] },
    {
      id: REV_2,
      revision_seq: 2,
      files: [{ path: "drivers/can/telemetry_buf.c", additions: 40, deletions: 12 }],
    },
  );

  const sync = new PrSyncService(
    MIRROR,
    new TicketSourceRegistry([new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host)]),
    OPENER,
  );
  const auditService = {
    record: (event: AuditRecord) => {
      audit.push(event);
      return Promise.resolve("event-id");
    },
  } as unknown as AuditService;
  const service = new CriteriaService(
    store as unknown as CriteriaRepository,
    sync,
    auditService,
    factSources,
  );

  return { service, store, host, audit, prNumber };
}

/**
 * The refusal a promise rejected with.
 *
 * @param promise - The call.
 * @returns The domain error's code.
 */
async function code(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(error).toBeInstanceOf(DomainError);
  return (error as DomainError).code;
}

describe("CriteriaService", () => {
  it("runs the lifecycle: create → attach evidence → verify → waive, audited throughout", async () => {
    const { service, store, host, audit, prNumber } = build();

    store.cases.push({
      id: "case-4",
      key: CASE_KEY,
      name: "test_frame_order_under_load",
      status: "passed",
      test_run_id: "build-4",
      attempt_seq: 4,
    });

    const created = await service.create(ORG, PR_ID, KEN, {
      claim: "Telemetry frames must arrive in ISR order under load",
    });

    expect(created).toMatchObject({ source: "manual", status: "unverified", sortOrder: 0 });

    await service.attach(ORG, PR_ID, created.id, {
      kind: "test_case",
      caseKey: CASE_KEY,
      note: "10⁶ frames, 0 reordered",
    });

    const cited = await service.attach(ORG, PR_ID, created.id, {
      kind: "hunk",
      path: "drivers/can/telemetry_buf.c",
      lineStart: 41,
      lineEnd: 66,
    });

    expect(cited.evidence.map((line) => line.displayText)).toEqual([
      "test_frame_order_under_load (10⁶ frames, 0 reordered)",
      "hunk telemetry_buf.c:41–66",
    ]);
    expect(cited.evidence[1].ref).toMatchObject({ revisionId: REV_2, lineStart: 41, lineEnd: 66 });

    const verified = await service.verify(ORG, PR_ID, created.id, KEN);

    expect(verified.status).toBe("verified");

    const waived = await service.waive(ORG, PR_ID, created.id, KEN, {
      reason: "rig runs at 22°C only — thermal chamber not in bench",
    });

    expect(waived.criterion.status).toBe("waived");
    expect(waived.criterion.waiver).toMatchObject({
      reason: "rig runs at 22°C only — thermal chamber not in bench",
      author: KEN.id,
      annotation: { state: "annotated" },
    });
    expect(waived.criterion.waiver?.annotation.url).toMatch(
      new RegExp(`/pull/${String(prNumber)}#comment-`),
    );
    expect(waived.annotation).toEqual({ state: "annotated", mode: "created", error: null });

    const [comment] = host.ledger().comments;

    expect(comment[2]).toContain("> Telemetry frames must arrive in ISR order under load");
    expect(comment[2]).toContain("**Reason:** rig runs at 22°C only");
    expect(comment[2]).toContain("**Waived by:** Ken S");
    expect(comment[2]).toContain(waiverAnnotationKey(created.id));

    expect(audit.map((event) => [event.action, event.actorId, event.subjectType])).toEqual([
      ["pr_criterion.verified", KEN.id, "pr_criterion"],
      ["pr_criterion.waived", KEN.id, "pr_criterion"],
    ]);
    expect(audit[1].detail).toMatchObject({ from: "verified", annotation: "annotated" });
  });

  it("reports the waiver to BF.3's waiver proposer (#412) once it is recorded", async () => {
    const observer = { sourceWritten: jest.fn().mockResolvedValue(undefined) };
    const { service } = build(observer);
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "Flake must not reappear" });

    const waived = await service.waive(ORG, PR_ID, id, KEN, { reason: "thermal chamber down" });

    expect(observer.sourceWritten).toHaveBeenCalledWith(ORG, {
      kind: "waiver",
      id: waived.criterion.waiver?.id,
    });
  });

  it("re-waiving edits the existing comment rather than posting a second one", async () => {
    const { service, host } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "Flake must not reappear" });
    const first = await service.waive(ORG, PR_ID, id, KEN, { reason: "chamber down" });
    const second = await service.waive(ORG, PR_ID, id, KEN, { reason: "chamber still down" });

    expect(first.annotation.mode).toBe("created");
    expect(second.annotation.mode).toBe("edited");
    expect(second.criterion.waiver?.annotation.commentId).toBe(
      first.criterion.waiver?.annotation.commentId,
    );
    expect(second.criterion.waiver?.id).not.toBe(first.criterion.waiver?.id);
    expect(host.ledger().comments).toHaveLength(1);
    expect(host.ledger().comments[0][2]).toContain("chamber still down");
  });

  it("records a refused annotation as failed and answers it — the waiver is kept", async () => {
    const { service, store, host, audit } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "Flake must not reappear" });

    host.refuse("permission");

    const waived = await service.waive(ORG, PR_ID, id, KEN, { reason: "chamber down" });

    expect(waived.criterion.status).toBe("waived");
    expect(waived.annotation).toMatchObject({
      state: "failed",
      mode: null,
      error: { code: "host_permission" },
    });
    expect(store.waiverRows[0].annotation_state).toBe("failed");
    expect(audit[0].detail).toMatchObject({ annotation: "failed" });

    host.recover();

    const retried = await service.waive(ORG, PR_ID, id, KEN, { reason: "chamber down" });

    expect(retried.annotation).toMatchObject({ state: "annotated", mode: "created" });
  });

  it("refuses to verify with no evidence, and demotes when the last evidence goes", async () => {
    const { service, audit } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "Zero heap allocation" });

    expect(await code(service.verify(ORG, PR_ID, id, KEN))).toBe(
      CRITERIA_ERRORS.criterionEvidenceRequired,
    );

    const cited = await service.attach(ORG, PR_ID, id, {
      kind: "analysis_note",
      note: "static K_MSGQ_DEFINE · stack analysis clean",
    });

    expect(cited.evidence[0]).toMatchObject({
      kind: "analysis_note",
      displayText: "static K_MSGQ_DEFINE · stack analysis clean",
      ref: { revisionId: REV_2 },
    });

    await service.verify(ORG, PR_ID, id, KEN);

    const detached = await service.detach(ORG, PR_ID, id, cited.evidence[0].id);

    expect(detached.status).toBe("unverified");
    expect(audit.map((event) => event.action)).toEqual(["pr_criterion.verified"]);
  });

  it("verifies and unverifies idempotently, auditing only real changes", async () => {
    const { service, audit } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "Zero heap allocation" });

    await service.attach(ORG, PR_ID, id, { kind: "analysis_note", note: "clean" });
    await service.verify(ORG, PR_ID, id, KEN);
    await service.verify(ORG, PR_ID, id, KEN);
    await service.unverify(ORG, PR_ID, id, KEN);
    await service.unverify(ORG, PR_ID, id, KEN);

    expect(audit.map((event) => [event.action, event.detail])).toEqual([
      ["pr_criterion.verified", { pr_id: PR_ID, from: "unverified", evidence: 1 }],
      ["pr_criterion.unverified", { pr_id: PR_ID, from: "verified", evidence: 1 }],
    ]);
  });

  it("neither verifies nor unverifies a waived criterion", async () => {
    const { service } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "Flake must not reappear" });

    await service.attach(ORG, PR_ID, id, { kind: "analysis_note", note: "clean" });
    await service.waive(ORG, PR_ID, id, KEN, { reason: "chamber down" });

    expect(await code(service.verify(ORG, PR_ID, id, KEN))).toBe(CRITERIA_ERRORS.criterionWaived);
    expect(await code(service.unverify(ORG, PR_ID, id, KEN))).toBe(CRITERIA_ERRORS.criterionWaived);
  });

  describe("rejects a dangling reference for every kind, with a typed error", () => {
    const dangling: [string, AttachEvidenceDto][] = [
      ["test_case", { kind: "test_case", caseKey: "d".repeat(64) }],
      ["hil_measurement", { kind: "hil_measurement", hilMeasurementId: "m-missing" }],
      ["build_artifact", { kind: "build_artifact", testArtifactId: "a-missing" }],
      [
        "hunk",
        {
          kind: "hunk",
          revisionId: "r-missing",
          path: "drivers/can/telemetry_buf.c",
          lineStart: 1,
          lineEnd: 2,
        },
      ],
      ["analysis_note", { kind: "analysis_note", revisionId: "r-missing", note: "clean" }],
    ];

    it.each(dangling)("%s", async (kind, request) => {
      const { service, store } = build();
      const { id } = await service.create(ORG, PR_ID, KEN, { claim: "A claim" });
      const refused = await service.attach(ORG, PR_ID, id, request).catch((e: unknown) => e);

      expect((refused as DomainError).code).toBe(CRITERIA_ERRORS.evidenceUnresolved);
      expect((refused as DomainError).details).toMatchObject({ kind });
      expect(store.lines).toEqual([]);
    });
  });

  it("rejects a hunk outside the revision's files snapshot", async () => {
    const { service } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "A claim" });

    expect(
      await code(
        service.attach(ORG, PR_ID, id, {
          kind: "hunk",
          revisionId: REV_1,
          path: "drivers/can/telemetry_buf.c",
          lineStart: 41,
          lineEnd: 66,
        }),
      ),
    ).toBe(CRITERIA_ERRORS.hunkOutsideSnapshot);
    expect(
      await code(
        service.attach(ORG, PR_ID, id, {
          kind: "hunk",
          path: "drivers/can/telemetry_buf.c",
          lineStart: 66,
          lineEnd: 41,
        }),
      ),
    ).toBe(CRITERIA_ERRORS.evidenceUnresolved);
  });

  it("rejects a case that did not run, an expired artifact, and evidence on a PR with no run", async () => {
    const { service, store } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "A claim" });

    store.cases.push({
      id: "case-skip",
      key: CASE_KEY,
      name: "t",
      status: "skipped",
      test_run_id: "b",
      attempt_seq: 2,
    });
    store.artifacts.push({ id: "a-old", name: "trace.pcap", expired_at: new Date() });

    expect(
      await code(service.attach(ORG, PR_ID, id, { kind: "test_case", caseKey: CASE_KEY })),
    ).toBe(CRITERIA_ERRORS.evidenceUnresolved);
    expect(
      await code(
        service.attach(ORG, PR_ID, id, { kind: "build_artifact", testArtifactId: "a-old" }),
      ),
    ).toBe(CRITERIA_ERRORS.evidenceUnresolved);

    store.prs.set(PR_ID, { ...(store.prs.get(PR_ID) as CriteriaPrRow), run_id: null });
    store.cases[0] = { ...store.cases[0], status: "passed" };

    expect(
      await code(service.attach(ORG, PR_ID, id, { kind: "test_case", caseKey: CASE_KEY })),
    ).toBe(CRITERIA_ERRORS.evidenceUnresolved);
    expect(await code(service.waive(ORG, PR_ID, id, KEN, { reason: "x" }))).toBe(
      CRITERIA_ERRORS.criterionWaiverNeedsRun,
    );
  });

  it("composes the HIL and artifact lines from their rows", async () => {
    const { service, store } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "No regression" });

    store.measurements.push({
      id: "m-1",
      metric: "overshoot",
      value: "1.7",
      unit: "%",
      limit_value: "2.0",
      limit_kind: "max",
      context: "was 2.4% in build 3",
    });
    store.artifacts.push({ id: "a-1", name: "rig-trace.pcap", expired_at: null });

    await service.attach(ORG, PR_ID, id, { kind: "hil_measurement", hilMeasurementId: "m-1" });

    const cited = await service.attach(ORG, PR_ID, id, {
      kind: "build_artifact",
      testArtifactId: "a-1",
    });

    expect(cited.evidence.map((line) => line.displayText)).toEqual([
      "HIL overshoot 1.7% vs 2.0% limit (was 2.4% in build 3)",
      "artifact rig-trace.pcap",
    ]);
  });

  it("turns V057 refusing at insert into the same 422, and lets anything else through", async () => {
    const { service, store } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "A claim" });
    const note: AttachEvidenceDto = { kind: "analysis_note", note: "clean" };

    store.insertFailure = Object.assign(new Error("fk"), { code: "23503" });
    expect(await code(service.attach(ORG, PR_ID, id, note))).toBe(
      CRITERIA_ERRORS.evidenceUnresolved,
    );

    store.insertFailure = new Error("connection reset");
    await expect(service.attach(ORG, PR_ID, id, note)).rejects.toThrow("connection reset");
  });

  it("refuses extracted and plan provenance from authoring", async () => {
    const { service } = build();

    for (const source of ["extracted", "plan"] as const) {
      expect(await code(service.create(ORG, PR_ID, KEN, { claim: "A claim", source }))).toBe(
        CRITERIA_ERRORS.criterionSourceInvalid,
      );
    }
  });

  it("imports the plan's criteria as plan rows, once", async () => {
    const { service, store } = build();

    store.draft = {
      id: "draft-1",
      body: "## Acceptance criteria\n- [ ] Frames in ISR order\n- [ ] No e-stop regression",
    };
    await service.create(ORG, PR_ID, KEN, { claim: "No e-stop regression" });

    const first = await service.importPlan(ORG, PR_ID, KEN);
    const again = await service.importPlan(ORG, PR_ID, KEN);

    expect(first.imported.map((row) => [row.claim, row.source, row.createdBy])).toEqual([
      ["Frames in ISR order", "plan", KEN.id],
    ]);
    expect(first.alreadyPresent).toEqual(["No e-stop regression"]);
    expect(again.imported).toEqual([]);
    expect((await service.matrix(ORG, PR_ID)).counts.total).toBe(2);
  });

  it("says when there is no plan to import, or no criteria in it", async () => {
    const { service, store } = build();

    expect(await code(service.importPlan(ORG, PR_ID, KEN))).toBe(
      CRITERIA_ERRORS.planContextMissing,
    );

    store.draft = { id: "draft-1", body: "- Decouple PID sampling" };
    expect(await code(service.importPlan(ORG, PR_ID, KEN))).toBe(
      CRITERIA_ERRORS.planCriteriaMissing,
    );

    store.prs.set(PR_ID, { ...(store.prs.get(PR_ID) as CriteriaPrRow), ticket_id: null });
    expect(await code(service.importPlan(ORG, PR_ID, KEN))).toBe(
      CRITERIA_ERRORS.planContextMissing,
    );
  });

  it("says on the matrix whether there is a plan to import from", async () => {
    const { service, store } = build();

    expect((await service.matrix(ORG, PR_ID)).planContext).toBe(false);

    store.draft = { id: "draft-1", body: "## Acceptance criteria\n- [ ] Frames in ISR order" };
    expect((await service.matrix(ORG, PR_ID)).planContext).toBe(true);

    // A PR with no ticket has no plan, whatever drafts exist.
    store.prs.set(PR_ID, { ...(store.prs.get(PR_ID) as CriteriaPrRow), ticket_id: null });
    expect((await service.matrix(ORG, PR_ID)).planContext).toBe(false);
  });

  it("reorders only by a permutation of the PR's criteria", async () => {
    const { service } = build();
    const a = await service.create(ORG, PR_ID, KEN, { claim: "A" });
    const b = await service.create(ORG, PR_ID, KEN, { claim: "B" });

    const matrix = await service.reorder(ORG, PR_ID, { criterionIds: [b.id, a.id] });

    expect(matrix.criteria.map((row) => row.claim)).toEqual(["B", "A"]);

    for (const criterionIds of [[a.id], [a.id, a.id, b.id], [a.id, b.id, "x"]]) {
      expect(await code(service.reorder(ORG, PR_ID, { criterionIds }))).toBe(
        CRITERIA_ERRORS.criteriaOrderInvalid,
      );
    }
  });

  it("rewords and deletes a claim, and counts the matrix", async () => {
    const { service } = build();
    const a = await service.create(ORG, PR_ID, KEN, { claim: "A" });
    const b = await service.create(ORG, PR_ID, KEN, { claim: "B" });

    expect((await service.update(ORG, PR_ID, a.id, { claim: "A, reworded" })).claim).toBe(
      "A, reworded",
    );

    await service.waive(ORG, PR_ID, b.id, KEN, { reason: "chamber down" });

    expect((await service.matrix(ORG, PR_ID)).counts).toEqual({
      total: 2,
      verified: 0,
      waived: 1,
      unverified: 1,
    });

    await service.remove(ORG, PR_ID, a.id);

    expect((await service.matrix(ORG, PR_ID)).criteria.map((row) => row.claim)).toEqual(["B"]);
  });

  it("answers 404 for another workspace's PR, a criterion of another PR, or missing evidence", async () => {
    const { service } = build();
    const { id } = await service.create(ORG, PR_ID, KEN, { claim: "A" });

    expect(await code(service.matrix("org-other", PR_ID))).toBe(
      CRITERIA_ERRORS.pullRequestNotFound,
    );
    expect(await code(service.verify(ORG, PR_ID, "c-missing", KEN))).toBe(
      CRITERIA_ERRORS.criterionNotFound,
    );
    expect(await code(service.detach(ORG, PR_ID, id, "e-missing"))).toBe(
      CRITERIA_ERRORS.evidenceNotFound,
    );
  });
});

describe("annotationError", () => {
  it("classifies a host refusal, a domain refusal and anything else", () => {
    expect(annotationError(new TicketSourceError("rate_limit", "slow down"))).toMatchObject({
      code: "host_rate_limit",
    });
    expect(annotationError(new Error("boom"))).toEqual({
      code: "annotation_failed",
      message: "The annotation could not be posted.",
    });
  });
});
