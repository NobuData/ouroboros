import type { ContextAssemblyService } from "../context-assembly/context-assembly.service";
import type { ContextManifest } from "../context-assembly/context-assembly.resources";
import { ENGINE_DRY_RUN_MAX_MANIFEST } from "../engine/engine.dryruns";
import { NotFoundError } from "../errors/error.envelope";
import type { ResolutionService } from "../routing/resolution.service";
import type { WorkflowCatalogService } from "../workflows/catalog.service";
import { DryRunPlanService, manifestText, type PlanSubject } from "./dry-runs.plans";
import { WORKSPACE } from "./dry-runs.store.fixture";

const SUBJECT: PlanSubject = {
  organizationId: WORKSPACE,
  workflowSlug: "security-patch",
  repository: "acme-robotics/helios-firmware",
  labels: ["bug", "can-bus"],
  effort: "m",
};

const MANIFEST = {
  skillVersions: [{ slug: "pr-etiquette", version: 12, body: "  Be kind.\n" }],
  facts: [{ text: "CAN frames are 8 bytes." }, { text: "Twister runs on pool-a." }],
} as unknown as ContextManifest;

function llm(id: string, config: Record<string, unknown>) {
  return {
    id,
    type: "llm",
    title: id,
    position: { x: 0, y: 0 },
    config: {
      mode: "prompt",
      prompt_template: "Do it.",
      routing: {},
      limits: { max_retries: 0, token_budget: 100000 },
      permissions: { push_fixup: false, touch_ci: false },
      ...config,
    },
  };
}

function bench(resolve: (task: string) => unknown = () => ({})) {
  const catalog = {
    dslCatalogue: jest.fn().mockResolvedValue({
      skills: ["pr-etiquette"],
      aliases: ["coder-max", "coder-std"],
      tasks: ["implement"],
    }),
  };
  const routing = {
    resolve: jest.fn().mockImplementation((_org: string, task: string) => {
      const answer = resolve(task);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }),
  };
  const assembly = { assemble: jest.fn().mockResolvedValue(MANIFEST) };
  const service = new DryRunPlanService(
    catalog as unknown as WorkflowCatalogService,
    routing as unknown as ResolutionService,
    assembly as unknown as ContextAssemblyService,
  );

  return { service, catalog, routing, assembly };
}

const RESOLVED = {
  outcome: "resolved",
  resolutionVersion: "res-7",
  chain: [
    { alias: "coder-cheap", decision: "skipped" },
    { alias: "coder-max", decision: "kept" },
  ],
};

describe("the knowledge a stage is given", () => {
  it("is each skill's body under its name, then the facts", () => {
    expect(manifestText(MANIFEST)).toBe(
      "## Skill: pr-etiquette (v12)\n\nBe kind.\n\n## Facts\n\n- CAN frames are 8 bytes.\n- Twister runs on pool-a.",
    );
  });

  it("is empty for an empty manifest, and cut to the engine's bound", () => {
    expect(manifestText({ skillVersions: [], facts: [] } as unknown as ContextManifest)).toBe("");
    const huge = {
      skillVersions: [{ slug: "big", version: 1, body: "x".repeat(ENGINE_DRY_RUN_MAX_MANIFEST) }],
      facts: [],
    } as unknown as ContextManifest;
    expect(manifestText(huge)).toHaveLength(ENGINE_DRY_RUN_MAX_MANIFEST);
  });
});

