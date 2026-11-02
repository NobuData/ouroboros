/**
 * Gathers the facts the live-loop readiness preflight is computed from (DK.1,
 * [#1318](https://github.com/NobuData/ouroboros/issues/1318)) and hands them to `readiness.ts`,
 * which decides.
 *
 * ```
 * deployment · workspace · slots      AdmissionService.workspaceFacts — the claim's own numbers
 * connections                         LoopRepository — kind, name, last health test (DH.4)
 * routes                              ResolutionService per task kind, PricingService per kept hop
 * executors                           the engine's GET /v0/status (unreachable is a fact, not an error)
 * pools                               ReadinessRepository — dispatch's eligibility, without room
 * push credential                     the workspace GitHub token: GET /repos/{owner}/{repo}
 * pull-request credential             the issue's GitHub source: repositoryAccess (same read)
 * dry-run                             repositoryDryRun — what the run would be judged by
 * estimate                            the route's per-run cap, the issue's latest stored size
 * ```
 *
 * **Read-only and safe to poll.** Nothing here invokes a model (pricing and routing read the
 * catalog; the engine is asked its status, never a task), dispatches a job, or writes a row. The
 * two GitHub calls are reads — a permission lookup, never a write. `readiness.service.spec.ts`
 * asserts both on the stubs.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AdmissionService, DEFAULT_MODEL_TASK_KIND } from "../admission/admission.service";
import { firstModelStage } from "../admission/admission.pin";
import { DatabaseService } from "../db/db.service";
import { EngineClient } from "../engine/engine.client";
import { NotFoundError } from "../errors/error.envelope";
import { GithubClientFactory } from "../github/github.client.factory";
import { GithubCredentialsService } from "../github/github.credentials.service";
import { GithubApiError } from "../github/github.errors";
import { pushPermission, REPOSITORY_ROUTE } from "../github/github.permissions";
import { OrgPolicyService, type DryRunPolicyReader } from "../policies/org-policy.service";
import { PolicyResolutionService } from "../policies/policy-resolution.service";
import { repositoryDryRun, type PolicyLoopSource } from "../policies/repository-dry-run";
import { PricingService } from "../pricing/pricing.service";
import type { Resolution } from "../routing/resolution";
import { ResolutionService } from "../routing/resolution.service";
import { supportsRepositoryAccess } from "../ticket-sources/ticket-source.access";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import { LoopRepository } from "./loop.repository";
import { INVOCABLE_KINDS } from "./loop.service";
import {
  loopReadiness,
  workflowStages,
  type CredentialFact,
  type LoopReadinessResource,
  type ReadinessFacts,
  type RouteFact,
  type WorkflowStages,
} from "./readiness";
import {
  ReadinessRepository,
  type ReadinessIssueRow,
  type ReadinessRepositoryRow,
} from "./readiness.repository";

/** What the preflight needs of the router. */
export type ReadinessRouter = Pick<ResolutionService, "resolve">;

/** What the preflight needs of the price catalog. */
export type ReadinessPricing = Pick<PricingService, "resolve">;

/** What one preflight asks about. */
export interface ReadinessRequest {
  /** `owner/name`. */
  readonly repository: string;
  /** The workflow's slug. */
  readonly workflow: string;
  /** The issue to size and to ask the pull-request source about; absent, the wizard's pick. */
  readonly issue?: number;
}

