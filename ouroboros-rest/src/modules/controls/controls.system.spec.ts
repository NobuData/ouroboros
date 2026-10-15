import type { AppConfigService } from "../config/config.service";
import type { Run, RunControl } from "../db/schema";
import type { ControlsRepository } from "./controls.repository";
import { ControlsService, SYSTEM_CONTROL_SENTENCES } from "./controls.service";

/**
 * Controls nobody asked for — live-run limits and a workspace pause reaching running runs
 * (DI.4, #1312). The person-facing queue is `controls.service.spec.ts`'.
 */

const ORG = "org-acme";
const RUN_ID = "5eed0009-0000-4000-8000-000000000482";
const NOW = new Date("2026-10-15T14:00:00.000Z");

const CONFIG = {
  runControlTtlSeconds: 120,
  runSteerTtlSeconds: 300,
  liveRunWallClockMinutes: 120,
  liveRunNoProgressMinutes: 15,
} as AppConfigService;

/** An open live run, locked. */
function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    organization_id: ORG,
    loop_seq: 1847,
    finished_at: null,
    status: "coding",
    origin: "live",
    ...overrides,
  } as Run;
}

/** A control row. */
function control(overrides: Partial<RunControl> = {}): RunControl {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    run_id: RUN_ID,
    kind: "abort",
    payload: null,
    state: "pending",
    requested_by: null,
    requested_at: NOW,
    delivered_at: null,
    acked_at: null,
    expires_at: new Date("2026-10-15T14:02:00.000Z"),
    ack_detail: null,
    idempotency_key: "k",
    remember: false,
    retry_stage: false,
    ...overrides,
  };
}

/** A repository stand-in whose transaction just runs the work. */
function repository() {
  return {
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work("trx")),
    lockRun: jest.fn().mockResolvedValue(run()),
    sweep: jest.fn().mockResolvedValue(0),
    findOutstanding: jest.fn().mockResolvedValue(undefined),
    insertPending: jest.fn((_trx: unknown, submission: { kind: RunControl["kind"] }) =>
      Promise.resolve(control({ kind: submission.kind })),
    ),
    appendSystemEntry: jest.fn().mockResolvedValue(12),
    overdueLiveRuns: jest.fn().mockResolvedValue([]),
    liveActiveRuns: jest.fn().mockResolvedValue([]),
    systemPausedRuns: jest.fn().mockResolvedValue([]),
  };
}

