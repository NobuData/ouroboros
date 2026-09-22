import type { Transaction } from "kysely";

import type { Database, Run, RunStage } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import type { GuardrailCheck } from "../db/schema";
import type { GuardrailRequest, GuardrailScheduler } from "./ingest.guardrails";
import { INGEST_ERRORS } from "./ingest.errors";
import { requestDigest } from "./ingest.idempotency";
import type { IngestRepository } from "./ingest.repository";
import { IngestService, RECEIPT_KEY_CONSTRAINT, stageResource } from "./ingest.service";

/**
 * The five steps, and the decisions between them.
 *
 * Driven against a stubbed repository rather than a database, because everything asserted
 * here is a decision this service makes *before or instead of* a statement: which refusal a
 * request earns, whether a replay does any work at all, whether a change-set report triggers
 * an evaluation, and where `simulated` comes from. `ingest.repository.spec.ts` holds the
 * statements and `ingest.integration-spec.ts` holds the whole thing against PostgreSQL.
 *
 * The stub answers, it does not assert. What a test cares about is stated in the test.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const WORKSPACE = "acme-robotics-id";
const REPOSITORY = "5eed0003-0000-4000-8000-000000000001";
const SOURCE = "8f14e45f-ceea-467a-9f0a-4a1c7c3b2d55";

/** The workflow document a run pins in these tests — two stages, one of them limited. */
const DEFINITION = {
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: {} },
  nodes: [
    {
      id: "queued",
      type: "trigger",
      title: "Issue queued",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "implement",
      type: "llm",
      title: "Code the change",
      position: { x: 1, y: 0 },
      config: {
        mode: "prompt",
        prompt_template: "…",
        routing: { inherit_task: "implement" },
        limits: { max_retries: 2, token_budget: 400_000 },
        permissions: { push_fixup: true, touch_ci: false },
      },
    },
  ],
  edges: [{ from: "queued", to: "implement", kind: "default" }],
};

/** A `runs` row, as the lock returns one. */
function run(over: Partial<Run> = {}): Run {
  return {
    id: RUN,
    organization_id: WORKSPACE,
    github_repo_id: REPOSITORY,
    issue_number: 482,
    issue_title: "Fix flaky CAN-bus telemetry test",
    workflow_tag: "standard-fix",
    model: "claude-fable-5",
    status: "coding",
    stage_label: "Code the change",
    stage_index: 1,
    stage_total: 2,
    started_at: new Date("2026-09-22T14:25:01.000Z"),
    finished_at: null,
    pr_number: null,
    checks_passed: null,
    checks_total: null,
    created_at: new Date("2026-09-22T14:25:01.000Z"),
    updated_at: new Date("2026-09-22T14:25:01.000Z"),
    loop_seq: 1847,
    branch_name: "loop/482-canbus-flake",
    workflow_version_pin: 14,
    simulated: true,
    event_seq: 7,
    event_bytes: "1024",
    event_cap: 20_000,
    event_byte_cap: "33554432",
    events_elided_at: null,
    merge_strategy: "squash",
    reserved_build_job_id: null,
    event_hint: 20,
    change_set_seq: 2,
    ...over,
  };
}

/** A `run_stages` row, as an insert or an update returns one. */
function stage(over: Partial<RunStage> = {}): RunStage {
  return {
    id: "5eed002a-0000-4000-8000-000000000004",
    run_id: RUN,
    stage_key: "implement",
    stage_label: "Code the change",
    position: 2,
    attempt: 1,
    status: "active",
    started_at: new Date("2026-09-22T14:30:00.000Z"),
    finished_at: null,
    max_attempts: 3,
    token_budget: 400_000,
    returned_from_stage_key: null,
    returned_from_kind: null,
    return_reason: null,
    note: null,
    created_at: new Date("2026-09-22T14:30:00.000Z"),
    updated_at: new Date("2026-09-22T14:30:00.000Z"),
    ...over,
  };
}

