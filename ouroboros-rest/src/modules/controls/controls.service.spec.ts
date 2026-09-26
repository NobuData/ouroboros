import type { AppConfigService } from "../config/config.service";
import type { Run, RunControl } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import type { ControlsRepository } from "./controls.repository";
import { ControlsService, MAX_LISTED_CONTROLS, type Requester } from "./controls.service";

/**
 * The queue's policy (#306), over a repository stand-in. The order of the checks is the
 * design: role before anything is read, shape before the run is locked, confirmation against
 * the locked row, and nothing written until all three have passed. So every refusal below also
 * asserts that no insert happened.
 */

const ORG = "org-acme";
const RUN_ID = "5eed0009-0000-4000-8000-000000000482";
const CONTROL_ID = "c0000000-0000-4000-8000-000000000001";

const ADMIN: Requester = { id: "user-admin", name: "Ada Admin", roles: ["admin"] };
const MEMBER: Requester = { id: "user-member", name: "Mel Member", roles: ["member"] };
const VIEWER: Requester = { id: "user-viewer", name: "Vic Viewer", roles: ["viewer"] };

const CONFIG = { runControlTtlSeconds: 120, runSteerTtlSeconds: 300 } as AppConfigService;

/** An open run, locked. */
function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    organization_id: ORG,
    loop_seq: 1847,
    finished_at: null,
    status: "coding",
    ...overrides,
  } as Run;
}

/** A control row. */
function control(overrides: Partial<RunControl> = {}): RunControl {
  return {
    id: CONTROL_ID,
    run_id: RUN_ID,
    kind: "pause",
    payload: null,
    state: "pending",
    requested_by: ADMIN.id,
    requested_at: new Date("2026-09-22T10:00:00.000Z"),
    delivered_at: null,
    acked_at: null,
    expires_at: new Date("2026-09-22T10:02:00.000Z"),
    ack_detail: null,
    idempotency_key: "k",
    remember: false,
    retry_stage: false,
    ...overrides,
  };
}

/** A repository stand-in whose transaction just runs the work. */
function repository() {
  const stub = {
    db: {},
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work({})),
    lockRun: jest.fn().mockResolvedValue(run()),
    runExists: jest.fn().mockResolvedValue(true),
    cancelRun: jest.fn().mockResolvedValue(true),
    activeStage: jest.fn().mockResolvedValue({ stage_key: "implement", attempt: 2 }),
    appendUserEntry: jest.fn().mockResolvedValue(9),
    findByKey: jest.fn().mockResolvedValue(undefined),
    findForUpdate: jest.fn().mockResolvedValue(control({ state: "delivered" })),
    findOutstanding: jest.fn().mockResolvedValue(undefined),
    insertPending: jest.fn(
      (
        _trx: unknown,
        submission: {
          kind: RunControl["kind"];
          payload: string | null;
          remember: boolean;
          retryStage: boolean;
        },
      ) =>
        Promise.resolve(
          control({
            kind: submission.kind,
            payload: submission.payload,
            remember: submission.remember,
            retry_stage: submission.retryStage,
          }),
        ),
    ),
    insertRejected: jest.fn(
      (
        _trx: unknown,
        submission: { kind: RunControl["kind"]; payload: string | null },
        reason: string,
      ) =>
        Promise.resolve(
          control({
            kind: submission.kind,
            payload: submission.payload,
            state: "rejected",
            ack_detail: reason,
          }),
        ),
    ),
    sweep: jest.fn().mockResolvedValue(0),
    claimPending: jest.fn().mockResolvedValue([]),
    ack: jest.fn((_trx: unknown, _id: string, detail: string) =>
      Promise.resolve(
        control({
          state: "acked",
          ack_detail: detail,
          delivered_at: new Date(),
          acked_at: new Date(),
        }),
      ),
    ),
    list: jest.fn().mockResolvedValue([]),
  };

  return stub;
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

