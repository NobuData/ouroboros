/**
 * The live-loop readiness preflight (DK.1, [#1318](https://github.com/NobuData/ouroboros/issues/1318)):
 * every prerequisite a first live loop has, checked for one repository and one workflow, each
 * with a reason and — when it does not pass — a fix.
 *
 * **Pure.** Facts in, the ordered checks out — in the style of the capability report
 * (`loop.capabilities.ts`) and live-run admission (`admission/admission.ts`).
 * `readiness.service.ts` gathers the facts, read-only: nothing here or there invokes a model or
 * starts a job, so the route is safe to poll.
 *
 * ```
 * deployment → workspace → provider_connection → routes → stage_executors → runner
 *   → repository → push_credential → pull_request_credential → dry_run → workflow_published
 *   → concurrency
 * ```
 *
 * `ready` is true only when every check passes; an `unknown` blocks like a `fail`, with its own
 * reason. The estimate beside the checks is labelled as one and is never part of `ready`.
 *
 * `code` is the stable vocabulary ({@link READINESS_CODES}) a client keys copy on; `reason` is the
 * sentence with this workspace's names in it.
 */

import type {
  EstimateEffort,
  ProviderConnectionStatus,
  WorkspaceLifecycleState,
} from "../db/schema";
import { admitsNewWork } from "../lifecycle/lifecycle.states";
import { InfraConfigSchema, NodeShapeSchema, WorkflowRootSchema } from "../workflows/dsl.schema";
import { pinnedTaskKinds } from "../admission/admission.pin";

/** The checks, in the order they are listed. Stable: add, never rename. */
export const READINESS_CHECK_IDS = [
  "deployment",
  "workspace",
  "provider_connection",
  "routes",
  "stage_executors",
  "runner",
  "repository",
  "push_credential",
  "pull_request_credential",
  "dry_run",
  "workflow_published",
  "concurrency",
] as const;

/** One check's id. */
export type ReadinessCheckId = (typeof READINESS_CHECK_IDS)[number];

/** Every reason a check does not pass. Stable: add, never rename. */
export const READINESS_CODES = [
  // deployment: `OURO_LIVE_EXECUTION_ENABLED` is off.
  "deployment_disabled",
  // workspace: paused, or pending deletion (#489).
  "workspace_paused",
  "workspace_pending_delete",
  // provider_connection: no enabled connection cleared for invocation (DH.4).
  "no_invocable_connection",
  // provider_connection: such connections exist, and every one failed its last health test.
  "connection_unhealthy",
  // provider_connection: such connections exist, and none has been tested yet.
  "connection_untested",
  // routes / stage_executors / runner: the workflow cannot be read, so its stages are not known.
  "workflow_unreadable",
  // routes: a task kind has no route, or its route resolves to no kept hop.
  "route_unresolved",
  // routes: the route's first kept hop names a model with no price in the catalog.
  "route_unpriced",
  // stage_executors: the engine did not answer its status call.
  "engine_unavailable",
  // stage_executors: the engine answered, and has registered no stage executor (DH.1).
  "no_executor",
  // runner: a build stage names no runner pool.
  "build_pool_required",
  // runner: a build stage names a pool the workspace does not have, or has disabled.
  "pool_not_found",
  "pool_disabled",
  // runner: no runner of the pool is online.
  "no_runner",
  // runner: runners are online, and none can check out source (#991) under the pool's executor.
  "no_source_checkout",
  // repository: the repository is not enabled for the loop.
  "repository_disabled",
  // push_credential: the workspace has no GitHub token.
  "github_not_configured",
  // pull_request_credential: no issue is picked or named, so the source that opens the pull
  // request — the one that mirrors the issue — is not known.
  "no_issue_chosen",
  // pull_request_credential: no GitHub source mirrors the issue, or its source opens PRs in
  // another repository.
  "no_pr_source",
  "pr_source_other_repository",
  // push_credential / pull_request_credential: the token cannot see the repository.
  "repository_unreadable",
  // push_credential / pull_request_credential: GitHub says the account cannot push.
  "push_denied",
  // push_credential / pull_request_credential: GitHub's answer did not say, or could not be had.
  "permission_unconfirmed",
  // dry_run: the repository is not in dry-run (decision L7).
  "policy_not_dry_run",
  // workflow_published: no workflow by that name, or nothing of it is published.
  "workflow_not_found",
  "workflow_unpublished",
  // concurrency: the workspace already runs as many live runs as its ceiling allows.
  "concurrency_ceiling",
] as const;