/** A repository that answers, and a record of what it was asked to write. */
function stubRepository() {
  const written = { receipts: [] as unknown[], events: 0, files: 0, usage: 0, reservations: 0 };
  // Every method returns a resolved promise rather than being `async`: they contain no
  // `await`, and the service is what decides the order they run in.
  const repository = {
    db: {} as never,
    transaction: <T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> =>
      work({} as Transaction<Database>),

    ticketsByKey: jest.fn(
      (
        _writer: unknown,
        _source: string,
        _key: string,
      ): Promise<{ organizationId: string; externalId: string; title: string }[]> =>
        Promise.resolve([
          {
            organizationId: WORKSPACE,
            externalId: "482",
            title: "Fix flaky CAN-bus telemetry test",
          },
        ]),
    ),
    repositoryBelongsTo: jest.fn((_w: unknown, _o: string, _r: string) => Promise.resolve(true)),
    pinnedDefinition: jest.fn(
      (
        _w: unknown,
        _o: string,
        _t: string,
        _v: number,
      ): Promise<{ definition: unknown } | undefined> =>
        Promise.resolve({ definition: DEFINITION }),
    ),
    buildJobBelongsTo: jest.fn((_w: unknown, _o: string, _j: string) => Promise.resolve(true)),

    lockRun: jest.fn((_w: unknown, _r: string): Promise<Run | undefined> => Promise.resolve(run())),
    insertRun: jest.fn((_w: unknown, _row: Record<string, unknown>) => Promise.resolve(run())),
    setReservation: jest.fn((_w: unknown, _r: string, _j: string | null) => {
      written.reservations += 1;

      return Promise.resolve();
    }),

    findReceipt: jest.fn(
      (
        _w: unknown,
        _o: string,
        _op: string,
        _k: string,
      ): Promise<{ request_digest: string; response: unknown } | undefined> =>
        Promise.resolve(undefined),
    ),
    insertReceipt: jest.fn((_writer: unknown, receipt: Record<string, unknown>) => {
      written.receipts.push(receipt);

      return Promise.resolve();
    }),

    stageState: jest.fn(
      (_w: unknown, _r: string, _k: string): Promise<{ attempt?: number; status?: string }> =>
        Promise.resolve({}),
    ),
    stageAttempt: jest.fn(
      (
        _w: unknown,
        _r: string,
        _k: string,
        _a: number,
      ): Promise<{ status: string; started_at: Date | null } | undefined> =>
        Promise.resolve(undefined),
    ),
    insertStage: jest.fn((_w: unknown, _row: Record<string, unknown>) => Promise.resolve(stage())),
    updateStage: jest.fn(
      (_w: unknown, _r: string, _k: string, _a: number, _change: Record<string, unknown>) =>
        Promise.resolve(stage({ status: "succeeded" })),
    ),

    appendEvents: jest.fn((_writer: unknown, _run: string, rows: readonly unknown[]) => {
      written.events += rows.length;

      return Promise.resolve(rows.map((_row, index) => ({ seq: 8 + index, marker: false })));
    }),
    raiseEventHint: jest.fn((_w: unknown, _r: string, _h: number) => Promise.resolve()),
    eventCounters: jest.fn((_w: unknown, _r: string) =>
      Promise.resolve({ hint: 22, elided: false }),
    ),

    replaceFiles: jest.fn((_writer: unknown, _run: string, files: readonly unknown[]) => {
      written.files = files.length;

      return Promise.resolve();
    }),
    changeSetTotals: jest.fn((_w: unknown, _r: string) =>
      Promise.resolve({ files: 2, additions: 59, deletions: 12 }),
    ),
    allocateChangeSetSeq: jest.fn((_w: unknown, _r: string) => Promise.resolve(3)),

    lastCommitSeq: jest.fn((_w: unknown, _r: string) => Promise.resolve(1)),
    knownCommitShas: jest.fn((_w: unknown, _r: string, _shas: readonly string[]) =>
      Promise.resolve(new Set<string>()),
    ),
    appendCommits: jest.fn((_writer: unknown, _run: string, rows: readonly unknown[]) =>
      Promise.resolve(rows.length),
    ),

    insertTokenUsage: jest.fn((_w: unknown, _usage: Record<string, unknown>) => {
      written.usage += 1;

      return Promise.resolve();
    }),
    spendTotals: jest.fn((_w: unknown, _r: string) =>
      Promise.resolve({
        tokensIn: 164_000,
        tokensOut: 48_000,
        costCents: "114.0000",
        unpricedEvents: 0,
      }),
    ),
  };

  return { repository: repository as unknown as IngestRepository, spy: repository, written };
}