describe("the control service", () => {
  let repo: ReturnType<typeof repository>;
  let service: ControlsService;

  beforeEach(() => {
    repo = repository();
    service = new ControlsService(repo as unknown as ControlsRepository, CONFIG);
  });

  describe("submitting", () => {
    it("queues a pause as pending with the control TTL", async () => {
      const answer = await service.submit(ORG, RUN_ID, ADMIN, { kind: "pause" });

      expect(answer.state).toBe("pending");
      expect(repo.lockRun).toHaveBeenCalledWith({}, RUN_ID, ORG);
      expect(repo.insertPending).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          kind: "pause",
          payload: null,
          remember: false,
          requestedBy: ADMIN.id,
          ttlSeconds: 120,
        }),
      );
      expect(repo.appendUserEntry).not.toHaveBeenCalled();
    });

    it("queues a steer with the steer TTL and mirrors it into the transcript", async () => {
      await service.submit(ORG, RUN_ID, MEMBER, {
        kind: "steer",
        payload: "prefer a fix inside the ISR",
      });

      expect(repo.insertPending).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ ttlSeconds: 300 }),
      );
      expect(repo.appendUserEntry).toHaveBeenCalledWith({}, RUN_ID, {
        body: "prefer a fix inside the ISR",
        stageKey: "implement",
        attempt: 2,
        payload: { controlId: CONTROL_ID, requestedBy: { id: MEMBER.id, name: MEMBER.name } },
      });
    });

    it("attributes a steer to no stage when the run is between stages", async () => {
      repo.activeStage.mockResolvedValue(undefined);

      await service.submit(ORG, RUN_ID, MEMBER, { kind: "steer", payload: "hold on" });

      expect(repo.appendUserEntry).toHaveBeenCalledWith(
        {},
        RUN_ID,
        expect.objectContaining({ stageKey: null, attempt: null }),
      );
    });

    it("carries the remember flag on a steer", async () => {
      const answer = await service.submit(ORG, RUN_ID, MEMBER, {
        kind: "steer",
        payload: "always use k_msgq",
        remember: true,
      });

      expect(answer.remember).toBe(true);
    });

    it("never makes an ordinary steer a correction round", async () => {
      const answer = await service.submit(ORG, RUN_ID, MEMBER, { kind: "steer", payload: "x" });

      expect(answer.retryStage).toBe(false);
      expect(repo.insertPending).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ retryStage: false }),
      );
    });

    it("sweeps the run before deciding anything is outstanding", async () => {
      await service.submit(ORG, RUN_ID, ADMIN, { kind: "pause" });

      const sweepOrder = repo.sweep.mock.invocationCallOrder[0];
      const outstandingOrder = repo.findOutstanding.mock.invocationCallOrder[0];

      expect(sweepOrder).toBeLessThan(outstandingOrder);
    });

    describe("the role matrix", () => {
      it.each(["pause", "resume", "abort"] as const)(
        "refuses a member's %s before reading the run",
        async (kind) => {
          expect(
            await refusal(service.submit(ORG, RUN_ID, MEMBER, { kind, confirmation: "1847" })),
          ).toBe("forbidden");
          expect(repo.transaction).not.toHaveBeenCalled();
          expect(repo.insertPending).not.toHaveBeenCalled();
        },
      );

      it("refuses a viewer's steer", async () => {
        expect(
          await refusal(service.submit(ORG, RUN_ID, VIEWER, { kind: "steer", payload: "x" })),
        ).toBe("forbidden");
      });

      it("lets an owner abort", async () => {
        const owner: Requester = { ...ADMIN, roles: ["owner"] };

        await service.submit(ORG, RUN_ID, owner, { kind: "abort", confirmation: "1847" });

        expect(repo.insertPending).toHaveBeenCalled();
      });
    });

    describe("the typed confirmation", () => {
      it("is re-checked against the run's own loop number", async () => {
        expect(
          await refusal(
            service.submit(ORG, RUN_ID, ADMIN, { kind: "abort", confirmation: "1846" }),
          ),
        ).toBe("abort_confirmation_invalid");
        expect(repo.insertPending).not.toHaveBeenCalled();
      });

      it("is required for an abort", async () => {
        expect(await refusal(service.submit(ORG, RUN_ID, ADMIN, { kind: "abort" }))).toBe(
          "abort_confirmation_invalid",
        );
      });

      it("is not asked of a pause", async () => {
        await service.submit(ORG, RUN_ID, ADMIN, { kind: "pause", confirmation: "nonsense" });

        expect(repo.insertPending).toHaveBeenCalled();
      });
    });

    describe("the payload's shape", () => {
      it.each([
        ["a steer with no text", { kind: "steer" as const }, "payload"],
        ["a steer that is only whitespace", { kind: "steer" as const, payload: "   " }, "payload"],
        ["a pause with text", { kind: "pause" as const, payload: "why" }, "payload"],
        ["a remembered pause", { kind: "pause" as const, remember: true }, "remember"],
      ])("refuses %s before the run is locked", async (_description, request, field) => {
        const error: unknown = await service
          .submit(ORG, RUN_ID, ADMIN, request)
          .catch((failure: unknown) => failure);

        expect((error as DomainError).code).toBe("control_payload_invalid");
        expect((error as DomainError).details).toEqual(expect.objectContaining({ field }));
        expect(repo.lockRun).not.toHaveBeenCalled();
      });

      it("allows an explicit remember: false on another kind", async () => {
        await service.submit(ORG, RUN_ID, ADMIN, { kind: "resume", remember: false });

        expect(repo.insertPending).toHaveBeenCalled();
      });
    });

    it("answers 404 for a run that is not in this workspace", async () => {
      repo.lockRun.mockResolvedValue(undefined);

      expect(await refusal(service.submit(ORG, RUN_ID, ADMIN, { kind: "pause" }))).toBe(
        "run_not_found",
      );
    });

    describe("a finished run", () => {
      it("records a steer as rejected, with a reason, and writes no transcript entry", async () => {
        repo.lockRun.mockResolvedValue(run({ finished_at: new Date(), status: "merged" }));

        const answer = await service.submit(ORG, RUN_ID, MEMBER, {
          kind: "steer",
          payload: "too late",
        });

        expect(answer.state).toBe("rejected");
        expect(answer.detail).toContain("merged");
        expect(repo.insertPending).not.toHaveBeenCalled();
        expect(repo.appendUserEntry).not.toHaveBeenCalled();
      });
    });

    describe("repeats", () => {
      it("collapses a second pause into the one outstanding", async () => {
        repo.findOutstanding.mockResolvedValue(control({ id: "earlier" }));

        const answer = await service.submit(ORG, RUN_ID, ADMIN, { kind: "pause" });

        expect(answer.id).toBe("earlier");
        expect(repo.insertPending).not.toHaveBeenCalled();
      });

      it("does not collapse steers", async () => {
        await service.submit(ORG, RUN_ID, MEMBER, { kind: "steer", payload: "one" });

        expect(repo.findOutstanding).not.toHaveBeenCalled();
      });

      it("answers a retry under the same key with the same control", async () => {
        repo.findByKey.mockResolvedValue(control({ id: "earlier" }));

        const answer = await service.submit(ORG, RUN_ID, ADMIN, {
          kind: "pause",
          idempotencyKey: "k",
        });

        expect(answer.id).toBe("earlier");
        expect(repo.sweep).not.toHaveBeenCalled();
        expect(repo.insertPending).not.toHaveBeenCalled();
      });

      it("refuses a key reused for a different control", async () => {
        repo.findByKey.mockResolvedValue(control({ kind: "resume" }));

        expect(
          await refusal(service.submit(ORG, RUN_ID, ADMIN, { kind: "pause", idempotencyKey: "k" })),
        ).toBe("control_key_reused");
      });

      it("refuses a key reused for a different steer", async () => {
        repo.findByKey.mockResolvedValue(control({ kind: "steer", payload: "first" }));

        expect(
          await refusal(
            service.submit(ORG, RUN_ID, MEMBER, {
              kind: "steer",
              payload: "second",
              idempotencyKey: "k",
            }),
          ),
        ).toBe("control_key_reused");
      });

      it("passes a new key to the insert", async () => {
        await service.submit(ORG, RUN_ID, ADMIN, { kind: "pause", idempotencyKey: "k-new" });

        expect(repo.insertPending).toHaveBeenCalledWith(
          {},
          expect.objectContaining({ idempotencyKey: "k-new" }),
        );
      });
    });
  });

  describe("listing", () => {
    it("sweeps the run and lists its recent controls", async () => {
      repo.list.mockResolvedValue([control()]);

      const answer = await service.list(ORG, RUN_ID);

      expect(answer.controls).toHaveLength(1);
      expect(repo.sweep).toHaveBeenCalledWith({}, RUN_ID);
      expect(repo.list).toHaveBeenCalledWith({}, RUN_ID, MAX_LISTED_CONTROLS);
    });

    it("answers 404 for a run that is not in this workspace", async () => {
      repo.runExists.mockResolvedValue(false);

      expect(await refusal(service.list(ORG, RUN_ID))).toBe("run_not_found");
      expect(repo.sweep).not.toHaveBeenCalled();
    });
  });

  describe("fetching", () => {
    it("sweeps, then claims, and hands over the steer text", async () => {
      repo.claimPending.mockResolvedValue([control({ kind: "steer", payload: "prefer the ISR" })]);

      const answer = await service.fetch(RUN_ID);

      expect(answer.controls[0].payload).toBe("prefer the ISR");
      expect(repo.lockRun).toHaveBeenCalledWith({}, RUN_ID);
      expect(repo.sweep.mock.invocationCallOrder[0]).toBeLessThan(
        repo.claimPending.mock.invocationCallOrder[0],
      );
    });

    it("answers 404 for no such run", async () => {
      repo.lockRun.mockResolvedValue(undefined);

      expect(await refusal(service.fetch(RUN_ID))).toBe("run_not_found");
    });
  });

  describe("acknowledging", () => {
    it("records the executor's own words", async () => {
      const answer = await service.ack(RUN_ID, CONTROL_ID, {
        effect: "paused at the top of the loop",
      });

      expect(answer.state).toBe("acked");
      expect(repo.ack).toHaveBeenCalledWith({}, CONTROL_ID, "paused at the top of the loop");
      expect(repo.cancelRun).not.toHaveBeenCalled();
    });

    it("composes the steer's sentence from the attempt", async () => {
      repo.findForUpdate.mockResolvedValue(
        control({ kind: "steer", payload: "x", state: "delivered" }),
      );

      await service.ack(RUN_ID, CONTROL_ID, { attempt: 2 });

      expect(repo.ack).toHaveBeenCalledWith({}, CONTROL_ID, "steering applied to attempt 2");
    });

    it("closes the run as canceled when an abort is acked", async () => {
      repo.findForUpdate.mockResolvedValue(control({ kind: "abort", state: "delivered" }));
      repo.ack.mockResolvedValue(
        control({ kind: "abort", state: "acked", ack_detail: "aborted — branch preserved" }),
      );

      await service.ack(RUN_ID, CONTROL_ID, {});

      expect(repo.cancelRun).toHaveBeenCalledWith({}, RUN_ID);
    });

    it("sweeps before reading the control, so a late ack meets an expired one", async () => {
      await service.ack(RUN_ID, CONTROL_ID, {});

      expect(repo.sweep.mock.invocationCallOrder[0]).toBeLessThan(
        repo.findForUpdate.mock.invocationCallOrder[0],
      );
    });

    it.each(["pending", "acked", "expired", "rejected"] as const)(
      "refuses a control that is %s",
      async (state) => {
        repo.findForUpdate.mockResolvedValue(control({ state }));

        expect(await refusal(service.ack(RUN_ID, CONTROL_ID, {}))).toBe("control_not_delivered");
        expect(repo.ack).not.toHaveBeenCalled();
      },
    );

    it("answers 404 for a control that is not this run's", async () => {
      repo.findForUpdate.mockResolvedValue(undefined);

      expect(await refusal(service.ack(RUN_ID, CONTROL_ID, {}))).toBe("control_not_found");
    });

    it("answers 404 for no such run", async () => {
      repo.lockRun.mockResolvedValue(undefined);

      expect(await refusal(service.ack(RUN_ID, CONTROL_ID, {}))).toBe("run_not_found");
    });
  });

  it("sweeps every run for the periodic loop", async () => {
    repo.sweep.mockResolvedValue(4);

    expect(await service.sweep()).toBe(4);
    expect(repo.sweep).toHaveBeenCalledWith(repo.db);
  });
});

