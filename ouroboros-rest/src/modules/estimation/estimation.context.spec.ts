import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Logger } from "@nestjs/common";

import { FLOOR_CODES, HOP_CODES, RESOLUTION_FAILURE_CODES } from "../routing/explanations";
import { RESOLUTION_VERSION, type Resolution, type ResolutionHop } from "../routing/resolution";
import type { ResolutionService } from "../routing/resolution.service";
import { routeNotFound } from "../routing/routing.errors";
import {
  BOOTSTRAP_WORKFLOW_SLUGS,
  type WorkflowRegistryService,
} from "../workflows/registry.service";
import {
  EstimationContextService,
  MAX_OFFERED_WORKFLOW_TAGS,
  MODEL_DEFAULT_KINDS,
} from "./estimation.context";
import { FIXTURE_WORKSPACE } from "./estimation.fixture";

/**
 * The vocabularies an estimate may use, and where they come from
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * This is the **unlanded half of the Z.4 routing amendment** (#197, decision M6) under test:
 * `model_defaults` is filled from the routing resolution rather than from configuration, and
 * the value is the resolved primary — the hop an executor would actually try. The engine's
 * half landed with #106 and is asserted in its own suite.
 *
 * And since P.4 ([#135](https://github.com/NobuData/ouroboros/issues/135)) the other vocabulary
 * comes from a workspace too: `workflowTags` is the workflow registry's, which is the amendment
 * absorbed from [#124](https://github.com/NobuData/ouroboros/issues/124). What an *empty*
 * registry answers is `workflows/registry.service.spec.ts`'; what is asserted here is that this
 * service asks it rather than holding a list of its own.
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
 * A context service over a resolver and a registry a spec writes.
 *
 * @param resolve - What `ResolutionService.resolve` answers, per task kind.
 * @param slugs - What the workflow registry offers this workspace. Decision K5's four by
 *   default, which is what a workspace with no workflow entities of its own is offered — so a
 *   case about the models says nothing about the tags by leaving this out.
 * @returns The service, the resolutions made through it, and the workspaces the registry was
 *   asked about.
 */
function build(
  resolve: (taskKind: string) => Promise<Resolution>,
  slugs: readonly string[] = BOOTSTRAP_WORKFLOW_SLUGS,
) {
  const calls: { organizationId: string; taskKind: string }[] = [];
  const registryAsked: string[] = [];

  const routing = {
    resolve: async (organizationId: string, taskKind: string) => {
      calls.push({ organizationId, taskKind });
      return resolve(taskKind);
    },
  } as unknown as ResolutionService;

  const workflows = {
    offered: (organizationId: string) => {
      registryAsked.push(organizationId);
      return Promise.resolve({
        slugs,
        source: slugs === BOOTSTRAP_WORKFLOW_SLUGS ? ("bootstrap" as const) : ("registry" as const),
      });
    },
  } as unknown as WorkflowRegistryService;

  return { service: new EstimationContextService(routing, workflows), calls, registryAsked };
}

describe("the workflow tags", () => {
  it("offers what the registry offers, scoped to the workspace", async () => {
    // The amendment: this workspace's own active workflows rather than four names every
    // installation shared. The engine only ever *prefers* one of them — `offered_tag` falls
    // back through `standard-fix` to whatever was offered first — so the list is what an answer
    // is held to rather than a hint, which is why it has to be the real one.
    const { service, registryAsked } = build(
      async () => Promise.resolve(resolution()),
      ["release-train", "hotfix-p0"],
    );

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.workflowTags).toEqual(["release-train", "hotfix-p0"]);
    expect(registryAsked).toEqual([FIXTURE_WORKSPACE]);
  });

  it("holds no list of its own to fall back to", async () => {
    // The constant this file used to carry moved to `workflows/registry.service.ts`. If it were
    // still here, a workspace with its own workflows would be offered both.
    const { service } = build(async () => Promise.resolve(resolution()), ["release-train"]);

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.workflowTags).toEqual(["release-train"]);
    for (const builtin of BOOTSTRAP_WORKFLOW_SLUGS) {
      expect(context?.workflowTags).not.toContain(builtin);
    }
  });

  it("passes the bootstrap vocabulary through unchanged for a workspace with no workflows", async () => {
    // Which is every installation today. The estimator's own fallback is first, and that is the
    // registry's guarantee rather than this file's — see `registry.service.spec.ts`.
    const { service } = build(async () => Promise.resolve(resolution()));

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.workflowTags).toEqual([...BOOTSTRAP_WORKFLOW_SLUGS]);
    expect(context?.workflowTags[0]).toBe("standard-fix");
  });

  it("sends a copy, so nothing downstream can edit the registry's answer", async () => {
    const offered = ["release-train"];
    const { service } = build(async () => Promise.resolve(resolution()), offered);

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);
    context?.workflowTags.push("invented");

    expect(offered).toEqual(["release-train"]);
  });
});

describe("a workspace with more workflows than the engine accepts", () => {
  let warned: jest.SpyInstance;

  /** The rail's order, long enough to cross the engine's bound. */
  const many = Array.from(
    { length: MAX_OFFERED_WORKFLOW_TAGS + 3 },
    (_unused, index) => `workflow-${String(index).padStart(3, "0")}`,
  );

  beforeEach(() => {
    warned = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  it("cuts the list to the bound rather than having the request refused", async () => {
    // `MAX_WORKFLOW_TAGS` is a refusal in `estimation/contract.py`, not a truncation: a longer
    // list is a `422` and no estimate at all. A constant of four could never reach it and a
    // registry can, so the trade is an estimate that cannot suggest the sixty-fifth workflow
    // against no estimate for that workspace whatsoever.
    const { service } = build(async () => Promise.resolve(resolution()), many);

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.workflowTags).toHaveLength(MAX_OFFERED_WORKFLOW_TAGS);
  });

  it("keeps the rail's order, so adding a workflow does not change what is offered", async () => {
    const { service } = build(async () => Promise.resolve(resolution()), many);

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.workflowTags).toEqual(many.slice(0, MAX_OFFERED_WORKFLOW_TAGS));
  });

  it("says so, because the two bounds need reconciling", async () => {
    const { service } = build(async () => Promise.resolve(resolution()), many);

    await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining(String(many.length)));
  });

  it("is quiet at exactly the bound", async () => {
    const { service } = build(
      async () => Promise.resolve(resolution()),
      many.slice(0, MAX_OFFERED_WORKFLOW_TAGS),
    );

    const context = await service.forWorkspace(FIXTURE_WORKSPACE);

    expect(context?.workflowTags).toHaveLength(MAX_OFFERED_WORKFLOW_TAGS);
    expect(warned).not.toHaveBeenCalled();
  });

  it("mirrors the engine's own number", () => {
    // `ouroboros-engine`'s `estimation/contract.py`. A mirror that drifted upwards would send a
    // list the engine refuses; one that drifted downwards would hide workflows for no reason.
    const contract = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "ouroboros-engine",
        "src",
        "ouroboros_engine",
        "estimation",
        "contract.py",
      ),
      "utf8",
    );

    expect(contract).toContain(`MAX_WORKFLOW_TAGS = ${MAX_OFFERED_WORKFLOW_TAGS}`);
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