/** A scheduler that counts, remembers what it was asked, and fails what it is told to. */
function stubGuardrails(
  failures: GuardrailCheck[] = [],
): GuardrailScheduler & { calls: number; requests: GuardrailRequest[] } {
  return {
    calls: 0,
    requests: [],
    evaluate(_writer, request) {
      this.calls += 1;
      this.requests.push(request);

      return Promise.resolve({ checks: 4, failures });
    },
  };
}

/** The error code a rejected promise carries. */
async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as DomainError).envelope().code;
  }

  throw new Error("expected a refusal");
}

/** A well-formed body for each operation. */
const OPEN = {
  idempotencyKey: "sim-482-open",
  ticket: { source: SOURCE, externalKey: "#482" },
  repository: REPOSITORY,
  workflow: { tag: "standard-fix", version: 14 },
  model: "claude-fable-5",
};

describe("opening a run", () => {
  it("resolves the workspace from the ticket and never from the body", async () => {
    const { repository, spy } = stubRepository();

    await new IngestService(repository, stubGuardrails()).openRun(OPEN, false);

    // The workspace the run is written with is the ticket's, and the request never named one.
    expect(spy.insertRun.mock.calls[0][1]).toMatchObject({ organization_id: WORKSPACE });
    expect(JSON.stringify(OPEN)).not.toContain(WORKSPACE);
  });

  it("takes simulated from the principal, not from anything the caller sent", async () => {
    const { repository, spy } = stubRepository();
    const service = new IngestService(repository, stubGuardrails());

    await service.openRun(OPEN, true);
    expect(spy.insertRun.mock.calls[0][1]).toMatchObject({ simulated: true });

    await service.openRun({ ...OPEN, idempotencyKey: "second" }, false);
    expect(spy.insertRun.mock.calls[1][1]).toMatchObject({ simulated: false });
  });

  it("snapshots the pin's first stage and its node count onto V008's columns", async () => {
    // The honest values at the moment a run opens: the first stage of the pinned document,
    // none of them entered, and as many as the document draws.
    const { repository, spy } = stubRepository();

    await new IngestService(repository, stubGuardrails()).openRun(OPEN, false);

    expect(spy.insertRun.mock.calls[0][1]).toMatchObject({
      stage_label: "Issue queued",
      stage_index: 0,
      stage_total: 2,
      workflow_version_pin: 14,
    });
  });

  it("refuses a ticket that is not mirrored", async () => {
    const { repository, spy } = stubRepository();
    spy.ticketsByKey.mockResolvedValueOnce([]);

    expect(
      await codeOf(new IngestService(repository, stubGuardrails()).openRun(OPEN as never, false)),
    ).toBe(INGEST_ERRORS.ticketNotFound);
  });

  it("refuses a key that names two tickets rather than picking one", async () => {
    const { repository, spy } = stubRepository();
    spy.ticketsByKey.mockResolvedValueOnce([
      { organizationId: WORKSPACE, externalId: "482", title: "a" },
      { organizationId: WORKSPACE, externalId: "483", title: "b" },
    ]);

    expect(
      await codeOf(new IngestService(repository, stubGuardrails()).openRun(OPEN as never, false)),
    ).toBe(INGEST_ERRORS.ticketAmbiguous);
  });

  it("names the V008/V030 disagreement rather than inventing a number", async () => {
    // `runs.issue_number` is an integer and a ticket's identity is text. Hashing one would
    // produce a number the console renders and no tracker recognises.
    const { repository, spy } = stubRepository();
    spy.ticketsByKey.mockResolvedValueOnce([
      { organizationId: WORKSPACE, externalId: "PROJ-142", title: "a" },
    ]);

    expect(
      await codeOf(new IngestService(repository, stubGuardrails()).openRun(OPEN as never, false)),
    ).toBe(INGEST_ERRORS.ticketNotNumbered);
  });

  it("refuses a repository belonging to another workspace", async () => {
    const { repository, spy } = stubRepository();
    spy.repositoryBelongsTo.mockResolvedValueOnce(false);

    expect(
      await codeOf(new IngestService(repository, stubGuardrails()).openRun(OPEN as never, false)),
    ).toBe(INGEST_ERRORS.repositoryNotFound);
  });

  it("refuses a pin nobody published, and one nothing can read", async () => {
    const missing = stubRepository();
    missing.spy.pinnedDefinition.mockResolvedValueOnce(undefined);
    expect(
      await codeOf(
        new IngestService(missing.repository, stubGuardrails()).openRun(OPEN as never, false),
      ),
    ).toBe(INGEST_ERRORS.workflowPinNotFound);

    const unreadable = stubRepository();
    unreadable.spy.pinnedDefinition.mockResolvedValueOnce({ definition: { nodes: 3 } });
    expect(
      await codeOf(
        new IngestService(unreadable.repository, stubGuardrails()).openRun(OPEN as never, false),
      ),
    ).toBe(INGEST_ERRORS.workflowPinUnreadable);
  });
});

