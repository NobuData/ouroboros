import {
  loopReadiness,
  READINESS_CHECK_IDS,
  READINESS_CODES,
  READINESS_FIXES,
  workflowStages,
  type ReadinessCheckId,
  type ReadinessCode,
  type ReadinessFacts,
  type ReadinessState,
} from "./readiness";

/** A published live-slice: plan → implement (both routed) → build on pool-a → draft PR. */
const DEFINITION = document([
  node("start", "trigger", {}),
  node("plan", "llm", llm("plan")),
  node("implement", "llm", llm("implement")),
  node("build", "infra", { runner_pool: "pool-a" }),
]);

/**
 * A workflow document over these nodes.
 *
 * @param nodes - The nodes.
 * @returns The document.
 */
function document(nodes: unknown[]) {
  return {
    dsl_version: "1.0",
    trigger: { event: "ticket_queued", conditions: {} },
    nodes,
    edges: [],
  };
}

/**
 * One DSL node.
 *
 * @param id - Its id.
 * @param type - Its type.
 * @param config - Its config.
 * @returns The node.
 */
function node(id: string, type: string, config: Record<string, unknown>) {
  return { id, type, title: id, position: { x: 0, y: 0 }, config };
}

/**
 * A model stage's config inheriting one task kind's route.
 *
 * @param task - The task kind.
 * @returns The config.
 */
function llm(task: string) {
  return {
    mode: "prompt",
    prompt_template: "Do the work.",
    routing: { inherit_task: task },
    limits: { max_retries: 1, token_budget: 200000 },
    permissions: { push_fixup: false, touch_ci: false },
  };
}

/** Every fact holding: the preflight passes. */
function readyFacts(): ReadinessFacts {
  return {
    repository: { slug: "acme/helios", enabled: true },
    workflowSlug: "live-slice",
    workflow: {
      slug: "live-slice",
      version: 1,
      stages: {
        modelStages: 2,
        tasks: ["plan", "implement"],
        buildStages: [{ node: "build", pool: "pool-a" }],
      },
    },
    deploymentEnabled: true,
    workspaceState: "active",
    connections: [{ kind: "anthropic", displayName: "Anthropic", status: "active" }],
    routes: [
      { task: "plan", resolves: true, alias: "coder-std", priced: true },
      { task: "implement", resolves: true, alias: "coder-std", priced: true },
    ],
    engine: { reachable: true, executors: ["harness"] },
    pools: [{ name: "pool-a", exists: true, enabled: true, online: 1, eligible: 1 }],
    push: { outcome: "can_push" },
    pullRequest: { outcome: "can_push" },
    dryRun: true,
    slots: { taken: 0, ceiling: 1 },
    estimate: {
      costCapCentsPerRun: 200,
      issue: { number: 1, title: "Greet by name", size: "s", sizedBy: "heuristic-v0" },
    },
  };
}

/** One failing fixture: the facts to change, and the check it must move. */
interface Failing {
  readonly name: string;
  readonly change: (facts: ReadinessFacts) => ReadinessFacts;
  readonly id: ReadinessCheckId;
  readonly state: Exclude<ReadinessState, "pass">;
  readonly code: ReadinessCode;
  readonly href: string;
}

