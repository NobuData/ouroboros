/**
 * The investigation loop's control-plane half (#620): what the engine's four writes leave
 * behind, and what each refuses. The store is in memory and refuses what the schema refuses.
 */

import { Logger } from "@nestjs/common";

import { ConflictError } from "../../errors/error.envelope";
import type { MatrixBuilderService } from "../briefs/matrix-builder.service";
import type { ResearchEstimateService } from "../estimate.service";
import { RESEARCH_ERRORS } from "../research.errors";
import { RESEARCH_TOOL_ERRORS } from "../tools/research-tool.errors";
import type { BriefDto, FinishDto, UsageDto } from "./investigation-loop.dto";
import { INVESTIGATION_LOOP_ERRORS } from "./investigation-loop.errors";
import type { InvestigationLoopRepository } from "./investigation-loop.repository";
import {
  InvestigationLoopService,
  MAX_CHECKPOINT_BYTES,
  MAX_DELIVERABLE_DEPTH,
  citedSources,
} from "./investigation-loop.service";
import {
  INVESTIGATION,
  MemoryLoopStore,
  WORKSPACE,
  investigation,
  source,
  sourceId,
} from "./investigation-loop.store.fixture";

const START = {
  loopVersion: "loop-v1",
  alias: "researcher-long-ctx",
  resolutionRef: "r1",
  task: `investigate:${INVESTIGATION}`,
};

function usage(seq: number, costCents: number | null = 8.25): UsageDto {
  return {
    seq,
    stage: "synthesize",
    alias: "researcher-long-ctx",
    hop: 0,
    connection: "conn-anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 20_000,
    outputTokens: 1_500,
    costCents,
  };
}

/** A two-finding, one-open-question brief over sources 7 and 12, with a matrix. */
function brief(overrides: Partial<BriefDto> = {}): BriefDto {
  return {
    attempt: 1,
    durationMs: 61_000,
    usage: [usage(3)],
    body: {
      paragraphs: [
        {
          spans: [
            { text: "The gap is control, not sensors.", claim: "c1" },
            { text: " Skylink applies wind-feedforward MPC.", claim: "c2" },
          ],
        },
        { spans: [{ text: "Does AeroMesh use a beacon?", claim: "q1" }] },
      ],
    },
    claims: [
      {
        ref: "c1",
        type: "finding",
        text: "The gap is control.",
        sources: [sourceId(7)],
        demoted: false,
      },
      {
        ref: "c2",
        type: "finding",
        text: "Skylink applies MPC.",
        sources: [sourceId(12), sourceId(7)],
        demoted: undefined,
      },
      { ref: "q1", type: "open_question", text: "A beacon?", sources: [], demoted: true },
    ],
    deliverables: {
      matrix: {
        rows: [
          {
            capability: "Docking in gusts",
            cells: [
              { subject: "Helios", status: "partial", sources: [sourceId(7)] },
              { subject: "Novum", status: "unknown", sources: [] },
            ],
          },
        ],
      },
    },
    ...overrides,
  };
}

function bench(...seeded: Parameters<typeof investigation>[0][]) {
  const store = new MemoryLoopStore(
    ...(seeded.length === 0 ? [investigation()] : seeded.map((each) => investigation(each))),
  );
  store.archive(INVESTIGATION, source(7), source(12));
  const reconcile = jest.fn((): Promise<unknown> => Promise.resolve({}));
  const build = jest.fn((): Promise<unknown> => Promise.resolve({ outcome: "built" }));
  const service = new InvestigationLoopService(
    store as unknown as InvestigationLoopRepository,
    { reconcile } as unknown as ResearchEstimateService,
    { build } as unknown as MatrixBuilderService,
  );
  return { store, service, reconcile, build };
}

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "resolved",
    (error: unknown) => (error as { code?: string }).code ?? String(error),
  );
}

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
});