describe("replaying a key", () => {
  it("returns the stored answer and does no work at all", async () => {
    // *Duplicate keys are no-ops returning the original result, not errors.* An executor
    // retries because it did not hear the answer; telling it "you already sent that" without
    // telling it what it was told leaves it where it was.
    const { repository, spy } = stubRepository();
    const stored = { id: RUN, loopSeq: 1847 };
    spy.findReceipt.mockResolvedValueOnce({
      request_digest: requestDigest(OPEN),
      response: stored,
    });

    const answer = await new IngestService(repository, stubGuardrails()).openRun(OPEN, false);

    expect(answer).toEqual(stored);
    expect(spy.insertRun).not.toHaveBeenCalled();
    expect(spy.insertReceipt).not.toHaveBeenCalled();
  });

  it("refuses a key presented with a different body", async () => {
    // The failure a stored response introduces: the caller would otherwise be told its report
    // landed, and it would not have.
    const { repository, spy } = stubRepository();
    spy.findReceipt.mockResolvedValueOnce({
      request_digest: requestDigest({ ...OPEN, model: "something-else" }),
      response: {},
    });

    expect(
      await codeOf(new IngestService(repository, stubGuardrails()).openRun(OPEN as never, false)),
    ).toBe(INGEST_ERRORS.idempotencyKeyReused);
  });

  it("answers a concurrent first delivery with the winner's receipt", async () => {
    // Two deliveries of one key can both pass the replay check and race to insert. The loser
    // is a replay that arrived a moment too early, so it is answered as one rather than as a
    // `500` — which is the one answer an executor cannot act on.
    const { repository, spy } = stubRepository();
    const stored = { id: RUN, loopSeq: 1847 };
    spy.insertReceipt.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: RECEIPT_KEY_CONSTRAINT,
      }),
    );
    spy.findReceipt
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ request_digest: requestDigest(OPEN), response: stored });

    expect(
      await new IngestService(repository, stubGuardrails()).openRun(OPEN as never, false),
    ).toEqual(stored);
  });

  it("rethrows a constraint that is not the receipt key", async () => {
    const { repository, spy } = stubRepository();
    spy.insertReceipt.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { code: "23503", constraint: "runs_repo_in_organization" }),
    );

    await expect(
      new IngestService(repository, stubGuardrails()).openRun(OPEN as never, false),
    ).rejects.toThrow("nope");
  });

  it("records a receipt for every operation, in the same transaction", async () => {
    const { repository, spy, written } = stubRepository();
    const service = new IngestService(repository, stubGuardrails());

    await service.openRun(OPEN, false);
    await service.transitionStage(RUN, {
      idempotencyKey: "a",
      stageKey: "implement",
      status: "active",
    } as never);
    await service.appendEvents(RUN, {
      idempotencyKey: "b",
      events: [{ hint: 21, actor: "system", body: "x" }],
    } as never);
    await service.reportFiles(RUN, { idempotencyKey: "c", files: [] });
    await service.reportCommits(RUN, {
      idempotencyKey: "d",
      commits: [{ sha: "a41c9e2", message: "m", committedAt: "2026-09-22T14:30:12.000Z" }],
    });
    await service.reportResources(RUN, { idempotencyKey: "e" });

    expect(written.receipts).toHaveLength(6);
    expect(written.receipts.map((receipt) => (receipt as { operation: string }).operation)).toEqual(
      [
        "run.create",
        "run.stage_transition",
        "run.events",
        "run.files",
        "run.commits",
        "run.resources",
      ],
    );
    expect(spy.insertReceipt.mock.calls.every((call) => call[1].run_id === RUN)).toBe(true);
  });
});

