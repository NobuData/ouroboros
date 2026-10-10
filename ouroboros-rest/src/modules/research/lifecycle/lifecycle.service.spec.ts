import { ConflictError, UpstreamError } from "../../errors/error.envelope";
import type { ResearchEstimateService } from "../estimate.service";
import type { InvestigationDispatchService } from "../loop/investigation-dispatch.service";
import { kindNotFound, toolUnknown } from "../research.errors";
import type { ScopeEstimateResource } from "../resources";
import {
  KEN,
  MAYA,
  MemoryLifecycleStore,
  WORKSPACE,
  investigationId,
  record,
  rs118,
  rs121,
  rs124,
} from "./lifecycle.fixture";
import type { LifecycleRepository } from "./lifecycle.repository";
import {
  type Caller,
  InvestigationLifecycleService,
  START_ROLE_HOLDERS,
  filterOf,
} from "./lifecycle.service";

/**
 * The lifecycle's rules (CM.6, #625), over an in-memory store and stand-ins for the estimator
 * (#622) and the dispatch (#620): who may start and cancel, what a refused start leaves, what
 * the list counts, and what a cancel keeps.
 */

const NOW = new Date("2026-10-10T12:00:00Z");
const WINDOW = { limit: 25, offset: 0 };

const ESTIMATE: ScopeEstimateResource = {
  depth: "deep_dive",
  tools: ["web", "competitor", "code", "tickets", "telemetry"],
  researcher: {
    taskKind: "research",
    routeTag: "research-primary",
    alias: "researcher-long-ctx",
    modelId: "claude-sonnet-4-6",
  },
  calibrationVersion: 1,
  operations: { total: 40, byTool: [] },
  synthesisCalls: { min: 44, max: 64 },
  sources: { min: 40, max: 60 },
  costCents: { min: 522, max: 687 },
  label: "est. 40–60 sources · ~$6",
};

const START = {
  question: "Autonomous docking vs. the field",
  kind: "gap_analysis",
  depth: "deep_dive",
} as const;

const caller = (userId: string, ...roles: Caller["roles"]): Caller => ({ userId, roles });
const MEMBER = caller(MAYA, "member");
const ADMIN = caller(MAYA, "admin");

function harness(store = new MemoryLifecycleStore()) {
  const estimate = jest.fn().mockResolvedValue(ESTIMATE);
  const dispatch = jest.fn().mockResolvedValue({
    investigation: "RS-128",
    task: "task-1",
    state: "accepted",
    loopVersion: "loop-v1",
  });
  const requestCancel = jest.fn().mockImplementation((_org: string, id: string) => {
    const queued = store.records.find((candidate) => candidate.id === id)?.status === "queued";
    if (queued) store.set(id, { status: "cancelled" });
    return Promise.resolve({ investigation: "RS-121", state: queued ? "cancelled" : "cancelling" });
  });
  const service = new InvestigationLifecycleService(
    store as unknown as LifecycleRepository,
    { estimate } as unknown as ResearchEstimateService,
    { dispatch, requestCancel } as unknown as InvestigationDispatchService,
  );

  return { store, service, estimate, dispatch, requestCancel };
}

