import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import type { RunControlResource } from "../controls/controls.resources";
import type { ControlsService, Requester } from "../controls/controls.service";
import type { ClassificationReceipt } from "../db/schema";
import { ConflictError, DomainError } from "../errors/error.envelope";
import type { FarmJobsService } from "../farm/dispatch/jobs.service";
import type { BuildJobResource } from "../farm/dispatch/jobs.resources";
import type { ClassifyCaseDto } from "./triage.dto";
import type {
  AttemptRow,
  CaseRow,
  ClassificationRow,
  NewClassification,
  TriageRepository,
} from "./triage.repository";
import type { RoutingResource } from "./triage.resources";
import { ROUTES, TriageService, receiptOf } from "./triage.service";

/**
 * The routing service (#332) over repository, queue and dispatch stand-ins: what each class
 * composes, what the receipt holds, what is refused before anything is written, and that every
 * decision and dispatch is audited with the person as the actor.
 */

const ORG = "org-acme";
const TEST_RUN = "5eed0033-0000-4000-8000-000000000002";
const RUN = "5eed0009-0000-4000-8000-000000000482";
const CASE = "5eed0035-0000-4000-8000-000000000001";
const OTHER_CASE = "5eed0035-0000-4000-8000-000000000002";
const CLASSIFICATION = "5eed0037-0000-4000-8000-000000000001";
const CONTROL = "c0000000-0000-4000-8000-000000000001";
const JOB = "7f000002-0000-4000-8000-000000000001";
const SOURCE = "7f000002-0000-4000-8000-000000000099";
const RUNNER = "7f000004-0000-4000-8000-000000000001";

const MEMBER: Requester = { id: "user-member", name: "Mel Member", roles: ["member"] };

const ATTEMPT: AttemptRow = {
  id: TEST_RUN,
  organization_id: ORG,
  run_id: RUN,
  attempt_seq: 2,
  build_job_id: SOURCE,
  commit_sha: "a3f19c2",
};

/** A failing case. */
function failing(overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    id: CASE,
    case_key: "c".repeat(64),
    name: "pid_overshoot_under_load",
    classname: "motor.control",
    status: "failed",
    retry_outcomes: ["failed"],
    failure: { message: "overshoot 2.4% > 2.0%", path: "drivers/motor/pid.c" },
    suite: "PHYSICAL · HIL rig",
    platform: "rig:helios-rig-02",
    ...overrides,
  };
}

/** The classification row a write answers with. */
function classification(
  row: Partial<NewClassification>,
  routed: ClassificationReceipt | null = null,
): ClassificationRow {
  return {
    id: CLASSIFICATION,
    test_case_id: row.testCaseId ?? CASE,
    class: row.class ?? "product_bug",
    subtype: row.subtype ?? null,
    note: row.note ?? null,
    actor: "human",
    rule_id: null,
    confidence: null,
    routed,
    created_by: MEMBER.id,
    created_at: new Date("2026-09-25T10:00:00.000Z"),
    superseded_by: null,
  };
}

/** A queued build. */
function job(): BuildJobResource {
  return { id: JOB, status: "queued", queuedAt: "2026-09-25T10:00:01.000Z" } as BuildJobResource;
}

/** A control as the queue answers. */
function control(overrides: Partial<RunControlResource> = {}): RunControlResource {
  return {
    id: CONTROL,
    runId: RUN,
    kind: "steer",
    state: "pending",
    retryStage: true,
    detail: null,
    ...overrides,
  } as RunControlResource;
}

