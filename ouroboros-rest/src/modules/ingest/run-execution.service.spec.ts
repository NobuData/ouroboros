import { Logger } from "@nestjs/common";

import type { Run } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import type { GuardrailService } from "../guardrails/guardrails.service";
import type { CodeWorkspace } from "../research/code/code.workspace";
import type { ResolutionService } from "../routing/resolution.service";
import { routeNotFound } from "../routing/routing.errors";
import type { IngestRepository } from "./ingest.repository";
import { requestDigest } from "./ingest.idempotency";
import type { RunExecutionRepository } from "./run-execution.repository";
import type { FinishRunDto } from "./run-execution.dto";
import { FINISH_STATUS, RunExecutionService } from "./run-execution.service";
import type { RunNeedsHumanEmitter } from "./run-needs-human.emitter";

/**
 * The execution bridge's policy (#160, ADR decision A) over stand-ins: who may start, the fence on
 * every later write, the base commit set once, and the four finish outcomes — including the
 * idempotent replay, the unconfirmed requeue, and the inbox card a hand-over files.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const ORG = "acme-robotics-id";
const REPO = "5eed0003-0000-4000-8000-000000000001";
const AT = new Date("2026-10-15T14:25:00.000Z");
const BASE = "a".repeat(40);
const DOCUMENT = { dsl_version: "1.0", nodes: [], edges: [] };
const TICKET = "5eed0010-0000-4000-8000-000000000482";
const CRITERIA = [
  { id: "c-1", text: "Telemetry frames arrive in ISR order" },
  { id: "c-2", text: "No regression in e-stop response" },
];
const REF = {
  workspace: ORG,
  slug: "acme-robotics/helios-firmware",
  remote: "https://github.com/acme-robotics/helios-firmware.git",
  token: "ghs_per_call",
};

/** A live, coding run at epoch 2. */
function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN,
    organization_id: ORG,
    github_repo_id: REPO,
    issue_number: 482,
    issue_title: "Fix flaky CAN-bus telemetry test",
    workflow_tag: "docs-loop",
    workflow_version_pin: 1,
    model: "coder-max",
    status: "coding",
    branch_name: null,
    simulated: false,
    origin: "live",
    exec_epoch: 2,
    exec_worker: "engine-worker-a",
    exec_heartbeat_at: AT,
    exec_base_commit: null,
    exec_checkpoint: null,
    exec_checkpoint_at: null,
    ...overrides,
  } as Run;
}

/** The code a refusal carries. */
async function refusal(
  promise: Promise<unknown>,
): Promise<{ code: string; status: number; details: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) {
      const envelope = error.envelope();
      return { code: envelope.code, status: error.getStatus(), details: envelope.details };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

/**
 * The service over stand-ins.
 *
 * @param options - The locked row, a stored receipt, and what the reads answer.
 * @returns The service and its stand-ins.
 */
function rig(
  options: {
    row?: Run | undefined;
    receipt?: { request_digest: string; response: unknown } | undefined;
    pinned?: { definition: unknown } | undefined;
    repository?: unknown;
    requeued?: string | null;
    emitter?: jest.Mock;
    estimate?: { effort: string; estMinutes: number | null } | undefined;
    criteria?: { id: string; text: string }[];
    starter?: { name: string; email: string } | undefined;
    resolve?: jest.Mock;
  } = {},
) {
  const row = "row" in options ? options.row : run();
  const runs = {
    db: "pool",
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work("trx")),
    lockRun: jest.fn().mockResolvedValue(row),
    pinnedDefinition: jest
      .fn()
      .mockResolvedValue("pinned" in options ? options.pinned : { definition: DOCUMENT }),
    findReceipt: jest.fn().mockResolvedValue(options.receipt),
    insertReceipt: jest.fn().mockResolvedValue(undefined),
  };
  const execution = {
    start: jest.fn(async () =>
      Promise.resolve({
        ...(row ?? run()),
        exec_epoch: (row?.exec_epoch ?? 0) + 1,
        branch_name: row?.branch_name ?? `ouro/run-${RUN}-482`,
      }),
    ),
    heartbeat: jest.fn().mockResolvedValue(AT),
    checkpoint: jest.fn().mockResolvedValue(AT),
    finish: jest.fn().mockResolvedValue(undefined),
    appendFinishEvent: jest.fn().mockResolvedValue(undefined),
    requeue: jest.fn().mockResolvedValue({
      id: "requeued" in options ? options.requeued : "q-new",
    }),
    repositoryOf: jest
      .fn()
      .mockResolvedValue(
        "repository" in options
          ? options.repository
          : { id: REPO, slug: REF.slug, name: "helios-firmware", defaultBranch: "main" },
      ),
    ticketOf: jest.fn().mockResolvedValue({
      id: TICKET,
      body: "The CAN-bus test flakes.",
      labels: ["flaky", "telemetry"],
    }),
    acceptanceCriteriaOf: jest
      .fn()
      .mockResolvedValue("criteria" in options ? options.criteria : CRITERIA),
    latestEstimate: jest
      .fn()
      .mockResolvedValue(
        "estimate" in options ? options.estimate : { effort: "m", estMinutes: 90 },
      ),
    starterOf: jest.fn().mockResolvedValue(options.starter),
  };
  const code = { repositoryRef: jest.fn().mockResolvedValue(REF) };
  const guardrails = {
    effectiveProtectedPaths: jest.fn().mockResolvedValue([".github/workflows/**", "infra/**"]),
  };
  const needsHuman = { handedOver: options.emitter ?? jest.fn().mockResolvedValue(null) };
  const resolutions = { resolve: options.resolve ?? jest.fn() };

  const service = new RunExecutionService(
    runs as unknown as IngestRepository,
    execution as unknown as RunExecutionRepository,
    code as unknown as CodeWorkspace,
    guardrails as unknown as GuardrailService,
    needsHuman as unknown as RunNeedsHumanEmitter,
    resolutions as unknown as ResolutionService,
  );

  return { service, runs, execution, code, guardrails, needsHuman, resolutions };
}

