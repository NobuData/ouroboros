import type { AdmissionService } from "../admission/admission.service";
import type { WorkspaceAdmissionFacts } from "../admission/admission";
import type { DatabaseService } from "../db/db.service";
import type { EngineClient } from "../engine/engine.client";
import { engineUnavailable } from "../engine/engine.errors";
import { NotFoundError } from "../errors/error.envelope";
import type { GithubClientFactory } from "../github/github.client.factory";
import type { GithubCredentialsService } from "../github/github.credentials.service";
import { GithubApiError } from "../github/github.errors";
import type { DryRunPolicyReader } from "../policies/org-policy.service";
import type { PolicyLoopSource } from "../policies/repository-dry-run";
import type { Resolution } from "../routing/resolution";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import type { LoopRepository } from "./loop.repository";
import type { ReadinessCheckId, ReadinessState } from "./readiness";
import type { ReadinessRepository } from "./readiness.repository";
import { ReadinessService } from "./readiness.service";

const WORKSPACE = "org-a";
const REPOSITORY = {
  id: "repo-1",
  slug: "acme/helios",
  owner: "acme",
  name: "helios",
  enabled: true,
};
const NOW = new Date("2026-10-23T12:00:00Z");

/**
 * A model stage inheriting one route, as the DSL spells it.
 *
 * @param id - The node id and the task kind.
 * @returns The node.
 */
function llm(id: string) {
  return {
    id,
    type: "llm",
    title: id,
    position: { x: 0, y: 0 },
    config: {
      mode: "prompt",
      prompt_template: "Do the work.",
      routing: { inherit_task: id },
      limits: { max_retries: 1, token_budget: 200000 },
      permissions: { push_fixup: false, touch_ci: false },
    },
  };
}

/** live-slice@v1: plan → implement → build on pool-a. */
const DEFINITION = {
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: {} },
  nodes: [
    llm("plan"),
    llm("implement"),
    {
      id: "build",
      type: "infra",
      title: "build",
      position: { x: 0, y: 0 },
      config: { runner_pool: "pool-a" },
    },
  ],
  edges: [],
};

/**
 * A resolution to one kept hop.
 *
 * @param task - The task kind.
 * @param maxCostCents - The route's per-run cap.
 * @returns The resolution.
 */
function resolved(task: string, maxCostCents: number | null = 200): Resolution {
  return {
    taskKind: task,
    outcome: "resolved",
    maxCostCents,
    chain: [
      {
        alias: "coder-std",
        modelId: "claude-sonnet-5-5",
        provider: { kind: "anthropic" },
        decision: "kept",
      },
    ],
  } as unknown as Resolution;
}

/** The GitHub source that mirrors the issue. */
const SOURCE: SyncSource = {
  sourceId: "source-1",
  organizationId: WORKSPACE,
  kind: "github",
  displayName: "acme GitHub",
  config: {},
  cursor: null,
  syncedAt: null,
};