describe("resolving a dry run's model stages", () => {
  it("resolves nothing, and assembles nothing, for a draft with no model stage", async () => {
    const { service, assembly, catalog } = bench();

    expect(await service.plans(SUBJECT, { nodes: [{ id: "build", type: "infra" }] })).toEqual({});
    expect(await service.plans(SUBJECT, {})).toEqual({});
    expect(assembly.assemble).not.toHaveBeenCalled();
    expect(catalog.dslCatalogue).not.toHaveBeenCalled();
  });

  it("routes a stage by its task kind, with the ticket's facts, to the chain's kept alias", async () => {
    const { service, routing, assembly } = bench(() => RESOLVED);

    const plans = await service.plans(SUBJECT, {
      nodes: [
        llm("implement", { routing: { inherit_task: "implement" } }),
        { id: "build", type: "infra" },
        null,
      ],
    });

    expect(plans).toEqual({
      implement: {
        alias: "coder-max",
        resolutionVersion: "res-7",
        manifest: manifestText(MANIFEST),
        skillResolved: true,
        warnings: [],
      },
    });
    expect(routing.resolve).toHaveBeenCalledWith(WORKSPACE, "implement", {
      labels: ["bug", "can-bus"],
      repo: "acme-robotics/helios-firmware",
      effort: "m",
    });
    expect(assembly.assemble).toHaveBeenCalledTimes(1);
    expect(assembly.assemble).toHaveBeenCalledWith(
      WORKSPACE,
      { repo: "acme-robotics/helios-firmware", workflow: "security-patch" },
      "run_stage",
    );
  });

  it("leaves an unsized ticket's effort out of the routing context", async () => {
    const { service, routing } = bench(() => RESOLVED);

    await service.plans(
      { ...SUBJECT, effort: null },
      {
        nodes: [llm("implement", { routing: { inherit_task: "implement" } })],
      },
    );

    expect(routing.resolve).toHaveBeenCalledWith(WORKSPACE, "implement", {
      labels: ["bug", "can-bus"],
      repo: "acme-robotics/helios-firmware",
    });
  });

  it("takes a pinned alias the registry holds as it is, without asking routing", async () => {
    const { service, routing } = bench();

    const plans = await service.plans(SUBJECT, {
      nodes: [llm("plan", { routing: { pinned_model: { alias: "coder-max" } } })],
    });

    expect(plans.plan).toMatchObject({ alias: "coder-max", resolutionVersion: null, warnings: [] });
    expect(routing.resolve).not.toHaveBeenCalled();
  });

  it("leaves a stage unresolved — skipped honestly, never guessed — with the reason (W7)", async () => {
    const { service } = bench((task) =>
      task === "exploit-verify"
        ? new NotFoundError("route_not_found", "no route")
        : { outcome: "fail_run", chain: [], failure: { explanation: "every hop is unhealthy." } },
    );

    const plans = await service.plans(SUBJECT, {
      nodes: [
        llm("exploit-verify", { routing: { inherit_task: "exploit-verify" } }),
        llm("review", { routing: { inherit_task: "review" } }),
        llm("second", { routing: { pinned_model: { alias: "coder-maxx" } } }),
        llm("nowhere", {}),
      ],
    });

    expect(plans["exploit-verify"]).toMatchObject({
      alias: null,
      warnings: ['Task kind "exploit-verify" has no route yet — the stage was skipped.'],
    });
    expect(plans.review).toMatchObject({
      alias: null,
      warnings: [
        'The "review" route did not resolve — every hop is unhealthy. The stage was skipped.',
      ],
    });
    expect(plans.second).toMatchObject({
      alias: null,
      warnings: ['Alias "coder-maxx" is not in the model registry — the stage was skipped.'],
    });
    expect(plans.nowhere).toMatchObject({
      alias: null,
      warnings: ['Stage "nowhere" names no model routing — the stage was skipped.'],
    });
  });

  it("says so when a route resolves to no kept hop, without an explanation to quote", async () => {
    const { service } = bench(() => ({ outcome: "resolved", chain: [], resolutionVersion: "r" }));

    const plans = await service.plans(SUBJECT, {
      nodes: [llm("review", { routing: { inherit_task: "review" } })],
    });

    expect(plans.review?.warnings[0]).toContain("no provider in the chain can serve it right now");
  });

  it("runs a stage without a skill that does not exist yet, and says so after any routing warning", async () => {
    const { service } = bench(() => RESOLVED);

    const plans = await service.plans(SUBJECT, {
      nodes: [
        llm("analyze", {
          mode: "skill",
          skill: "advisory-db",
          routing: { pinned_model: { alias: "coder-std" } },
        }),
        llm("etiquette", {
          mode: "skill",
          skill: "pr-etiquette",
          routing: { inherit_task: "implement" },
        }),
        llm("both", {
          mode: "skill",
          skill: "advisory-db",
          routing: { pinned_model: { alias: "nope" } },
        }),
      ],
    });

    expect(plans.analyze).toMatchObject({
      alias: "coder-std",
      skillResolved: false,
      warnings: ['Skill "advisory-db" does not exist yet — the stage ran without it.'],
    });
    expect(plans.etiquette).toMatchObject({ skillResolved: true, warnings: [] });
    expect(plans.both?.warnings).toEqual([
      'Alias "nope" is not in the model registry — the stage was skipped.',
      'Skill "advisory-db" does not exist yet — the stage ran without it.',
    ]);
  });

  it("does not guess at a model configuration that does not parse", async () => {
    const { service } = bench();

    const plans = await service.plans(SUBJECT, {
      nodes: [{ id: "broken", type: "llm", config: { mode: "telepathy" } }],
    });

    expect(plans.broken).toEqual({
      alias: null,
      resolutionVersion: null,
      manifest: manifestText(MANIFEST),
      skillResolved: false,
      warnings: ['Stage "broken" has a model configuration that does not parse.'],
    });
  });

  it("lets a routing failure that is not a missing route through", async () => {
    const { service } = bench(() => new Error("database is down"));

    await expect(
      service.plans(SUBJECT, {
        nodes: [llm("implement", { routing: { inherit_task: "implement" } })],
      }),
    ).rejects.toThrow("database is down");
  });
});