const FAILING: readonly Failing[] = [
  {
    name: "the deployment switch is off",
    change: (f) => ({ ...f, deploymentEnabled: false }),
    id: "deployment",
    state: "fail",
    code: "deployment_disabled",
    href: READINESS_FIXES.liveExecution.href,
  },
  {
    name: "the workspace is paused",
    change: (f) => ({ ...f, workspaceState: "paused" }),
    id: "workspace",
    state: "fail",
    code: "workspace_paused",
    href: "/settings",
  },
  {
    name: "the workspace is pending deletion",
    change: (f) => ({ ...f, workspaceState: "pending_delete" }),
    id: "workspace",
    state: "fail",
    code: "workspace_pending_delete",
    href: "/settings",
  },
  {
    name: "no invocable connection exists",
    change: (f) => ({ ...f, connections: [] }),
    id: "provider_connection",
    state: "fail",
    code: "no_invocable_connection",
    href: "/models/providers",
  },
  {
    name: "every invocable connection failed its test",
    change: (f) => ({
      ...f,
      connections: [{ kind: "anthropic", displayName: "Anthropic", status: "error" }],
    }),
    id: "provider_connection",
    state: "fail",
    code: "connection_unhealthy",
    href: "/models/providers",
  },
  {
    name: "no invocable connection has been tested",
    change: (f) => ({
      ...f,
      connections: [
        { kind: "anthropic", displayName: "Anthropic", status: "unknown" },
        { kind: "openai", displayName: "OpenAI", status: "error" },
      ],
    }),
    id: "provider_connection",
    state: "unknown",
    code: "connection_untested",
    href: "/models/providers",
  },
  {
    name: "a task kind's route does not resolve",
    change: (f) => ({
      ...f,
      routes: [
        { task: "plan", resolves: true, alias: "coder-std", priced: true },
        { task: "implement", resolves: false, alias: null, priced: false },
      ],
    }),
    id: "routes",
    state: "fail",
    code: "route_unresolved",
    href: "/models",
  },
  {
    name: "a route resolves to an unpriced model",
    change: (f) => ({
      ...f,
      routes: [
        { task: "plan", resolves: true, alias: "local-qwen", priced: false },
        { task: "implement", resolves: true, alias: "coder-std", priced: true },
      ],
    }),
    id: "routes",
    state: "fail",
    code: "route_unpriced",
    href: "/models",
  },
  {
    name: "the engine does not answer",
    change: (f) => ({ ...f, engine: { reachable: false, executors: [] } }),
    id: "stage_executors",
    state: "fail",
    code: "engine_unavailable",
    href: READINESS_FIXES.stageExecutors.href,
  },
  {
    name: "the engine registered no executor",
    change: (f) => ({ ...f, engine: { reachable: true, executors: [] } }),
    id: "stage_executors",
    state: "fail",
    code: "no_executor",
    href: READINESS_FIXES.stageExecutors.href,
  },
  {
    name: "a build stage names no pool",
    change: (f) => withBuildStages(f, [{ node: "build", pool: null }]),
    id: "runner",
    state: "fail",
    code: "build_pool_required",
    href: "/workflows/live-slice?node=build",
  },
  {
    name: "the build stage's pool does not exist",
    change: (f) => ({
      ...f,
      pools: [{ name: "pool-a", exists: false, enabled: false, online: 0, eligible: 0 }],
    }),
    id: "runner",
    state: "fail",
    code: "pool_not_found",
    href: "/build-farm",
  },
  {
    name: "the build stage's pool is disabled",
    change: (f) => ({
      ...f,
      pools: [{ name: "pool-a", exists: true, enabled: false, online: 1, eligible: 1 }],
    }),
    id: "runner",
    state: "fail",
    code: "pool_disabled",
    href: "/build-farm",
  },
  {
    name: "no runner is online in the pool",
    change: (f) => ({
      ...f,
      pools: [{ name: "pool-a", exists: true, enabled: true, online: 0, eligible: 0 }],
    }),
    id: "runner",
    state: "fail",
    code: "no_runner",
    href: "/build-farm",
  },
  {
    name: "no online runner can check out source",
    change: (f) => ({
      ...f,
      pools: [{ name: "pool-a", exists: true, enabled: true, online: 2, eligible: 0 }],
    }),
    id: "runner",
    state: "fail",
    code: "no_source_checkout",
    href: "/build-farm",
  },
  {
    name: "the repository is not enabled",
    change: (f) => ({ ...f, repository: { slug: "acme/helios", enabled: false } }),
    id: "repository",
    state: "fail",
    code: "repository_disabled",
    href: "/settings/repositories",
  },
  {
    name: "the workspace has no GitHub token",
    change: (f) => ({ ...f, push: { outcome: "not_configured" } }),
    id: "push_credential",
    state: "fail",
    code: "github_not_configured",
    href: "/settings/sources",
  },
  {
    name: "the workspace token cannot read the repository",
    change: (f) => ({ ...f, push: { outcome: "unreadable" } }),
    id: "push_credential",
    state: "fail",
    code: "repository_unreadable",
    href: "/settings/sources",
  },
  {
    name: "the workspace token's account cannot push",
    change: (f) => ({ ...f, push: { outcome: "push_denied" } }),
    id: "push_credential",
    state: "fail",
    code: "push_denied",
    href: "/settings/sources",
  },
  {
    name: "GitHub does not say whether the workspace token may push",
    change: (f) => ({ ...f, push: { outcome: "unconfirmed", why: "no permission document" } }),
    id: "push_credential",
    state: "unknown",
    code: "permission_unconfirmed",
    href: "/settings/sources",
  },
  {
    name: "no issue is picked",
    change: (f) => ({ ...f, pullRequest: { outcome: "no_issue" } }),
    id: "pull_request_credential",
    state: "unknown",
    code: "no_issue_chosen",
    href: "/get-started?repo=acme%2Fhelios",
  },
  {
    name: "no GitHub source mirrors the issue",
    change: (f) => ({ ...f, pullRequest: { outcome: "no_pr_source" } }),
    id: "pull_request_credential",
    state: "fail",
    code: "no_pr_source",
    href: "/settings/sources",
  },
  {
    name: "the issue's source opens PRs elsewhere",
    change: (f) => ({ ...f, pullRequest: { outcome: "other_repository", target: "acme/docs" } }),
    id: "pull_request_credential",
    state: "fail",
    code: "pr_source_other_repository",
    href: "/settings/sources",
  },
  {
    name: "the source token's account cannot push",
    change: (f) => ({ ...f, pullRequest: { outcome: "push_denied" } }),
    id: "pull_request_credential",
    state: "fail",
    code: "push_denied",
    href: "/settings/sources",
  },
  {
    name: "the repository is not in dry-run",
    change: (f) => ({ ...f, dryRun: false }),
    id: "dry_run",
    state: "fail",
    code: "policy_not_dry_run",
    href: "/settings#policies",
  },
  {
    name: "the workflow does not exist",
    change: (f) => ({ ...f, workflow: undefined }),
    id: "workflow_published",
    state: "fail",
    code: "workflow_not_found",
    href: "/workflows",
  },
  {
    name: "nothing of the workflow is published",
    change: (f) => ({ ...f, workflow: { slug: "live-slice", version: null, stages: undefined } }),
    id: "workflow_published",
    state: "fail",
    code: "workflow_unpublished",
    href: "/workflows/live-slice",
  },
  {
    name: "the concurrency ceiling is full",
    change: (f) => ({ ...f, slots: { taken: 1, ceiling: 1 } }),
    id: "concurrency",
    state: "fail",
    code: "concurrency_ceiling",
    href: READINESS_FIXES.limits.href,
  },
];

