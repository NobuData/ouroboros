import { Logger } from "@nestjs/common";

import { FLOOR_CODES, HOP_CODES, RESOLUTION_FAILURE_CODES } from "../routing/explanations";
import { RESOLUTION_VERSION, type Resolution, type ResolutionHop } from "../routing/resolution";
import type { ResolutionService } from "../routing/resolution.service";
import { routeNotFound } from "../routing/routing.errors";
import { EstimationContextService, MODEL_DEFAULT_KINDS, WORKFLOW_TAGS } from "./estimation.context";
import { FIXTURE_WORKSPACE } from "./estimation.fixture";

/**
 * The vocabularies an estimate may use, and where they come from
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * This is the **unlanded half of the Z.4 routing amendment** (#197, decision M6) under test:
 * `model_defaults` is filled from the routing resolution rather than from configuration, and
 * the value is the resolved primary — the hop an executor would actually try. The engine's
 * half landed with #106 and is asserted in its own suite.
 */

/** One hop of a resolved chain. */
function hop(overrides: Partial<ResolutionHop> = {}): ResolutionHop {
  return {
    index: 1,
    position: 1,
    alias: "coder-max",
    modelId: "claude-fable-5",
    params: {},
    provider: null,
    note: null,
    decision: "kept",
    code: HOP_CODES.healthy,
    explanation: "Primary hop.",
    ...overrides,
  };
}

/** One resolution, as `ResolutionService.resolve` answers. */
function resolution(overrides: Partial<Resolution> = {}): Resolution {
  return {
    resolutionVersion: RESOLUTION_VERSION,
    taskKind: "implement",
    routeTag: "implement-primary",
    outcome: "resolved",
    chain: [hop()],
    rules: [],
    votes: [],
    floor: { hopIndex: null, code: FLOOR_CODES.none, explanation: "No floor is configured." },
    allowLocalFallback: true,
    maxCostCents: null,
    failure: null,
    ...overrides,
  };
}

/**
 * A context service over a resolver a spec writes.
 *
 * @param resolve - What `ResolutionService.resolve` answers, per task kind.
 * @returns The service and the calls made through it.
 */
function build(resolve: (taskKind: string) => Promise<Resolution>) {
  const calls: { organizationId: string; taskKind: string }[] = [];

  const routing = {
    resolve: async (organizationId: string, taskKind: string) => {
      calls.push({ organizationId, taskKind });
      return resolve(taskKind);
    },
  } as unknown as ResolutionService;

  return { service: new EstimationContextService(routing), calls };
}

describe("the workflow tags", () => {
  it("offers the four the mockup renders, with the estimator's fallback among them", async () => {
    // The engine only ever *prefers* a tag: `offered_tag` falls back through `standard-fix` to
    // whatever was offered first, so this list is what an answer is held to. It is a constant
    // here because workflow entities are mockup 04's and no table declares one yet.
    const { service } = build(async () => Promise.resolve(resolution()));

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.workflowTags).toEqual([
      "standard-fix",
      "docs-loop",
      "feature-loop",
      "deps-refresh",
    ]);
    expect(WORKFLOW_TAGS[0]).toBe("standard-fix");
  });
});

