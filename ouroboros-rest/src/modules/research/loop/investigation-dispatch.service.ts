/**
 * Hands investigations to the engine's loop, asks one to stop, and resumes the ones a restart
 * left behind (CM.1, [#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * **Dispatch** turns an investigation row into the engine's `/v0/investigate` request: the
 * kind's playbook, the question, the enabled tools with what each can do, the depth, the
 * budget, and the aliases routing resolves `research` and `research-plan` to. The lifecycle
 * API (CM.6, #625) calls it when a person starts an investigation.
 *
 * **The budget is computed, like the estimate it comes from.** Operations and sources are the
 * scope estimate's own figures for this depth and tool selection (`estimate.ts`); the spend
 * ceiling is the stored estimate's upper bound with {@link SPEND_CEILING} of headroom, so a
 * run that lands a little over its estimate finishes and one that runs away is stopped as a
 * `budget_breach`. No stored cost — an unpriced model — means no ceiling.
 *
 * **Resume is a re-submit.** The engine holds nothing durable; a `running` investigation whose
 * loop row has not been written to for {@link STALL_MS} is submitted again. An engine that
 * still holds it answers `already_running`; one that was restarted starts a new attempt from
 * the stored checkpoint. After {@link MAX_ATTEMPTS} attempts it is failed as `engine_error`
 * instead of being restarted forever — with everything it gathered kept. A stalled one that a
 * person asked to cancel is cancelled there and then, engine or no engine.
 */

import { Injectable, Logger } from "@nestjs/common";

import { EngineClient } from "../../engine/engine.client";
import type {
  EngineInvestigateRequest,
  EngineInvestigationTool,
} from "../../engine/engine.investigate";
import { DomainError } from "../../errors/error.envelope";
import { describeForLog } from "../../errors/failure";
import { ResolutionService } from "../../routing/resolution.service";
import { ROUTING_ERRORS } from "../../routing/routing.errors";
import { estimateInvestigation } from "../estimate";
import { investigationNotFound } from "../research.errors";
import { RESEARCH_TASK_KIND } from "../resources";
import { declaredOperations } from "../tools/research-tool.adapter";
import { ResearchToolRegistry } from "../tools/research-tool.registry";
import {
  notCancellable,
  notRunnable,
  researcherUnavailable,
  toolsUnavailable,
} from "./investigation-loop.errors";
import {
  InvestigationLoopRepository,
  type InvestigationLoopStore,
  type LoopInvestigation,
} from "./investigation-loop.repository";

/** The task kind planning and operation selection are routed as (CM.3, #622). */
export const RESEARCH_PLAN_TASK_KIND = "research-plan";

/**
 * The spend ceiling as a multiple of the estimate's upper bound — one and a half times, as an
 * integer ratio so the ceiling never depends on float rounding.
 */
export const SPEND_CEILING = { numerator: 3, denominator: 2 } as const;

/** How long a running investigation may go without a checkpoint before it is re-submitted. */
export const STALL_MS = 600_000;

/** The most attempts an investigation gets before it is failed as `engine_error`. */
export const MAX_ATTEMPTS = 3;

/** How many stalled investigations one resume pass looks at. */
export const RESUME_BATCH = 20;

/** What a person reads when an investigation was restarted too often. */
export const ABANDONED_DETAIL =
  "The investigation was restarted too many times without finishing. What it gathered is kept.";

/** The answer to a dispatch. */
export interface DispatchedResource {
  /** `RS-127`. */
  readonly investigation: string;
  /** The engine task — `investigations.engine_task_ref` once the loop claims the run. */
  readonly task: string;
  /** `already_running` when an engine process already held it. */
  readonly state: "accepted" | "already_running";
  readonly loopVersion: string;
}

/** The answer to a cancel request. */
export interface CancelResource {
  /** `RS-127`. */
  readonly investigation: string;
  /** `cancelled` at once, or `cancelling` while the worker finishes its current operation. */
  readonly state: "cancelled" | "cancelling";
}