@Injectable()
export class ReadinessService {
  /**
   * @param database - The pool, handed to admission's workspace facts. Nothing here writes.
   * @param readiness - The preflight's own reads.
   * @param loop - The workspace's invocable connections.
   * @param admission - The workspace facts the claim decides by.
   * @param engine - The engine's registered executors.
   * @param routing - The router, per task kind.
   * @param pricing - The price catalog, per kept hop.
   * @param policy - The org-wide dry-run switch.
   * @param resolver - The per-repository dry-run rule.
   * @param credentials - Whether the workspace has a GitHub token.
   * @param github - A client over that token.
   * @param registry - The ticket-source providers by kind.
   * @param sources - Opens a source's credential for one call.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly readiness: ReadinessRepository,
    private readonly loop: LoopRepository,
    private readonly admission: AdmissionService,
    private readonly engine: EngineClient,
    @Inject(ResolutionService) private readonly routing: ReadinessRouter,
    @Inject(PricingService) private readonly pricing: ReadinessPricing,
    @Inject(OrgPolicyService) private readonly policy: DryRunPolicyReader,
    @Inject(PolicyResolutionService) private readonly resolver: PolicyLoopSource,
    private readonly credentials: GithubCredentialsService,
    private readonly github: GithubClientFactory,
    private readonly registry: TicketSourceRegistry,
    private readonly sources: TicketSourcesService,
  ) {}

  /**
   * The preflight for one repository and workflow.
   *
   * @param organizationId - The workspace, from the tenant context — never from the request.
   * @param request - The repository, the workflow and, optionally, the issue.
   * @param now - The instant pool windows and leases are judged against.
   * @returns The ordered checks, `ready`, and the estimate.
   * @throws {NotFoundError} `repository_not_found` — the workspace has no such repository;
   *   `issue_not_found` — the named issue is not in its synced backlog.
   */
  async read(
    organizationId: string,
    request: ReadinessRequest,
    now: Date = new Date(),
  ): Promise<LoopReadinessResource> {
    const [owner = "", name = ""] = request.repository.split("/");
    const repository = await this.readiness.repository(organizationId, owner, name);

    if (repository === undefined) {
      throw new NotFoundError(
        "repository_not_found",
        `The workspace has no repository ${request.repository}.`,
      );
    }

    const issue = await this.issue(organizationId, repository, request.issue);
    const workflowRow = await this.readiness.workflow(organizationId, request.workflow);
    const stages =
      workflowRow?.definition === undefined ? undefined : workflowStages(workflowRow.definition);

    const resolutions = new Map<string, Promise<Resolution | undefined>>();
    const [engine, connections, routes, pools, push, pullRequest, dryRun, costCap] =
      await Promise.all([
        this.engineFacts(),
        this.loop.invocableConnections(organizationId, INVOCABLE_KINDS),
        this.routes(organizationId, stages, resolutions),
        this.readiness.pools(organizationId, poolNames(stages), now),
        this.pushCredential(organizationId, repository),
        this.pullRequestCredential(organizationId, repository, issue?.number),
        repositoryDryRun(this.policy, this.resolver, organizationId, repository.id),
        this.costCap(organizationId, workflowRow?.definition, resolutions),
      ]);
    const workspace = await this.admission.workspaceFacts(
      this.database.db,
      organizationId,
      now,
      engine.executors.length,
    );

    const facts: ReadinessFacts = {
      repository: { slug: repository.slug, enabled: repository.enabled },
      workflowSlug: request.workflow,
      workflow:
        workflowRow === undefined
          ? undefined
          : { slug: workflowRow.slug, version: workflowRow.version, stages },
      deploymentEnabled: workspace.deploymentEnabled,
      workspaceState: workspace.state,
      connections,
      routes,
      engine,
      pools,
      push,
      pullRequest,
      dryRun,
      slots: { taken: workspace.liveSlotsTaken, ceiling: workspace.ceiling },
      estimate: { costCapCentsPerRun: costCap, issue: issue ?? null },
    };

    return loopReadiness(facts);
  }

  /**
   * The issue the preflight asks about: the one named, else the wizard's pick.
   *
   * @param organizationId - The workspace.
   * @param repository - The repository.
   * @param named - The issue number the caller named, if any.
   * @returns The issue, or `undefined` when none is named or picked (or the pick is not mirrored).
   * @throws {NotFoundError} `issue_not_found` for a named issue the backlog does not mirror.
   */
  private async issue(
    organizationId: string,
    repository: ReadinessRepositoryRow,
    named: number | undefined,
  ): Promise<ReadinessIssueRow | undefined> {
    const number =
      named ??
      (await this.readiness.pickedIssueNumber(organizationId, repository.slug.toLowerCase()));

    if (number === undefined) {
      return undefined;
    }

    const issue = await this.readiness.issue(organizationId, repository.id, number);

    if (issue === undefined && named !== undefined) {
      throw new NotFoundError(
        "issue_not_found",
        `${repository.slug}#${named} is not in the repository's synced backlog.`,
      );
    }

    return issue;
  }

  /**
   * What the engine says about its executors.
   *
   * @returns Reachable and its executor kinds, or unreachable with none when the call failed.
   */
  private async engineFacts(): Promise<ReadinessFacts["engine"]> {
    try {
      const status = await this.engine.status();

      return { reachable: true, executors: [...(status.executors ?? [])] };
    } catch {
      return { reachable: false, executors: [] };
    }
  }

  /**
   * One task kind's resolution, asked once per preflight.
   *
   * @param organizationId - The workspace.
   * @param task - The task kind.
   * @param resolutions - The answers so far.
   * @returns The resolution, or `undefined` when the task kind has no route.
   */
  private resolution(
    organizationId: string,
    task: string,
    resolutions: Map<string, Promise<Resolution | undefined>>,
  ): Promise<Resolution | undefined> {
    let pending = resolutions.get(task);

    if (pending === undefined) {
      pending = this.routing.resolve(organizationId, task).catch((error: unknown) => {
        if (error instanceof NotFoundError) {
          return undefined;
        }
        throw error;
      });
      resolutions.set(task, pending);
    }

    return pending;
  }