/** One reason code. */
export type ReadinessCode = (typeof READINESS_CODES)[number];

/** How one check came out. */
export type ReadinessState = "pass" | "fail" | "unknown";

/** Where a person goes to clear a check. */
export interface ReadinessFix {
  /** The link's words. */
  readonly label: string;
  /** A product path (`/build-farm`) or an absolute documentation URL. */
  readonly href: string;
}

/** One check. */
export interface ReadinessCheck {
  readonly id: ReadinessCheckId;
  readonly state: ReadinessState;
  /** Why not, or `null` when it passes. */
  readonly code: ReadinessCode | null;
  /** A sentence: what passed, or what is missing. */
  readonly reason: string;
  /** Where to clear it, or `null` when it passes. */
  readonly fix: ReadinessFix | null;
}

/** The estimate beside the checks — labelled as one, never part of `ready`. */
export interface ReadinessEstimate {
  /** Always true: nothing in this object is a promise. */
  readonly isEstimate: true;
  /** The per-run cost cap the loop's model route enforces, or `null` when it sets none. */
  readonly costCapCentsPerRun: number | null;
  /** The issue the loop would work on, or `null` when none is picked or named. */
  readonly issue: {
    readonly number: number;
    readonly title: string;
    /** The latest stored estimate's size, or `null` while the issue is unsized. */
    readonly size: EstimateEffort | null;
    /** What produced that size (`heuristic-v0`), or `null` while unsized. */
    readonly sizedBy: string | null;
  } | null;
}

/** `GET /api/v1/loop/readiness`. */
export interface LoopReadinessResource {
  /** `owner/name`, as the repository is known here. */
  readonly repository: string;
  /** The workflow's slug and the version in force, or `null` when none is. */
  readonly workflow: { readonly slug: string; readonly version: number | null };
  /** True only when every check passes. */
  readonly ready: boolean;
  /** The checks, in {@link READINESS_CHECK_IDS} order. */
  readonly checks: readonly ReadinessCheck[];
  readonly estimate: ReadinessEstimate;
}

/** Where the documentation lives — the UI's `DOCS_URL`. */
export const DOCS_URL = "https://docs.ouroboros.build/";

/** The fix links. Product paths are the UI's own (`ouroboros-ui/app/paths.ts`). */
export const READINESS_FIXES = {
  liveExecution: {
    label: "Live execution · enable it",
    href: `${DOCS_URL}administration/live-execution`,
  },
  stageExecutors: {
    label: "Live execution · stage executors",
    href: `${DOCS_URL}administration/live-execution#stage-executors`,
  },
  limits: {
    label: "Live execution · the concurrency ceiling",
    href: `${DOCS_URL}administration/live-execution#limits`,
  },
  workspace: { label: "Settings · resume the workspace", href: "/settings" },
  providers: { label: "Providers · connect or test a provider", href: "/models/providers" },
  routes: { label: "Models · fix the route", href: "/models" },
  buildFarm: { label: "Build Farm · enrol a runner", href: "/build-farm" },
  repositories: { label: "Repositories · enable it", href: "/settings/repositories" },
  sources: { label: "Sources · check the token", href: "/settings/sources" },
  policies: { label: "Policies · turn dry-run on", href: "/settings#policies" },
  workflows: { label: "Workflows · publish it", href: "/workflows" },
} as const satisfies Record<string, ReadinessFix>;

/**
 * A workflow's page, or one node on its canvas.
 *
 * @param slug - The workflow.
 * @param node - A node id to select, when there is one.
 * @returns The product path.
 */
export function workflowHref(slug: string, node?: string): string {
  const path = `/workflows/${encodeURIComponent(slug)}`;

  return node === undefined ? path : `${path}?node=${encodeURIComponent(node)}`;
}

/** A build stage, as the runner check reads it. */
export interface BuildStage {
  /** The node id. */
  readonly node: string;
  /** The runner pool it names, or `null` when it names none. */
  readonly pool: string | null;
}