describe("starting an investigation", () => {
  it("checks the estimate, creates the investigation queued with it, and dispatches", async () => {
    const { service, store, estimate, dispatch } = harness();

    const started = await service.start(WORKSPACE, MEMBER, START);

    expect(estimate).toHaveBeenCalledWith(WORKSPACE, { kind: "gap_analysis", depth: "deep_dive" });
    expect(store.created).toEqual([
      {
        kind: "gap_analysis",
        question: "Autonomous docking vs. the field",
        depth: "deep_dive",
        // The kind's defaults, as the estimate resolved them — what was estimated is what runs.
        tools: ["web", "competitor", "code", "tickets", "telemetry"],
        estimate: { sources: { min: 40, max: 60 }, cost_cents: { min: 522, max: 687 } },
        calibrationVersion: 1,
        userId: MAYA,
      },
    ]);
    expect(dispatch).toHaveBeenCalledWith(WORKSPACE, investigationId(128));
    expect(started.estimate.label).toBe("est. 40–60 sources · ~$6");
    expect(started.investigation).toMatchObject({
      displayId: "RS-128",
      status: "queued",
      sources: 0,
      estimate: { sources: { min: 40, max: 60 }, costCents: { min: 522, max: 687 } },
      startedBy: { id: MAYA },
      mayCancel: true,
    });
    expect(store.discarded).toEqual([]);
  });

  it("passes chosen tools to the estimate", async () => {
    const { service, estimate } = harness();

    await service.start(WORKSPACE, MEMBER, { ...START, tools: ["web"] });

    expect(estimate).toHaveBeenCalledWith(WORKSPACE, {
      kind: "gap_analysis",
      depth: "deep_dive",
      tools: ["web"],
    });
  });

  it("stores an unpriced estimate without a cost", async () => {
    const { service, store, estimate } = harness();
    estimate.mockResolvedValue({ ...ESTIMATE, costCents: null });

    await service.start(WORKSPACE, MEMBER, START);

    expect(store.created[0]?.estimate).toEqual({ sources: { min: 40, max: 60 }, cost_cents: null });
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["member", true],
    ["viewer", false],
  ] as const)("by default lets a %s start: %s", async (role, allowed) => {
    const { service, store } = harness();
    const attempt = service.start(WORKSPACE, caller(MAYA, role), START);

    if (allowed) {
      await expect(attempt).resolves.toBeDefined();
    } else {
      await expect(attempt).rejects.toMatchObject({
        status: 403,
        code: "forbidden",
        details: { role, required: ["owner", "admin", "member"] },
      });
      expect(store.created).toEqual([]);
    }
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["viewer", false],
  ] as const)("lets a %s start when the workspace says admins only: %s", async (role, allowed) => {
    const { service, store, estimate } = harness();
    store.roles.set(WORKSPACE, "admin");
    const attempt = service.start(WORKSPACE, caller(MAYA, role), START);

    if (allowed) {
      await expect(attempt).resolves.toBeDefined();
    } else {
      await expect(attempt).rejects.toMatchObject({
        status: 403,
        code: "forbidden",
        details: { required: ["owner", "admin"] },
      });
      // Refused before anything is estimated, created or dispatched.
      expect(estimate).not.toHaveBeenCalled();
      expect(store.created).toEqual([]);
    }
  });

  it("refuses a caller with no recognised role", async () => {
    const { service } = harness();

    await expect(service.start(WORKSPACE, caller(MAYA), START)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("admits a caller holding several roles when one is enough", async () => {
    const { service, store } = harness();
    store.roles.set(WORKSPACE, "admin");

    await expect(
      service.start(WORKSPACE, caller(MAYA, "viewer", "admin"), START),
    ).resolves.toBeDefined();
  });

  it("creates nothing when the estimate refuses the kind or a tool", async () => {
    const { service, store, estimate, dispatch } = harness();

    estimate.mockRejectedValueOnce(kindNotFound("nope"));
    await expect(
      service.start(WORKSPACE, MEMBER, { ...START, kind: "nope" }),
    ).rejects.toMatchObject({ code: "investigation_kind_not_found" });
    estimate.mockRejectedValueOnce(toolUnknown(["nope"]));
    await expect(
      service.start(WORKSPACE, MEMBER, { ...START, tools: ["nope"] }),
    ).rejects.toMatchObject({ code: "research_tool_unknown" });

    expect(store.created).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("creates nothing when routing resolves no researcher", async () => {
    const { service, store, estimate, dispatch } = harness();
    estimate.mockResolvedValue({ ...ESTIMATE, researcher: null, costCents: null });

    await expect(service.start(WORKSPACE, MEMBER, START)).rejects.toMatchObject({
      status: 409,
      code: "investigation_researcher_unavailable",
      details: { kind: "gap_analysis" },
    });
    expect(store.created).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("answers kind-not-found when the kind vanished between the estimate and the insert", async () => {
    const { service, store, dispatch } = harness();
    store.kinds = new Set();

    await expect(service.start(WORKSPACE, MEMBER, START)).rejects.toMatchObject({
      code: "investigation_kind_not_found",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ["the engine is down", new UpstreamError("engine_unavailable", "The engine did not answer.")],
    [
      "no enabled tool has an adapter",
      new ConflictError("investigation_tools_unavailable", "No tool can run."),
    ],
  ])("cancels the new investigation and answers the refusal when %s", async (_why, refusal) => {
    const { service, store, dispatch } = harness();
    dispatch.mockRejectedValue(refusal);

    await expect(service.start(WORKSPACE, MEMBER, START)).rejects.toBe(refusal);

    expect(store.discarded).toEqual([investigationId(128)]);
    // Nothing is left queued for a run that will never come.
    expect(store.records.filter((candidate) => candidate.status === "queued")).toEqual([
      expect.objectContaining({ displayId: "RS-121" }),
    ]);
  });

  it("still answers the dispatch's refusal when the clean-up fails too", async () => {
    const { service, store, dispatch } = harness();
    const refusal = new UpstreamError("engine_unavailable", "The engine did not answer.");
    dispatch.mockRejectedValue(refusal);
    jest.spyOn(store, "discard").mockRejectedValue(new Error("the pool is gone"));
    const logged = jest
      .spyOn((service as unknown as { logger: { error: () => void } }).logger, "error")
      .mockImplementation(() => undefined);

    await expect(service.start(WORKSPACE, MEMBER, START)).rejects.toBe(refusal);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("maps each starter setting to the roles it admits", () => {
    expect(START_ROLE_HOLDERS).toEqual({
      member: ["owner", "admin", "member"],
      admin: ["owner", "admin"],
    });
  });
});

describe("cancelling an investigation", () => {
  it("lets the starter cancel a queued investigation at once, ledger kept", async () => {
    const { service, requestCancel } = harness();

    const cancelled = await service.cancel(WORKSPACE, caller(KEN, "member"), investigationId(121));

    expect(requestCancel).toHaveBeenCalledWith(WORKSPACE, investigationId(121), KEN);
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.investigation).toMatchObject({
      displayId: "RS-121",
      status: "cancelled",
      sources: 9,
      ledger: { total: 9 },
      pill: { label: "cancelled" },
      mayCancel: false,
    });
  });

  it("asks a running investigation to stop, and says it is stopping", async () => {
    const store = new MemoryLifecycleStore([rs121({ status: "running", sources: 31 })]);
    const { service } = harness(store);

    const cancelled = await service.cancel(WORKSPACE, ADMIN, investigationId(121));

    expect(cancelled.state).toBe("cancelling");
    expect(cancelled.investigation).toMatchObject({ status: "running", sources: 31 });
  });

  it("lets an owner or admin cancel somebody else's", async () => {
    for (const role of ["owner", "admin"] as const) {
      const { service } = harness();

      await expect(
        service.cancel(WORKSPACE, caller(MAYA, role), investigationId(121)),
      ).resolves.toMatchObject({ state: "cancelled" });
    }
  });

  it.each(["member", "viewer"] as const)(
    "refuses a %s who did not start it, and asks nothing of the loop",
    async (role) => {
      const { service, requestCancel } = harness();

      await expect(
        service.cancel(WORKSPACE, caller(MAYA, role), investigationId(121)),
      ).rejects.toMatchObject({
        status: 403,
        code: "investigation_cancel_forbidden",
        details: { investigation: "RS-121", required: ["starter", "owner", "admin"] },
      });
      expect(requestCancel).not.toHaveBeenCalled();
    },
  );

  it("lets the starter cancel even as a viewer now", async () => {
    const { service } = harness();

    await expect(
      service.cancel(WORKSPACE, caller(KEN, "viewer"), investigationId(121)),
    ).resolves.toMatchObject({ state: "cancelled" });
  });

  it("answers not-found for an unknown investigation and for another workspace's", async () => {
    const { service, requestCancel } = harness();

    await expect(service.cancel(WORKSPACE, ADMIN, investigationId(999))).rejects.toMatchObject({
      status: 404,
      code: "investigation_not_found",
    });
    await expect(service.cancel("org-other", ADMIN, investigationId(121))).rejects.toMatchObject({
      code: "investigation_not_found",
    });
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it("passes on the loop's refusal for one that has finished", async () => {
    const { service, requestCancel } = harness();
    requestCancel.mockRejectedValue(
      new ConflictError(
        "investigation_not_cancellable",
        "This investigation has already finished.",
      ),
    );

    await expect(service.cancel(WORKSPACE, ADMIN, investigationId(127))).rejects.toMatchObject({
      status: 409,
      code: "investigation_not_cancellable",
    });
  });
});

describe("listing investigations", () => {
  it("answers the four rows under `4 active · 4 this quarter`, newest first", async () => {
    const { service } = harness();

    const list = await service.list(WORKSPACE, {}, WINDOW, NOW);

    expect(list.items.map((row) => row.displayId)).toEqual([
      "RS-127",
      "RS-124",
      "RS-121",
      "RS-118",
    ]);
    expect(list).toMatchObject({
      total: 4,
      limit: 25,
      offset: 0,
      counts: { active: 4, thisQuarter: 4 },
      quarter: {
        key: "2026-Q4",
        from: "2026-10-01T00:00:00.000Z",
        to: "2027-01-01T00:00:00.000Z",
      },
    });
  });

  it("counts active as everything not failed or cancelled, and the quarter by the clock", async () => {
    const store = new MemoryLifecycleStore([
      record(),
      rs121(),
      record({ id: investigationId(126), displayId: "RS-126", status: "failed" }),
      record({ id: investigationId(125), displayId: "RS-125", status: "cancelled" }),
      record({ id: investigationId(120), displayId: "RS-120", status: "running" }),
      // Last quarter's, still active: it counts as active and not as this quarter's.
      rs118({ createdAt: new Date("2026-09-30T23:59:59Z") }),
    ]);
    const { service } = harness(store);

    expect((await service.list(WORKSPACE, {}, WINDOW, NOW)).counts).toEqual({
      active: 4,
      thisQuarter: 5,
    });
    // The window moves with the clock: next quarter, none of them is "this quarter".
    expect(
      (await service.list(WORKSPACE, {}, WINDOW, new Date("2027-01-01T00:00:00Z"))).counts,
    ).toEqual({ active: 4, thisQuarter: 0 });
  });

  it("keeps the counts whole-workspace whatever the filters", async () => {
    const { service } = harness();

    const list = await service.list(WORKSPACE, { kind: "gap_analysis" }, WINDOW, NOW);

    expect(list.items.map((row) => row.displayId)).toEqual(["RS-127"]);
    expect(list.total).toBe(1);
    expect(list.counts).toEqual({ active: 4, thisQuarter: 4 });
  });

  it("composes kind, status and quarter", async () => {
    const store = new MemoryLifecycleStore([
      record(),
      record({ id: investigationId(125), displayId: "RS-125", status: "cancelled" }),
      record({
        id: investigationId(103),
        displayId: "RS-103",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      }),
      rs124(),
    ]);
    const { service } = harness(store);
    const ids = async (request: Parameters<typeof service.list>[1]) =>
      (await service.list(WORKSPACE, request, WINDOW, NOW)).items.map((row) => row.displayId);

    expect(await ids({ kind: "gap_analysis" })).toEqual(["RS-127", "RS-125", "RS-103"]);
    expect(await ids({ kind: "gap_analysis", status: "brief_ready" })).toEqual([
      "RS-127",
      "RS-103",
    ]);
    expect(await ids({ kind: "gap_analysis", status: "brief_ready", quarter: "current" })).toEqual([
      "RS-127",
    ]);
    expect(await ids({ kind: "gap_analysis", status: "brief_ready", quarter: "2026-Q3" })).toEqual([
      "RS-103",
    ]);
    expect(await ids({ status: "active", quarter: "current" })).toEqual(["RS-127", "RS-124"]);
    expect(await ids({ kind: "bug_root_cause", status: "cancelled" })).toEqual([]);
  });

  it("pages", async () => {
    const { service } = harness();

    const page = await service.list(WORKSPACE, {}, { limit: 2, offset: 1 }, NOW);

    expect(page.items.map((row) => row.displayId)).toEqual(["RS-124", "RS-121"]);
    expect(page).toMatchObject({ total: 4, limit: 2, offset: 1 });
  });

  it("shows another workspace nothing", async () => {
    const { service } = harness();

    expect(await service.list("org-other", {}, WINDOW, NOW)).toMatchObject({
      items: [],
      total: 0,
      counts: { active: 0, thisQuarter: 0 },
    });
  });
});

describe("filterOf", () => {
  it("is empty for an empty request", () => {
    expect(filterOf({}, NOW)).toEqual({});
  });

  it("expands `active` and passes a single status through", () => {
    expect(filterOf({ status: "active" }, NOW).statuses).toEqual([
      "queued",
      "running",
      "brief_ready",
      "issues_filed",
    ]);
    expect(filterOf({ status: "failed" }, NOW).statuses).toEqual(["failed"]);
  });

  it("reads the quarter, and ignores one it cannot read", () => {
    expect(filterOf({ quarter: "current" }, NOW).quarter?.key).toBe("2026-Q4");
    expect(filterOf({ quarter: "2025-Q1" }, NOW).quarter?.key).toBe("2025-Q1");
    expect(filterOf({ quarter: "soon" }, NOW)).toEqual({});
  });
});

describe("opening an investigation", () => {
  it("answers the detail with the ledger per tool", async () => {
    const { service, store } = harness();
    store.ledgers.set(investigationId(127), [
      { tool: "web", count: 30 },
      { tool: "code", count: 14 },
    ]);

    const detail = await service.detail(WORKSPACE, MEMBER, investigationId(127));

    expect(detail).toMatchObject({
      displayId: "RS-127",
      ledger: {
        total: 44,
        byTool: [
          { tool: "web", count: 30 },
          { tool: "code", count: 14 },
        ],
      },
      link: { kind: "brief" },
    });
  });

  it("answers not-found for another workspace's investigation", async () => {
    const { service } = harness();

    await expect(service.detail("org-other", MEMBER, investigationId(127))).rejects.toMatchObject({
      status: 404,
      code: "investigation_not_found",
      details: { investigationId: investigationId(127) },
    });
  });

  it("reads for a service account, which may cancel nothing as a starter", async () => {
    const { service } = harness();

    const detail = await service.detail(
      WORKSPACE,
      { userId: null, roles: ["member"] },
      investigationId(121),
    );

    expect(detail.mayCancel).toBe(false);
  });
});

describe("reading progress", () => {
  it("answers one reading", async () => {
    const { service } = harness();

    expect(await service.progress(WORKSPACE, investigationId(121))).toMatchObject({
      status: "queued",
      sources: 9,
      iteration: null,
    });
  });

  it("answers not-found across workspaces", async () => {
    const { service } = harness();

    await expect(service.progress("org-other", investigationId(121))).rejects.toMatchObject({
      code: "investigation_not_found",
    });
  });
});

describe("the starter setting", () => {
  it("reads `member` for a workspace that never chose", async () => {
    const { service } = harness();

    expect(await service.settings(WORKSPACE)).toEqual({ startRole: "member" });
  });

  it("stores a change, per workspace", async () => {
    const { service, store } = harness();
    const saved = jest.spyOn(store, "saveStartRole");

    expect(await service.updateSettings(WORKSPACE, KEN, { startRole: "admin" })).toEqual({
      startRole: "admin",
    });
    expect(saved).toHaveBeenCalledWith(WORKSPACE, "admin", KEN);
    expect(await service.settings(WORKSPACE)).toEqual({ startRole: "admin" });
    expect(await service.settings("org-other")).toEqual({ startRole: "member" });
  });

  it("changes nothing for an empty patch", async () => {
    const { service, store } = harness();
    store.roles.set(WORKSPACE, "admin");
    const saved = jest.spyOn(store, "saveStartRole");

    expect(await service.updateSettings(WORKSPACE, KEN, {})).toEqual({ startRole: "admin" });
    expect(saved).not.toHaveBeenCalled();
  });
});
