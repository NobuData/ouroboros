import type { PolicyResolutionService } from "../../policies/policy-resolution.service";
import type { PricingService } from "../../pricing/pricing.service";
import type { ConnectionOpener } from "../../provider-connections/connection.opener";
import type { ResolutionService } from "../../routing/resolution.service";
import { resolve } from "../../routing/resolve";
import { routeNotFound } from "../../routing/routing.errors";
import { resolutionInput } from "../../routing/routing.fixture";
import { INTERNAL_ERRORS } from "../internal.errors";
import type { InvokeEvent } from "../invoke.contract";
import type { InvokeRequestDto } from "./invoke.dto";
import { isRefusal } from "./invoke.plan";
import type { InvokeRepository, InvokeSubject } from "./invoke.repository";
import { InvokeService, ratesOf, usageRow, type PreparedInvocation } from "./invoke.service";

const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const CONNECTION = "c0000000-0000-4000-8000-000000000001";
const ORG = "acme";

/** A request. */
function request(overrides: Partial<InvokeRequestDto> = {}): InvokeRequestDto {
  return {
    alias: "coder-max",
    payload: { messages: [] },
    runCtx: { run: RUN },
    ...overrides,
  };
}

/** The service over fakes, with the subject and the resolution the case names. */
function service(options: {
  subject?: InvokeSubject | undefined;
  resolution?: "route" | "none";
  binding?: Awaited<ReturnType<InvokeRepository["aliasBinding"]>>;
  guardCents?: number | null;
}) {
  const repository = {
    subjectOf: jest
      .fn()
      .mockResolvedValue(
        "subject" in options ? options.subject : { organizationId: ORG, kind: "run", id: RUN },
      ),
    aliasBinding: jest.fn().mockResolvedValue(options.binding),
    insertSnapshot: jest.fn().mockResolvedValue("snap-1"),
  };
  const resolutions = {
    resolve: jest.fn(() =>
      options.resolution === "none"
        ? Promise.reject(routeNotFound("implement"))
        : Promise.resolve(resolve(resolutionInput())),
    ),
  };
  const connections = {
    describe: jest
      .fn()
      .mockResolvedValue({ id: CONNECTION, kind: "anthropic", monthlyCapCents: null }),
  };
  const policies =
    options.guardCents === undefined
      ? undefined
      : {
          resolve: jest.fn().mockResolvedValue({
            value: { perRunCapCents: options.guardCents },
            version: 4,
          }),
        };

  return {
    repository,
    resolutions,
    service: new InvokeService(
      repository as unknown as InvokeRepository,
      resolutions as unknown as ResolutionService,
      connections as unknown as ConnectionOpener,
      {} as PricingService,
      policies as unknown as PolicyResolutionService | undefined,
    ),
  };
}

describe("prepare", () => {
  it("refuses neither or both targets with invoke_target_invalid", async () => {
    const { service: invoke } = service({});

    await expect(invoke.prepare(request({ alias: undefined }))).rejects.toMatchObject({
      code: INTERNAL_ERRORS.invokeTargetInvalid,
    });
    await expect(invoke.prepare(request({ connection: CONNECTION }))).rejects.toMatchObject({
      code: INTERNAL_ERRORS.invokeTargetInvalid,
    });
  });

  it("refuses an id no owner table has with run_not_found", async () => {
    const { service: invoke } = service({ subject: undefined });

    await expect(invoke.prepare(request())).rejects.toMatchObject({
      code: INTERNAL_ERRORS.runNotFound,
    });
  });

  it("walks the stage's route from the alias, and snapshots it for a run (G1)", async () => {
    const { service: invoke, repository } = service({});
    const prepared = await invoke.prepare(request({ runCtx: { run: RUN, stage: "implement" } }));

    expect(isRefusal(prepared.plan)).toBe(false);
    expect(!isRefusal(prepared.plan) && prepared.plan.chained).toBe(true);
    expect(prepared.taskKind).toBe("implement");
    await expect(prepared.snapshotId).resolves.toBe("snap-1");
    expect(repository.insertSnapshot).toHaveBeenCalledWith(
      ORG,
      RUN,
      expect.objectContaining({ task_kind: "implement" }),
    );
  });

  it("writes no snapshot for a subject that is not a run", async () => {
    const { service: invoke, repository } = service({
      subject: { organizationId: ORG, kind: "copilot_session", id: RUN },
    });
    const prepared = await invoke.prepare(request({ runCtx: { run: RUN, stage: "implement" } }));

    await expect(prepared.snapshotId).resolves.toBeNull();
    expect(repository.insertSnapshot).not.toHaveBeenCalled();
  });

  it("calls an unrouted alias as one hop, capped by the spend guard", async () => {
    const { service: invoke } = service({
      resolution: "none",
      guardCents: 300,
      binding: {
        alias: "sizer",
        modelId: "claude-haiku-4-5",
        params: {},
        enabled: true,
        connectionId: CONNECTION,
        kind: "anthropic",
      },
    });
    const prepared = await invoke.prepare(
      request({ alias: "sizer", runCtx: { run: RUN, stage: "plan-step" } }),
    );

    expect(prepared.plan).toMatchObject({
      chained: false,
      cap: { source: "spend_guard", limitCents: 300 },
      hops: [{ alias: "sizer", modelId: "claude-haiku-4-5", connectionId: CONNECTION }],
    });
    expect(prepared.taskKind).toBeNull();
  });

  it("refuses an alias that is missing, disabled or unbound", async () => {
    await expect(service({ resolution: "none" }).service.prepare(request())).rejects.toMatchObject({
      code: INTERNAL_ERRORS.aliasNotFound,
    });
    await expect(
      service({
        resolution: "none",
        binding: {
          alias: "x",
          modelId: "m",
          params: {},
          enabled: false,
          connectionId: CONNECTION,
          kind: "ollama",
        },
      }).service.prepare(request()),
    ).rejects.toMatchObject({ code: INTERNAL_ERRORS.aliasUnavailable });
    await expect(
      service({
        resolution: "none",
        binding: {
          alias: "x",
          modelId: "m",
          params: {},
          enabled: true,
          connectionId: null,
          kind: null,
        },
      }).service.prepare(request()),
    ).rejects.toMatchObject({ code: INTERNAL_ERRORS.aliasUnavailable });
  });

  it("calls a named connection with the payload's model, and requires one", async () => {
    const { service: invoke } = service({});
    const prepared = await invoke.prepare(
      request({
        alias: undefined,
        connection: CONNECTION,
        payload: { model: "claude-sonnet-4-5" },
      }),
    );

    expect(prepared.plan).toMatchObject({
      chained: false,
      hops: [{ modelId: "claude-sonnet-4-5", alias: null }],
    });
    await expect(
      invoke.prepare(request({ alias: undefined, connection: CONNECTION, payload: {} })),
    ).rejects.toMatchObject({ code: INTERNAL_ERRORS.invokeModelRequired });
  });

  it("propagates a routing failure that is not a missing route", async () => {
    const { service: invoke, resolutions } = service({});

    resolutions.resolve.mockRejectedValueOnce(new Error("database down"));

    await expect(
      invoke.prepare(request({ runCtx: { run: RUN, stage: "implement" } })),
    ).rejects.toThrow("database down");
  });
});