/** What every stub answers unless a case says otherwise: a ready workspace. */
function rig() {
  const readiness = {
    repository: jest.fn().mockResolvedValue(REPOSITORY),
    workflow: jest
      .fn()
      .mockResolvedValue({ slug: "live-slice", version: 1, definition: DEFINITION }),
    pools: jest
      .fn()
      .mockResolvedValue([{ name: "pool-a", exists: true, enabled: true, online: 1, eligible: 1 }]),
    pickedIssueNumber: jest.fn().mockResolvedValue(1),
    issue: jest
      .fn()
      .mockImplementation((_org: string, _repo: string, number: number) =>
        Promise.resolve({ number, title: "Greet by name", size: "s", sizedBy: "heuristic-v0" }),
      ),
    prSource: jest.fn().mockResolvedValue(SOURCE),
  };
  const loop = {
    invocableConnections: jest
      .fn()
      .mockResolvedValue([{ kind: "anthropic", displayName: "Anthropic", status: "active" }]),
  };
  const workspace: WorkspaceAdmissionFacts = {
    deploymentEnabled: true,
    state: "active",
    executors: 1,
    liveSlotsTaken: 0,
    ceiling: 1,
  };
  const admission = { workspaceFacts: jest.fn().mockResolvedValue(workspace) };
  // Every engine member a model call or a job would go through, so the suite can say none ran.
  const engine = {
    status: jest.fn().mockResolvedValue({ executors: ["harness"] }),
    estimate: jest.fn(),
    echo: jest.fn(),
    copilot: jest.fn(),
    dryRun: jest.fn(),
  };
  const routing = {
    resolve: jest.fn((_org: string, task: string) => Promise.resolve(resolved(task))),
  };
  const pricing = { resolve: jest.fn().mockResolvedValue({ mode: "token" }) };
  // The org-wide switch on: dry-run holds without the per-repository rule.
  const policy: jest.Mocked<DryRunPolicyReader> = {
    dryRun: jest.fn().mockResolvedValue(true),
    dryRunNow: jest.fn().mockResolvedValue(true),
  };
  // Off, the rule decides: `dry_run_new_repos` inactive for this repository.
  const resolver = {
    snapshot: jest.fn().mockResolvedValue({
      resolve: () => ({ value: { active: false }, version: null }),
    }),
    nextLoop: jest.fn().mockResolvedValue(1),
  } as unknown as PolicyLoopSource;
  const credentials = { isConfigured: jest.fn().mockResolvedValue(true) };
  const client = {
    request: jest.fn().mockResolvedValue({ data: { permissions: { push: true } } }),
  };
  const github = { forOrganization: jest.fn().mockResolvedValue(client) };
  const provider = {
    capabilities: () => ({ pr: { pullRequests: true } }),
    createPR: jest.fn(),
    repositoryAccess: jest.fn().mockResolvedValue({ repository: "acme/helios", push: true }),
  };
  const registry = { find: jest.fn().mockReturnValue(provider) };
  const sources = {
    withCredentials: jest.fn((source: SyncSource, run: (context: unknown) => unknown) =>
      run({ sourceId: source.sourceId }),
    ),
  };
  const database = { db: { marker: "pool" } };

  const service = new ReadinessService(
    database as unknown as DatabaseService,
    readiness as unknown as ReadinessRepository,
    loop as unknown as LoopRepository,
    admission as unknown as AdmissionService,
    engine as unknown as EngineClient,
    routing,
    pricing,
    policy,
    resolver,
    credentials as unknown as GithubCredentialsService,
    github as unknown as GithubClientFactory,
    registry as unknown as TicketSourceRegistry,
    sources as unknown as TicketSourcesService,
  );

  return {
    service,
    readiness,
    loop,
    admission,
    engine,
    routing,
    pricing,
    policy,
    credentials,
    client,
    github,
    provider,
    registry,
    sources,
    database,
  };
}

/** The preflight's default request. */
const REQUEST = { repository: "acme/helios", workflow: "live-slice" };

/**
 * One check's state and code.
 *
 * @param service - The service.
 * @param id - The check.
 * @param request - The request, when not the default.
 * @returns `[state, code]`.
 */
async function check(
  service: ReadinessService,
  id: ReadinessCheckId,
  request: Parameters<ReadinessService["read"]>[1] = REQUEST,
): Promise<[ReadinessState | undefined, string | null | undefined]> {
  const readiness = await service.read(WORKSPACE, request, NOW);
  const found = readiness.checks.find((candidate) => candidate.id === id);

  return [found?.state, found?.code];
}

