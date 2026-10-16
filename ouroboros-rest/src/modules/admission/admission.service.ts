/**
 * Gathers the facts live-run admission is decided from (DI.4,
 * [#1312](https://github.com/NobuData/ouroboros/issues/1312)) — the decision itself is the pure
 * `admission.ts`.
 *
 * ```
 * workspace   OURO_LIVE_EXECUTION_ENABLED · workspace_lifecycle.state · engine executors
 *             · live runs + unexpired leases vs min(live_run_ceiling, OURO_LIVE_RUN_CEILING_MAX)
 * item        github_repos.enabled · repository dry-run (uncached) · pinned version reads
 *             · every inherited route resolves to a kept hop, and an invocable connection exists
 *             · queue_items.confirmed_at
 * ```
 *
 * Two callers: the claim, inside its transaction and under its lock, and the read models
 * (`GET /api/v1/queue`, the dashboard, the backlog) through {@link AdmissionService.waiting}.
 * Item facts are gathered once per distinct repository, pin and route, so a listing of fifty
 * items asks the policy and the router a handful of times, not fifty.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Transaction } from "kysely";

import { AppConfigService } from "../config/config.service";
import { queueItemSummary, type QueueItemSummary } from "../dashboard/resources";
import type { Database, QueueItem } from "../db/schema";
import { EngineClient } from "../engine/engine.client";
import { NotFoundError } from "../errors/error.envelope";
import { WorkspaceStateReader } from "../lifecycle/lifecycle.state";
import { LoopRepository } from "../loop/loop.repository";
import { INVOCABLE_KINDS } from "../loop/loop.service";
import { OrgPolicyService, type DryRunPolicyReader } from "../policies/org-policy.service";
import { PolicyResolutionService } from "../policies/policy-resolution.service";
import { repositoryDryRun, type PolicyLoopSource } from "../policies/repository-dry-run";
import { ResolutionService } from "../routing/resolution.service";
import { effectiveCanApproveLoops } from "../tenancy/capabilities";
import { CapabilityRepository } from "../tenancy/capability.repository";
import {
  effectiveCeiling,
  itemAdmission,
  queueWaiting,
  workspaceAdmission,
  type WorkspaceAdmissionReason,
  type ItemAdmissionFacts,
  type QueueWaiting,
  type WorkspaceAdmissionFacts,
} from "./admission";
import { firstModelStage, pinnedTaskKinds } from "./admission.pin";
import { AdmissionRepository, type Writer } from "./admission.repository";

/**
 * How many queue items one claim judges at most. A queue is tens of rows; past this many items
 * that cannot start, the claim answers nothing rather than walk the rest under its lock.
 */
export const CLAIM_CANDIDATE_LIMIT = 50;

/**
 * The task kind whose route names a run's model when its pinned workflow has no model stage to
 * read one from (#160) — the loop's own work.
 */
export const DEFAULT_MODEL_TASK_KIND = "implement";

/** The model a claim names when nothing resolves one — never blank, as `runs.model` requires. */
export const UNROUTED_MODEL = "unrouted";

/** What one claim's admission decided. */
export type AdmitNext =
  /** The workspace holds every item; nothing was judged. */
  | { readonly refused: WorkspaceAdmissionReason; readonly taken: number; readonly ceiling: number }
  /** The first item that may start, or `undefined` when none may. */
  | { readonly refused: null; readonly item: QueueItem | undefined };

/** How long the engine's executor count is reused by the read models, in milliseconds. */
export const EXECUTOR_CACHE_MS = 15_000;

/** The clock token a suite binds to control the executor cache. */
export const ADMISSION_CLOCK = Symbol("ADMISSION_CLOCK");

/** What a surface publishing queue items needs of admission. */
export type AdmissionSummaries = Pick<AdmissionService, "summaries">;

/** What admission needs of the router. */
export type RouteResolver = Pick<ResolutionService, "resolve">;

@Injectable()
export class AdmissionService {
  /** The engine's last answer, for the read models. */
  private executorCache: { readonly count: number; readonly at: number } | undefined;

  /** The clock. */
  private readonly now: () => number;