/** What the readiness checks need of a workflow definition. */
export interface WorkflowStages {
  /** How many model (`llm`) stages it has. */
  readonly modelStages: number;
  /** The task kinds its model stages inherit routes from. */
  readonly tasks: readonly string[];
  /** Its build-farm (`infra`) stages. */
  readonly buildStages: readonly BuildStage[];
}

/**
 * Read the stages of a published definition.
 *
 * @param definition - `workflow_versions.definition`.
 * @returns The stages, or `undefined` when the document cannot be read — the same rule admission
 *   uses for a pin ({@link pinnedTaskKinds}).
 */
export function workflowStages(definition: unknown): WorkflowStages | undefined {
  const tasks = pinnedTaskKinds(definition);
  const root = WorkflowRootSchema.safeParse(definition);

  if (tasks === undefined || !root.success) {
    return undefined;
  }

  let modelStages = 0;
  const buildStages: BuildStage[] = [];

  for (const candidate of root.data.nodes) {
    const node = NodeShapeSchema.parse(candidate);

    if (node.type === "llm") {
      modelStages += 1;
    } else if (node.type === "infra") {
      const config = InfraConfigSchema.safeParse(node.config ?? {});

      if (!config.success) {
        return undefined;
      }
      buildStages.push({ node: node.id, pool: config.data.runner_pool ?? null });
    }
  }

  return { modelStages, tasks, buildStages };
}

/** One invocable connection, as the provider check reads it. */
export interface ConnectionFact {
  readonly kind: string;
  readonly displayName: string;
  /** Its last health test's outcome — `unknown` until it has been tested. */
  readonly status: ProviderConnectionStatus;
}

/** One task kind's route, as the routes check reads it. */
export interface RouteFact {
  readonly task: string;
  /** Whether it resolves to at least one kept hop. */
  readonly resolves: boolean;
  /** The first kept hop's alias, when it resolves. */
  readonly alias: string | null;
  /** Whether that hop's model has a price in the catalog. */
  readonly priced: boolean;
}

/** One build stage's pool, as the runner check reads it. */
export interface PoolFact {
  readonly name: string;
  /** Whether the workspace has a pool by that name. */
  readonly exists: boolean;
  readonly enabled: boolean;
  /** Active runners of the pool (or in one of its windows now) that are online. */
  readonly online: number;
  /** Of those, how many can check out source under the pool's executor. */
  readonly eligible: number;
}

/** What GitHub said about one token and the repository. */
export type CredentialFact =
  /** The token could push: the PR or the branch will be accepted. */
  | { readonly outcome: "can_push" }
  /** There is nothing to probe with. */
  | { readonly outcome: "not_configured" | "no_pr_source" }
  /** No issue is picked or named, so there is no source to ask. */
  | { readonly outcome: "no_issue" }
  /** The source's PRs open in another repository. */
  | { readonly outcome: "other_repository"; readonly target: string }
  /** The token cannot see the repository. */
  | { readonly outcome: "unreadable" }
  /** The account can read and cannot push. */
  | { readonly outcome: "push_denied" }
  /** GitHub's answer did not say, or the call failed for a reason that says nothing. */
  | { readonly outcome: "unconfirmed"; readonly why: string };

/** What the checks are computed from. Gathered by `ReadinessService`. */
export interface ReadinessFacts {
  readonly repository: { readonly slug: string; readonly enabled: boolean };
  /** The workflow: `undefined` when the workspace has none by that slug. */
  readonly workflow:
    | {
        readonly slug: string;
        /** The version in force, or `null` when nothing is published. */
        readonly version: number | null;
        /** Its stages, or `undefined` when unpublished or unreadable. */
        readonly stages: WorkflowStages | undefined;
      }
    | undefined;
  /** The workflow slug the caller asked for. */
  readonly workflowSlug: string;
  readonly deploymentEnabled: boolean;
  readonly workspaceState: WorkspaceLifecycleState;
  /** The workspace's enabled, unpaused connections cleared for invocation. */
  readonly connections: readonly ConnectionFact[];
  /** One per task kind of the workflow; empty when it has none or cannot be read. */
  readonly routes: readonly RouteFact[];
  readonly engine: { readonly reachable: boolean; readonly executors: readonly string[] };
  /** One per distinct pool the build stages name. */
  readonly pools: readonly PoolFact[];
  readonly push: CredentialFact;
  readonly pullRequest: CredentialFact;
  /** Whether the repository is in dry-run now. */
  readonly dryRun: boolean;
  /** Live slots taken and the effective ceiling (`admission.ts`). */
  readonly slots: { readonly taken: number; readonly ceiling: number };
  readonly estimate: Omit<ReadinessEstimate, "isEstimate">;
}

