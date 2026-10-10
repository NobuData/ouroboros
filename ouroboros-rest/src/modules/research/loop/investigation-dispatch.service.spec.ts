/**
 * Dispatch, cancel and resume (#620): the engine request an investigation becomes, the budget
 * it is given, and what happens to one a restart left behind.
 */

import { Logger } from "@nestjs/common";

import type { EngineClient } from "../../engine/engine.client";
import type { EngineInvestigateRequest } from "../../engine/engine.investigate";
import { ENGINE_ERRORS, engineUnavailable } from "../../engine/engine.errors";
import { NotFoundError } from "../../errors/error.envelope";
import type { ResolutionService } from "../../routing/resolution.service";
import { ROUTING_ERRORS } from "../../routing/routing.errors";
import { RESEARCH_ERRORS } from "../research.errors";
import type { ResearchToolRegistry } from "../tools/research-tool.registry";
import {
  ABANDONED_DETAIL,
  InvestigationDispatchService,
  MAX_ATTEMPTS,
  STALL_MS,
  budgetOf,
} from "./investigation-dispatch.service";
import { INVESTIGATION_LOOP_ERRORS } from "./investigation-loop.errors";
import type { InvestigationLoopRepository } from "./investigation-loop.repository";
import {
  INVESTIGATION,
  MemoryLoopStore,
  WORKSPACE,
  investigation,
} from "./investigation-loop.store.fixture";

const START = { loopVersion: "loop-v1", alias: "a", resolutionRef: null, task: "t" };

/** An adapter stand-in with the given capabilities. */
function adapter(name: string, subLine: string, operations: string[]) {
  return {
    displayMeta: () => ({ name, glyph: "·", subLine }),
    capabilities: () => ({
      search: operations.includes("search"),
      fetch: operations.includes("fetch"),
      query: operations.includes("query"),
      watch: false,
    }),
  };
}

const ADAPTERS: Record<string, ReturnType<typeof adapter>> = {
  web: adapter("Web search & reader", "search and page reads", ["search", "fetch"]),
  competitor: adapter(
    "Competitor tracker",
    "{rivals} rivals watched · release notes, changelogs, filings",
    ["query"],
  ),
  code: adapter("Codebase & git mining", "blame, bisect, dependency graph over {repos}", ["query"]),
  tickets: adapter("Issue & PR history", "", ["query"]),
};

function resolved(alias: string) {
  return {
    outcome: "resolved",
    resolutionVersion: "r1",
    chain: [
      { alias: "dropped-first", decision: "dropped" },
      { alias, decision: "kept" },
    ],
  };
}

