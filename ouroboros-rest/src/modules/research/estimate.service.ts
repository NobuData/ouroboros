/**
 * `ResearchEstimateService` — the estimate, its researcher, and the record of how it compared.
 *
 * [#622](https://github.com/NobuData/ouroboros/issues/622), decision **V5**. Three operations,
 * each a thin read around the pure function in `estimate.ts`:
 *
 *   * **{@link estimate}** — what the composer calls on every kind, depth or tool change. It
 *     resolves the `research` task kind through Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194))
 *     — the same `ResolutionService` execution uses, so the pill names what would actually run —
 *     prices that alias through CH.3 ([#586](https://github.com/NobuData/ouroboros/issues/586)),
 *     asks the hosted tool providers for their per-operation prices, and computes.
 *   * **{@link storeEstimate}** — the same computation for a queued investigation, written onto it
 *     with the calibration version (CM.6, [#625](https://github.com/NobuData/ouroboros/issues/625),
 *     calls it when an investigation is created).
 *   * **{@link reconcile}** — once the run has recorded actuals (CM.1,
 *     [#620](https://github.com/NobuData/ouroboros/issues/620)), the estimate and the actuals are
 *     written side by side in `investigation_estimate_outcomes`, which is what calibration reads.
 *
 * **Unpriced means no dollars.** A researcher whose price is absent, seat-based or vendor-metered
 * gives no per-call rate, so the estimate carries a source range and no cost — and no hosted tool
 * cost either. A researcher that cannot be resolved at all is the same: nothing will run, so
 * nothing can be priced.
 */

import { Injectable } from "@nestjs/common";

import { DomainError } from "../errors/error.envelope";
import type { InvestigationDepth } from "../db/schema";
import type { ResolvedPrice } from "../pricing/price";
import { PricingService } from "../pricing/pricing.service";
import { ResolutionService } from "../routing/resolution.service";
import { ROUTING_ERRORS } from "../routing/routing.errors";
import { type SynthesisRates, estimateInvestigation } from "./estimate";
import {
  investigationNotFound,
  investigationNotQueued,
  kindNotFound,
  outcomeUnavailable,
  toolUnknown,
  toolsRequired,
} from "./research.errors";
import { ResearchRepository } from "./research.repository";
import {
  type EstimateOutcomeResource,
  RESEARCH_TASK_KIND,
  type ResearcherResource,
  type ScopeEstimateResource,
  estimateOutcomeResource,
  scopeEstimateResource,
} from "./resources";
import { ResearchToolPricing } from "./tool-pricing";

/** What the composer asks to have estimated. */
export interface EstimateRequest {
  /** The investigation kind's slug — `gap_analysis`. */
  readonly kind: string;
  /** The depth preset. */
  readonly depth: InvestigationDepth;
  /** The enabled tools; when omitted, the kind's playbook defaults. */
  readonly tools?: readonly string[];
}

/** A resolved researcher and the per-token rates its alias is priced at (null when unpriced). */
interface PricedResearcher {
  readonly resource: ResearcherResource;
  readonly rates: SynthesisRates | null;
}

/**
 * The per-token rates a price gives, or null when it gives none.
 *
 * @param price - CH.3's answer, or undefined for an uncovered model.
 * @returns Both rates for a `token` price; zero for a `free` one (a real zero-price row);
 *   null for `seat`, `usage` and no price — none of which is a per-call rate.
 */
export function synthesisRatesOf(price: ResolvedPrice | undefined): SynthesisRates | null {
  switch (price?.billingMode) {
    case "token":
      return { inputCentsPer1m: price.inputCentsPer1m, outputCentsPer1m: price.outputCentsPer1m };
    case "free":
      return {
        inputCentsPer1m: price.inputCentsPer1m ?? 0,
        outputCentsPer1m: price.outputCentsPer1m ?? 0,
      };
    default:
      return null;
  }
}

@Injectable()
export class ResearchEstimateService {
  /**
   * @param research - The research tables.
   * @param resolution - Z.1's resolution — the composer's pill is its answer for `research`.
   * @param pricing - CH.3's pricing service.
   * @param toolPricing - Hosted tool providers' per-operation prices (#615 binds the real one).
   */
  constructor(
    private readonly research: ResearchRepository,
    private readonly resolution: ResolutionService,
    private readonly pricing: PricingService,
    private readonly toolPricing: ResearchToolPricing,
  ) {}

  /**
   * Estimates a prospective investigation — the composer's re-estimation call.
   *
   * @param organizationId - The workspace.
   * @param request - Kind, depth and (optionally) tools.
   * @returns The estimate, its researcher and the composer's line.
   * @throws NotFoundError `investigation_kind_not_found` for a kind this workspace lacks.
   * @throws InvalidRequestError `research_tool_unknown` for an unregistered tool, and
   *   `research_tools_required` when no tools were given and the kind defaults to none.
   */
  async estimate(organizationId: string, request: EstimateRequest): Promise<ScopeEstimateResource> {
    const kind = await this.research.findKind(organizationId, request.kind);
    if (kind === undefined) {
      throw kindNotFound(request.kind);
    }

    const tools = request.tools ?? kind.defaultTools;
    if (tools.length === 0) {
      throw toolsRequired(kind.slug);
    }

    return this.compute(organizationId, request.depth, tools);
  }

