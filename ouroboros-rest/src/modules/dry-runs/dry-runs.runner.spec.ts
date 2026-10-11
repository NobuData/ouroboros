import { Logger } from "@nestjs/common";

import type { DryRun } from "../db/schema";
import type { EngineClient } from "../engine/engine.client";
import type { EngineDryRunRequest } from "../engine/engine.dryruns";
import { effectiveBudget } from "./dry-runs.budget";
import { DryRunRecords } from "./dry-runs.records";
import { DryRunRunner, HARNESS_STOPPED, RESULT_UNRECORDED, endingOf } from "./dry-runs.runner";
import {
  DEFINITION,
  DryRunStore,
  FakeEngine,
  PINNED_SHA,
  TICKET_ID,
  WORKFLOW_ID,
  WORKSPACE,
  harnessResult,
  harnessStage,
  type ScriptStep,
} from "./dry-runs.store.fixture";
import type { DryRunStreamEvent } from "./dry-runs.stream";

const BUDGET = effectiveBudget(1000, 500);

async function bench(script: (request: EngineDryRunRequest) => ScriptStep[]) {
  const store = new DryRunStore();
  const engine = new FakeEngine(script);
  const records = new DryRunRecords(store.repository);
  const runner = new DryRunRunner(engine as unknown as EngineClient, store.repository, records);
  const recorded = await store.insert({
    organizationId: WORKSPACE,
    workflowId: WORKFLOW_ID,
    baseVersion: null,
    draftRev: 3,
    sessionId: null,
    ticketId: TICKET_ID,
    pinnedSha: PINNED_SHA,
  });
  const run = await store.markRunning(recorded.id);
  const request: EngineDryRunRequest = {
    dryRun: run.id,
    definition: DEFINITION,
    ticket: {
      externalKey: "#489",
      source: "github",
      labels: [],
      estimate: null,
      title: "t",
      body: "",
    },
    repository: { slug: "acme-robotics/helios-firmware", pinnedSha: PINNED_SHA, token: "t0ken" },
    stages: {},
    budget: { runCostCents: 500, stageCostCents: null, runTokens: null, stageTokens: null },
  };

  return { store, engine, runner, run, request };
}