/** A check that passed. */
function pass(id: ReadinessCheckId, reason: string): ReadinessCheck {
  return { id, state: "pass", code: null, reason, fix: null };
}

/** A check that failed, or could not be confirmed. */
function block(
  id: ReadinessCheckId,
  state: "fail" | "unknown",
  code: ReadinessCode,
  reason: string,
  fix: ReadinessFix,
): ReadinessCheck {
  return { id, state, code, reason, fix };
}

/** A list in words: `plan, implement`. */
function listed(items: readonly string[]): string {
  return items.join(", ");
}

/** `deployment`. */
function deploymentCheck(facts: ReadinessFacts): ReadinessCheck {
  return facts.deploymentEnabled
    ? pass("deployment", "Live execution is enabled for this deployment.")
    : block(
        "deployment",
        "fail",
        "deployment_disabled",
        "Live execution is turned off for this deployment.",
        READINESS_FIXES.liveExecution,
      );
}

/** `workspace`. */
function workspaceCheck(facts: ReadinessFacts): ReadinessCheck {
  if (admitsNewWork(facts.workspaceState)) {
    return pass("workspace", "The workspace is active.");
  }

  return facts.workspaceState === "paused"
    ? block(
        "workspace",
        "fail",
        "workspace_paused",
        "The workspace is paused, so no new work starts.",
        READINESS_FIXES.workspace,
      )
    : block(
        "workspace",
        "fail",
        "workspace_pending_delete",
        "The workspace is pending deletion, so no new work starts.",
        READINESS_FIXES.workspace,
      );
}

/** `provider_connection` — passes on one connection whose last health test passed. */
function providerCheck(facts: ReadinessFacts): ReadinessCheck {
  const healthy = facts.connections.find((connection) => connection.status === "active");

  if (healthy !== undefined) {
    return pass(
      "provider_connection",
      `A provider connection can run a loop: ${healthy.displayName} (${healthy.kind}).`,
    );
  }

  if (facts.connections.length === 0) {
    return block(
      "provider_connection",
      "fail",
      "no_invocable_connection",
      "No enabled provider connection can serve a loop's model calls.",
      READINESS_FIXES.providers,
    );
  }

  return facts.connections.some((connection) => connection.status === "unknown")
    ? block(
        "provider_connection",
        "unknown",
        "connection_untested",
        "No provider connection that can run a loop has passed a test yet.",
        READINESS_FIXES.providers,
      )
    : block(
        "provider_connection",
        "fail",
        "connection_unhealthy",
        "Every provider connection that can run a loop failed its last test.",
        READINESS_FIXES.providers,
      );
}

/** The shared answer of a check that needs the workflow's stages and cannot read them. */
function unreadable(id: ReadinessCheckId, facts: ReadinessFacts): ReadinessCheck {
  return block(
    id,
    "unknown",
    "workflow_unreadable",
    `The stages of ${facts.workflowSlug} are not known until a readable version is published.`,
    { ...READINESS_FIXES.workflows, href: workflowHref(facts.workflowSlug) },
  );
}

/** `routes` — every task kind resolves, and its first kept hop is priced. */
function routesCheck(facts: ReadinessFacts): ReadinessCheck {
  const stages = facts.workflow?.stages;

  if (stages === undefined) {
    return unreadable("routes", facts);
  }

  const unresolved = facts.routes.filter((route) => !route.resolves);
  if (unresolved.length > 0) {
    return block(
      "routes",
      "fail",
      "route_unresolved",
      `No route resolves to a runnable model for: ${listed(unresolved.map((route) => route.task))}.`,
      READINESS_FIXES.routes,
    );
  }

  const unpriced = facts.routes.filter((route) => !route.priced);
  if (unpriced.length > 0) {
    return block(
      "routes",
      "fail",
      "route_unpriced",
      `The model a route resolves to has no price, so its spend cannot be capped: ${listed(
        unpriced.map((route) => `${route.task} → ${route.alias ?? "?"}`),
      )}.`,
      READINESS_FIXES.routes,
    );
  }

  return pass(
    "routes",
    stages.tasks.length === 0
      ? "The workflow inherits no route."
      : `Routes resolve: ${listed(stages.tasks)}.`,
  );
}