  /**
   * @param store - The admission statements.
   * @param config - The switch and the deployment's ceiling maximum.
   * @param states - The workspace's lifecycle state (#489).
   * @param connections - Whether an invocable connection exists (DH.4).
   * @param engine - The engine's registered executors.
   * @param routing - The router, for each inherited route.
   * @param policy - The org-wide dry-run switch.
   * @param resolver - The per-repository dry-run rule.
   * @param capabilities - Members' explicit `can_approve_loops` settings.
   * @param clock - The clock — `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly store: AdmissionRepository,
    private readonly config: AppConfigService,
    private readonly states: WorkspaceStateReader,
    private readonly connections: LoopRepository,
    private readonly engine: EngineClient,
    @Inject(ResolutionService) private readonly routing: RouteResolver,
    @Inject(OrgPolicyService) private readonly policy: DryRunPolicyReader,
    @Inject(PolicyResolutionService) private readonly resolver: PolicyLoopSource,
    private readonly capabilities: CapabilityRepository,
    @Optional() @Inject(ADMISSION_CLOCK) clock?: () => number,
  ) {
    this.now = clock ?? Date.now;
  }

  /**
   * Who an enqueue is confirmed by, if anyone — decision L5: an item becomes claimable at once
   * only when the deployment runs live loops **and** the person queueing it holds
   * `can_approve_loops`. Everyone else's item waits as `needs_confirmation`.
   *
   * @param organizationId - The workspace.
   * @param caller - The signed-in person and their roles, or undefined for a write no person
   *   made (a playbook trigger, a chat command, a watch).
   * @returns The user id to stamp as `confirmed_by`, or `null`.
   */
  async confirmerFor(
    organizationId: string,
    caller: { readonly userId: string; readonly roles: readonly string[] } | undefined,
  ): Promise<string | null> {
    if (caller === undefined || !this.config.liveExecutionEnabled) {
      return null;
    }

    const explicit = await this.capabilities.explicitFor(organizationId, caller.userId);

    return effectiveCanApproveLoops(caller.roles, explicit) ? caller.userId : null;
  }

  /**
   * How many stage executors the engine has registered.
   *
   * @param declared - The executors the claiming worker declared, when it did — its own word is
   *   the freshest answer. Absent, the engine's status call is asked (and reused for
   *   {@link EXECUTOR_CACHE_MS}); an engine that does not answer has none.
   * @returns The count.
   */
  async executorCount(declared?: readonly string[]): Promise<number> {
    if (declared !== undefined) {
      return declared.length;
    }

    const at = this.now();
    if (this.executorCache !== undefined && at - this.executorCache.at < EXECUTOR_CACHE_MS) {
      return this.executorCache.count;
    }

    let count = 0;
    try {
      count = ((await this.engine.status()).executors ?? []).length;
    } catch {
      count = 0;
    }

    this.executorCache = { count, at };
    return count;
  }