describe("a stage transition", () => {
  /** A transition body with the defaults these tests perturb. */
  const MOVE = { idempotencyKey: "k", stageKey: "implement", status: "active" };

  it("refuses a stage the pinned document does not name", async () => {
    const { repository } = stubRepository();

    expect(
      await codeOf(
        new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
          ...MOVE,
          stageKey: "deploy",
        } as never),
      ),
    ).toBe(INGEST_ERRORS.stageNotInPin);
  });

  it("refuses a move the state machine forbids, with the four values that locate it", async () => {
    const { repository, spy } = stubRepository();
    spy.stageState.mockResolvedValueOnce({ attempt: 1, status: "pending" });
    spy.stageAttempt.mockResolvedValueOnce({ status: "pending", started_at: null });

    try {
      await new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
        ...MOVE,
        status: "succeeded",
      } as never);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as DomainError).envelope()).toMatchObject({
        code: INGEST_ERRORS.stageTransitionInvalid,
        details: { stageKey: "implement", attempt: 1, from: "pending", to: "succeeded" },
      });
    }
  });

  it("refuses an attempt past the pinned limit", async () => {
    // `attempt 4/3` would be a stepper saying something untrue about the document it is
    // running.
    const { repository } = stubRepository();

    expect(
      await codeOf(
        new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
          ...MOVE,
          attempt: 4,
        } as never),
      ),
    ).toBe(INGEST_ERRORS.attemptLimitExceeded);
  });

  it("does not refuse an attempt on a stage the pin gives no limit", async () => {
    const { repository, spy } = stubRepository();

    await new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
      ...MOVE,
      stageKey: "queued",
    } as never);

    expect(spy.insertStage.mock.calls[0][1]).toMatchObject({
      stage_key: "queued",
      max_attempts: null,
      token_budget: null,
    });
  });

  it("refuses a loop return reported on a first attempt", async () => {
    // The note opens *"attempt N−1"* and there is no attempt 0 for a gate to have failed.
    const { repository } = stubRepository();

    expect(
      await codeOf(
        new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
          ...MOVE,
          returnedFrom: { stageKey: "queued", kind: "gate", reason: "failed_tests" },
        } as never),
      ),
    ).toBe(INGEST_ERRORS.stageReturnNotARetry);
  });

  it("writes the pin's label, position and limits onto the row", async () => {
    const { repository, spy } = stubRepository();

    await new IngestService(repository, stubGuardrails()).transitionStage(RUN, MOVE as never);

    expect(spy.insertStage.mock.calls[0][1]).toMatchObject({
      stage_label: "Code the change",
      position: 2,
      max_attempts: 3,
      token_budget: 400_000,
      attempt: 1,
      status: "active",
    });
  });

  it("sets the clock the status implies, and no other", async () => {
    const { repository, spy } = stubRepository();
    const at = "2026-09-22T14:30:00.000Z";

    await new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
      ...MOVE,
      status: "pending",
      at,
    } as never);
    expect(spy.insertStage.mock.calls[0][1]).toMatchObject({
      started_at: null,
      finished_at: null,
    });

    await new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
      ...MOVE,
      status: "active",
      at,
    } as never);
    expect(spy.insertStage.mock.calls[1][1]).toMatchObject({
      started_at: new Date(at),
      finished_at: null,
    });
  });

  it("does not move a start that has already happened", async () => {
    // A clock is set once, so `pending → active → succeeded` records when the attempt began
    // rather than when it ended — and `run_stages_finished_after_started` stays satisfiable.
    const { repository, spy } = stubRepository();
    const began = new Date("2026-09-22T14:30:00.000Z");
    spy.stageState.mockResolvedValueOnce({ attempt: 1, status: "active" });
    spy.stageAttempt.mockResolvedValueOnce({ status: "active", started_at: began });

    await new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
      ...MOVE,
      status: "succeeded",
      at: "2026-09-22T14:40:00.000Z",
    } as never);

    expect(spy.updateStage.mock.calls[0][4]).toEqual({
      status: "succeeded",
      finished_at: new Date("2026-09-22T14:40:00.000Z"),
    });
  });

  it("returns the note the database composed, and composes none itself", async () => {
    const { repository, spy } = stubRepository();
    spy.stageState.mockResolvedValueOnce({ attempt: 1, status: "failed" });
    spy.insertStage.mockResolvedValueOnce(
      stage({
        attempt: 2,
        returned_from_stage_key: "queued",
        returned_from_kind: "gate",
        return_reason: "failed_tests",
        note: "attempt 1 failed tests — loop returned from gate ↺",
      }),
    );

    const answer = await new IngestService(repository, stubGuardrails()).transitionStage(RUN, {
      ...MOVE,
      attempt: 2,
      returnedFrom: { stageKey: "queued", kind: "gate", reason: "failed_tests" },
    } as never);

    expect(answer.note).toBe("attempt 1 failed tests — loop returned from gate ↺");
    expect(answer.returnedFrom).toEqual({
      stageKey: "queued",
      kind: "gate",
      reason: "failed_tests",
    });
  });
});