describe("a control nobody asked for", () => {
  let repo: ReturnType<typeof repository>;
  let service: ControlsService;

  beforeEach(() => {
    repo = repository();
    service = new ControlsService(repo as unknown as ControlsRepository, CONFIG);
  });

  it("queues with no requester, no role check and no typed confirmation", async () => {
    const answer = await service.submitSystem(ORG, RUN_ID, "abort", "no_progress_limit");

    expect(answer).toMatchObject({ queued: true, control: { kind: "abort", state: "pending" } });
    expect(repo.lockRun).toHaveBeenCalledWith("trx", RUN_ID, ORG);
    expect(repo.insertPending).toHaveBeenCalledWith("trx", {
      runId: RUN_ID,
      kind: "abort",
      payload: null,
      remember: false,
      retryStage: false,
      requestedBy: null,
      ttlSeconds: 120,
    });
  });

  it("says why in the transcript, in the system's name", async () => {
    await service.submitSystem(ORG, RUN_ID, "abort", "wall_clock_limit");

    expect(repo.appendSystemEntry).toHaveBeenCalledWith(
      "trx",
      RUN_ID,
      SYSTEM_CONTROL_SENTENCES.wall_clock_limit,
      {
        controlId: "c0000000-0000-4000-8000-000000000001",
        kind: "abort",
        reason: "wall_clock_limit",
      },
    );
  });

  it("names the kept branch in every abort's sentence", () => {
    expect(SYSTEM_CONTROL_SENTENCES.wall_clock_limit).toContain("branch is kept");
    expect(SYSTEM_CONTROL_SENTENCES.no_progress_limit).toContain("branch is kept");
  });

  it("answers an outstanding control of the same kind rather than queueing a second", async () => {
    repo.findOutstanding.mockResolvedValue(control({ kind: "pause", state: "delivered" }));

    const answer = await service.submitSystem(ORG, RUN_ID, "pause", "workspace_paused");

    expect(answer).toMatchObject({ queued: false, control: { kind: "pause", state: "delivered" } });
    expect(repo.insertPending).not.toHaveBeenCalled();
    expect(repo.appendSystemEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["gone", undefined],
    ["finished", run({ finished_at: NOW, status: "failed" })],
  ])("queues nothing for a run that is %s", async (_case, locked) => {
    repo.lockRun.mockResolvedValue(locked);

    await expect(
      service.submitSystem(ORG, RUN_ID, "abort", "no_progress_limit"),
    ).resolves.toBeUndefined();
    expect(repo.insertPending).not.toHaveBeenCalled();
  });
});

describe("the live-run limits (#1312)", () => {
  let repo: ReturnType<typeof repository>;
  let service: ControlsService;

  beforeEach(() => {
    repo = repository();
    service = new ControlsService(repo as unknown as ControlsRepository, CONFIG);
  });

  it("measures the wall clock and the silence back from now", async () => {
    await service.enforceLiveLimits(NOW);

    expect(repo.overdueLiveRuns).toHaveBeenCalledWith(
      new Date("2026-10-15T12:00:00.000Z"),
      new Date("2026-10-15T13:45:00.000Z"),
    );
  });

  it("aborts each overdue run with the limit it passed, and counts the aborts queued", async () => {
    repo.overdueLiveRuns.mockResolvedValue([
      { id: "run-long", organizationId: ORG, limit: "wall_clock" },
      { id: "run-quiet", organizationId: "org-other", limit: "no_progress" },
    ]);

    await expect(service.enforceLiveLimits(NOW)).resolves.toBe(2);

    const reasons = repo.appendSystemEntry.mock.calls.map(
      (call: unknown[]) => (call[3] as { reason: string }).reason,
    );
    expect(reasons).toEqual(["wall_clock_limit", "no_progress_limit"]);
    expect(repo.lockRun.mock.calls.map((call: unknown[]) => call.slice(1))).toEqual([
      ["run-long", ORG],
      ["run-quiet", "org-other"],
    ]);
  });

  it("does not count an abort already outstanding twice — pending or delivered", async () => {
    repo.overdueLiveRuns.mockResolvedValue([
      { id: RUN_ID, organizationId: ORG, limit: "no_progress" },
      { id: "run-other", organizationId: ORG, limit: "no_progress" },
    ]);
    repo.findOutstanding
      .mockResolvedValueOnce(control({ state: "pending" }))
      .mockResolvedValueOnce(control({ state: "delivered" }));

    await expect(service.enforceLiveLimits(NOW)).resolves.toBe(0);
  });
});

describe("a workspace pause reaching its live runs (#1312)", () => {
  let repo: ReturnType<typeof repository>;
  let service: ControlsService;

  beforeEach(() => {
    repo = repository();
    service = new ControlsService(repo as unknown as ControlsRepository, CONFIG);
  });

  it("asks every live run still executing to pause", async () => {
    repo.liveActiveRuns.mockResolvedValue(["run-a", "run-b"]);

    await expect(service.pauseLiveRuns(ORG)).resolves.toBe(2);

    expect(repo.liveActiveRuns).toHaveBeenCalledWith(ORG);
    expect(repo.insertPending.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      expect.objectContaining({ runId: "run-a", kind: "pause", requestedBy: null }),
      expect.objectContaining({ runId: "run-b", kind: "pause", requestedBy: null }),
    ]);
  });

  it("resumes only the runs the pause paused", async () => {
    repo.systemPausedRuns.mockResolvedValue(["run-a"]);

    await expect(service.resumeLiveRuns(ORG)).resolves.toBe(1);

    expect(repo.liveActiveRuns).not.toHaveBeenCalled();
    expect(repo.insertPending.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      expect.objectContaining({ runId: "run-a", kind: "resume", requestedBy: null }),
    ]);
  });
});