function bench(...seeded: Parameters<typeof investigation>[0][]) {
  const store = new MemoryLoopStore(
    ...(seeded.length === 0 ? [investigation()] : seeded.map((each) => investigation(each))),
  );
  const submitted: EngineInvestigateRequest[] = [];
  const investigate = jest.fn((request: EngineInvestigateRequest) => {
    submitted.push(request);
    return Promise.resolve({
      investigation: request.investigation,
      task: `investigate:${request.investigation}`,
      state: "accepted" as const,
      loopVersion: "loop-v1",
    });
  });
  const resolve = jest.fn((_organizationId: string, taskKind: string): Promise<unknown> =>
    Promise.resolve(resolved(taskKind === "research" ? "researcher-long-ctx" : "sizer")),
  );
  const service = new InvestigationDispatchService(
    store as unknown as InvestigationLoopRepository,
    { find: (slug: string) => ADAPTERS[slug] } as unknown as ResearchToolRegistry,
    { resolve } as unknown as ResolutionService,
    { investigate } as unknown as EngineClient,
  );
  return { store, service, submitted, investigate, resolve };
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

describe("dispatching an investigation", () => {
  it("sends the engine the playbook, the tools, the budget and the routed aliases", async () => {
    const { service, submitted } = bench();

    const dispatched = await service.dispatch(WORKSPACE, INVESTIGATION);

    expect(dispatched).toEqual({
      investigation: "RS-127",
      task: `investigate:${INVESTIGATION}`,
      state: "accepted",
      loopVersion: "loop-v1",
    });
    expect(submitted).toEqual([
      {
        investigation: INVESTIGATION,
        kind: {
          slug: "gap_analysis",
          playbook: {
            version: 1,
            default_tools: ["web", "competitor", "code", "tickets", "telemetry"],
            synthesis_template: "gap_analysis@1",
            deliverables: ["brief", "matrix"],
          },
        },
        question: "Why do rivals dock reliably in wind and we do not?",
        // `telemetry` is enabled but has no adapter in this build, so the loop is not told of it.
        tools: [
          {
            slug: "web",
            operations: ["search", "fetch"],
            description: "Web search & reader — search and page reads",
          },
          {
            slug: "competitor",
            operations: ["query"],
            description: "Competitor tracker — rivals watched · release notes, changelogs, filings",
          },
          {
            slug: "code",
            operations: ["query"],
            description: "Codebase & git mining — blame, bisect, dependency graph over",
          },
          { slug: "tickets", operations: ["query"], description: "Issue & PR history" },
        ],
        depth: "deep_dive",
        // Mockup 22's deep dive: 40 operations, up to 60 sources; 687¢ × 1.5 → 1031¢.
        budget: { operations: 40, sources: 60, spendCents: 1031 },
        alias: "researcher-long-ctx",
        planAlias: "sizer",
        resolutionVersion: "r1",
      },
    ]);
  });

  it("plans on the research alias when the workspace routes no research-plan kind", async () => {
    const { service, submitted, resolve } = bench();
    resolve.mockImplementation((_organizationId, taskKind) =>
      taskKind === "research"
        ? Promise.resolve(resolved("researcher-long-ctx"))
        : Promise.reject(new NotFoundError(ROUTING_ERRORS.routeNotFound, "no route")),
    );

    await service.dispatch(WORKSPACE, INVESTIGATION);

    expect(submitted[0]?.planAlias).toBeNull();
  });

  it.each([
    [
      "no research route",
      () => Promise.reject(new NotFoundError(ROUTING_ERRORS.routeNotFound, "x")),
    ],
    ["a resolution that refuses to run", () => Promise.resolve({ outcome: "fail_run", chain: [] })],
    [
      "a resolution that keeps no hop",
      () => Promise.resolve({ outcome: "resolved", chain: [{ alias: "x", decision: "dropped" }] }),
    ],
  ])("refuses to dispatch with %s", async (_name, answer) => {
    const { service, investigate, resolve } = bench();
    resolve.mockImplementation(answer);

    expect(await code(service.dispatch(WORKSPACE, INVESTIGATION))).toBe(
      INVESTIGATION_LOOP_ERRORS.researcherUnavailable,
    );
    expect(investigate).not.toHaveBeenCalled();
  });

  it("does not swallow a routing failure that is not a missing route", async () => {
    const { service, resolve } = bench();
    resolve.mockRejectedValue(new Error("the database went away"));

    await expect(service.dispatch(WORKSPACE, INVESTIGATION)).rejects.toThrow(
      "the database went away",
    );
  });

  it("refuses when none of the enabled tools has an adapter", async () => {
    const { service, investigate } = bench({ tools: ["telemetry", "docs"] });

    expect(await code(service.dispatch(WORKSPACE, INVESTIGATION))).toBe(
      INVESTIGATION_LOOP_ERRORS.toolsUnavailable,
    );
    expect(investigate).not.toHaveBeenCalled();
  });

  it.each(["brief_ready", "issues_filed", "failed", "cancelled"] as const)(
    "refuses a %s investigation",
    async (status) => {
      const { service } = bench({ status });
      expect(await code(service.dispatch(WORKSPACE, INVESTIGATION))).toBe(
        INVESTIGATION_LOOP_ERRORS.notRunnable,
      );
    },
  );

  it("does not find another workspace's investigation", async () => {
    const { service, investigate } = bench();

    expect(await code(service.dispatch("org-elsewhere", INVESTIGATION))).toBe(
      RESEARCH_ERRORS.investigationNotFound,
    );
    expect(investigate).not.toHaveBeenCalled();
  });

  it("leaves the investigation queued when the engine cannot take it", async () => {
    const { store, service, investigate } = bench();
    investigate.mockRejectedValue(engineUnavailable());

    expect(await code(service.dispatch(WORKSPACE, INVESTIGATION))).toBe(ENGINE_ERRORS.unavailable);
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("queued");
  });
});

describe("an investigation's budget", () => {
  it("is the scope estimate's operations and sources for its depth and tools", () => {
    expect(budgetOf(investigation({ depth: "quick", tools: ["web"], estimate: null }))).toEqual({
      operations: 3,
      sources: 5,
      spendCents: null,
    });
    expect(
      budgetOf(investigation({ depth: "standard", tools: ["web", "telemetry"], estimate: null })),
    ).toEqual({ operations: 8, sources: 12, spendCents: null });
  });

  it("caps spend at one and a half times the estimate's upper bound, rounded up", () => {
    const estimate = (max: number) => ({
      sources: { min: 1, max: 2 },
      cost_cents: { min: 0, max },
    });
    expect(budgetOf(investigation({ estimate: estimate(687) })).spendCents).toBe(1031);
    expect(budgetOf(investigation({ estimate: estimate(100) })).spendCents).toBe(150);
    expect(budgetOf(investigation({ estimate: estimate(0) })).spendCents).toBe(0);
  });

  it("sets no ceiling for an unpriced estimate", () => {
    expect(
      budgetOf(investigation({ estimate: { sources: { min: 40, max: 60 }, cost_cents: null } }))
        .spendCents,
    ).toBeNull();
  });
});

describe("cancelling", () => {
  it("cancels a queued investigation at once", async () => {
    const { store, service } = bench();

    expect(await service.requestCancel(WORKSPACE, INVESTIGATION, "user-1")).toEqual({
      investigation: "RS-127",
      state: "cancelled",
    });
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("cancelled");
  });

  it("records the request for a running one and leaves it to its worker", async () => {
    const { store, service } = bench();
    await store.start(INVESTIGATION, START);

    expect(await service.requestCancel(WORKSPACE, INVESTIGATION, "user-1")).toEqual({
      investigation: "RS-127",
      state: "cancelling",
    });
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("running");
    expect(store.loops.get(INVESTIGATION)?.cancelRequestedBy).toBe("user-1");

    // Asking again changes nothing, and keeps who asked first.
    await service.requestCancel(WORKSPACE, INVESTIGATION, "user-2");
    expect(store.loops.get(INVESTIGATION)?.cancelRequestedBy).toBe("user-1");
  });

  it("cancels a running investigation no worker ever claimed", async () => {
    const { store, service } = bench({ status: "running" });

    expect((await service.requestCancel(WORKSPACE, INVESTIGATION, null)).state).toBe("cancelled");
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("cancelled");
  });

  it.each(["brief_ready", "issues_filed", "failed", "cancelled"] as const)(
    "refuses to cancel a %s investigation",
    async (status) => {
      const { service } = bench({ status });
      expect(await code(service.requestCancel(WORKSPACE, INVESTIGATION, null))).toBe(
        INVESTIGATION_LOOP_ERRORS.notCancellable,
      );
    },
  );

  it("does not cancel another workspace's investigation", async () => {
    const { store, service } = bench();

    expect(await code(service.requestCancel("org-elsewhere", INVESTIGATION, null))).toBe(
      RESEARCH_ERRORS.investigationNotFound,
    );
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("queued");
  });
});

describe("the resume pass", () => {
  const LATER = new Date("2026-10-09T12:00:00Z").getTime() + STALL_MS + 1;

  it("submits a running investigation whose checkpoint stopped moving", async () => {
    const { store, service, submitted } = bench();
    await store.start(INVESTIGATION, START);

    expect(await service.resume(new Date(LATER))).toBe(1);

    expect(submitted.map((request) => request.investigation)).toEqual([INVESTIGATION]);
  });

  it("leaves alone one that checkpointed recently", async () => {
    const { store, service, investigate } = bench();
    await store.start(INVESTIGATION, START);

    expect(await service.resume(new Date(LATER - 2))).toBe(0);
    expect(investigate).not.toHaveBeenCalled();
  });

  it("leaves queued and finished investigations alone", async () => {
    const { store, service, investigate } = bench();
    expect(await service.resume(new Date(LATER))).toBe(0);

    await store.start(INVESTIGATION, START);
    await store.finish(INVESTIGATION, {
      attempt: 1,
      outcome: "cancelled",
      reason: null,
      detail: null,
      durationMs: 0,
      usage: [],
      seq: 1,
      checkpoint: {},
    });
    expect(await service.resume(new Date(LATER))).toBe(0);
    expect(investigate).not.toHaveBeenCalled();
  });

  it("fails an investigation that has used up its attempts, keeping what it gathered", async () => {
    const { store, service, investigate } = bench();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await store.start(INVESTIGATION, START);
    }
    await store.checkpoint(INVESTIGATION, {
      attempt: MAX_ATTEMPTS,
      seq: 1,
      checkpoint: { phase: "iterate" },
      durationMs: 9_000,
      usage: [],
    });

    await service.resume(new Date(LATER));

    expect(investigate).not.toHaveBeenCalled();
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("failed");
    const loop = store.loops.get(INVESTIGATION);
    expect(loop?.failureReason).toBe("engine_error");
    expect(loop?.failureDetail).toBe(ABANDONED_DETAIL);
    expect(loop?.checkpoint).toEqual({ phase: "iterate" });
    expect(store.actuals.get(INVESTIGATION)?.duration_ms).toBe(9_000);
  });

  it("cancels a stalled investigation a person asked to stop, without an engine", async () => {
    const { store, service, investigate } = bench();
    await store.start(INVESTIGATION, START);
    await service.requestCancel(WORKSPACE, INVESTIGATION, "user-1");
    investigate.mockRejectedValue(engineUnavailable());

    await service.resume(new Date(LATER));

    expect(investigate).not.toHaveBeenCalled();
    expect(store.investigations.get(INVESTIGATION)?.status).toBe("cancelled");
    expect(store.loops.get(INVESTIGATION)?.failureReason).toBeNull();
    expect(store.actuals.get(INVESTIGATION)).toEqual({
      sources_used: 0,
      spend_cents: 0,
      duration_ms: 0,
    });
  });

  it("carries on with the others when one cannot be resumed", async () => {
    const other = "5eed0091-0000-4000-8000-000000000128";
    const { store, service, investigate } = bench({}, { id: other, displayId: "RS-128" });
    await store.start(INVESTIGATION, START);
    store.now = new Date(store.now.getTime() + 1);
    await store.start(other, START);
    investigate.mockRejectedValueOnce(engineUnavailable());

    expect(await service.resume(new Date(LATER + 1))).toBe(2);

    expect(investigate).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
  });
});