describe("appending to the transcript", () => {
  it("refuses a batch that does not continue the accepted order", async () => {
    // The run stands at hint 20; a batch opening at 20 overtook one already accepted.
    const { repository } = stubRepository();

    expect(
      await codeOf(
        new IngestService(repository, stubGuardrails()).appendEvents(RUN, {
          idempotencyKey: "k",
          events: [{ hint: 20, actor: "system", body: "x" }],
        } as never),
      ),
    ).toBe(INGEST_ERRORS.eventsOutOfOrder);
  });

  it("refuses a batch whose own hints do not increase", async () => {
    // A different bug from the one above: this executor's numbering is broken rather than its
    // deliveries having raced.
    const { repository } = stubRepository();

    expect(
      await codeOf(
        new IngestService(repository, stubGuardrails()).appendEvents(RUN, {
          idempotencyKey: "k",
          events: [
            { hint: 21, actor: "system", body: "a" },
            { hint: 21, actor: "system", body: "b" },
          ],
        } as never),
      ),
    ).toBe(INGEST_ERRORS.eventsOutOfOrder);
  });

  it("writes nothing when the order is refused", async () => {
    const { repository, written } = stubRepository();

    await codeOf(
      new IngestService(repository, stubGuardrails()).appendEvents(RUN, {
        idempotencyKey: "k",
        events: [{ hint: 1, actor: "system", body: "x" }],
      } as never),
    );

    expect(written.events).toBe(0);
  });

  it("reports the store's sequence numbers, not the caller's hints", async () => {
    const { repository } = stubRepository();

    const answer = await new IngestService(repository, stubGuardrails()).appendEvents(RUN, {
      idempotencyKey: "k",
      events: [
        { hint: 21, actor: "system", body: "a" },
        { hint: 22, actor: "system", body: "b" },
      ],
    } as never);

    expect(answer).toEqual({
      submitted: 2,
      stored: 2,
      firstSeq: 8,
      lastSeq: 9,
      hint: 22,
      elided: false,
    });
  });

  it("does not count the cap's elision marker as one of the caller's entries", async () => {
    // The marker is the database's row, not an event. A caller told `stored: 1` for a batch of
    // two, with a range that skips nothing, can tell what happened.
    const { repository, spy } = stubRepository();
    spy.appendEvents.mockResolvedValueOnce([
      { seq: 8, marker: false },
      { seq: 9, marker: true },
    ]);
    spy.eventCounters.mockResolvedValueOnce({ hint: 22, elided: true });

    const answer = await new IngestService(repository, stubGuardrails()).appendEvents(RUN, {
      idempotencyKey: "k",
      events: [
        { hint: 21, actor: "system", body: "a" },
        { hint: 22, actor: "system", body: "b" },
      ],
    } as never);

    expect(answer).toMatchObject({
      submitted: 2,
      stored: 1,
      firstSeq: 8,
      lastSeq: 8,
      elided: true,
    });
  });
});