  /**
   * The model a run opened from a claimed item will record — `runs.model`, what the dashboard
   * row renders (#160). The rule, in order:
   *
   *   1. the pinned workflow's **first model stage** (`llm` node, document order): its pinned
   *      registry alias when it pins one;
   *   2. otherwise the alias of the **first kept hop** of the route that stage inherits
   *      (`routing.inherit_task`);
   *   3. a definition with no model stage reads the route of {@link DEFAULT_MODEL_TASK_KIND}
   *      the same way;
   *   4. and when no route resolves to a kept hop, {@link UNROUTED_MODEL}.
   *
   * An alias, never a raw provider model id (decision M1) — the same name the run's stages are
   * routed by. Admission has already required every inherited route to resolve, so step 4 is
   * for a definition with no model stage in a workspace with no default route.
   *
   * @param organizationId - The workspace.
   * @param definition - The pinned `workflow_versions.definition`, or `undefined` when there is
   *   no pin.
   * @returns The alias.
   */
  async modelFor(organizationId: string, definition: unknown): Promise<string> {
    const stage = definition === undefined ? undefined : firstModelStage(definition);

    if (stage !== undefined && "alias" in stage) {
      return stage.alias;
    }

    const task = stage?.task ?? DEFAULT_MODEL_TASK_KIND;

    try {
      const resolution = await this.routing.resolve(organizationId, task);
      const primary = resolution.chain.find((hop) => hop.decision === "kept");

      return resolution.outcome === "resolved" && primary !== undefined
        ? primary.alias
        : UNROUTED_MODEL;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return UNROUTED_MODEL;
      }
      throw error;
    }
  }

  /**
   * The claim's decision: lock the workspace's claims, check it may start anything, then take
   * the first item in queue order that may start — skipping, not stopping at, an item that
   * cannot (it keeps its place and its reason).
   *
   * @param trx - The claim's transaction. The lock is held until it ends, so the slot this
   *   admits is counted by the next claim — the ceiling holds with two workers racing for one.
   * @param organizationId - The workspace.
   * @param now - The instant a lease is judged against.
   * @param executors - How many executors the engine has registered.
   * @returns The refusal, or the item to lease (`undefined` when none may start).
   */
  async admitNext(
    trx: Transaction<Database>,
    organizationId: string,
    now: Date,
    executors: number,
  ): Promise<AdmitNext> {
    await this.store.lockClaims(trx, organizationId);

    const workspace = await this.workspaceFacts(trx, organizationId, now, executors);
    const refused = workspaceAdmission(workspace);

    if (refused !== null) {
      return { refused, taken: workspace.liveSlotsTaken, ceiling: workspace.ceiling };
    }

    const candidates = await this.store.claimableCandidates(
      trx,
      organizationId,
      now,
      CLAIM_CANDIDATE_LIMIT,
    );
    const facts = await this.itemFacts(trx, organizationId, candidates);
    const item = candidates.find((candidate) => {
      const own = facts.get(candidate.id);

      return own !== undefined && itemAdmission(own) === null;
    });

    return { refused: null, item };
  }

  /**
   * The workspace-wide facts.
   *
   * @param writer - The connection — the claim's transaction, under its lock.
   * @param organizationId - The workspace.
   * @param now - The instant a lease is judged against.
   * @param executors - How many executors the engine has registered.
   * @returns The facts.
   */
  async workspaceFacts(
    writer: Writer,
    organizationId: string,
    now: Date,
    executors: number,
  ): Promise<WorkspaceAdmissionFacts> {
    const [state, liveSlotsTaken, ceiling] = await Promise.all([
      this.states.stateOf(organizationId),
      this.store.liveSlotsTaken(writer, organizationId, now),
      this.store.ceiling(writer, organizationId),
    ]);

    return {
      deploymentEnabled: this.config.liveExecutionEnabled,
      state,
      executors,
      liveSlotsTaken,
      ceiling: effectiveCeiling(ceiling, this.config.liveRunCeilingMax),
    };
  }

  /**
   * Each item's own facts.
   *
   * @param writer - The connection.
   * @param organizationId - The workspace.
   * @param items - The items, all of this workspace.
   * @returns The facts by item id.
   */
  async itemFacts(
    writer: Writer,
    organizationId: string,
    items: readonly QueueItem[],
  ): Promise<ReadonlyMap<string, ItemAdmissionFacts>> {
    if (items.length === 0) {
      return new Map();
    }

    const repositories = [...new Set(items.map((item) => item.github_repo_id))];
    const [enabled, dryRuns, invocable] = await Promise.all([
      this.store.repositoriesEnabled(writer, organizationId, repositories),
      this.dryRuns(organizationId, repositories),
      this.connections.invocableConnectionExists(organizationId, INVOCABLE_KINDS),
    ]);

    const pins = new Map<string, Promise<readonly string[] | undefined>>();
    const routes = new Map<string, Promise<boolean>>();
    const facts = new Map<string, ItemAdmissionFacts>();

    for (const item of items) {
      const tasks = await this.pinTasks(writer, organizationId, item, pins);
      const routeInvocable =
        invocable &&
        tasks !== undefined &&
        (await this.allRoutesResolve(organizationId, tasks, routes));

      facts.set(item.id, {
        repositoryEnabled: enabled.get(item.github_repo_id) ?? false,
        dryRun: dryRuns.get(item.github_repo_id) ?? false,
        workflowPublished: tasks !== undefined,
        routeInvocable,
        confirmed: item.confirmed_at !== null,
      });
    }

    return facts;
  }

  /**
   * Why each item is waiting, as the read models publish it. An item a worker holds is not
   * waiting — it is being opened.
   *
   * @param organizationId - The workspace.
   * @param items - The items to explain.
   * @param now - The instant a lease is judged against.
   * @returns The reason by item id, `null` for an item that would be admitted or is held.
   */
  async waiting(
    organizationId: string,
    items: readonly QueueItem[],
    now: Date = new Date(),
  ): Promise<ReadonlyMap<string, QueueWaiting | null>> {
    if (items.length === 0) {
      return new Map();
    }

    const writer = this.store.db;
    const [workspace, facts] = await Promise.all([
      this.executorCount().then((executors) =>
        this.workspaceFacts(writer, organizationId, now, executors),
      ),
      this.itemFacts(writer, organizationId, items),
    ]);

    return new Map(
      items.map((item) => {
        const held = item.claim_expires_at !== null && item.claim_expires_at > now;
        const own = facts.get(item.id);

        return [item.id, held || own === undefined ? null : queueWaiting(workspace, own)];
      }),
    );
  }

  /**
   * Queue items as every surface publishes them, each with why it is waiting.
   *
   * @param organizationId - The workspace.
   * @param items - The rows, in the order to publish them.
   * @param now - The instant a lease is judged against.
   * @returns The summaries, in the same order.
   */
  async summaries(
    organizationId: string,
    items: readonly QueueItem[],
    now: Date = new Date(),
  ): Promise<QueueItemSummary[]> {
    const waiting = await this.waiting(organizationId, items, now);

    return items.map((item) => queueItemSummary(item, waiting.get(item.id) ?? null, now));
  }

  /**
   * Each repository's dry-run, read now.
   *
   * @param organizationId - The workspace.
   * @param repositories - Distinct repository ids.
   * @returns Dry-run by repository id.
   */
  private async dryRuns(
    organizationId: string,
    repositories: readonly string[],
  ): Promise<ReadonlyMap<string, boolean>> {
    const answers = await Promise.all(
      repositories.map((repository) =>
        repositoryDryRun(this.policy, this.resolver, organizationId, repository),
      ),
    );

    return new Map(repositories.map((repository, index) => [repository, answers[index] ?? false]));
  }

  /**
   * The task kinds an item's pinned version inherits, read once per pin.
   *
   * @param writer - The connection.
   * @param organizationId - The workspace.
   * @param item - The item.
   * @param pins - The reads so far, by `tag@version`.
   * @returns The task kinds, or `undefined` when the item pins nothing published or readable.
   */
  private pinTasks(
    writer: Writer,
    organizationId: string,
    item: QueueItem,
    pins: Map<string, Promise<readonly string[] | undefined>>,
  ): Promise<readonly string[] | undefined> {
    const version = item.workflow_version;

    if (version === null) {
      return Promise.resolve(undefined);
    }

    const key = `${item.workflow_tag}@${version}`;
    let pending = pins.get(key);

    if (pending === undefined) {
      pending = this.store
        .pinnedDefinition(writer, organizationId, item.workflow_tag, version)
        .then((row) => (row === undefined ? undefined : pinnedTaskKinds(row.definition)));
      pins.set(key, pending);
    }

    return pending;
  }

  /**
   * Whether every task kind resolves to at least one hop the router kept — a hop on a connection
   * not cleared for invocation is dropped (`provider_not_invocable`, DH.4).
   *
   * @param organizationId - The workspace.
   * @param tasks - The task kinds.
   * @param routes - The answers so far, by task kind.
   * @returns True when all do; true for none.
   */
  private async allRoutesResolve(
    organizationId: string,
    tasks: readonly string[],
    routes: Map<string, Promise<boolean>>,
  ): Promise<boolean> {
    for (const task of tasks) {
      let pending = routes.get(task);

      if (pending === undefined) {
        pending = this.routeResolves(organizationId, task);
        routes.set(task, pending);
      }

      if (!(await pending)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Whether one task kind's route resolves to a kept hop.
   *
   * @param organizationId - The workspace.
   * @param task - The task kind.
   * @returns False when there is no route, or it resolves to nothing runnable.
   */
  private async routeResolves(organizationId: string, task: string): Promise<boolean> {
    try {
      const resolution = await this.routing.resolve(organizationId, task);

      return (
        resolution.outcome === "resolved" && resolution.chain.some((hop) => hop.decision === "kept")
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        return false;
      }
      throw error;
    }
  }
}