describe("starting an investigation", () => {
  it("moves a queued investigation to running and records its provenance", async () => {
    const { store, service } = bench();

    const started = await service.start(INVESTIGATION, START);

    expect(started).toEqual({
      investigation: "RS-127",
      attempt: 1,
      checkpoint: null,
      checkpointSeq: 0,
      durationMs: 0,
      cancelRequested: false,
      sources: [source(7), source(12)],
    });
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("running");
    expect(store.provenance.get(INVESTIGATION)).toEqual({
      loopVersion: "loop-v1",
      alias: "researcher-long-ctx",
      resolutionRef: "r1",
      task: `investigate:${INVESTIGATION}`,
    });
  });

  it("resumes a running investigation as a new attempt, from its checkpoint", async () => {
    const { service } = bench();
    await service.start(INVESTIGATION, START);
    await service.checkpoint(INVESTIGATION, {
      attempt: 1,
      seq: 1,
      checkpoint: { phase: "iterate", iteration: 1 },
      durationMs: 4_200,
      usage: [],
    });

    const resumed = await service.start(INVESTIGATION, START);

    expect(resumed.attempt).toBe(2);
    expect(resumed.checkpoint).toEqual({ phase: "iterate", iteration: 1 });
    expect(resumed.checkpointSeq).toBe(1);
    expect(resumed.durationMs).toBe(4_200);
  });

  it("treats an omitted resolution ref as none", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, { ...START, resolutionRef: undefined as never });
    expect(store.provenance.get(INVESTIGATION)?.resolutionRef).toBeNull();
  });

  it.each(["brief_ready", "issues_filed", "failed", "cancelled"] as const)(
    "refuses to start a %s investigation",
    async (status) => {
      const { service } = bench({ status });
      expect(await code(service.start(INVESTIGATION, START))).toBe(
        INVESTIGATION_LOOP_ERRORS.notRunnable,
      );
    },
  );

  it("answers 404 for an investigation that does not exist", async () => {
    const { service } = bench();
    expect(await code(service.start("5eed0091-0000-4000-8000-000000000999", START))).toBe(
      RESEARCH_ERRORS.investigationNotFound,
    );
  });
});

describe("checkpointing", () => {
  it("saves the state and the usage, and reports no cancel", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);

    const saved = await service.checkpoint(INVESTIGATION, {
      attempt: 1,
      seq: 1,
      checkpoint: { phase: "iterate" },
      durationMs: 900,
      usage: [usage(1), usage(2, null)],
    });

    expect(saved).toEqual({ cancelRequested: false });
    expect(store.loops.get(INVESTIGATION)?.checkpoint).toEqual({ phase: "iterate" });
    expect([...(store.usage.get(INVESTIGATION)?.keys() ?? [])]).toEqual([1, 2]);
  });

  it("records a usage row once however often it is sent", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);
    const write = { attempt: 1, checkpoint: {}, durationMs: 0, usage: [usage(1)] };

    await service.checkpoint(INVESTIGATION, { ...write, seq: 1 });
    await service.checkpoint(INVESTIGATION, { ...write, seq: 2, usage: [usage(1, 99), usage(2)] });

    expect(store.usage.get(INVESTIGATION)?.get(1)?.costCents).toBe(8.25);
    expect(store.spendCents(INVESTIGATION)).toBe(17);
  });

  it("refuses a checkpoint from an attempt that was replaced", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);
    await service.start(INVESTIGATION, START);

    const refused = service.checkpoint(INVESTIGATION, {
      attempt: 1,
      seq: 1,
      checkpoint: { phase: "stale" },
      durationMs: 0,
      usage: [usage(1)],
    });

    expect(await code(refused)).toBe(INVESTIGATION_LOOP_ERRORS.checkpointStale);
    expect(store.loops.get(INVESTIGATION)?.checkpoint).toBeNull();
    expect(store.usage.get(INVESTIGATION)).toBeUndefined();
  });

  it("refuses a checkpoint number that does not rise", async () => {
    const { service } = bench();
    await service.start(INVESTIGATION, START);
    const write = { attempt: 1, checkpoint: {}, durationMs: 0, usage: [] };
    await service.checkpoint(INVESTIGATION, { ...write, seq: 2 });

    for (const seq of [1, 2]) {
      expect(await code(service.checkpoint(INVESTIGATION, { ...write, seq }))).toBe(
        INVESTIGATION_LOOP_ERRORS.checkpointStale,
      );
    }
  });

  it("answers a pending cancel with every write", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);
    await store.requestCancel(WORKSPACE, INVESTIGATION, "user-1");

    const saved = await service.checkpoint(INVESTIGATION, {
      attempt: 1,
      seq: 1,
      checkpoint: {},
      durationMs: 0,
      usage: [],
    });

    expect(saved.cancelRequested).toBe(true);
  });

  it("refuses a write to an investigation that is not running", async () => {
    const { service } = bench({ status: "cancelled" });
    const refused = service.checkpoint(INVESTIGATION, {
      attempt: 1,
      seq: 1,
      checkpoint: {},
      durationMs: 0,
      usage: [],
    });
    expect(await code(refused)).toBe(RESEARCH_TOOL_ERRORS.investigationNotRunning);
  });

  it("refuses a checkpoint larger than a loop may keep, before writing it", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);

    const refused = service.checkpoint(INVESTIGATION, {
      attempt: 1,
      seq: 1,
      checkpoint: { notes: "x".repeat(MAX_CHECKPOINT_BYTES) },
      durationMs: 0,
      usage: [],
    });

    expect(await code(refused)).toBe(INVESTIGATION_LOOP_ERRORS.checkpointTooLarge);
    expect(store.loops.get(INVESTIGATION)?.checkpointSeq).toBe(0);
  });
});

