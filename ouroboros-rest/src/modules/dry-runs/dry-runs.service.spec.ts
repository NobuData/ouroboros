import { Logger } from "@nestjs/common";

import type { EngineClient } from "../engine/engine.client";
import { ENGINE_DRY_RUN_TIMEOUT_MS, type EngineDryRunRequest } from "../engine/engine.dryruns";
import { ENGINE_ERRORS } from "../engine/engine.errors";
import { WORKFLOW_ERRORS } from "../workflows/workflows.errors";
import type { PinnedCommitReader } from "./dry-runs.commit";
import { DRY_RUN_ERRORS } from "./dry-runs.errors";
import { DryRunPickerService } from "./dry-runs.picker.service";
import type { DryRunPlanService } from "./dry-runs.plans";
import { DryRunRecords } from "./dry-runs.records";
import { DryRunRunner } from "./dry-runs.runner";
import {
  DISPATCH_FAILED,
  DryRunsService,
  INTERRUPTED,
  PRECHECK_UNAVAILABLE,
  precheckReason,
} from "./dry-runs.service";
import {
  DEFINITION,
  DryRunStore,
  FakeEngine,
  HARNESS,
  PINNED_SHA,
  SESSION_ID,
  TICKET_ID,
  WORKFLOW_ID,
  WORKSPACE,
  guardTrace,
  harnessResult,
  harnessStage,
  ticketRow,
  workflowRow,
  type ScriptStep,
} from "./dry-runs.store.fixture";
import type { DryRunStreamEvent } from "./dry-runs.stream";

const BODY = { ticketId: TICKET_ID, draftRev: 3 };
const PLANS = {
  implement: {
    alias: "coder-max",
    resolutionVersion: "res-7",
    manifest: "## Facts\n\n- CAN frames are 8 bytes.",
    skillResolved: true,
    warnings: [],
  },
};

function bench(
  script: (request: EngineDryRunRequest) => ScriptStep[] = (sent) => [
    { kind: "done", result: harnessResult(sent.dryRun) },
  ],
) {
  const store = new DryRunStore();
  const engine = new FakeEngine(script);
  const records = new DryRunRecords(store.repository);
  const runner = new DryRunRunner(engine as unknown as EngineClient, store.repository, records);
  const commits = {
    pin: jest.fn().mockResolvedValue({
      slug: "acme-robotics/helios-firmware",
      sha: PINNED_SHA,
      token: "ghp_read_only",
    }),
  };
  const planner = { plans: jest.fn().mockResolvedValue(PLANS) };
  const service = new DryRunsService(
    store.repository,
    records,
    runner,
    commits as unknown as PinnedCommitReader,
    planner as unknown as DryRunPlanService,
    new DryRunPickerService(store.repository),
    engine as unknown as EngineClient,
  );

  return { store, engine, runner, commits, planner, service };
}