/** The code a promise was refused with. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );

  expect(error).toBeInstanceOf(DomainError);

  return (error as DomainError).code;
}

describe("the classification & routing service", () => {
  let repo: {
    transaction: jest.Mock;
    attempt: jest.Mock;
    cases: jest.Mock;
    dossiers: jest.Mock;
    job: jest.Mock;
    rerunSource: jest.Mock;
    currentStage: jest.Mock;
    classifications: jest.Mock;
    insertClassification: jest.Mock;
    route: jest.Mock;
    upsertIntents: jest.Mock;
    markHistory: jest.Mock;
    flagRunner: jest.Mock;
    insertWaiver: jest.Mock;
  };
  let controls: { correctionRound: jest.Mock };
  let jobs: { submitRerun: jest.Mock };
  let trail: AuditRecord[];
  let service: TriageService;

  beforeEach(() => {
    repo = {
      transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work({})),
      attempt: jest.fn().mockResolvedValue(ATTEMPT),
      cases: jest.fn().mockResolvedValue([failing()]),
      dossiers: jest.fn(),
      job: jest.fn().mockResolvedValue({
        id: SOURCE,
        status: "failed",
        runner_id: RUNNER,
        runner_name: "helios-rig-02",
        runner_status: "online",
      }),
      rerunSource: jest.fn().mockResolvedValue(SOURCE),
      currentStage: jest.fn().mockResolvedValue({ stage_key: "implement", attempt: 3 }),
      classifications: jest.fn().mockResolvedValue([]),
      insertClassification: jest.fn((_trx: unknown, row: NewClassification) =>
        Promise.resolve(classification(row)),
      ),
      // The receipt lands on the row the insert wrote, as V055's update does.
      route: jest.fn((_org: string, _id: string, receipt: ClassificationReceipt) => {
        const [, inserted] = repo.insertClassification.mock.calls.at(-1) as [
          unknown,
          NewClassification,
        ];

        return Promise.resolve(classification(inserted, receipt));
      }),
      upsertIntents: jest.fn().mockResolvedValue(undefined),
      markHistory: jest.fn().mockResolvedValue(true),
      flagRunner: jest.fn().mockResolvedValue(new Date("2026-09-25T10:00:02.000Z")),
      insertWaiver: jest.fn(),
    };
    controls = { correctionRound: jest.fn().mockResolvedValue(control()) };
    jobs = {
      submitRerun: jest
        .fn()
        .mockResolvedValue({ job: job(), queueState: "queued_no_eligible_runner" }),
    };
    trail = [];
    service = new TriageService(
      repo as unknown as TriageRepository,
      controls as unknown as ControlsService,
      jobs as unknown as FarmJobsService,
      {
        record: jest.fn((event: AuditRecord) => {
          trail.push(event);

          return Promise.resolve("event");
        }),
      } as unknown as AuditService,
    );
  });

  /** Classify the case as a member. */
  function classify(request: ClassifyCaseDto) {
    return service.classify(ORG, TEST_RUN, CASE, MEMBER, request);
  }

  it("routes each class to decision T7's composition", () => {
    expect(ROUTES).toEqual({
      product_bug: "correction_round",
      test_update: "correction_round",
      flake_retry: "flake_retry",
      infra_rig: "infra_rig",
    });
  });

  describe("a correction round (product_bug, test_update)", () => {
    it("queues the note as a stage-retry steer and stores control id + target attempt", async () => {
      const answer = await classify({ class: "product_bug", note: "Move PID sampling." });

      expect(controls.correctionRound).toHaveBeenCalledWith(
        ORG,
        RUN,
        MEMBER,
        "Move PID sampling.",
        `classification:${CLASSIFICATION}`,
      );
      expect(repo.route).toHaveBeenCalledWith(ORG, CLASSIFICATION, {
        control_id: CONTROL,
        target_attempt: 4,
        route: "correction_round",
      });
      expect(answer.classification.routed).toEqual({
        controlId: CONTROL,
        rerunJobId: null,
        targetAttempt: 4,
        route: "correction_round",
      });
      expect(answer.routing).toEqual(
        expect.objectContaining({ route: "correction_round", targetAttempt: 4, skipped: [] }),
      );
    });

    it("is what a test update queues too", async () => {
      await classify({ class: "test_update", note: "The frame-order test assumes FIFO." });

      expect(controls.correctionRound).toHaveBeenCalledTimes(1);
    });

    it("records the decision before it is routed", async () => {
      await classify({ class: "product_bug", note: "x" });

      expect(repo.insertClassification.mock.invocationCallOrder[0]).toBeLessThan(
        controls.correctionRound.mock.invocationCallOrder[0],
      );
      expect(repo.insertClassification).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ createdBy: MEMBER.id, testCaseId: CASE, note: "x" }),
      );
    });

    it("keeps a rejected round's control id but opens no attempt, and says why", async () => {
      controls.correctionRound.mockResolvedValue(
        control({ state: "rejected", detail: "the run has already finished" }),
      );

      const answer = await classify({ class: "product_bug", note: "x" });

      expect(repo.route).toHaveBeenCalledWith(ORG, CLASSIFICATION, {
        control_id: CONTROL,
        route: "correction_round",
      });
      expect(answer.routing.targetAttempt).toBeNull();
      expect(answer.routing.skipped).toEqual([
        "The run has finished, so no correction round was queued: the run has already finished.",
      ]);
    });

    it("names no target attempt before any stage has started", async () => {
      repo.currentStage.mockResolvedValue(undefined);

      const answer = await classify({ class: "product_bug", note: "x" });

      expect(answer.routing.targetAttempt).toBeNull();
    });

    it("stores the unclear-requirements subtype (the #434 amendment)", async () => {
      await classify({ class: "product_bug", subtype: "unclear_requirements", note: "x" });

      expect(repo.insertClassification).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ subtype: "unclear_requirements" }),
      );
      expect(trail[0].detail).toEqual(expect.objectContaining({ subtype: "unclear_requirements" }));
    });
  });

  describe("a flake", () => {
    it("marks the history and re-runs only that case, as a new build", async () => {
      const answer = await classify({ class: "flake_retry" });

      expect(repo.markHistory).toHaveBeenCalledWith(ORG, CASE);
      expect(jobs.submitRerun).toHaveBeenCalledWith(
        ORG,
        MEMBER.id,
        RUN,
        SOURCE,
        { scope: "failed", test_run_id: TEST_RUN, case_keys: ["c".repeat(64)] },
        "Re-run failed (1)",
      );
      expect(repo.route).toHaveBeenCalledWith(ORG, CLASSIFICATION, {
        rerun_job_id: JOB,
        route: "flake_retry",
      });
      expect(answer.routing).toEqual(
        expect.objectContaining({ historyMarked: true, skipped: [], control: null }),
      );
      expect(controls.correctionRound).not.toHaveBeenCalled();
    });

    it("is still recorded, unrouted, when there is no build to re-run — and says so", async () => {
      repo.rerunSource.mockResolvedValue(undefined);

      const answer = await classify({ class: "flake_retry" });

      expect(repo.route).not.toHaveBeenCalled();
      expect(answer.classification.routed).toBeNull();
      expect(answer.routing.rerun).toBeNull();
      expect(answer.routing.skipped).toEqual([
        "No attempt of this run was built on the farm, so there is no build to re-run.",
      ]);
    });

    it("turns the farm's refusal into a sentence rather than an error", async () => {
      jobs.submitRerun.mockRejectedValue(
        new ConflictError("farm_pool_disabled", "Pool rig-pool is disabled."),
      );

      const answer = await classify({ class: "flake_retry" });

      expect(answer.routing.skipped).toEqual(["Pool rig-pool is disabled."]);
    });

    it("lets any other failure through", async () => {
      jobs.submitRerun.mockRejectedValue(new Error("connection lost"));

      await expect(classify({ class: "flake_retry" })).rejects.toThrow("connection lost");
    });
  });

  describe("infra", () => {
    it("flags the runner that ran the attempt with a health note, and audits it", async () => {
      const answer = await classify({ class: "infra_rig", note: "PSU browned out." });

      expect(repo.flagRunner).toHaveBeenCalledWith(ORG, RUNNER, "PSU browned out.", MEMBER.id);
      expect(answer.routing.runnerFlag).toEqual({
        runnerId: RUNNER,
        runnerName: "helios-rig-02",
        note: "PSU browned out.",
        notedAt: "2026-09-25T10:00:02.000Z",
      });
      expect(trail.map((event) => [event.action, event.subjectType, event.actorId])).toEqual([
        ["runner.flagged", "runner", MEMBER.id],
        ["triage.classified", "test_case", MEMBER.id],
      ]);
      // Nothing dispatched, so nothing to receipt.
      expect(repo.route).not.toHaveBeenCalled();
      expect(jobs.submitRerun).not.toHaveBeenCalled();
    });

    it("writes a note of its own when the person wrote none", async () => {
      await classify({ class: "infra_rig" });

      expect(repo.flagRunner).toHaveBeenCalledWith(
        ORG,
        RUNNER,
        "Classified infra_rig: pid_overshoot_under_load failed in build 2 on this runner.",
        MEMBER.id,
      );
    });

    it("requeues the attempt's full case set when asked", async () => {
      repo.cases
        .mockResolvedValueOnce([failing()])
        .mockResolvedValueOnce([failing(), failing({ id: OTHER_CASE, case_key: "d".repeat(64) })]);

      const answer = await classify({ class: "infra_rig", toggles: { requeue: true } });

      expect(jobs.submitRerun).toHaveBeenCalledWith(
        ORG,
        MEMBER.id,
        RUN,
        SOURCE,
        { scope: "full", test_run_id: TEST_RUN, case_keys: ["c".repeat(64), "d".repeat(64)] },
        "Re-run full suite (2)",
      );
      expect(answer.classification.routed).toEqual(expect.objectContaining({ rerunJobId: JOB }));
    });

    it("says so when the attempt ran on no runner", async () => {
      repo.job.mockResolvedValue(undefined);

      const answer = await classify({ class: "infra_rig" });

      expect(repo.flagRunner).not.toHaveBeenCalled();
      expect(answer.routing.skipped).toEqual([
        "The attempt was not run on a farm runner, so no runner was flagged.",
      ]);
    });

    it("says so when the runner has since been removed", async () => {
      repo.flagRunner.mockResolvedValue(undefined);

      const answer = await classify({ class: "infra_rig" });

      expect(answer.routing.runnerFlag).toBeNull();
      expect(answer.routing.skipped).toEqual(["The runner that ran the attempt has been removed."]);
    });
  });

  describe("what is refused before anything is written", () => {
    it.each(["product_bug", "test_update"] as const)(
      "a %s without a note — the note is the next attempt's context",
      async (failureClass) => {
        expect(await refusal(classify({ class: failureClass }))).toBe(
          "classification_note_required",
        );
        expect(repo.insertClassification).not.toHaveBeenCalled();
      },
    );

    it("requeue on anything but infra", async () => {
      expect(await refusal(classify({ class: "flake_retry", toggles: { requeue: true } }))).toBe(
        "classification_toggle_invalid",
      );
    });

    it("an attempt of another workspace, and a case not in the attempt", async () => {
      repo.attempt.mockResolvedValueOnce(undefined);
      expect(await refusal(classify({ class: "flake_retry" }))).toBe("test_run_not_found");

      repo.cases.mockResolvedValueOnce([]);
      expect(await refusal(classify({ class: "flake_retry" }))).toBe("test_case_not_found");
      expect(repo.insertClassification).not.toHaveBeenCalled();
    });

    it.each(["passed", "skipped"] as const)("a %s case", async (status) => {
      repo.cases.mockResolvedValue([failing({ status })]);

      expect(await refusal(classify({ class: "flake_retry" }))).toBe("test_case_not_failing");
    });
  });

  it("stores the card's PR toggles as intents, in the classification's transaction", async () => {
    await classify({
      class: "product_bug",
      note: "x",
      toggles: { blockUntilGreen: true, autoRerunPhysical: false },
    });

    expect(repo.upsertIntents).toHaveBeenCalledWith(
      {},
      ORG,
      RUN,
      { blockUntilGreen: true, autoRerunPhysical: false },
      MEMBER.id,
    );
  });

  it("leaves the intents alone when the card sent no toggle", async () => {
    await classify({ class: "product_bug", note: "x" });

    expect(repo.upsertIntents).not.toHaveBeenCalled();
  });

  it("audits every classification with the person, the class and what was routed", async () => {
    await classify({ class: "product_bug", note: "the note stays out of the trail" });

    expect(trail).toEqual([
      {
        organizationId: ORG,
        actorId: MEMBER.id,
        action: "triage.classified",
        subjectType: "test_case",
        subjectId: CASE,
        at: new Date("2026-09-25T10:00:00.000Z"),
        detail: {
          classification_id: CLASSIFICATION,
          class: "product_bug",
          test_run_id: TEST_RUN,
          run_id: RUN,
          route: "correction_round",
          control_id: CONTROL,
          target_attempt: 4,
        },
      },
    ]);
    expect(JSON.stringify(trail)).not.toContain("stays out");
  });

  describe("re-running", () => {
    it("dispatches only the failed and error cases for Re-run failed", async () => {
      repo.cases.mockResolvedValue([
        failing(),
        failing({ id: OTHER_CASE, case_key: "d".repeat(64), status: "error" }),
      ]);

      const answer = await service.rerun(ORG, TEST_RUN, MEMBER, "failed");

      expect(repo.cases).toHaveBeenCalledWith(ORG, TEST_RUN, { statuses: ["failed", "error"] });
      expect(answer).toEqual({
        testRunId: TEST_RUN,
        scope: "failed",
        caseKeys: ["c".repeat(64), "d".repeat(64)],
        job: job(),
        queueState: "queued_no_eligible_runner",
      });
      expect(trail).toEqual([
        expect.objectContaining({
          action: "triage.rerun_requested",
          actorId: MEMBER.id,
          subjectType: "test_run",
          detail: {
            run_id: RUN,
            scope: "failed",
            cases: 2,
            job_id: JOB,
            queue_state: "queued_no_eligible_runner",
          },
        }),
      ]);
    });

    it("dispatches every case for Re-run full suite", async () => {
      await service.rerun(ORG, TEST_RUN, MEMBER, "full");

      expect(repo.cases).toHaveBeenCalledWith(ORG, TEST_RUN, {});
    });

    it("refuses when nothing failed, and when no attempt was built on the farm", async () => {
      repo.cases.mockResolvedValueOnce([]);
      expect(await refusal(service.rerun(ORG, TEST_RUN, MEMBER, "failed"))).toBe(
        "rerun_nothing_selected",
      );

      repo.rerunSource.mockResolvedValueOnce(undefined);
      expect(await refusal(service.rerun(ORG, TEST_RUN, MEMBER, "failed"))).toBe(
        "rerun_source_missing",
      );
      expect(jobs.submitRerun).not.toHaveBeenCalled();
      expect(trail).toEqual([]);
    });
  });

  describe("waiving", () => {
    beforeEach(() => {
      repo.insertWaiver.mockImplementation(
        (_org: string, runId: string, author: string, reason: string, caseKeys: string[]) =>
          Promise.resolve({
            id: "w-1",
            run_id: runId,
            author,
            reason,
            case_keys: caseKeys,
            annotation_state: "pending_pr_plane",
            created_at: new Date("2026-09-25T10:00:00.000Z"),
          }),
      );
    });

    it("records the author, the reason and the cases by key — and no annotation", async () => {
      const answer = await service.waive(ORG, TEST_RUN, "user-admin", {
        reason: "Known rig drift; tracked in #512.",
        caseIds: [CASE, CASE],
      });

      expect(repo.insertWaiver).toHaveBeenCalledWith(
        ORG,
        RUN,
        "user-admin",
        "Known rig drift; tracked in #512.",
        ["c".repeat(64)],
      );
      expect(answer).toEqual(
        expect.objectContaining({
          author: "user-admin",
          annotationState: "pending_pr_plane",
          testRunId: TEST_RUN,
        }),
      );
      expect(trail).toEqual([
        expect.objectContaining({
          action: "triage.waived",
          actorId: "user-admin",
          subjectType: "pr_waiver",
          subjectId: "w-1",
        }),
      ]);
    });

    it("waives a criterion when it names no case", async () => {
      await service.waive(ORG, TEST_RUN, "user-admin", { reason: "criterion" });

      expect(repo.cases).not.toHaveBeenCalled();
      expect(repo.insertWaiver).toHaveBeenCalledWith(ORG, RUN, "user-admin", "criterion", []);
    });

    it("refuses a case that is not in the attempt", async () => {
      expect(
        await refusal(
          service.waive(ORG, TEST_RUN, "user-admin", { reason: "r", caseIds: [OTHER_CASE] }),
        ),
      ).toBe("waiver_cases_invalid");
      expect(repo.insertWaiver).not.toHaveBeenCalled();
    });
  });
});

describe("the receipt", () => {
  const base: RoutingResource = {
    route: "infra_rig",
    control: null,
    targetAttempt: null,
    historyMarked: null,
    rerun: null,
    runnerFlag: null,
    skipped: [],
  };

  it("is null when nothing was dispatched, so V055's shape check is never fed an empty one", () => {
    expect(receiptOf(base)).toBeNull();
  });

  it("holds exactly what was dispatched, and the route", () => {
    expect(
      receiptOf({
        ...base,
        rerun: { job: { id: JOB } } as RoutingResource["rerun"],
      }),
    ).toEqual({ rerun_job_id: JOB, route: "infra_rig" });
  });
});