describe("delivering a brief", () => {
  it("writes the brief, its claims and the matrix input, and ends brief_ready with actuals", async () => {
    const { store, service, reconcile } = bench();
    await service.start(INVESTIGATION, START);
    await service.checkpoint(INVESTIGATION, {
      attempt: 1,
      seq: 1,
      checkpoint: {},
      durationMs: 30_000,
      usage: [usage(1), usage(2)],
    });

    const delivered = await service.deliver(INVESTIGATION, brief());

    expect(delivered).toEqual({
      investigation: "RS-127",
      status: "brief_ready",
      // Three priced calls at 8.25¢ → 24.75¢, rounded up; the sources are the ledger's.
      actuals: { sourcesUsed: 2, spendCents: 25, durationMs: 61_000 },
      brief: { id: expect.any(String) as string, version: 1 },
    });
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("brief_ready");

    const written = store.briefs.get(INVESTIGATION)?.[0]?.write;
    expect(written?.claims).toEqual([
      {
        ref: "c1",
        type: "finding",
        text: "The gap is control.",
        sources: [sourceId(7)],
        demoted: false,
      },
      {
        ref: "c2",
        type: "finding",
        text: "Skylink applies MPC.",
        sources: [sourceId(12), sourceId(7)],
        demoted: false,
      },
      { ref: "q1", type: "open_question", text: "A beacon?", sources: [], demoted: true },
    ]);
    expect([...(written?.deliverables.keys() ?? [])]).toEqual(["matrix"]);
    expect(reconcile).toHaveBeenCalledWith(WORKSPACE, INVESTIGATION);
  });

  it("reconciles spend against the usage rows of the run", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);

    const delivered = await service.deliver(
      INVESTIGATION,
      brief({ usage: [usage(1, 100.5), usage(2, null), usage(3, 0.01)] }),
    );

    expect(delivered.actuals.spendCents).toBe(101);
    expect(delivered.actuals.spendCents).toBe(store.spendCents(INVESTIGATION));
    expect(store.actuals.get(INVESTIGATION)?.spend_cents).toBe(101);
  });

  it("records no spend figure when no call was priced, and zero when none was made", async () => {
    const unpriced = bench();
    await unpriced.service.start(INVESTIGATION, START);
    const first = await unpriced.service.deliver(INVESTIGATION, brief({ usage: [usage(1, null)] }));
    expect(first.actuals.spendCents).toBeNull();

    const silent = bench();
    await silent.service.start(INVESTIGATION, START);
    const second = await silent.service.deliver(INVESTIGATION, brief({ usage: [] }));
    expect(second.actuals.spendCents).toBe(0);
  });

  it("refuses a finding that cites nothing", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);
    const uncited = brief();
    uncited.claims[0].sources = [];

    expect(await code(service.deliver(INVESTIGATION, uncited))).toBe(
      INVESTIGATION_LOOP_ERRORS.claimUncited,
    );
    expect(store.briefs.get(INVESTIGATION)).toBeUndefined();
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("running");
  });

  it("refuses a claim citing a source that is not in this investigation's ledger", async () => {
    const { service } = bench();
    await service.start(INVESTIGATION, START);
    const foreign = brief();
    foreign.claims[1].sources = [sourceId(99)];

    expect(await code(service.deliver(INVESTIGATION, foreign))).toBe(
      INVESTIGATION_LOOP_ERRORS.sourceUnknown,
    );
  });

  it("refuses a deliverable citing a source that is not in the ledger", async () => {
    const { service } = bench();
    await service.start(INVESTIGATION, START);

    const refused = service.deliver(
      INVESTIGATION,
      brief({ deliverables: { matrix: { rows: [{ cells: [{ sources: [sourceId(99)] }] }] } } }),
    );

    expect(await code(refused)).toBe(INVESTIGATION_LOOP_ERRORS.sourceUnknown);
  });

  it("refuses a deliverable the kind's playbook does not produce", async () => {
    const { service } = bench();
    await service.start(INVESTIGATION, START);

    for (const deliverables of [{ fix_draft: {} }, { brief: {} }, { __proto__: {}, podcast: {} }]) {
      expect(await code(service.deliver(INVESTIGATION, brief({ deliverables })))).toBe(
        INVESTIGATION_LOOP_ERRORS.deliverableUnexpected,
      );
    }
  });

  it("accepts a brief with no deliverable inputs at all", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);
    await service.deliver(INVESTIGATION, brief({ deliverables: {} }));
    expect(store.briefs.get(INVESTIGATION)?.[0]?.write.deliverables.size).toBe(0);
  });

  it.each<[string, (candidate: BriefDto) => void]>([
    [
      "a claim no span states",
      (c) =>
        c.claims.push({ ref: "c9", type: "open_question", text: "?", sources: [], demoted: false }),
    ],
    ["a span whose claim was not written", (c) => void c.claims.pop()],
    ["a claim written twice", (c) => c.claims.push({ ...c.claims[2] })],
    ["a finding marked demoted", (c) => void (c.claims[0].demoted = true)],
    ["a body with no paragraphs", (c) => void (c.body = { paragraphs: [] })],
    ["a body with an extra key", (c) => void (c.body = { ...c.body, markdown: "# hi" })],
    ["a paragraph with no spans", (c) => void (c.body = { paragraphs: [{ spans: [] }] })],
    ["a blank span", (c) => void (c.body = { paragraphs: [{ spans: [{ text: "  " }] }] })],
    [
      "a span with an extra key",
      (c) => void (c.body = { paragraphs: [{ spans: [{ text: "a", html: "<b>" }] }] }),
    ],
    [
      "a span ref that is not a ref",
      (c) => void (c.body = { paragraphs: [{ spans: [{ text: "a", claim: "C 1" }] }] }),
    ],
    [
      "a claim span stated twice",
      (c) =>
        void (c.body = {
          paragraphs: [
            {
              spans: [
                { text: "a", claim: "c1" },
                { text: "b", claim: "c1" },
              ],
            },
          ],
        }),
    ],
    ["a deliverable that is not an object", (c) => void (c.deliverables = { matrix: [] })],
    [
      "a deliverable whose sources are not ids",
      (c) => void (c.deliverables = { matrix: { sources: ["07"] } }),
    ],
    [
      "a deliverable whose sources are not a list",
      (c) => void (c.deliverables = { matrix: { sources: sourceId(7) } }),
    ],
  ])("refuses %s", async (_name, mutate) => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);
    const candidate = brief();
    mutate(candidate);

    expect(await code(service.deliver(INVESTIGATION, candidate))).toBe(
      INVESTIGATION_LOOP_ERRORS.briefInvalid,
    );
    expect(store.briefs.get(INVESTIGATION)).toBeUndefined();
  });

  it("refuses a delivery from a replaced attempt, and one after the run ended", async () => {
    const { service } = bench();
    await service.start(INVESTIGATION, START);
    await service.start(INVESTIGATION, START);
    expect(await code(service.deliver(INVESTIGATION, brief()))).toBe(
      INVESTIGATION_LOOP_ERRORS.checkpointStale,
    );

    await service.deliver(INVESTIGATION, brief({ attempt: 2 }));
    expect(await code(service.deliver(INVESTIGATION, brief({ attempt: 2 })))).toBe(
      RESEARCH_TOOL_ERRORS.investigationNotRunning,
    );
  });

  it("delivers even when the estimate cannot be reconciled", async () => {
    const { service, reconcile } = bench();
    await service.start(INVESTIGATION, START);
    reconcile.mockRejectedValueOnce(
      new ConflictError(RESEARCH_ERRORS.outcomeUnavailable, "no estimate"),
    );
    expect((await service.deliver(INVESTIGATION, brief())).status).toBe("brief_ready");

    const broken = bench();
    await broken.service.start(INVESTIGATION, START);
    broken.reconcile.mockRejectedValueOnce(new Error("the database went away"));
    expect((await broken.service.deliver(INVESTIGATION, brief())).status).toBe("brief_ready");
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
  });

  it("builds the capability matrix once a matrix input is delivered", async () => {
    const { service, build } = bench();
    await service.start(INVESTIGATION, START);
    await service.deliver(INVESTIGATION, brief());

    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(WORKSPACE, INVESTIGATION);
  });

  it("builds no matrix for a brief that delivered no matrix input", async () => {
    const { service, build } = bench();
    await service.start(INVESTIGATION, START);
    await service.deliver(INVESTIGATION, brief({ deliverables: {} }));

    expect(build).not.toHaveBeenCalled();
  });

  it("delivers even when the matrix cannot be built, and says why in the log", async () => {
    const { service, build } = bench();
    await service.start(INVESTIGATION, START);
    build.mockRejectedValueOnce(new Error("matrix_cell_uncited"));

    expect((await service.deliver(INVESTIGATION, brief())).status).toBe("brief_ready");
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "RS-127's capability matrix could not be built from its input.",
      expect.anything(),
    );
  });

  it("logs how many claims were demoted", async () => {
    const { service } = bench();
    await service.start(INVESTIGATION, START);
    await service.deliver(INVESTIGATION, brief());

    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "RS-127 delivered brief v1: 2 findings, 1 open questions (1 demoted — uncited)",
    );
  });
});