async function collect(stream: AsyncGenerator<DryRunStreamEvent>) {
  const events: DryRunStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function refusal(work: Promise<unknown>): Promise<{ code: string; details?: unknown }> {
  try {
    await work;
  } catch (error) {
    return error as { code: string; details?: unknown };
  }
  throw new Error("expected a refusal");
}

describe("starting a dry run", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  it("pins the commit, passes the pre-check, budgets, resolves the stages and dispatches", async () => {
    const { store, engine, runner, commits, planner, service } = bench();
    store.traces = [guardTrace(500)];

    const started = await service.start(WORKSPACE, WORKFLOW_ID, { ...BODY, sessionId: SESSION_ID });

    expect(started).toMatchObject({
      workflowId: WORKFLOW_ID,
      draft: { baseVersion: null, rev: 3, label: "v0.3" },
      ticket: { id: TICKET_ID, key: "#489" },
      sessionId: SESSION_ID,
      pinnedSha: PINNED_SHA,
      status: "running",
      precheckFindings: [],
      budget: {
        capCents: 500,
        source: "draft_guard",
        workspaceCapCents: 1000,
        draftGuardCents: 500,
      },
    });
    expect(commits.pin).toHaveBeenCalledWith(WORKSPACE, "acme-robotics", "helios-firmware", "main");
    expect(planner.plans).toHaveBeenCalledWith(
      {
        organizationId: WORKSPACE,
        workflowSlug: "security-patch",
        repository: "acme-robotics/helios-firmware",
        labels: ["bug", "can-bus"],
        effort: "m",
      },
      DEFINITION,
    );

    await runner.settled(started.id);
    expect(engine.validations).toBe(1);
    expect(engine.dispatched).toEqual([
      {
        dryRun: started.id,
        definition: DEFINITION,
        ticket: {
          externalKey: "#489",
          source: "github",
          labels: ["bug", "can-bus"],
          estimate: { effort: "m" },
          title: "CAN arbitration-lost storm under full telemetry load",
          body: "Under full telemetry load the bus loses arbitration repeatedly.",
        },
        repository: {
          slug: "acme-robotics/helios-firmware",
          pinnedSha: PINNED_SHA,
          token: "ghp_read_only",
        },
        stages: PLANS,
        budget: { runCostCents: 500, stageCostCents: null, runTokens: null, stageTokens: null },
      },
    ]);
    // The read token goes to the harness and nowhere a person can read it back.
    expect(JSON.stringify(started)).not.toContain("ghp_read_only");
    expect(JSON.stringify(store.runs)).not.toContain("ghp_read_only");
  });

  it("stops a $5 draft guard under a larger workspace cap at $5, with the partial rows kept", async () => {
    const analyze = harnessStage(1, "analyze");
    const { store, engine, runner, service } = bench((sent) => [
      { kind: "stage_finished", stage: analyze },
      {
        kind: "done",
        result: harnessResult(sent.dryRun, {
          status: "budget_stopped",
          failureReason: `the run's spend cap of ${String(sent.budget.runCostCents)} cents was reached`,
          stages: [
            analyze,
            harnessStage(2, "implement", {
              verdict: "not_reached",
              how: "deterministic",
              note: "",
              metrics: {},
            }),
          ],
          costCents: sent.budget.runCostCents,
          tokens: 700000,
        }),
      },
    ]);
    store.capCents = 2500;
    store.traces = [guardTrace(500)];

    const started = await service.start(WORKSPACE, WORKFLOW_ID, BODY);
    await runner.settled(started.id);
    const ended = await service.detail(WORKSPACE, WORKFLOW_ID, started.id);

    expect(started.budget).toMatchObject({
      capCents: 500,
      source: "draft_guard",
      workspaceCapCents: 2500,
    });
    expect(engine.dispatched[0]?.budget.runCostCents).toBe(500);
    expect(ended).toMatchObject({
      status: "budget_stopped",
      failureReason: "the run's spend cap of 500 cents was reached",
      totals: { costCents: 500 },
    });
    expect(ended.stages.map((stage) => [stage.stageKey, stage.verdict])).toEqual([
      ["analyze", "ok"],
      ["implement", "not_reached"],
    ]);
  });

  it("runs under the workspace cap alone when the draft carries no guard", async () => {
    const { engine, runner, service } = bench();

    const started = await service.start(WORKSPACE, WORKFLOW_ID, BODY);
    await runner.settled(started.id);

    expect(started.budget).toMatchObject({
      capCents: 1000,
      source: "workspace_cap",
      draftGuardCents: null,
    });
    expect(engine.dispatched[0]?.budget.runCostCents).toBe(1000);
  });

  it("fails a structurally invalid draft at the pre-check, with anchored findings, invoking nothing", async () => {
    const { store, engine, planner, service } = bench();
    // A stage nothing reaches: the DSL validator's own structural stage.
    store.definition = {
      ...DEFINITION,
      nodes: [...DEFINITION.nodes, { ...DEFINITION.nodes[1], id: "orphan", title: "orphan" }],
    };

    const failed = await service.start(WORKSPACE, WORKFLOW_ID, BODY);

    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe(precheckReason(failed.precheckFindings?.length ?? 0));
    expect(failed.precheckFindings?.length).toBeGreaterThan(0);
    expect(failed.precheckFindings?.every((finding) => finding.source === "dsl")).toBe(true);
    expect(failed.precheckFindings?.some((finding) => finding.node === "orphan")).toBe(true);
    expect(failed.stages).toEqual([]);
    expect(failed.budget).toBeUndefined();
    // The gateway spy: no model, no estimator, no stage resolution — not even the engine's
    // own validator, because the cheap stage already refused.
    expect(engine.dispatched).toEqual([]);
    expect(engine.validations).toBe(0);
    expect(planner.plans).not.toHaveBeenCalled();
    // No dry run beyond the pre-check's record.
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ status: "failed" });
  });

  it("fails at the pre-check on the engine's findings too, anchored the way a publish anchors them", async () => {
    const { engine, service } = bench();
    engine.findings = [
      { code: "graph.unreachable", message: "Stage build can never run.", node: "build" },
    ];

    const failed = await service.start(WORKSPACE, WORKFLOW_ID, BODY);

    expect(failed).toMatchObject({
      status: "failed",
      failureReason: "The structural pre-check found 1 problem; nothing was invoked.",
      precheckFindings: [
        {
          source: "engine",
          code: "graph.unreachable",
          message: "Stage build can never run.",
          node: "build",
        },
      ],
    });
    expect(engine.dispatched).toEqual([]);
  });

  it("does not leave a record in pre-check when the engine cannot run it", async () => {
    const { store, engine, service } = bench();
    engine.validateFails = true;

    const refused = await refusal(service.start(WORKSPACE, WORKFLOW_ID, BODY));

    expect(refused.code).toBe(ENGINE_ERRORS.unavailable);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ status: "failed", failure_reason: PRECHECK_UNAVAILABLE });
    expect(engine.dispatched).toEqual([]);
  });

  it("does not leave a run open when its dispatch could not be prepared", async () => {
    const { store, engine, planner, service } = bench();
    planner.plans.mockRejectedValue(new Error("routing is down"));

    await expect(service.start(WORKSPACE, WORKFLOW_ID, BODY)).rejects.toThrow("routing is down");

    expect(store.runs[0]).toMatchObject({ status: "failed", failure_reason: DISPATCH_FAILED });
    expect(engine.dispatched).toEqual([]);
  });

  it("refuses what it cannot run, before anything is pinned or recorded", async () => {
    const cases: [string, (store: DryRunStore) => void, object, string][] = [
      [
        "another workspace's workflow",
        (store) => (store.workflows = [workflowRow({ organization_id: "other" })]),
        BODY,
        WORKFLOW_ERRORS.workflowNotFound,
      ],
      [
        "a workflow with no draft",
        (store) => (store.definition = undefined),
        BODY,
        WORKFLOW_ERRORS.draftAbsent,
      ],
      ["a draft that moved", () => undefined, { ...BODY, draftRev: 2 }, DRY_RUN_ERRORS.draftStale],
      [
        "a ticket that is not there",
        (store) => (store.tickets = []),
        BODY,
        DRY_RUN_ERRORS.ticketNotFound,
      ],
      [
        "a session about something else",
        () => undefined,
        { ...BODY, sessionId: "5eed008a-0000-4000-8000-0000000000ff" },
        DRY_RUN_ERRORS.sessionMismatch,
      ],
      [
        "a ticket from a tracker no trigger can name",
        (store) => (store.tickets = [ticketRow({ source_kind: "custom" })]),
        BODY,
        DRY_RUN_ERRORS.sourceUnsupported,
      ],
      [
        "a ticket naming no mirrored repository",
        (store) => (store.tickets = [ticketRow({ repo_owner: null, repo_name: null })]),
        BODY,
        DRY_RUN_ERRORS.repositoryUnresolved,
      ],
    ];

    for (const [, arrange, body, code] of cases) {
      const { store, commits, service } = bench();
      arrange(store);

      const refused = await refusal(service.start(WORKSPACE, WORKFLOW_ID, body as typeof BODY));

      expect(refused.code).toBe(code);
      expect(commits.pin).not.toHaveBeenCalled();
      expect(store.runs).toEqual([]);
    }

    const stale = bench();
    expect(
      (await refusal(stale.service.start(WORKSPACE, WORKFLOW_ID, { ...BODY, draftRev: 2 })))
        .details,
    ).toEqual({
      requestedDraftRev: 2,
      currentDraftRev: 3,
    });
  });

  it("refuses a second dry run while one is open, naming it", async () => {
    const { engine, runner, service } = bench((sent) => [
      { kind: "pause", name: "running" },
      { kind: "done", result: harnessResult(sent.dryRun) },
    ]);

    const first = await service.start(WORKSPACE, WORKFLOW_ID, BODY);
    await engine.atPause("running");
    const refused = await refusal(service.start(WORKSPACE, WORKFLOW_ID, BODY));

    expect(refused).toMatchObject({
      code: DRY_RUN_ERRORS.inProgress,
      details: { dryRunId: first.id },
    });
    engine.release("running");
    await runner.settled(first.id);
    await expect(service.start(WORKSPACE, WORKFLOW_ID, BODY)).resolves.toMatchObject({
      status: "running",
    });
  });

  it("reaps a run left open by a process that stopped, once it has outlived the harness deadline", async () => {
    const { store, service } = bench();
    const abandoned = await store.insert({
      organizationId: WORKSPACE,
      workflowId: WORKFLOW_ID,
      baseVersion: null,
      draftRev: 2,
      sessionId: null,
      ticketId: TICKET_ID,
      pinnedSha: PINNED_SHA,
    });
    await store.markRunning(abandoned.id);

    // Still inside the deadline: it may be running in another process.
    expect((await refusal(service.start(WORKSPACE, WORKFLOW_ID, BODY))).code).toBe(
      DRY_RUN_ERRORS.inProgress,
    );

    store.runs[0] = {
      ...store.runs[0],
      started_at: new Date(Date.now() - ENGINE_DRY_RUN_TIMEOUT_MS - 1000),
    };
    const started = await service.start(WORKSPACE, WORKFLOW_ID, BODY);

    expect(started.status).toBe("running");
    expect(store.runs[0]).toMatchObject({ status: "failed", failure_reason: INTERRUPTED });
  });

  it("reaps one abandoned in its pre-check the same way", async () => {
    const { store, service } = bench();
    await store.insert({
      organizationId: WORKSPACE,
      workflowId: WORKFLOW_ID,
      baseVersion: null,
      draftRev: 2,
      sessionId: null,
      ticketId: TICKET_ID,
      pinnedSha: PINNED_SHA,
    });
    store.runs[0] = {
      ...store.runs[0],
      started_at: new Date(Date.now() - ENGINE_DRY_RUN_TIMEOUT_MS - 1000),
    };

    await service.start(WORKSPACE, WORKFLOW_ID, BODY);

    expect(store.runs[0]).toMatchObject({ status: "failed", failure_reason: INTERRUPTED });
  });

  it("still refuses when the abandoned run cannot be ended", async () => {
    const { store, service } = bench();
    const abandoned = await store.insert({
      organizationId: WORKSPACE,
      workflowId: WORKFLOW_ID,
      baseVersion: null,
      draftRev: 2,
      sessionId: null,
      ticketId: TICKET_ID,
      pinnedSha: PINNED_SHA,
    });
    await store.markRunning(abandoned.id);
    store.runs[0] = {
      ...store.runs[0],
      started_at: new Date(Date.now() - ENGINE_DRY_RUN_TIMEOUT_MS - 1000),
    };
    store.finish = () => Promise.reject(new Error("connection terminated"));

    expect((await refusal(service.start(WORKSPACE, WORKFLOW_ID, BODY))).code).toBe(
      DRY_RUN_ERRORS.inProgress,
    );
  });
});