describe("the model defaults", () => {
  it("resolves each key through its own task kind, scoped to the workspace", async () => {
    const { service, calls } = build(async (taskKind) =>
      Promise.resolve(
        resolution({
          taskKind,
          chain: [hop({ modelId: taskKind === "docs" ? "claude-haiku-4-5" : "claude-fable-5" })],
        }),
      ),
    );

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.modelDefaults).toEqual({
      default: "claude-fable-5",
      docs: "claude-haiku-4-5",
    });
    expect(calls.map((call) => call.taskKind).sort()).toEqual(["docs", "implement"]);
    expect(calls.every((call) => call.organizationId === FIXTURE_WORKSPACE)).toBe(true);
  });

  it("names the model an executor would actually try, skipping dropped hops", async () => {
    // `Resolution.chain` carries dropped hops *with their explanations* — that is what the
    // simulate panel renders — so naming hop 1 blindly would point an estimate at a model the
    // executor is going to skip.
    const { service } = build(async () =>
      Promise.resolve(
        resolution({
          chain: [
            hop({ index: 1, decision: "dropped", modelId: "unreachable-local" }),
            hop({ index: 2, decision: "kept", modelId: "claude-fable-5" }),
          ],
        }),
      ),
    );

    expect((await service.forWorkspace(FIXTURE_WORKSPACE))?.modelDefaults).toMatchObject({
      default: "claude-fable-5",
    });
  });

  it("omits a key whose kind has no route, rather than guessing one", async () => {
    const { service } = build(async (taskKind) =>
      taskKind === "implement"
        ? Promise.resolve(resolution())
        : Promise.reject(routeNotFound(taskKind)),
    );

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.modelDefaults).toEqual({ default: "claude-fable-5" });
  });

  it("omits a key whose route refuses to run", async () => {
    // `fail_run` is a successful answer carrying a reason — a floor breached, nothing healthy
    // under the chain — and it means the same thing to this question as no route at all: there
    // is no model to name.
    const { service } = build(async (taskKind) =>
      Promise.resolve(
        taskKind === "implement"
          ? resolution()
          : resolution({
              outcome: "fail_run",
              chain: [],
              failure: {
                code: RESOLUTION_FAILURE_CODES.noEligibleHop,
                explanation: "Nothing to run it on.",
              },
            }),
      ),
    );

    expect((await service.forWorkspace(FIXTURE_WORKSPACE))?.modelDefaults).toEqual({
      default: "claude-fable-5",
    });
  });

  it("omits a key whose every hop was dropped", async () => {
    const { service } = build(async (taskKind) =>
      Promise.resolve(
        taskKind === "implement"
          ? resolution()
          : resolution({ chain: [hop({ decision: "dropped" })] }),
      ),
    );

    expect((await service.forWorkspace(FIXTURE_WORKSPACE))?.modelDefaults).toEqual({
      default: "claude-fable-5",
    });
  });

  it("keeps `default` among the keys it offers, because it is the one the engine falls back to", () => {
    // `heuristic-v0` looks a per-tag key up first and falls through to `default`. A map with no
    // `default` would still work — the engine takes the first key it was given — but the key
    // that always matches is the one worth guaranteeing.
    expect(Object.keys(MODEL_DEFAULT_KINDS)).toContain("default");
    expect(MODEL_DEFAULT_KINDS["default"]).toBe("implement");
  });
});

describe("a workspace that routes nothing", () => {
  let warned: jest.SpyInstance;

  beforeEach(() => {
    warned = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  it("answers undefined rather than inventing a model", async () => {
    // `issue_estimates.routed_model` is not null and non-blank, so an installation with no
    // route genuinely has no estimate to store. A guessed model would be a record of a
    // resolution that never happened.
    const { service } = build(async (taskKind) => Promise.reject(routeNotFound(taskKind)));

    await expect(service.forWorkspace(FIXTURE_WORKSPACE)).resolves.toBeUndefined();
  });

  it("says so once, naming the kinds it looked for", async () => {
    const { service } = build(async (taskKind) => Promise.reject(routeNotFound(taskKind)));

    await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("implement"));
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("unsized"));
  });

  it("is quiet when even one key resolved", async () => {
    const { service } = build(async (taskKind) =>
      taskKind === "implement"
        ? Promise.resolve(resolution())
        : Promise.reject(routeNotFound(taskKind)),
    );

    await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(warned).not.toHaveBeenCalled();
  });

  it("treats a resolution that threw for any other reason the same way", async () => {
    // The caller's next move is identical whatever went wrong, and there is exactly one
    // sentence a person needs — so a second classification here would be a branch nothing reads.
    const { service } = build(async () => Promise.reject(new Error("the pool is exhausted")));

    await expect(service.forWorkspace(FIXTURE_WORKSPACE)).resolves.toBeUndefined();
  });
});