describe("a deliverable's citations", () => {
  it("are found at any depth, once each", () => {
    expect(
      citedSources({
        sources: [sourceId(1)],
        rows: [{ cells: [{ sources: [sourceId(2), sourceId(1).toUpperCase()] }] }],
        note: { sources: [] },
      }),
    ).toEqual([sourceId(1), sourceId(2)]);
  });

  it("refuses an input nested deeper than it will search", () => {
    let nested: Record<string, unknown> = { sources: [sourceId(1)] };
    for (let depth = 0; depth <= MAX_DELIVERABLE_DEPTH; depth += 1) nested = { next: nested };

    expect(() => citedSources(nested)).toThrow("The brief is not well-formed.");
  });
});

describe("ending without a brief", () => {
  function ending(overrides: Partial<FinishDto> = {}): FinishDto {
    return {
      attempt: 1,
      outcome: "failed",
      reason: "budget_breach",
      detail: "The investigation reached its spend ceiling of 30¢.",
      durationMs: 12_000,
      usage: [usage(2)],
      seq: 4,
      checkpoint: { phase: "iterate", operations_used: 2 },
      ...overrides,
    };
  }

  it("fails with its reason, records actuals and keeps the partial", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);
    await service.checkpoint(INVESTIGATION, {
      attempt: 1,
      seq: 1,
      checkpoint: {},
      durationMs: 5_000,
      usage: [usage(1)],
    });

    const failed = await service.finish(INVESTIGATION, ending());

    expect(failed).toEqual({
      investigation: "RS-127",
      status: "failed",
      actuals: { sourcesUsed: 2, spendCents: 17, durationMs: 12_000 },
      brief: null,
    });
    const loop = store.loops.get(INVESTIGATION);
    expect(loop?.failureReason).toBe("budget_breach");
    expect(loop?.failureDetail).toContain("30¢");
    expect(loop?.checkpoint).toEqual({ phase: "iterate", operations_used: 2 });
    expect(loop?.checkpointSeq).toBe(4);
    expect(await store.ledger(INVESTIGATION)).toHaveLength(2);
    expect(store.usage.get(INVESTIGATION)?.size).toBe(2);
  });

  it("cancels with the ledger intact and no failure reason", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);

    const cancelled = await service.finish(
      INVESTIGATION,
      ending({ outcome: "cancelled", reason: undefined, detail: undefined }),
    );

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.actuals.sourcesUsed).toBe(2);
    expect(store.loops.get(INVESTIGATION)?.failureReason).toBeNull();
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("cancelled");
  });

  it.each<[string, Partial<FinishDto>]>([
    ["a failure with no reason", { reason: undefined }],
    ["a failure with no detail", { detail: undefined }],
    ["a cancel with a reason", { outcome: "cancelled", detail: undefined }],
    ["a cancel with a detail", { outcome: "cancelled", reason: undefined }],
  ])("refuses %s", async (_name, overrides) => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);

    expect(await code(service.finish(INVESTIGATION, ending(overrides)))).toBe(
      INVESTIGATION_LOOP_ERRORS.endingInvalid,
    );
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("running");
  });

  it("refuses an end from a replaced attempt, so the newer worker's run survives", async () => {
    const { store, service } = bench();
    await service.start(INVESTIGATION, START);
    await service.start(INVESTIGATION, START);

    expect(await code(service.finish(INVESTIGATION, ending()))).toBe(
      INVESTIGATION_LOOP_ERRORS.checkpointStale,
    );
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("running");
  });
});