@Injectable()
export class InvestigationDispatchService {
  private readonly logger = new Logger(InvestigationDispatchService.name);
  private readonly store: InvestigationLoopStore;

  /**
   * @param repository - Investigations and their loop state.
   * @param registry - The research tool adapters of this build.
   * @param resolution - Z.1's resolution, for the `research` aliases.
   * @param engine - The engine.
   */
  constructor(
    repository: InvestigationLoopRepository,
    private readonly registry: ResearchToolRegistry,
    private readonly resolution: ResolutionService,
    private readonly engine: EngineClient,
  ) {
    this.store = repository;
  }

  /**
   * Hand an investigation of a workspace to the engine.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The engine task that took it.
   * @throws {NotFoundError} `investigation_not_found`.
   * @throws {ConflictError} `investigation_not_runnable` once it has ended,
   *   `investigation_researcher_unavailable` when routing resolves no researcher, and
   *   `investigation_tools_unavailable` when no enabled tool has an adapter.
   * @throws {UpstreamError} `engine_unavailable` — the investigation is left as it was.
   */
  async dispatch(organizationId: string, investigationId: string): Promise<DispatchedResource> {
    const investigation = await this.store.findIn(organizationId, investigationId);
    if (investigation === undefined) throw investigationNotFound(investigationId);

    return this.submit(investigation);
  }

  /**
   * Ask an investigation to stop.
   *
   * A queued one is cancelled at once. A running one is cancelled by its worker between two
   * operations, so its ledger, checkpoint and actuals are kept.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @param userId - Who asked, or null.
   * @returns Whether it is cancelled already or on its way.
   * @throws {NotFoundError} `investigation_not_found`.
   * @throws {ConflictError} `investigation_not_cancellable` once it has finished.
   */
  async requestCancel(
    organizationId: string,
    investigationId: string,
    userId: string | null,
  ): Promise<CancelResource> {
    const cancel = await this.store.requestCancel(organizationId, investigationId, userId);

    if (cancel.outcome === "not_found") throw investigationNotFound(investigationId);
    if (cancel.outcome === "not_cancellable") {
      throw notCancellable(cancel.displayId, cancel.status);
    }

    return {
      investigation: cancel.displayId,
      state: cancel.outcome === "cancelled" ? "cancelled" : "cancelling",
    };
  }

  /**
   * One resume pass: re-submit every running investigation whose checkpoint has stopped
   * moving, and fail the ones that have used up their attempts.
   *
   * @param now - The current time.
   * @returns How many stalled investigations were looked at.
   */
  async resume(now: Date = new Date()): Promise<number> {
    const stalled = await this.store.stalled(new Date(now.getTime() - STALL_MS), RESUME_BATCH);

    for (const candidate of stalled) {
      try {
        if (candidate.cancelRequested) {
          // A person asked for it to stop and its worker is gone: there is nothing to wait
          // for, and starting an engine attempt only to cancel it would be the wrong way round.
          if (await this.store.abandon(candidate.id, candidate.attempt, null)) {
            this.logger.warn(`${candidate.displayId} was cancelled; its worker had stopped.`);
          }
          continue;
        }
        if (candidate.attempt >= MAX_ATTEMPTS) {
          if (await this.store.abandon(candidate.id, candidate.attempt, ABANDONED_DETAIL)) {
            this.logger.error(
              `${candidate.displayId} failed as engine_error after ${candidate.attempt.toString()} attempts.`,
            );
          }
          continue;
        }

        const investigation = await this.store.find(candidate.id);
        if (investigation?.status !== "running") continue;
        const dispatched = await this.submit(investigation);
        if (dispatched.state === "accepted") {
          this.logger.warn(`${candidate.displayId} had stalled and was submitted again.`);
        }
      } catch (error) {
        // One investigation that cannot be resumed now must not stop the others; it is still
        // stalled next pass.
        this.logger.error(
          `${candidate.displayId} could not be resumed; trying again next pass.`,
          describeForLog(error),
        );
      }
    }

    return stalled.length;
  }