describe("a correction round (#332)", () => {
  let repo: ReturnType<typeof repository>;
  let service: ControlsService;

  beforeEach(() => {
    repo = repository();
    service = new ControlsService(repo as unknown as ControlsRepository, CONFIG);
  });

  it("queues a steer that asks for the stage's next attempt, with the steer TTL", async () => {
    const answer = await service.correctionRound(
      ORG,
      RUN_ID,
      MEMBER,
      "Keep k_msgq, but move PID velocity sampling off the telemetry path.",
      "classification:1",
    );

    expect(answer).toEqual(
      expect.objectContaining({ kind: "steer", state: "pending", retryStage: true }),
    );
    expect(repo.insertPending).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        kind: "steer",
        payload: "Keep k_msgq, but move PID velocity sampling off the telemetry path.",
        retryStage: true,
        remember: false,
        ttlSeconds: 300,
        idempotencyKey: "classification:1",
      }),
    );
  });

  it("puts the note in the transcript, marked as a correction round", async () => {
    await service.correctionRound(ORG, RUN_ID, MEMBER, "move PID sampling");

    expect(repo.appendUserEntry).toHaveBeenCalledWith({}, RUN_ID, {
      body: "move PID sampling",
      stageKey: "implement",
      attempt: 2,
      payload: {
        controlId: CONTROL_ID,
        requestedBy: { id: MEMBER.id, name: MEMBER.name },
        correctionRound: true,
      },
    });
  });

  it("is held to the steer's role policy — a viewer may not queue one", async () => {
    expect(await refusal(service.correctionRound(ORG, RUN_ID, VIEWER, "x"))).toBe("forbidden");
    expect(repo.insertPending).not.toHaveBeenCalled();
  });

  it("refuses a note that is only whitespace", async () => {
    expect(await refusal(service.correctionRound(ORG, RUN_ID, MEMBER, "   "))).toBe(
      "control_payload_invalid",
    );
  });

  it("is recorded as rejected on a finished run", async () => {
    repo.lockRun.mockResolvedValue(run({ finished_at: new Date(), status: "canceled" }));

    const answer = await service.correctionRound(ORG, RUN_ID, MEMBER, "too late");

    expect(answer.state).toBe("rejected");
    expect(repo.appendUserEntry).not.toHaveBeenCalled();
  });

  it("does not answer a replay of an ordinary steer under the same key", async () => {
    repo.findByKey.mockResolvedValue(
      control({ kind: "steer", payload: "same", retry_stage: false }),
    );

    expect(await refusal(service.correctionRound(ORG, RUN_ID, MEMBER, "same", "k"))).toBe(
      "control_key_reused",
    );
  });

  it("answers its own replay with the same control", async () => {
    repo.findByKey.mockResolvedValue(
      control({ id: "earlier", kind: "steer", payload: "same", retry_stage: true }),
    );

    const answer = await service.correctionRound(ORG, RUN_ID, MEMBER, "same", "k");

    expect(answer.id).toBe("earlier");
    expect(repo.insertPending).not.toHaveBeenCalled();
  });
});