async function collect(stream: AsyncGenerator<DryRunStreamEvent, boolean>) {
  const events: DryRunStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function stored(store: DryRunStore, run: DryRun): DryRun {
  return store.runs.find((row) => row.id === run.id) as DryRun;
}

const ANALYZE = harnessStage(1, "analyze");
const IMPLEMENT = harnessStage(2, "implement", { metrics: { tokens: 84000, simulated_writes: 1 } });
const BUILD = harnessStage(3, "build", {
  how: "replayed",
  note: "est. 4m 02s (214 similar builds, ±20s)",
  metrics: { estimate_ms: 242000, sample_count: 214, spread_ms: 20000, similarity_class: "x" },
});

describe("how a dry run ends", () => {
  it("is the harness's own verdict on a clean run", () => {
    expect(endingOf(harnessResult("r", { tokens: 96000, costCents: 31 }), false)).toEqual({
      status: "complete",
      failureReason: null,
      durationMs: 161000,
      costCents: 31,
      tokens: 96000,
      guardAudit: [],
    });
  });

  it("keeps an unpriced, unmetered run null — never zero", () => {
    expect(endingOf(harnessResult("r"), false)).toMatchObject({ costCents: null, tokens: null });
  });

  it("keeps a budget stop and a failure distinct, each with its reason", () => {
    expect(
      endingOf(
        harnessResult("r", {
          status: "budget_stopped",
          failureReason: "spend cap of $5.00 reached",
        }),
        false,
      ),
    ).toMatchObject({ status: "budget_stopped", failureReason: "spend cap of $5.00 reached" });
    expect(endingOf(harnessResult("r", { status: "budget_stopped" }), false)).toMatchObject({
      status: "budget_stopped",
      failureReason: "The dry run reached its budget.",
    });
    expect(endingOf(harnessResult("r", { status: "failed" }), false)).toMatchObject({
      status: "failed",
      failureReason: "The dry run failed.",
    });
  });

  it("fails a run whose guards had to hold, whatever status came with the audit", () => {
    const audit = [
      { guard: "allow_list", call: "git_push", count: 2, stageKey: "implement" },
      { guard: "workspace_boundary", call: "edit_file", count: 1, stageKey: null },
    ];

    const lying = endingOf(
      harnessResult("r", { status: "complete", guardAudit: audit, guardsClean: false }),
      false,
    );
    expect(lying).toMatchObject({
      status: "failed",
      failureReason:
        "The tool boundary refused 3 calls; a dry run whose guards had to hold is not trusted.",
      guardAudit: [
        { guard: "allow_list", call: "git_push", count: 2, stage_key: "implement" },
        { guard: "workspace_boundary", call: "edit_file", count: 1 },
      ],
    });

    const honest = endingOf(
      harnessResult("r", {
        status: "failed",
        failureReason: "the tool boundary refused 1 call",
        guardAudit: [audit[1]],
      }),
      false,
    );
    expect(honest).toMatchObject({
      status: "failed",
      failureReason: "the tool boundary refused 1 call",
    });

    const stopped = endingOf(
      harnessResult("r", {
        status: "budget_stopped",
        failureReason: "cap",
        guardAudit: [audit[1]],
      }),
      false,
    );
    expect(stopped).toMatchObject({
      status: "failed",
      failureReason:
        "The tool boundary refused 1 call; a dry run whose guards had to hold is not trusted.",
    });
  });

  it("is cancelled without a reason when somebody stopped it, and failed when the harness went away", () => {
    expect(endingOf(undefined, true)).toEqual({
      status: "cancelled",
      failureReason: null,
      durationMs: null,
      costCents: null,
      tokens: null,
      guardAudit: [],
    });
    expect(endingOf(undefined, false)).toMatchObject({
      status: "failed",
      failureReason: HARNESS_STOPPED,
    });
  });
});

describe("a dry run in flight", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("streams progress in stage order and ends with the totals", async () => {
    const { store, runner, run, request } = await bench((sent) => [
      { kind: "stage_started", seq: 1, stageKey: "analyze", displayName: "analyze" },
      { kind: "stage_finished", stage: ANALYZE },
      { kind: "stage_started", seq: 2, stageKey: "implement", displayName: "implement" },
      { kind: "stage_finished", stage: IMPLEMENT },
      { kind: "stage_started", seq: 3, stageKey: "build", displayName: "build" },
      { kind: "stage_finished", stage: BUILD },
      {
        kind: "done",
        result: harnessResult(sent.dryRun, {
          stages: [ANALYZE, IMPLEMENT, BUILD],
          artifacts: [
            {
              kind: "overlay_diff",
              content: "@@ drivers/can/arbitration.c @@",
              truncated: false,
              originalBytes: 31,
              pathSummary: [{ path: "drivers/can/arbitration.c", added: 41, removed: 9 }],
            },
            {
              kind: "plan_excerpt",
              content: "3 steps",
              truncated: false,
              originalBytes: 7,
              pathSummary: [],
            },
          ],
          tokens: 96000,
          costCents: 31,
        }),
      },
    ]);

    await runner.launch(run, request, BUDGET);
    const events = await collect(runner.follow(run.id));

    expect(events.map((event) => event.kind)).toEqual([
      "accepted",
      "stage_started",
      "stage_finished",
      "stage_started",
      "stage_finished",
      "stage_started",
      "stage_finished",
      "done",
    ]);
    expect(
      events.flatMap((event) => (event.kind === "stage_finished" ? [event.stage.seq] : [])),
    ).toEqual([1, 2, 3]);
    expect(events[0]).toMatchObject({
      kind: "accepted",
      dryRun: { status: "running", budget: { capCents: 500, source: "draft_guard" } },
    });
    expect(events[4]).toMatchObject({ stage: { stageKey: "implement", howLabel: "simulated" } });
    expect(events[6]).toMatchObject({
      stage: { stageKey: "build", howLabel: "replayed from history" },
    });

    const done = events.at(-1);
    expect(done).toMatchObject({
      kind: "done",
      dryRun: {
        status: "complete",
        failureReason: null,
        totals: { durationMs: 161000, costCents: 31, tokens: 96000 },
        guardAudit: [],
        guardsClean: true,
      },
    });
    expect(done?.kind === "done" && done.dryRun.stages.map((stage) => stage.stageKey)).toEqual([
      "analyze",
      "implement",
      "build",
    ]);
    expect(done?.kind === "done" && done.dryRun.artifacts[0]).toMatchObject({
      kind: "overlay_diff",
      pathSummary: [{ path: "drivers/can/arbitration.c", added: 41, removed: 9 }],
    });
    expect(done?.kind === "done" && done.dryRun.artifacts[1]?.pathSummary).toBeNull();

    // Recorded once each, though the final result repeats every row.
    expect(store.stageRows).toHaveLength(3);
    expect(stored(store, run)).toMatchObject({
      status: "complete",
      guard_audit: [],
      guards_clean: true,
    });
    expect(runner.isLive(run.id)).toBe(false);
  });

  it("replays the stream from the top to a subscriber who arrives late, and gives none to a stranger", async () => {
    const { engine, runner, run, request } = await bench((sent) => [
      { kind: "stage_finished", stage: ANALYZE },
      { kind: "pause", name: "mid" },
      { kind: "done", result: harnessResult(sent.dryRun, { stages: [ANALYZE] }) },
    ]);

    await runner.launch(run, request, BUDGET);
    await engine.atPause("mid");
    const late = collect(runner.follow(run.id));
    engine.release("mid");

    expect((await late).map((event) => event.kind)).toEqual(["accepted", "stage_finished", "done"]);
    const stranger = runner.follow("not-a-run");
    expect(await stranger.next()).toEqual({ done: true, value: false });
  });

  it("lets a subscriber leave without waiting for the run", async () => {
    const { engine, runner, run, request } = await bench((sent) => [
      { kind: "pause", name: "mid" },
      { kind: "done", result: harnessResult(sent.dryRun) },
    ]);
    const gone = new AbortController();

    await runner.launch(run, request, BUDGET);
    const watching = collect(runner.follow(run.id, gone.signal));
    await engine.atPause("mid");
    gone.abort();

    expect((await watching).map((event) => event.kind)).toEqual(["accepted"]);
    engine.release("mid");
    await runner.settled(run.id);
  });

  it("stops at the budget with the rows so far kept", async () => {
    const { store, runner, run, request } = await bench((sent) => [
      { kind: "stage_finished", stage: ANALYZE },
      { kind: "stage_finished", stage: IMPLEMENT },
      {
        kind: "done",
        result: harnessResult(sent.dryRun, {
          status: "budget_stopped",
          failureReason: "the run's spend cap of $5.00 was reached",
          stages: [
            ANALYZE,
            IMPLEMENT,
            harnessStage(3, "build", {
              verdict: "not_reached",
              how: "deterministic",
              note: "",
              metrics: {},
            }),
          ],
          tokens: 800000,
          costCents: 500,
        }),
      },
    ]);

    await runner.launch(run, request, BUDGET);
    const done = (await collect(runner.follow(run.id))).at(-1);

    expect(done).toMatchObject({
      kind: "done",
      dryRun: {
        status: "budget_stopped",
        failureReason: "the run's spend cap of $5.00 was reached",
        totals: { costCents: 500 },
      },
    });
    expect(done?.kind === "done" && done.dryRun.stages.map((stage) => stage.verdict)).toEqual([
      "ok",
      "ok",
      "not_reached",
    ]);
    expect(stored(store, run).status).toBe("budget_stopped");
  });

  it("populates the guard audit on an injected violation, streams it, and fails the run", async () => {
    const audit = [{ guard: "allow_list", call: "git_push", count: 1, stageKey: "implement" }];
    const { store, runner, run, request } = await bench((sent) => [
      { kind: "stage_started", seq: 1, stageKey: "implement", displayName: "implement" },
      { kind: "guard_blocked", guard: "allow_list", call: "git_push", stageKey: "implement" },
      { kind: "stage_finished", stage: harnessStage(1, "implement", { verdict: "failed" }) },
      // Even a harness that reported success: the audit decides.
      {
        kind: "done",
        result: harnessResult(sent.dryRun, {
          status: "complete",
          guardAudit: audit,
          guardsClean: false,
        }),
      },
    ]);

    await runner.launch(run, request, BUDGET);
    const events = await collect(runner.follow(run.id));

    expect(events[2]).toEqual({
      kind: "guard_blocked",
      guard: "allow_list",
      call: "git_push",
      stageKey: "implement",
    });
    expect(events.at(-1)).toMatchObject({
      dryRun: {
        status: "failed",
        guardsClean: false,
        guardAudit: [{ guard: "allow_list", call: "git_push", count: 1, stage_key: "implement" }],
        failureReason: expect.stringContaining("refused 1 call") as string,
      },
    });
    expect(stored(store, run)).toMatchObject({ status: "failed", guards_clean: false });
  });

  it("cancels mid-run: the rows so far are kept and the end is neither a failure nor a budget stop", async () => {
    const { store, engine, runner, run, request } = await bench((sent) => [
      { kind: "stage_finished", stage: ANALYZE },
      { kind: "pause", name: "implementing" },
      { kind: "stage_finished", stage: IMPLEMENT },
      { kind: "done", result: harnessResult(sent.dryRun) },
    ]);

    await runner.launch(run, request, BUDGET);
    const watching = collect(runner.follow(run.id));
    await engine.atPause("implementing");

    const ended = await runner.cancel(run);

    expect(ended).toMatchObject({ status: "cancelled", failure_reason: null });
    expect(store.stageRows.map((row) => row.stage_key)).toEqual(["analyze"]);
    const done = (await watching).at(-1);
    expect(done).toMatchObject({
      kind: "done",
      dryRun: { status: "cancelled", failureReason: null },
    });
    expect(done?.kind === "done" && done.dryRun.stages).toHaveLength(1);
    expect(Logger.prototype.error).not.toHaveBeenCalled();
    expect(runner.isLive(run.id)).toBe(false);
  });

  it("cancels a run no process is holding, straight in the record", async () => {
    const { store, runner, run } = await bench(() => []);

    expect(await runner.cancel(run)).toMatchObject({ status: "cancelled" });
    expect(stored(store, run).status).toBe("cancelled");

    // And a run that had already ended is answered as it stands.
    expect(await runner.cancel(stored(store, run))).toMatchObject({ status: "cancelled" });
  });

  it("ends the runs it holds when the process stops, rather than leave them running", async () => {
    const { store, engine, runner, run, request } = await bench((sent) => [
      { kind: "stage_finished", stage: ANALYZE },
      { kind: "pause", name: "implementing" },
      { kind: "done", result: harnessResult(sent.dryRun) },
    ]);

    await runner.launch(run, request, BUDGET);
    await engine.atPause("implementing");
    await runner.onModuleDestroy();

    expect(stored(store, run)).toMatchObject({ status: "failed", failure_reason: HARNESS_STOPPED });
    expect(store.stageRows).toHaveLength(1);
    expect(runner.isLive(run.id)).toBe(false);
  });

  it("fails a run whose stream ended without a result", async () => {
    const { store, runner, run, request } = await bench(() => [
      { kind: "stage_finished", stage: ANALYZE },
    ]);

    await runner.launch(run, request, BUDGET);
    const done = (await collect(runner.follow(run.id))).at(-1);

    expect(done).toMatchObject({ dryRun: { status: "failed", failureReason: HARNESS_STOPPED } });
    expect(store.stageRows).toHaveLength(1);
  });

  it("fails a run the engine broke off, and says the harness stopped", async () => {
    const { engine, runner, run, request } = await bench(() => []);
    engine.dryRun = async function* broken() {
      await Promise.resolve();
      yield { kind: "stage_finished" as const, stage: ANALYZE };
      throw (await import("../engine/engine.errors")).engineUnavailable();
    };

    await runner.launch(run, request, BUDGET);
    const done = (await collect(runner.follow(run.id))).at(-1);

    expect(done).toMatchObject({ dryRun: { status: "failed", failureReason: HARNESS_STOPPED } });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it("fails a run whose row could not be recorded, rather than leave it open", async () => {
    const { store, runner, run, request } = await bench((sent) => [
      { kind: "stage_finished", stage: ANALYZE },
      { kind: "done", result: harnessResult(sent.dryRun, { stages: [ANALYZE] }) },
    ]);
    store.failStageInsert = true;

    await runner.launch(run, request, BUDGET);
    const done = (await collect(runner.follow(run.id))).at(-1);

    expect(done).toMatchObject({ dryRun: { status: "failed", failureReason: RESULT_UNRECORDED } });
    expect(stored(store, run).status).toBe("failed");
  });

  it("releases its subscribers when the record itself cannot be ended", async () => {
    const { store, runner, run, request } = await bench((sent) => [
      { kind: "done", result: harnessResult(sent.dryRun) },
    ]);
    store.finish = () => Promise.reject(new Error("connection terminated"));

    await runner.launch(run, request, BUDGET);
    const events = await collect(runner.follow(run.id));
    await runner.settled(run.id);

    expect(events.map((event) => event.kind)).toEqual(["accepted"]);
    expect(runner.isLive(run.id)).toBe(false);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining("could not be ended"),
      expect.anything(),
    );
  });
});