  /**
   * Build the engine's request for an investigation and send it.
   *
   * @param investigation - The investigation.
   * @returns The engine task.
   */
  private async submit(investigation: LoopInvestigation): Promise<DispatchedResource> {
    if (investigation.status !== "queued" && investigation.status !== "running") {
      throw notRunnable(investigation.displayId, investigation.status);
    }

    const tools = this.tools(investigation);
    if (tools.length === 0) {
      throw toolsUnavailable(investigation.displayId, investigation.tools);
    }

    const researcher = await this.routed(investigation.organizationId, RESEARCH_TASK_KIND);
    if (researcher === null) throw researcherUnavailable(investigation.displayId);
    const planner = await this.routed(investigation.organizationId, RESEARCH_PLAN_TASK_KIND);

    const request: EngineInvestigateRequest = {
      investigation: investigation.id,
      kind: { slug: investigation.kind, playbook: investigation.playbook },
      question: investigation.question,
      tools,
      depth: investigation.depth,
      budget: budgetOf(investigation),
      alias: researcher.alias,
      planAlias: planner?.alias ?? null,
      resolutionVersion: researcher.resolutionVersion,
    };
    const accepted = await this.engine.investigate(request);

    return {
      investigation: investigation.displayId,
      task: accepted.task,
      state: accepted.state,
      loopVersion: accepted.loopVersion,
    };
  }

  /**
   * The enabled tools this build has an adapter for, and what each can do.
   *
   * @param investigation - The investigation.
   * @returns One entry per usable tool, in the investigation's order.
   */
  private tools(investigation: LoopInvestigation): EngineInvestigationTool[] {
    return investigation.tools.flatMap((slug) => {
      const adapter = this.registry.find(slug);
      if (adapter === undefined) return [];
      const operations = declaredOperations(adapter);
      if (operations.length === 0) return [];
      const meta = adapter.displayMeta();

      // The sub-line's `{slot}`s are live counts the card fills; the model only needs the words.
      const about = meta.subLine.replaceAll(/\{[^}]*\}\s*/g, "").trim();
      return [
        {
          slug,
          operations,
          description: `${meta.name}${about === "" ? "" : ` — ${about}`}`.slice(0, 400),
        },
      ];
    });
  }

  /**
   * The alias routing resolves a task kind to, in a workspace.
   *
   * @param organizationId - The workspace.
   * @param taskKind - `research` or `research-plan`.
   * @returns The first kept hop's alias and the resolution's version; null when the workspace
   *   has no route for the kind or the resolution keeps no hop.
   */
  private async routed(
    organizationId: string,
    taskKind: string,
  ): Promise<{ readonly alias: string; readonly resolutionVersion: string } | null> {
    let resolution;
    try {
      resolution = await this.resolution.resolve(organizationId, taskKind, {});
    } catch (error) {
      if (error instanceof DomainError && error.code === ROUTING_ERRORS.routeNotFound) {
        return null;
      }
      throw error;
    }

    const hop =
      resolution.outcome === "resolved"
        ? resolution.chain.find((candidate) => candidate.decision === "kept")
        : undefined;

    return hop === undefined
      ? null
      : { alias: hop.alias, resolutionVersion: resolution.resolutionVersion };
  }
}

/**
 * An investigation's budget: the scope estimate's operations and sources for its depth and
 * tools, and a spend ceiling from the estimate it was started under.
 *
 * @param investigation - The investigation.
 * @returns The budget the engine enforces.
 */
export function budgetOf(
  investigation: Pick<LoopInvestigation, "depth" | "tools" | "estimate">,
): EngineInvestigateRequest["budget"] {
  const scope = estimateInvestigation({
    depth: investigation.depth,
    tools: investigation.tools,
    synthesisRates: null,
    toolOperationCents: new Map(),
  });
  const cost = investigation.estimate?.cost_cents ?? null;

  return {
    operations: scope.operations.total,
    sources: scope.sources.max,
    spendCents:
      cost === null
        ? null
        : Math.ceil((cost.max * SPEND_CEILING.numerator) / SPEND_CEILING.denominator),
  };
}