  /**
   * Each task kind's route: whether it resolves to a kept hop, and whether that hop is priced.
   *
   * @param organizationId - The workspace.
   * @param stages - The workflow's stages, or `undefined` when unknown.
   * @param resolutions - The shared resolution cache.
   * @returns One fact per task kind; none when the stages are unknown.
   */
  private async routes(
    organizationId: string,
    stages: WorkflowStages | undefined,
    resolutions: Map<string, Promise<Resolution | undefined>>,
  ): Promise<RouteFact[]> {
    return Promise.all(
      (stages?.tasks ?? []).map(async (task): Promise<RouteFact> => {
        const resolution = await this.resolution(organizationId, task, resolutions);
        const hop =
          resolution?.outcome === "resolved"
            ? resolution.chain.find((candidate) => candidate.decision === "kept")
            : undefined;

        if (hop === undefined) {
          return { task, resolves: false, alias: null, priced: false };
        }

        const price = await this.pricing.resolve(
          hop.provider?.kind ?? null,
          hop.modelId,
          organizationId,
        );

        return { task, resolves: true, alias: hop.alias, priced: price !== undefined };
      }),
    );
  }

  /**
   * The per-run cost cap of the route the loop's model is named by — admission's `modelFor` rule:
   * the first model stage's inherited route, else {@link DEFAULT_MODEL_TASK_KIND}'s. A first model
   * stage that pins its model has no route, and so no route cap.
   *
   * @param organizationId - The workspace.
   * @param definition - The version in force's definition, or `undefined`.
   * @param resolutions - The shared resolution cache.
   * @returns The cap in cents, or `null` when the route sets none (or there is no route).
   */
  private async costCap(
    organizationId: string,
    definition: unknown,
    resolutions: Map<string, Promise<Resolution | undefined>>,
  ): Promise<number | null> {
    const stage = definition === undefined ? undefined : firstModelStage(definition);

    if (stage !== undefined && "alias" in stage) {
      return null;
    }

    const resolution = await this.resolution(
      organizationId,
      stage?.task ?? DEFAULT_MODEL_TASK_KIND,
      resolutions,
    );

    return resolution?.maxCostCents ?? null;
  }

  /**
   * Whether the workspace GitHub token — the one a live run pushes its branch with
   * (`ingest/run-push.service.ts`) — may push to the repository.
   *
   * @param organizationId - The workspace.
   * @param repository - The repository.
   * @returns What GitHub said.
   */
  private async pushCredential(
    organizationId: string,
    repository: ReadinessRepositoryRow,
  ): Promise<CredentialFact> {
    if (!(await this.credentials.isConfigured(organizationId))) {
      return { outcome: "not_configured" };
    }

    try {
      const client = await this.github.forOrganization(organizationId);
      const { data } = await client.request<unknown>(REPOSITORY_ROUTE, {
        owner: repository.owner,
        repo: repository.name,
      });

      return fromPush(pushPermission(data));
    } catch (error) {
      if (
        error instanceof GithubApiError &&
        (error.failure === "not_found" || error.failure === "unauthorized")
      ) {
        return { outcome: "unreadable" };
      }

      return { outcome: "unconfirmed", why: "GitHub did not answer the permission lookup" };
    }
  }

  /**
   * Whether the issue's GitHub source — the one a live run opens its pull request with
   * (`ingest/run-pull-request.service.ts`) — may open one in the repository.
   *
   * @param organizationId - The workspace.
   * @param repository - The repository.
   * @param issueNumber - The issue, when one is named or picked.
   * @returns What the source's host said.
   */
  private async pullRequestCredential(
    organizationId: string,
    repository: ReadinessRepositoryRow,
    issueNumber: number | undefined,
  ): Promise<CredentialFact> {
    if (issueNumber === undefined) {
      return { outcome: "no_issue" };
    }

    const source = await this.readiness.prSource(organizationId, repository, issueNumber);
    const provider = source === undefined ? undefined : this.registry.find(source.kind);

    if (source === undefined || provider === undefined || !supportsRepositoryAccess(provider)) {
      return { outcome: "no_pr_source" };
    }

    try {
      const access = await this.sources.withCredentials(source, (context) =>
        provider.repositoryAccess(context),
      );

      if (access.repository.toLowerCase() !== repository.slug.toLowerCase()) {
        return { outcome: "other_repository", target: access.repository };
      }

      return fromPush(access.push);
    } catch (error) {
      if (
        TicketSourceError.is(error) &&
        (error.errorClass === "auth" || error.errorClass === "not_found")
      ) {
        return { outcome: "unreadable" };
      }

      return {
        outcome: "unconfirmed",
        why: `the source ${source.displayName} did not answer the permission lookup`,
      };
    }
  }
}

/**
 * The credential outcome of a push permission.
 *
 * @param push - What GitHub said, or `null` when it did not say.
 * @returns The outcome.
 */
function fromPush(push: boolean | null): CredentialFact {
  if (push === null) {
    return { outcome: "unconfirmed", why: "GitHub's answer carries no permission for the token" };
  }

  return push ? { outcome: "can_push" } : { outcome: "push_denied" };
}

/**
 * The distinct pools the build stages name.
 *
 * @param stages - The workflow's stages, or `undefined`.
 * @returns The names, in first-use order.
 */
function poolNames(stages: WorkflowStages | undefined): string[] {
  const names = (stages?.buildStages ?? [])
    .map((stage) => stage.pool)
    .filter((pool): pool is string => pool !== null);

  return [...new Set(names)];
}