describe("ReadinessService (DK.1, #1318)", () => {
  it("is ready when every source agrees, and carries the estimate", async () => {
    const { service } = rig();

    const readiness = await service.read(WORKSPACE, REQUEST, NOW);

    expect(readiness.checks.filter((c) => c.state !== "pass")).toEqual([]);
    expect(readiness.ready).toBe(true);
    expect(readiness.estimate).toEqual({
      isEstimate: true,
      costCapCentsPerRun: 200,
      issue: { number: 1, title: "Greet by name", size: "s", sizedBy: "heuristic-v0" },
    });
  });

  it("invokes no model, dispatches no job and writes nothing — it only reads", async () => {
    const stubs = rig();

    await stubs.service.read(WORKSPACE, REQUEST, NOW);

    // The engine is asked its status, never a task.
    expect(stubs.engine.status).toHaveBeenCalledTimes(1);
    expect(stubs.engine.estimate).not.toHaveBeenCalled();
    expect(stubs.engine.echo).not.toHaveBeenCalled();
    expect(stubs.engine.copilot).not.toHaveBeenCalled();
    expect(stubs.engine.dryRun).not.toHaveBeenCalled();
    // The only GitHub calls are the two permission lookups — a GET each.
    expect(stubs.client.request.mock.calls).toEqual([
      ["GET /repos/{owner}/{repo}", { owner: "acme", repo: "helios" }],
    ]);
    expect(stubs.provider.repositoryAccess).toHaveBeenCalledTimes(1);
    expect(stubs.provider.createPR).not.toHaveBeenCalled();
    // Admission's numbers are read through the pool, never a transaction that claims.
    expect(stubs.admission.workspaceFacts).toHaveBeenCalledWith(
      stubs.database.db,
      WORKSPACE,
      NOW,
      1,
    );
  });

  it("reads every fact for the session's workspace only", async () => {
    const stubs = rig();

    await stubs.service.read(WORKSPACE, { ...REQUEST, issue: 7 }, NOW);

    for (const mock of [
      stubs.readiness.repository,
      stubs.readiness.workflow,
      stubs.readiness.pools,
      stubs.readiness.issue,
      stubs.readiness.prSource,
      stubs.loop.invocableConnections,
      stubs.routing.resolve,
      stubs.credentials.isConfigured,
      stubs.github.forOrganization,
      stubs.policy.dryRunNow,
    ]) {
      expect(mock.mock.calls.length).toBeGreaterThan(0);
      for (const call of mock.mock.calls as unknown[][]) {
        expect(call[0]).toBe(WORKSPACE);
      }
    }
    expect(stubs.pricing.resolve).toHaveBeenCalledWith("anthropic", "claude-sonnet-5-5", WORKSPACE);
  });

  it("answers 404 for a repository the workspace does not have", async () => {
    const { service, readiness } = rig();
    readiness.repository.mockResolvedValue(undefined);

    await expect(service.read(WORKSPACE, REQUEST, NOW)).rejects.toMatchObject({
      code: "repository_not_found",
    });
  });

  describe("the issue", () => {
    it("is the wizard's pick when none is named", async () => {
      const { service, readiness } = rig();

      await service.read(WORKSPACE, REQUEST, NOW);

      expect(readiness.pickedIssueNumber).toHaveBeenCalledWith(WORKSPACE, "acme/helios");
      expect(readiness.prSource).toHaveBeenCalledWith(WORKSPACE, REPOSITORY, 1);
    });

    it("is the named one when the caller names it", async () => {
      const { service, readiness } = rig();

      const readinessAnswer = await service.read(WORKSPACE, { ...REQUEST, issue: 42 }, NOW);

      expect(readiness.pickedIssueNumber).not.toHaveBeenCalled();
      expect(readinessAnswer.estimate.issue?.number).toBe(42);
    });

    it("answers 404 for a named issue the backlog does not mirror", async () => {
      const { service, readiness } = rig();
      readiness.issue.mockResolvedValue(undefined);

      await expect(service.read(WORKSPACE, { ...REQUEST, issue: 9 }, NOW)).rejects.toMatchObject({
        code: "issue_not_found",
      });
    });

    it("leaves the pull-request check unknown, and the estimate without an issue, when none is picked", async () => {
      const { service, readiness } = rig();
      readiness.pickedIssueNumber.mockResolvedValue(undefined);

      const answer = await service.read(WORKSPACE, REQUEST, NOW);

      expect(answer.estimate.issue).toBeNull();
      expect(answer.checks.find((c) => c.id === "pull_request_credential")).toMatchObject({
        state: "unknown",
        code: "no_issue_chosen",
      });
      expect(readiness.prSource).not.toHaveBeenCalled();
    });
  });

  describe("the routes", () => {
    it("fails a task kind with no route", async () => {
      const { service, routing } = rig();
      routing.resolve.mockImplementation((_org: string, task: string) =>
        task === "implement"
          ? Promise.reject(new NotFoundError("route_not_found", "no route"))
          : Promise.resolve(resolved(task)),
      );

      await expect(check(service, "routes")).resolves.toEqual(["fail", "route_unresolved"]);
    });

    it("fails a route that resolves to a fail_run outcome", async () => {
      const { service, routing } = rig();
      routing.resolve.mockResolvedValue({
        outcome: "fail_run",
        chain: [],
        maxCostCents: null,
      } as unknown as Resolution);

      await expect(check(service, "routes")).resolves.toEqual(["fail", "route_unresolved"]);
    });

    it("fails a kept hop whose model has no price", async () => {
      const { service, pricing } = rig();
      pricing.resolve.mockResolvedValue(undefined);

      await expect(check(service, "routes")).resolves.toEqual(["fail", "route_unpriced"]);
    });

    it("asks each route once, though the cap reads it too", async () => {
      const { service, routing } = rig();

      await service.read(WORKSPACE, REQUEST, NOW);

      expect(routing.resolve.mock.calls.map((call) => call[1])).toEqual(["plan", "implement"]);
    });
  });

  describe("the estimate's cost cap", () => {
    it("is the first model stage's route cap", async () => {
      const { service, routing } = rig();
      routing.resolve.mockImplementation((_org: string, task: string) =>
        Promise.resolve(resolved(task, task === "plan" ? 150 : 900)),
      );

      const answer = await service.read(WORKSPACE, REQUEST, NOW);

      expect(answer.estimate.costCapCentsPerRun).toBe(150);
    });

    it("is null when the route sets none", async () => {
      const { service, routing } = rig();
      routing.resolve.mockImplementation((_org: string, task: string) =>
        Promise.resolve(resolved(task, null)),
      );

      const answer = await service.read(WORKSPACE, REQUEST, NOW);

      expect(answer.estimate.costCapCentsPerRun).toBeNull();
    });
  });

  it("fails the executor check when the engine does not answer", async () => {
    const { service, engine } = rig();
    engine.status.mockRejectedValue(engineUnavailable());

    await expect(check(service, "stage_executors")).resolves.toEqual([
      "fail",
      "engine_unavailable",
    ]);
  });

  it("asks the pools the build stages name, at the instant given", async () => {
    const { service, readiness } = rig();

    await service.read(WORKSPACE, REQUEST, NOW);

    expect(readiness.pools).toHaveBeenCalledWith(WORKSPACE, ["pool-a"], NOW);
  });

  describe("the push credential — the workspace token", () => {
    it("fails when the workspace has none, without calling GitHub", async () => {
      const { service, credentials, github } = rig();
      credentials.isConfigured.mockResolvedValue(false);

      await expect(check(service, "push_credential")).resolves.toEqual([
        "fail",
        "github_not_configured",
      ]);
      expect(github.forOrganization).not.toHaveBeenCalled();
    });

    it("fails when GitHub says the account cannot push", async () => {
      const { service, client } = rig();
      client.request.mockResolvedValue({ data: { permissions: { pull: true, push: false } } });

      await expect(check(service, "push_credential")).resolves.toEqual(["fail", "push_denied"]);
    });

    it.each(["not_found", "unauthorized"] as const)(
      "fails as unreadable when GitHub answers %s",
      async (failure) => {
        const { service, client } = rig();
        client.request.mockRejectedValue(new GithubApiError(failure, "refused"));

        await expect(check(service, "push_credential")).resolves.toEqual([
          "fail",
          "repository_unreadable",
        ]);
      },
    );

    it("is unknown when the answer carries no permission document", async () => {
      const { service, client } = rig();
      client.request.mockResolvedValue({ data: { full_name: "acme/helios" } });

      await expect(check(service, "push_credential")).resolves.toEqual([
        "unknown",
        "permission_unconfirmed",
      ]);
    });

    it("is unknown when GitHub does not answer", async () => {
      const { service, client } = rig();
      client.request.mockRejectedValue(new GithubApiError("upstream_error", "502"));

      await expect(check(service, "push_credential")).resolves.toEqual([
        "unknown",
        "permission_unconfirmed",
      ]);
    });
  });

  describe("the pull-request credential — the issue's source", () => {
    it("fails when no GitHub source mirrors the issue", async () => {
      const { service, readiness } = rig();
      readiness.prSource.mockResolvedValue(undefined);

      await expect(check(service, "pull_request_credential")).resolves.toEqual([
        "fail",
        "no_pr_source",
      ]);
    });

    it("fails when the source's provider cannot be probed", async () => {
      const { service, registry } = rig();
      registry.find.mockReturnValue({ capabilities: () => ({ pr: { pullRequests: false } }) });

      await expect(check(service, "pull_request_credential")).resolves.toEqual([
        "fail",
        "no_pr_source",
      ]);
    });

    it("fails when the source opens pull requests in another repository", async () => {
      const { service, provider } = rig();
      provider.repositoryAccess.mockResolvedValue({ repository: "acme/docs", push: true });

      const answer = await service.read(WORKSPACE, REQUEST, NOW);

      expect(answer.checks.find((c) => c.id === "pull_request_credential")).toMatchObject({
        state: "fail",
        code: "pr_source_other_repository",
        reason: "The issue's source opens pull requests in acme/docs, not acme/helios.",
      });
    });

    it("compares the push target case-insensitively", async () => {
      const { service, provider } = rig();
      provider.repositoryAccess.mockResolvedValue({ repository: "ACME/Helios", push: true });

      await expect(check(service, "pull_request_credential")).resolves.toEqual(["pass", null]);
    });

    it("fails as unreadable on the source's auth refusal", async () => {
      const { service, provider } = rig();
      provider.repositoryAccess.mockRejectedValue(new TicketSourceError("auth", "refused"));

      await expect(check(service, "pull_request_credential")).resolves.toEqual([
        "fail",
        "repository_unreadable",
      ]);
    });

    it("is unknown when the host is silent on the permission", async () => {
      const { service, provider } = rig();
      provider.repositoryAccess.mockResolvedValue({ repository: "acme/helios", push: null });

      await expect(check(service, "pull_request_credential")).resolves.toEqual([
        "unknown",
        "permission_unconfirmed",
      ]);
    });

    it("is unknown when the host fails for another reason", async () => {
      const { service, provider } = rig();
      provider.repositoryAccess.mockRejectedValue(new TicketSourceError("upstream", "502"));

      await expect(check(service, "pull_request_credential")).resolves.toEqual([
        "unknown",
        "permission_unconfirmed",
      ]);
    });
  });

  it("judges dry-run for the repository", async () => {
    const { service, policy } = rig();
    policy.dryRunNow.mockResolvedValue(false);

    await expect(check(service, "dry_run")).resolves.toEqual(["fail", "policy_not_dry_run"]);
  });

  it("reports a missing workflow as a failing check, not an error", async () => {
    const { service, readiness } = rig();
    readiness.workflow.mockResolvedValue(undefined);

    const answer = await service.read(WORKSPACE, REQUEST, NOW);

    expect(answer.workflow).toEqual({ slug: "live-slice", version: null });
    expect(answer.checks.find((c) => c.id === "workflow_published")?.code).toBe(
      "workflow_not_found",
    );
  });
});