/** `stage_executors` — a model stage needs a registered executor; build stages go to the farm. */
function executorsCheck(facts: ReadinessFacts): ReadinessCheck {
  const stages = facts.workflow?.stages;

  if (stages === undefined) {
    return unreadable("stage_executors", facts);
  }

  if (stages.modelStages === 0) {
    return pass("stage_executors", "The workflow has no model stage to execute.");
  }

  if (!facts.engine.reachable) {
    return block(
      "stage_executors",
      "fail",
      "engine_unavailable",
      "The engine did not answer, so no stage executor is known.",
      READINESS_FIXES.stageExecutors,
    );
  }

  return facts.engine.executors.length === 0
    ? block(
        "stage_executors",
        "fail",
        "no_executor",
        "The engine has registered no stage executor for model stages.",
        READINESS_FIXES.stageExecutors,
      )
    : pass(
        "stage_executors",
        `A stage executor is registered for model stages: ${listed(facts.engine.executors)}.`,
      );
}

/** `runner` — every build stage's pool has an online runner that can check out source. */
function runnerCheck(facts: ReadinessFacts): ReadinessCheck {
  const stages = facts.workflow?.stages;

  if (stages === undefined) {
    return unreadable("runner", facts);
  }

  if (stages.buildStages.length === 0) {
    return pass("runner", "The workflow has no build stage.");
  }

  const unnamed = stages.buildStages.find((stage) => stage.pool === null);
  if (unnamed !== undefined) {
    return block(
      "runner",
      "fail",
      "build_pool_required",
      `The build stage ${unnamed.node} names no runner pool.`,
      {
        label: "Workflow · set the stage's runner pool",
        href: workflowHref(facts.workflowSlug, unnamed.node),
      },
    );
  }

  for (const pool of facts.pools) {
    const blocked = poolBlock(pool);

    if (blocked !== null) {
      return blocked;
    }
  }

  return pass("runner", `A runner is online in ${listed(facts.pools.map((pool) => pool.name))}.`);
}

/**
 * Why one pool cannot take the build, or `null` when it can.
 *
 * @param pool - The pool's facts.
 * @returns The failing check, or `null`.
 */
function poolBlock(pool: PoolFact): ReadinessCheck | null {
  const fix = READINESS_FIXES.buildFarm;

  if (!pool.exists) {
    return block("runner", "fail", "pool_not_found", `No runner pool is named ${pool.name}.`, fix);
  }
  if (!pool.enabled) {
    return block(
      "runner",
      "fail",
      "pool_disabled",
      `The runner pool ${pool.name} is disabled.`,
      fix,
    );
  }
  if (pool.online === 0) {
    return block("runner", "fail", "no_runner", `No runner is online in ${pool.name}.`, fix);
  }

  return pool.eligible === 0
    ? block(
        "runner",
        "fail",
        "no_source_checkout",
        `No online runner in ${pool.name} can check out the repository (git).`,
        fix,
      )
    : null;
}

/** `repository`. */
function repositoryCheck(facts: ReadinessFacts): ReadinessCheck {
  return facts.repository.enabled
    ? pass("repository", `${facts.repository.slug} is enabled for the loop.`)
    : block(
        "repository",
        "fail",
        "repository_disabled",
        `${facts.repository.slug} is not enabled for the loop.`,
        READINESS_FIXES.repositories,
      );
}

/**
 * A credential check from what GitHub said.
 *
 * @param id - `push_credential` or `pull_request_credential`.
 * @param fact - The probe's outcome.
 * @param what - What the token must do, in words: `push a branch`, `open a pull request`.
 * @param repository - `owner/name`.
 * @returns The check.
 */