  /**
   * Computes and stores the estimate of a queued investigation, from its own depth and tools.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The estimate that was stored.
   * @throws NotFoundError `investigation_not_found` when the workspace has no such investigation.
   * @throws ConflictError `investigation_not_queued` once it has started — it keeps the estimate
   *   it started under, which is what reconciliation compares against.
   */
  async storeEstimate(
    organizationId: string,
    investigationId: string,
  ): Promise<ScopeEstimateResource> {
    const investigation = await this.research.findInvestigation(organizationId, investigationId);
    if (investigation === undefined) {
      throw investigationNotFound(investigationId);
    }
    if (investigation.status !== "queued") {
      throw investigationNotQueued(investigation.displayId, investigation.status);
    }

    const estimate = await this.compute(organizationId, investigation.depth, investigation.tools);
    const stored = await this.research.storeEstimate(
      organizationId,
      investigationId,
      { sources: estimate.sources, cost_cents: estimate.costCents },
      estimate.calibrationVersion,
    );

    if (!stored) {
      // It left `queued` between the read and the write. Re-read so the conflict names the
      // status it is in now rather than the one it was in a moment ago.
      const now = await this.research.findInvestigation(organizationId, investigationId);
      throw now === undefined
        ? investigationNotFound(investigationId)
        : investigationNotQueued(now.displayId, now.status);
    }

    return estimate;
  }

  /**
   * Records the estimate-vs-actuals comparison of an investigation, for calibration.
   *
   * Idempotent: a second call refreshes the same row from the same investigation.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The comparison.
   * @throws NotFoundError `investigation_not_found` when the workspace has no such investigation.
   * @throws ConflictError `investigation_outcome_unavailable` when it lacks an estimate or actuals.
   */
  async reconcile(
    organizationId: string,
    investigationId: string,
  ): Promise<EstimateOutcomeResource> {
    const investigation = await this.research.findInvestigation(organizationId, investigationId);
    if (investigation === undefined) {
      throw investigationNotFound(investigationId);
    }

    const outcome = await this.research.recordOutcome(organizationId, investigationId);
    if (outcome === undefined) {
      throw outcomeUnavailable(investigation.displayId);
    }

    return estimateOutcomeResource(outcome);
  }

  /**
   * The researcher alias routing resolves `research` to, and its per-token rates.
   *
   * @param organizationId - The workspace.
   * @returns The researcher and its rates, or null when the workspace has no `research` route
   *   or the resolution keeps no hop.
   */
  async researcher(organizationId: string): Promise<PricedResearcher | null> {
    let resolution;
    try {
      resolution = await this.resolution.resolve(organizationId, RESEARCH_TASK_KIND, {});
    } catch (error) {
      // No route is an honest "nothing to run", not a failure of the estimate: the sources can
      // still be counted, and the composer says there is no researcher.
      if (error instanceof DomainError && error.code === ROUTING_ERRORS.routeNotFound) {
        return null;
      }
      throw error;
    }

    const hop =
      resolution.outcome === "resolved"
        ? resolution.chain.find((candidate) => candidate.decision === "kept")
        : undefined;
    if (hop === undefined) {
      return null;
    }

    const price =
      hop.provider === null
        ? undefined
        : await this.pricing.resolve(hop.provider.kind, hop.modelId, organizationId);

    return {
      resource: {
        taskKind: resolution.taskKind,
        routeTag: resolution.routeTag,
        alias: hop.alias,
        modelId: hop.modelId,
      },
      rates: synthesisRatesOf(price),
    };
  }

  /**
   * Validates the tools, gathers the prices and runs the pure estimate.
   *
   * @param organizationId - The workspace.
   * @param depth - The depth preset.
   * @param tools - The tool selection, non-empty.
   * @returns The published estimate.
   * @throws InvalidRequestError `research_tool_unknown` for an unregistered tool.
   */
  private async compute(
    organizationId: string,
    depth: InvestigationDepth,
    tools: readonly string[],
  ): Promise<ScopeEstimateResource> {
    const unknown = await this.research.unknownTools(tools);
    if (unknown.length > 0) {
      throw toolUnknown(unknown);
    }

    const [researcher, toolOperationCents] = await Promise.all([
      this.researcher(organizationId),
      this.toolPricing.operationPrices(organizationId, tools),
    ]);

    const estimate = estimateInvestigation({
      depth,
      tools,
      synthesisRates: researcher?.rates ?? null,
      toolOperationCents,
    });

    return scopeEstimateResource(estimate, depth, tools, researcher?.resource ?? null);
  }
}