/** A finish request. */
function finishing(overrides: Partial<FinishRunDto> = {}): FinishRunDto {
  return {
    epoch: 2,
    idempotency_key: "finish-1",
    outcome: "failed",
    reason: "implement failed twice",
    ...overrides,
  };
}

describe("the run-execution service (#160)", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("starting", () => {
    it("takes a new epoch and answers everything the interpreter needs", async () => {
      const { service, execution, code, guardrails, runs } = rig();

      const started = await service.start(RUN, { worker: "engine-worker-b" });

      expect(runs.lockRun).toHaveBeenCalledWith("trx", RUN);
      expect(execution.start).toHaveBeenCalledWith("trx", RUN, "engine-worker-b");
      expect(runs.pinnedDefinition).toHaveBeenCalledWith("trx", ORG, "docs-loop", 1);
      expect(guardrails.effectiveProtectedPaths).toHaveBeenCalledWith("trx", {
        organizationId: ORG,
        githubRepoId: REPO,
        issueNumber: 482,
        workflowTag: "docs-loop",
        workflowVersionPin: 1,
      });
      expect(code.repositoryRef).toHaveBeenCalledWith(ORG, {
        id: REPO,
        slug: REF.slug,
        name: "helios-firmware",
        defaultBranch: "main",
      });
      expect(started).toEqual({
        run_id: RUN,
        epoch: 3,
        organization_id: ORG,
        issue_number: 482,
        issue_title: "Fix flaky CAN-bus telemetry test",
        issue_body: "The CAN-bus test flakes.",
        labels: ["flaky", "telemetry"],
        effort: "m",
        acceptance_criteria: CRITERIA,
        model: "coder-max",
        task_models: {},
        started_by: null,
        branch_name: `ouro/run-${RUN}-482`,
        workflow: { tag: "docs-loop", version: 1, document: DOCUMENT },
        repository: { id: REPO, slug: REF.slug, default_branch: "main", ref: REF },
        protected_paths: [".github/workflows/**", "infra/**"],
        base_commit: null,
        checkpoint: null,
        status: "coding",
      });
    });

    it("names the alias each inherited task routes to, so a stage asks with its own (#1321)", async () => {
      const definition = {
        ...DOCUMENT,
        nodes: [
          { id: "plan", type: "llm", config: { routing: { inherit_task: "plan" } } },
          { id: "implement", type: "llm", config: { routing: { inherit_task: "implement" } } },
          { id: "build", type: "infra", config: {} },
        ],
      };
      const resolve = jest.fn((_org: string, kind: string) =>
        Promise.resolve({
          outcome: "resolved",
          chain: [
            { alias: `${kind}-dropped`, decision: "dropped", provider: { id: "p" } },
            { alias: `${kind}-alias`, decision: "kept", provider: { id: "p" } },
          ],
        }),
      );
      const { service } = rig({ pinned: { definition }, resolve });

      const started = await service.start(RUN, { worker: "w" });

      expect(resolve).toHaveBeenCalledWith(ORG, "plan");
      expect(resolve).toHaveBeenCalledWith(ORG, "implement");
      expect(started.task_models).toEqual({ plan: "plan-alias", implement: "implement-alias" });
    });

    it("leaves out a task the workspace does not route, and the start still answers", async () => {
      const definition = {
        ...DOCUMENT,
        nodes: [
          { id: "implement", type: "llm", config: { routing: { inherit_task: "implement" } } },
        ],
      };
      const resolve = jest.fn().mockRejectedValue(routeNotFound("implement"));
      const { service } = rig({ pinned: { definition }, resolve });

      expect((await service.start(RUN, { worker: "w" })).task_models).toEqual({});
    });

    it("reads the acceptance criteria of the run's canonical ticket", async () => {
      const { service, execution } = rig();

      await service.start(RUN, { worker: "w" });

      expect(execution.acceptanceCriteriaOf).toHaveBeenCalledWith(
        "trx",
        expect.objectContaining({ id: RUN }),
        TICKET,
      );
    });

    it("names the person who started the run, the co-author of its commits (#1310)", async () => {
      const { service, execution } = rig({
        row: run({ started_by: "user-ken" }),
        starter: { name: "Ken Suenobu", email: "ken@acme-robotics.dev" },
      });

      const started = await service.start(RUN, { worker: "w" });

      expect(execution.starterOf).toHaveBeenCalledWith("trx", expect.objectContaining({ id: RUN }));
      expect(started.started_by).toEqual({ name: "Ken Suenobu", email: "ken@acme-robotics.dev" });
    });

    it("answers [] for an issue without imported acceptance criteria", async () => {
      const { service } = rig({ criteria: [] });

      await expect(service.start(RUN, { worker: "w" })).resolves.toEqual(
        expect.objectContaining({ acceptance_criteria: [] }),
      );
    });

    it("answers a null effort for an issue never sized", async () => {
      const { service, execution } = rig({ estimate: undefined });

      const started = await service.start(RUN, { worker: "w" });

      expect(execution.ticketOf).toHaveBeenCalledWith("trx", expect.objectContaining({ id: RUN }));
      expect(started.effort).toBeNull();
    });

    it("hands a restart the base commit and checkpoint it resumes from", async () => {
      const checkpoint = { position: "review", attempts: { implement: 1 } };
      const { service } = rig({
        row: run({ exec_base_commit: BASE, exec_checkpoint: checkpoint, exec_checkpoint_at: AT }),
      });

      const started = await service.start(RUN, { worker: "engine-worker-b" });

      expect(started.base_commit).toBe(BASE);
      expect(started.checkpoint).toEqual(checkpoint);
    });

    it("refuses a run nobody has", async () => {
      const { service, execution } = rig({ row: undefined });

      await expect(refusal(service.start(RUN, { worker: "w" }))).resolves.toMatchObject({
        code: "run_not_found",
        status: 404,
      });
      expect(execution.start).not.toHaveBeenCalled();
    });

    it.each([
      ["simulated", run({ origin: "simulated", simulated: true })],
      ["seeded", run({ origin: "seeded" })],
    ])("refuses a %s run, which is never executed", async (_origin, row) => {
      const { service, execution } = rig({ row });

      await expect(refusal(service.start(RUN, { worker: "w" }))).resolves.toMatchObject({
        code: "run_simulated",
        status: 409,
      });
      expect(execution.start).not.toHaveBeenCalled();
    });

    it.each(["review", "merged", "needs_human", "failed", "canceled"] as const)(
      "refuses a run in %s",
      async (status) => {
        const { service, execution } = rig({ row: run({ status }) });

        await expect(refusal(service.start(RUN, { worker: "w" }))).resolves.toMatchObject({
          code: "run_not_executable",
          status: 409,
          details: { run: RUN, status },
        });
        expect(execution.start).not.toHaveBeenCalled();
      },
    );

    it("starts a building run too", async () => {
      const { service } = rig({ row: run({ status: "building" }) });

      await expect(service.start(RUN, { worker: "w" })).resolves.toMatchObject({
        status: "building",
      });
    });

    it("refuses a run whose pin is gone, inside the transaction that took the epoch", async () => {
      const { service, code } = rig({ pinned: undefined });

      await expect(refusal(service.start(RUN, { worker: "w" }))).resolves.toMatchObject({
        code: "workflow_pin_not_found",
      });
      expect(code.repositoryRef).not.toHaveBeenCalled();
    });

    it("refuses a run whose repository left the workspace", async () => {
      const { service } = rig({ repository: undefined });

      await expect(refusal(service.start(RUN, { worker: "w" }))).resolves.toMatchObject({
        code: "repository_not_found",
      });
    });
  });

  describe("heartbeats", () => {
    it("stamps the heartbeat under the current epoch", async () => {
      const { service, execution } = rig();

      await expect(service.heartbeat(RUN, { epoch: 2 })).resolves.toEqual({
        epoch: 2,
        heartbeat_at: AT.toISOString(),
      });
      expect(execution.heartbeat).toHaveBeenCalledWith("trx", RUN);
    });

    it("is fenced when another start took the run, naming the current epoch", async () => {
      const { service, execution } = rig({ row: run({ exec_epoch: 3 }) });

      await expect(refusal(service.heartbeat(RUN, { epoch: 2 }))).resolves.toEqual({
        code: "fenced",
        status: 409,
        details: { current_epoch: 3 },
      });
      expect(execution.heartbeat).not.toHaveBeenCalled();
    });

    it("tells the engine to stop once a person cancelled the run", async () => {
      const { service, execution } = rig({ row: run({ status: "canceled" }) });

      await expect(refusal(service.heartbeat(RUN, { epoch: 2 }))).resolves.toMatchObject({
        code: "run_not_executable",
      });
      expect(execution.heartbeat).not.toHaveBeenCalled();
    });

    it("refuses a run nobody has", async () => {
      const { service } = rig({ row: undefined });

      await expect(refusal(service.heartbeat(RUN, { epoch: 1 }))).resolves.toMatchObject({
        code: "run_not_found",
      });
    });
  });

  describe("checkpoints", () => {
    const STATE = { position: "implement", attempts: { implement: 1 } };

    it("saves the state and sets the base commit the first time it is named", async () => {
      const { service, execution } = rig();

      await expect(
        service.checkpoint(RUN, { epoch: 2, base_commit: BASE, state: STATE }),
      ).resolves.toEqual({ checkpoint_at: AT.toISOString() });
      expect(execution.checkpoint).toHaveBeenCalledWith("trx", RUN, STATE, BASE);
    });

    it("leaves a set base commit alone when the same commit is named again, or none", async () => {
      const { service, execution } = rig({ row: run({ exec_base_commit: BASE }) });

      await service.checkpoint(RUN, { epoch: 2, base_commit: BASE, state: STATE });
      await service.checkpoint(RUN, { epoch: 2, state: STATE });

      expect(execution.checkpoint).toHaveBeenNthCalledWith(1, "trx", RUN, STATE, undefined);
      expect(execution.checkpoint).toHaveBeenNthCalledWith(2, "trx", RUN, STATE, undefined);
    });

    it("refuses a different base commit than the one set", async () => {
      const { service, execution } = rig({ row: run({ exec_base_commit: BASE }) });

      await expect(
        refusal(service.checkpoint(RUN, { epoch: 2, base_commit: "b".repeat(40), state: STATE })),
      ).resolves.toEqual({
        code: "base_commit_mismatch",
        status: 409,
        details: { current: BASE, offered: "b".repeat(40) },
      });
      expect(execution.checkpoint).not.toHaveBeenCalled();
    });

    it("is fenced under a superseded epoch, before anything else is judged", async () => {
      const { service, execution } = rig({
        row: run({ exec_epoch: 5, exec_base_commit: BASE, status: "failed" }),
      });

      await expect(
        refusal(service.checkpoint(RUN, { epoch: 4, base_commit: "b".repeat(40), state: STATE })),
      ).resolves.toMatchObject({ code: "fenced" });
      expect(execution.checkpoint).not.toHaveBeenCalled();
    });

    it("refuses a run that is no longer executing", async () => {
      const { service } = rig({ row: run({ status: "review" }) });

      await expect(
        refusal(service.checkpoint(RUN, { epoch: 2, state: STATE })),
      ).resolves.toMatchObject({ code: "run_not_executable" });
    });
  });

  describe("finishing", () => {
    it.each([
      ["review", "review"],
      ["needs_human", "needs_human"],
      ["failed", "failed"],
      ["back_to_queue", "failed"],
    ] as const)("ends %s as %s", async (outcome, status) => {
      const { service, execution } = rig();

      const finished = await service.finish(RUN, finishing({ outcome }));

      expect(FINISH_STATUS[outcome]).toBe(status);
      expect(execution.finish).toHaveBeenCalledWith("trx", RUN, status);
      expect(finished.status).toBe(status);
    });

    it("writes the reason to the transcript, with the outcome and the stage", async () => {
      const { service, execution } = rig();

      await service.finish(RUN, finishing({ stage_key: "implement" }));

      expect(execution.appendFinishEvent).toHaveBeenCalledWith(
        "trx",
        RUN,
        "implement failed twice",
        { outcome: "failed", stage_key: "implement" },
      );
    });

    it("requeues the ticket for back_to_queue and answers the item", async () => {
      const row = run();
      const { service, execution } = rig({ row });

      await expect(service.finish(RUN, finishing({ outcome: "back_to_queue" }))).resolves.toEqual({
        run_id: RUN,
        status: "failed",
        requeued_queue_item_id: "q-new",
      });
      expect(execution.requeue).toHaveBeenCalledWith("trx", row);
    });

    it("answers no item when the ticket is already queued", async () => {
      const { service } = rig({ requeued: null });

      await expect(
        service.finish(RUN, finishing({ outcome: "back_to_queue" })),
      ).resolves.toMatchObject({ requeued_queue_item_id: null });
    });

    it.each(["review", "needs_human", "failed"] as const)(
      "does not requeue for %s",
      async (outcome) => {
        const { service, execution } = rig();

        const finished = await service.finish(RUN, finishing({ outcome }));

        expect(execution.requeue).not.toHaveBeenCalled();
        expect(finished.requeued_queue_item_id).toBeNull();
      },
    );

    it("records a receipt under run.finish in the run's workspace", async () => {
      const request = finishing();
      const { service, runs } = rig();

      const finished = await service.finish(RUN, request);

      expect(runs.insertReceipt).toHaveBeenCalledWith("trx", {
        organization_id: ORG,
        run_id: RUN,
        operation: "run.finish",
        idempotency_key: "finish-1",
        request_digest: requestDigest(request),
        response: finished,
      });
    });

    it("files the inbox card after a hand-over to a person", async () => {
      const { service, needsHuman, runs } = rig();

      await service.finish(
        RUN,
        finishing({ outcome: "needs_human", reason: "guardrails need a person" }),
      );

      expect(needsHuman.handedOver).toHaveBeenCalledWith(RUN, "guardrails need a person");
      // After the commit: the receipt was written first.
      expect(runs.insertReceipt.mock.invocationCallOrder[0]).toBeLessThan(
        needsHuman.handedOver.mock.invocationCallOrder[0],
      );
    });

    it.each(["review", "failed", "back_to_queue"] as const)(
      "files no card for %s",
      async (outcome) => {
        const { service, needsHuman } = rig();

        await service.finish(RUN, finishing({ outcome }));

        expect(needsHuman.handedOver).not.toHaveBeenCalled();
      },
    );

    it("keeps the finish when the card cannot be filed", async () => {
      const emitter = jest.fn().mockRejectedValue(new Error("registry down"));
      const { service } = rig({ emitter });

      await expect(
        service.finish(RUN, finishing({ outcome: "needs_human" })),
      ).resolves.toMatchObject({ status: "needs_human" });
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it("answers a replay with what the first delivery was told, even once the run has finished", async () => {
      const request = finishing({ outcome: "needs_human" });
      const stored = { run_id: RUN, status: "needs_human", requeued_queue_item_id: null };
      const { service, execution, needsHuman, runs } = rig({
        row: run({ status: "needs_human" }),
        receipt: { request_digest: requestDigest(request), response: stored },
      });

      await expect(service.finish(RUN, request)).resolves.toEqual(stored);
      expect(execution.finish).not.toHaveBeenCalled();
      expect(runs.insertReceipt).not.toHaveBeenCalled();
      // The card was filed by the first delivery.
      expect(needsHuman.handedOver).not.toHaveBeenCalled();
    });

    it("refuses a key reused for a different finish", async () => {
      const { service } = rig({
        receipt: { request_digest: "another", response: {} },
      });

      await expect(refusal(service.finish(RUN, finishing()))).resolves.toMatchObject({
        code: "idempotency_key_reused",
      });
    });

    it("refuses a finish on a run already finished under another key", async () => {
      const { service, execution } = rig({ row: run({ status: "failed" }) });

      await expect(refusal(service.finish(RUN, finishing()))).resolves.toMatchObject({
        code: "run_not_executable",
      });
      expect(execution.finish).not.toHaveBeenCalled();
    });

    it("is fenced before the replay, so a worker that lost the run is never told it finished", async () => {
      const request = finishing({ epoch: 1 });
      const { service, runs } = rig({
        receipt: { request_digest: requestDigest(request), response: {} },
      });

      await expect(refusal(service.finish(RUN, request))).resolves.toMatchObject({
        code: "fenced",
      });
      expect(runs.findReceipt).not.toHaveBeenCalled();
    });
  });
});