function credentialCheck(
  id: "push_credential" | "pull_request_credential",
  fact: CredentialFact,
  what: string,
  repository: string,
): ReadinessCheck {
  const fix = READINESS_FIXES.sources;

  switch (fact.outcome) {
    case "can_push":
      return pass(id, `The token can ${what} in ${repository}.`);
    case "not_configured":
      return block(id, "fail", "github_not_configured", "The workspace has no GitHub token.", fix);
    case "no_issue":
      return block(
        id,
        "unknown",
        "no_issue_chosen",
        `No first issue of ${repository} is picked, so the source that would ${what} is not known.`,
        {
          label: "Get started · pick a first issue",
          href: `/get-started?repo=${encodeURIComponent(repository)}`,
        },
      );
    case "no_pr_source":
      return block(
        id,
        "fail",
        "no_pr_source",
        `No GitHub source mirrors this issue of ${repository}, so nothing can ${what}.`,
        fix,
      );
    case "other_repository":
      return block(
        id,
        "fail",
        "pr_source_other_repository",
        `The issue's source opens pull requests in ${fact.target}, not ${repository}.`,
        fix,
      );
    case "unreadable":
      return block(
        id,
        "fail",
        "repository_unreadable",
        `The token cannot read ${repository}.`,
        fix,
      );
    case "push_denied":
      return block(id, "fail", "push_denied", `The token cannot ${what} in ${repository}.`, fix);
    case "unconfirmed":
      return block(
        id,
        "unknown",
        "permission_unconfirmed",
        `Whether the token can ${what} could not be confirmed: ${fact.why}.`,
        fix,
      );
  }
}

/** `dry_run`. */
function dryRunCheck(facts: ReadinessFacts): ReadinessCheck {
  return facts.dryRun
    ? pass("dry_run", "Dry-run policy is on: pull requests open as drafts and nothing merges.")
    : block(
        "dry_run",
        "fail",
        "policy_not_dry_run",
        `${facts.repository.slug} is not in dry-run; a live loop opens draft pull requests only.`,
        READINESS_FIXES.policies,
      );
}

/** `workflow_published`. */
function workflowCheck(facts: ReadinessFacts): ReadinessCheck {
  const { workflow, workflowSlug } = facts;
  const fix = { ...READINESS_FIXES.workflows, href: workflowHref(workflowSlug) };

  if (workflow === undefined) {
    return block(
      "workflow_published",
      "fail",
      "workflow_not_found",
      `The workspace has no workflow named ${workflowSlug}.`,
      { ...READINESS_FIXES.workflows, href: "/workflows" },
    );
  }

  if (workflow.version === null || workflow.stages === undefined) {
    return block(
      "workflow_published",
      "fail",
      "workflow_unpublished",
      workflow.version === null
        ? `${workflowSlug} has no published version.`
        : `${workflowSlug}@v${workflow.version} cannot be read.`,
      fix,
    );
  }

  return pass("workflow_published", `${workflowSlug}@v${workflow.version} is published.`);
}

/** `concurrency`. */
function concurrencyCheck(facts: ReadinessFacts): ReadinessCheck {
  const { taken, ceiling } = facts.slots;

  return taken < ceiling
    ? pass("concurrency", `A live-run slot is free (${taken} of ${ceiling} in use).`)
    : block(
        "concurrency",
        "fail",
        "concurrency_ceiling",
        `All ${ceiling} live-run slots are in use.`,
        READINESS_FIXES.limits,
      );
}

/**
 * Compute the preflight.
 *
 * @param facts - What the deployment, the engine, the workspace and GitHub say.
 * @returns The ordered checks, `ready`, and the estimate.
 */
export function loopReadiness(facts: ReadinessFacts): LoopReadinessResource {
  const repository = facts.repository.slug;
  const checks = [
    deploymentCheck(facts),
    workspaceCheck(facts),
    providerCheck(facts),
    routesCheck(facts),
    executorsCheck(facts),
    runnerCheck(facts),
    repositoryCheck(facts),
    credentialCheck("push_credential", facts.push, "push a branch", repository),
    credentialCheck(
      "pull_request_credential",
      facts.pullRequest,
      "open a pull request",
      repository,
    ),
    dryRunCheck(facts),
    workflowCheck(facts),
    concurrencyCheck(facts),
  ];

  return {
    repository,
    workflow: { slug: facts.workflowSlug, version: facts.workflow?.version ?? null },
    ready: checks.every((check) => check.state === "pass"),
    checks,
    estimate: { isEstimate: true, ...facts.estimate },
  };
}