describe("stream", () => {
  it("reports a plan refusal as its one error event", async () => {
    const { service: invoke } = service({});
    const prepared: PreparedInvocation = {
      subject: { organizationId: ORG, kind: "run", id: RUN },
      plan: { refused: true, code: "resolution_failed", message: "No.", reason: "floor_breached" },
      payload: {},
      runCtx: { run: RUN },
      taskKind: null,
      snapshotId: Promise.resolve(null),
    };
    const events: InvokeEvent[] = [];

    await invoke.stream(prepared, new AbortController().signal, (event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { kind: "error", code: "resolution_failed", message: "No.", reason: "floor_breached" },
    ]);
  });
});

describe("ratesOf", () => {
  it("reads a token price, a free price, and calls everything else unpriced", () => {
    expect(
      ratesOf({ billingMode: "token", inputCentsPer1m: "300", outputCentsPer1m: "1500" } as never),
    ).toEqual({ inputCentsPer1m: 300, outputCentsPer1m: 1500 });
    expect(
      ratesOf({ billingMode: "free", inputCentsPer1m: null, outputCentsPer1m: null } as never),
    ).toEqual({
      inputCentsPer1m: 0,
      outputCentsPer1m: 0,
    });
    expect(
      ratesOf({ billingMode: "seat", inputCentsPer1m: null, outputCentsPer1m: null } as never),
    ).toBeNull();
    expect(ratesOf(undefined)).toBeNull();
  });
});

describe("usageRow", () => {
  const prepared = (kind: InvokeSubject["kind"]): PreparedInvocation => ({
    subject: { organizationId: ORG, kind, id: RUN },
    plan: { hops: [], chained: true, floorPosition: null, floorReason: null, cap: null },
    payload: {},
    runCtx: { run: RUN, stage: "implement", vote: true },
    taskKind: "implement",
    snapshotId: Promise.resolve("snap-1"),
  });
  const settled = {
    hop: {
      index: 1,
      position: 2,
      alias: "coder-fallback",
      modelId: "m",
      params: {},
      connectionId: CONNECTION,
      kind: "openai_compatible" as const,
    },
    usage: { inputTokens: 31, outputTokens: 9, cacheReadTokens: 6, cacheWriteTokens: 0 },
    costCents: 0.0228,
    latencyMs: 40,
  };

  it("attributes a hop to its own connection, model, alias and subject (G2)", () => {
    expect(usageRow(prepared("run"), settled, "snap-1")).toEqual({
      organization_id: ORG,
      run_id: RUN,
      provider: "openai_compatible",
      model: "m",
      tokens_in: 31,
      tokens_out: 9,
      cost_cents: "0.0228",
      task_kind: "implement",
      latency_ms: 40,
      connection_id: CONNECTION,
      alias: "coder-fallback",
      hop: 1,
      stage: "implement",
      attempt: null,
      is_vote: true,
      cache_read_tokens: 6,
      cache_write_tokens: 0,
      subject_kind: "run",
      subject_id: RUN,
      resolution_snapshot_id: "snap-1",
    });
  });

  it("sets run_id only for a run, and stores an unpriced cost as null", () => {
    const row = usageRow(prepared("dry_run"), { ...settled, costCents: null }, null);

    expect(row.run_id).toBeNull();
    expect(row.subject_kind).toBe("dry_run");
    expect(row.cost_cents).toBeNull();
  });
});