describe("reporting a change-set", () => {
  it("triggers evaluation, carrying the report's own number", async () => {
    const { repository, spy } = stubRepository();
    const guardrails = stubGuardrails();

    const answer = await new IngestService(repository, guardrails).reportFiles(RUN, {
      idempotencyKey: "k",
      files: [{ path: "a.c", status: "modified", additions: 3 }],
    } as never);

    expect(guardrails.calls).toBe(1);
    expect(answer).toEqual({
      changeSetSeq: 3,
      files: 2,
      additions: 59,
      deletions: 12,
      guardrailChecks: 4,
      guardrailFailures: [],
      needsHuman: false,
    });
    expect(spy.allocateChangeSetSeq).toHaveBeenCalled();
  });

  it("hands the evaluator the change-set with its hunks, and the store paths and counts only", async () => {
    // The hunks are what the secrets check scans, and they go no further than the evaluator:
    // `replaceFiles` is given the four columns `run_files` has, and nothing a diff line could
    // ride in on.
    const { repository, spy } = stubRepository();
    const guardrails = stubGuardrails();
    const hunks = [{ newStart: 10, lines: [{ kind: "add", text: "int x = 1;" }] }];

    await new IngestService(repository, guardrails).reportFiles(RUN, {
      idempotencyKey: "k",
      files: [
        { path: "a.c", status: "modified", additions: 1, hunks },
        { path: "b.c", status: "added", additions: 2 },
      ],
    } as never);

    expect(guardrails.requests[0]).toEqual({
      runId: RUN,
      changeSetSeq: 3,
      files: 2,
      changeSet: [{ path: "a.c", hunks }, { path: "b.c" }],
    });
    expect(spy.replaceFiles.mock.calls[0][2]).toEqual([
      { path: "a.c", status: "modified", additions: 1, deletions: 0 },
      { path: "b.c", status: "added", additions: 2, deletions: 0 },
    ]);
  });

  it("flags the run for a person when a check fails, and names the check", async () => {
    // The `needs_human` interplay: stated in the answer, not enforced — AR.1 stops the stage.
    const { repository } = stubRepository();

    const answer = await new IngestService(
      repository,
      stubGuardrails(["secrets", "ci_config"]),
    ).reportFiles(RUN, {
      idempotencyKey: "k",
      files: [{ path: "a.c", status: "modified", additions: 3 }],
    } as never);

    expect(answer.guardrailFailures).toEqual(["secrets", "ci_config"]);
    expect(answer.needsHuman).toBe(true);
  });

  it("triggers none for a run with no file changes, and allocates no number", async () => {
    // The acceptance criterion's other half. A report naming no files is not a change-set, so
    // there is nothing to number and nothing to judge.
    const { repository, spy } = stubRepository();
    const guardrails = stubGuardrails();

    const answer = await new IngestService(repository, guardrails).reportFiles(RUN, {
      idempotencyKey: "k",
      files: [],
    });

    expect(guardrails.calls).toBe(0);
    expect(answer.guardrailChecks).toBe(0);
    expect(answer.guardrailFailures).toEqual([]);
    expect(answer.needsHuman).toBe(false);
    expect(answer.changeSetSeq).toBe(2);
    expect(spy.allocateChangeSetSeq).not.toHaveBeenCalled();
  });

  it("still replaces the stored change-set when the report is empty", async () => {
    // A run that reverted everything it did has an empty change-set, not a stale one.
    const { repository, spy } = stubRepository();

    await new IngestService(repository, stubGuardrails()).reportFiles(RUN, {
      idempotencyKey: "k",
      files: [],
    });

    expect(spy.replaceFiles).toHaveBeenCalledWith({}, RUN, []);
  });

  it("defaults a file's counts to zero rather than leaving them absent", async () => {
    const { repository, spy } = stubRepository();

    await new IngestService(repository, stubGuardrails()).reportFiles(RUN, {
      idempotencyKey: "k",
      files: [{ path: "gone.c", status: "deleted" }],
    } as never);

    expect(spy.replaceFiles.mock.calls[0][2]).toEqual([
      { path: "gone.c", status: "deleted", additions: 0, deletions: 0 },
    ]);
  });
});

describe("reporting commits", () => {
  it("numbers only the commits that are new, so the sequence stays dense", async () => {
    const { repository, spy } = stubRepository();
    spy.knownCommitShas.mockResolvedValueOnce(new Set(["a41c9e2"]));

    const answer = await new IngestService(repository, stubGuardrails()).reportCommits(RUN, {
      idempotencyKey: "k",
      commits: [
        { sha: "a41c9e2", message: "m", committedAt: "2026-09-22T14:30:12.000Z" },
        { sha: "7f03b8d", message: "n", committedAt: "2026-09-22T14:34:47.000Z" },
      ],
    });

    expect(spy.appendCommits.mock.calls[0][2]).toEqual([
      expect.objectContaining({ sha: "7f03b8d", seq: 2 }),
    ]);
    expect(answer).toEqual({ submitted: 2, appended: 1, duplicates: 1, lastSeq: 2 });
  });

  it("numbers a sha repeated inside one batch only once", async () => {
    // `run_commits_run_seq_key` would refuse the second copy's *number* rather than the copy,
    // and a number handed to a row that is never written is a gap in the card's ordering.
    const { repository, spy } = stubRepository();

    await new IngestService(repository, stubGuardrails()).reportCommits(RUN, {
      idempotencyKey: "k",
      commits: [
        { sha: "7f03b8d", message: "n", committedAt: "2026-09-22T14:34:47.000Z" },
        { sha: "7f03b8d", message: "n", committedAt: "2026-09-22T14:34:47.000Z" },
      ],
    });

    expect(spy.appendCommits.mock.calls[0][2]).toHaveLength(1);
  });
});