describe("re-running, cancelling and reading", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("re-runs against the current draft revision, not the original", async () => {
    const { store, engine, runner, service } = bench();
    const first = await service.start(WORKSPACE, WORKFLOW_ID, { ...BODY, sessionId: SESSION_ID });
    await runner.settled(first.id);

    // Apply: the draft moves to v0.4 with a changed document.
    const applied = { ...DEFINITION, trigger: { event: "ticket_queued", conditions: {} } };
    store.workflows = [workflowRow({ draft_rev: 4 })];
    store.definition = applied;

    const second = await service.rerun(WORKSPACE, WORKFLOW_ID, first.id);
    await runner.settled(second.id);

    expect(first.draft.label).toBe("v0.3");
    expect(second).toMatchObject({
      draft: { rev: 4, label: "v0.4" },
      ticket: { key: "#489" },
      sessionId: SESSION_ID,
      status: "running",
    });
    expect(second.id).not.toBe(first.id);
    expect(engine.dispatched.map((request) => request.definition)).toEqual([DEFINITION, applied]);
  });

  it("refuses to re-run what is not there", async () => {
    const { store, runner, service } = bench();
    expect(
      (await refusal(service.rerun(WORKSPACE, WORKFLOW_ID, "5eed008b-0000-4000-8000-00000000dead")))
        .code,
    ).toBe(DRY_RUN_ERRORS.notFound);

    const first = await service.start(WORKSPACE, WORKFLOW_ID, BODY);
    await runner.settled(first.id);
    store.definition = undefined;
    expect((await refusal(service.rerun(WORKSPACE, WORKFLOW_ID, first.id))).code).toBe(
      WORKFLOW_ERRORS.draftAbsent,
    );

    store.definition = DEFINITION;
    store.tickets = [];
    expect((await refusal(service.rerun(WORKSPACE, WORKFLOW_ID, first.id))).code).toBe(
      DRY_RUN_ERRORS.ticketNotFound,
    );
  });

  it("cancels mid-run, distinguishably from a failure and from a budget stop", async () => {
    const analyze = harnessStage(1, "analyze");
    const { engine, service } = bench((sent) => [
      { kind: "stage_finished", stage: analyze },
      { kind: "pause", name: "implementing" },
      { kind: "done", result: harnessResult(sent.dryRun) },
    ]);
    const started = await service.start(WORKSPACE, WORKFLOW_ID, BODY);
    await engine.atPause("implementing");

    const cancelled = await service.cancel(WORKSPACE, WORKFLOW_ID, started.id);

    expect(cancelled).toMatchObject({ status: "cancelled", failureReason: null });
    expect(cancelled.stages.map((stage) => stage.stageKey)).toEqual(["analyze"]);
    expect(["failed", "budget_stopped", "complete"]).not.toContain(cancelled.status);

    const again = await refusal(service.cancel(WORKSPACE, WORKFLOW_ID, started.id));
    expect(again).toMatchObject({
      code: DRY_RUN_ERRORS.notRunning,
      details: { status: "cancelled" },
    });
    expect(
      (
        await refusal(
          service.cancel(WORKSPACE, WORKFLOW_ID, "5eed008b-0000-4000-8000-00000000dead"),
        )
      ).code,
    ).toBe(DRY_RUN_ERRORS.notFound);
  });

  it("reads the history: the count, the draft's line, the runs newest first and the dry-run spend", async () => {
    const { store, runner, service } = bench((sent) => [
      { kind: "done", result: harnessResult(sent.dryRun, { costCents: 31, tokens: 96000 }) },
    ]);
    const first = await service.start(WORKSPACE, WORKFLOW_ID, BODY);
    await runner.settled(first.id);
    store.workflows = [workflowRow({ draft_rev: 4 })];
    const second = await service.rerun(WORKSPACE, WORKFLOW_ID, first.id);
    await runner.settled(second.id);

    const history = await service.history(WORKSPACE, WORKFLOW_ID);

    expect(history).toMatchObject({
      draft: { label: "v0.4", rev: 4, baseVersion: null, copilotEdits: 2 },
      count: 2,
      spend: { costCents: 62, unpriced: 0 },
    });
    expect(history.runs.map((run) => [run.id, run.draftLabel, run.ticket.key, run.status])).toEqual(
      [
        [second.id, "v0.4", "#489", "complete"],
        [first.id, "v0.3", "#489", "complete"],
      ],
    );
    expect(history.runs[0]?.totals).toEqual({ durationMs: 161000, costCents: 31, tokens: 96000 });
  });

  it("ranks the picker's candidates for the draft as it stands", async () => {
    const { store, service } = bench();
    store.tickets = [
      ticketRow({
        id: "t-491",
        external_key: "#491",
        labels: ["security", "cve"],
        source_updated_at: new Date("2026-10-11T00:00:00Z"),
      }),
      ticketRow(),
      ticketRow({ id: "t-sup", external_key: "SUP-1", source_kind: "custom" }),
    ];

    const picked = await service.candidates(WORKSPACE, WORKFLOW_ID);

    expect(picked.draftLabel).toBe("v0.3");
    expect(
      picked.candidates.map((candidate) => [candidate.rank, candidate.ticket.key, candidate.score]),
    ).toEqual([
      [1, "#489", 1],
      [2, "#491", 0],
    ]);
    expect(picked.candidates[0]).toMatchObject({
      matchesTrigger: false,
      ticket: { labels: ["bug", "can-bus"], effort: "m", source: "github" },
      reason: expect.stringContaining("no `security` label") as string,
    });
    expect((await service.candidates(WORKSPACE, WORKFLOW_ID, 1)).candidates).toHaveLength(1);

    store.definition = undefined;
    expect((await refusal(service.candidates(WORKSPACE, WORKFLOW_ID))).code).toBe(
      WORKFLOW_ERRORS.draftAbsent,
    );
  });

  it("derives the safety strip from what the engine says its harness is", async () => {
    const { engine, service } = bench();

    expect(
      (await service.safety(WORKSPACE, WORKFLOW_ID)).columns.map((column) => column.holds),
    ).toEqual([true, true, true]);

    engine.harness = { ...HARNESS, guards: [] };
    const weakened = await service.safety(WORKSPACE, WORKFLOW_ID);
    expect(weakened.guards).toEqual([]);
    expect(weakened.columns[0]?.holds).toBe(false);

    expect((await refusal(service.safety("other", WORKFLOW_ID))).code).toBe(
      WORKFLOW_ERRORS.workflowNotFound,
    );
  });

  it("follows a live run, and reads a finished one back from the record", async () => {
    const analyze = harnessStage(1, "analyze");
    const { engine, runner, service } = bench((sent) => [
      { kind: "stage_started", seq: 1, stageKey: "analyze", displayName: "analyze" },
      { kind: "stage_finished", stage: analyze },
      { kind: "pause", name: "mid" },
      { kind: "done", result: harnessResult(sent.dryRun, { stages: [analyze], costCents: 31 }) },
    ]);
    const started = await service.start(WORKSPACE, WORKFLOW_ID, BODY);
    await engine.atPause("mid");

    const live = collect(service.events(WORKSPACE, WORKFLOW_ID, started.id));
    engine.release("mid");

    expect((await live).map((event) => event.kind)).toEqual([
      "accepted",
      "stage_started",
      "stage_finished",
      "done",
    ]);
    await runner.settled(started.id);

    const replayed = await collect(service.events(WORKSPACE, WORKFLOW_ID, started.id));
    expect(replayed.map((event) => event.kind)).toEqual(["accepted", "stage_finished", "done"]);
    expect(replayed.at(-1)).toMatchObject({
      dryRun: { status: "complete", totals: { costCents: 31 } },
    });

    const stranger = service.events(WORKSPACE, WORKFLOW_ID, "5eed008b-0000-4000-8000-00000000dead");
    await expect(stranger.next()).rejects.toMatchObject({ code: DRY_RUN_ERRORS.notFound });
  });

  it("gives a run nobody here is holding its rows so far, and no `done` until it ends", async () => {
    const { store, service } = bench();
    const elsewhere = await store.insert({
      organizationId: WORKSPACE,
      workflowId: WORKFLOW_ID,
      baseVersion: null,
      draftRev: 3,
      sessionId: null,
      ticketId: TICKET_ID,
      pinnedSha: PINNED_SHA,
    });
    await store.markRunning(elsewhere.id);
    await store.insertStage(elsewhere, harnessStage(1, "analyze"));

    const events = await collect(service.events(WORKSPACE, WORKFLOW_ID, elsewhere.id));

    expect(events.map((event) => event.kind)).toEqual(["accepted", "stage_finished"]);
  });
});