/**
 * The facts with other build stages.
 *
 * @param facts - The facts.
 * @param buildStages - The stages.
 * @returns The changed facts.
 */
function withBuildStages(
  facts: ReadinessFacts,
  buildStages: NonNullable<NonNullable<ReadinessFacts["workflow"]>["stages"]>["buildStages"],
): ReadinessFacts {
  const workflow = facts.workflow;

  if (workflow?.stages === undefined) {
    throw new Error("the fixture has a readable workflow");
  }

  return { ...facts, workflow: { ...workflow, stages: { ...workflow.stages, buildStages } } };
}

describe("the live-loop readiness preflight (DK.1, #1318)", () => {
  it("lists every check, in order, and is ready when all pass", () => {
    const readiness = loopReadiness(readyFacts());

    expect(readiness.checks.map((check) => check.id)).toEqual([...READINESS_CHECK_IDS]);
    expect(readiness.checks.every((check) => check.state === "pass")).toBe(true);
    expect(readiness.checks.every((check) => check.code === null && check.fix === null)).toBe(true);
    expect(readiness.ready).toBe(true);
    expect(readiness).toMatchObject({
      repository: "acme/helios",
      workflow: { slug: "live-slice", version: 1 },
    });
  });

  it("says what passed, in the workspace's own names", () => {
    const reasons = Object.fromEntries(
      loopReadiness(readyFacts()).checks.map((check) => [check.id, check.reason]),
    );

    expect(reasons.provider_connection).toBe(
      "A provider connection can run a loop: Anthropic (anthropic).",
    );
    expect(reasons.routes).toBe("Routes resolve: plan, implement.");
    expect(reasons.runner).toBe("A runner is online in pool-a.");
    expect(reasons.workflow_published).toBe("live-slice@v1 is published.");
    expect(reasons.concurrency).toBe("A live-run slot is free (0 of 1 in use).");
  });

  it.each(FAILING)("blocks when $name", ({ change, id, state, code, href }) => {
    const readiness = loopReadiness(change(readyFacts()));
    const check = readiness.checks.find((candidate) => candidate.id === id);

    expect(check).toMatchObject({ state, code, fix: { href } });
    expect(check?.reason).not.toBe("");
    expect(check?.fix?.label).not.toBe("");
    expect(readiness.ready).toBe(false);
    // Only the changed check moved.
    expect(
      readiness.checks.filter((candidate) => candidate.state !== "pass").map((c) => c.id),
    ).toEqual(id === "workflow_published" ? expect.arrayContaining([id]) : [id]);
  });

  it("has a failing fixture for every check, and uses every code", () => {
    const covered = new Set(FAILING.map((failing) => failing.id));
    const codes = new Set(FAILING.map((failing) => failing.code));

    expect([...READINESS_CHECK_IDS].filter((id) => !covered.has(id))).toEqual([]);
    expect(
      READINESS_CODES.filter((code) => !codes.has(code) && code !== "workflow_unreadable"),
    ).toEqual([]);
  });

  it("blocks with `unknown` the checks that need stages it cannot read", () => {
    const readiness = loopReadiness({
      ...readyFacts(),
      workflow: { slug: "live-slice", version: 3, stages: undefined },
      routes: [],
      pools: [],
    });
    const states = Object.fromEntries(
      readiness.checks.map((check) => [check.id, [check.state, check.code]]),
    );

    expect(states.routes).toEqual(["unknown", "workflow_unreadable"]);
    expect(states.stage_executors).toEqual(["unknown", "workflow_unreadable"]);
    expect(states.runner).toEqual(["unknown", "workflow_unreadable"]);
    expect(states.workflow_published).toEqual(["fail", "workflow_unpublished"]);
    expect(readiness.checks.find((check) => check.id === "workflow_published")?.reason).toBe(
      "live-slice@v3 cannot be read.",
    );
    expect(readiness.ready).toBe(false);
  });

  it("lets an `unknown` alone block readiness, with its reason", () => {
    const readiness = loopReadiness({
      ...readyFacts(),
      push: { outcome: "unconfirmed", why: "GitHub's answer carries no permission for the token" },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.id === "push_credential")).toMatchObject({
      state: "unknown",
      reason:
        "Whether the token can push a branch could not be confirmed: GitHub's answer carries no permission for the token.",
    });
  });

  it("passes the stage checks a workflow without model or build stages does not need", () => {
    const facts = readyFacts();
    const readiness = loopReadiness({
      ...facts,
      workflow: {
        slug: "live-slice",
        version: 1,
        stages: { modelStages: 0, tasks: [], buildStages: [] },
      },
      routes: [],
      pools: [],
      engine: { reachable: false, executors: [] },
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks.find((check) => check.id === "runner")?.reason).toBe(
      "The workflow has no build stage.",
    );
  });

  it("labels the estimate as one and keeps it out of `ready`", () => {
    const readiness = loopReadiness({
      ...readyFacts(),
      deploymentEnabled: false,
      estimate: { costCapCentsPerRun: null, issue: null },
    });

    expect(readiness.estimate).toEqual({ isEstimate: true, costCapCentsPerRun: null, issue: null });
    expect(loopReadiness(readyFacts()).estimate).toEqual({
      isEstimate: true,
      costCapCentsPerRun: 200,
      issue: { number: 1, title: "Greet by name", size: "s", sizedBy: "heuristic-v0" },
    });
  });
});

describe("workflowStages", () => {
  it("reads model stages, their task kinds and the build stages' pools", () => {
    expect(workflowStages(DEFINITION)).toEqual({
      modelStages: 2,
      tasks: ["plan", "implement"],
      buildStages: [{ node: "build", pool: "pool-a" }],
    });
  });

  it("reads a build stage that names no pool as pool null", () => {
    const definition = document([node("build", "infra", {})]);

    expect(workflowStages(definition)?.buildStages).toEqual([{ node: "build", pool: null }]);
  });

  it("cannot read a document admission could not read", () => {
    expect(workflowStages({})).toBeUndefined();
    expect(workflowStages(document([{ id: "x" }]))).toBeUndefined();
    expect(workflowStages(document([node("build", "infra", { runner_pool: "" })]))).toBeUndefined();
  });
});