describe("reporting resources", () => {
  it("attributes spend to the run's own workspace", async () => {
    const { repository, spy } = stubRepository();

    await new IngestService(repository, stubGuardrails()).reportResources(RUN, {
      idempotencyKey: "k",
      spend: { provider: "anthropic", model: "claude-fable-5", tokensIn: 10, tokensOut: 2 },
    });

    expect(spy.insertTokenUsage.mock.calls[0][1]).toMatchObject({
      organization_id: WORKSPACE,
      run_id: RUN,
      cost_cents: null,
    });
  });

  it("takes a reservation, releases one on null, and says nothing when absent", async () => {
    const { repository, spy } = stubRepository();
    const service = new IngestService(repository, stubGuardrails());

    await service.reportResources(RUN, {
      idempotencyKey: "a",
      reservedBuildJob: "job",
    });
    expect(spy.setReservation).toHaveBeenLastCalledWith({}, RUN, "job");

    await service.reportResources(RUN, { idempotencyKey: "b", reservedBuildJob: null });
    expect(spy.setReservation).toHaveBeenLastCalledWith({}, RUN, null);

    await service.reportResources(RUN, { idempotencyKey: "c" });
    expect(spy.setReservation).toHaveBeenCalledTimes(2);
  });

  it("refuses a build job of another workspace", async () => {
    const { repository, spy } = stubRepository();
    spy.buildJobBelongsTo.mockResolvedValueOnce(false);

    expect(
      await codeOf(
        new IngestService(repository, stubGuardrails()).reportResources(RUN, {
          idempotencyKey: "k",
          reservedBuildJob: "job",
        }),
      ),
    ).toBe(INGEST_ERRORS.buildJobNotFound);
  });

  it("answers with the run's totals, not with the delta it was sent", async () => {
    const { repository } = stubRepository();

    expect(
      await new IngestService(repository, stubGuardrails()).reportResources(RUN, {
        idempotencyKey: "k",
        spend: { provider: "anthropic", model: "m", tokensIn: 10, tokensOut: 2 },
      }),
    ).toEqual({
      tokensIn: 164_000,
      tokensOut: 48_000,
      costCents: "114.0000",
      unpricedEvents: 0,
      reservedBuildJobId: null,
    });
  });
});

describe("a run that is not there", () => {
  it.each([
    [
      "a stage transition",
      (service: IngestService) =>
        service.transitionStage(RUN, {
          idempotencyKey: "k",
          stageKey: "implement",
          status: "active",
        } as never),
    ],
    [
      "an event batch",
      (service: IngestService) =>
        service.appendEvents(RUN, {
          idempotencyKey: "k",
          events: [{ hint: 21, actor: "system", body: "x" }],
        } as never),
    ],
    [
      "a change-set report",
      (service: IngestService) => service.reportFiles(RUN, { idempotencyKey: "k", files: [] }),
    ],
    [
      "a commit report",
      (service: IngestService) =>
        service.reportCommits(RUN, {
          idempotencyKey: "k",
          commits: [{ sha: "a41c9e2", message: "m", committedAt: "2026-09-22T14:30:12.000Z" }],
        }),
    ],
    [
      "a resource report",
      (service: IngestService) => service.reportResources(RUN, { idempotencyKey: "k" }),
    ],
  ])("refuses %s with run_not_found", async (_name, call) => {
    const { repository, spy } = stubRepository();
    spy.lockRun.mockResolvedValueOnce(undefined);

    expect(await codeOf(call(new IngestService(repository, stubGuardrails())))).toBe(
      INGEST_ERRORS.runNotFound,
    );
  });
});

describe("mapping a stage row", () => {
  it("renders times as ISO strings and an absent return as null", () => {
    // Everything on this surface is stored in a `jsonb` receipt and handed back verbatim on a
    // replay, so a `Date` here would make the first answer and its replay differ in type.
    const answer = stageResource(stage());

    expect(answer.startedAt).toBe("2026-09-22T14:30:00.000Z");
    expect(answer.finishedAt).toBeNull();
    expect(answer.returnedFrom).toBeNull();
  });
});
