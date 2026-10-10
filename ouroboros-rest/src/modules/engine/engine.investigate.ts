/**
 * `POST /v0/investigate` — the investigation loop's submit, as this service sends it (CM.1,
 * [#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * The engine answers `202` at once and works in the background; everything it produces comes
 * back through the internal research surface (`research/loop/`), never through this answer. So
 * the contract here is small: what to investigate, under which playbook and budget, and the
 * engine task that took it.
 *
 * Submitting is idempotent on the engine's side — a process already working on the
 * investigation answers `already_running` and starts nothing — which is what lets the resume
 * pass submit a stalled investigation again without asking first.
 */

import { z } from "zod";

import type { InvestigationDepth, InvestigationPlaybookDocument } from "../db/schema";
import type { ToolOperation } from "../research/tools/research-tool.adapter";
import { ENGINE_API_VERSION } from "./engine.contract";

/** The route, relative to `OURO_ENGINE_URL`. */
export const ENGINE_INVESTIGATE_ROUTE = `${ENGINE_API_VERSION}/investigate`;

/** One enabled research tool, as the loop is told about it. */
export interface EngineInvestigationTool {
  readonly slug: string;
  /** The operations its adapter declares. */
  readonly operations: readonly ToolOperation[];
  /** The tools card's line for it — shown to the model that chooses operations. */
  readonly description: string;
}

/** What the investigation may use. */
export interface EngineInvestigationBudget {
  /** Tool operations, in total. */
  readonly operations: number;
  /** Ledger records; iteration stops at this many. */
  readonly sources: number;
  /** The model-spend ceiling in cents, or null when nothing prices the routed model. */
  readonly spendCents: number | null;
}

/** An investigation to run or resume. */
export interface EngineInvestigateRequest {
  /** `investigations.id`. */
  readonly investigation: string;
  readonly kind: { readonly slug: string; readonly playbook: InvestigationPlaybookDocument };
  readonly question: string;
  readonly tools: readonly EngineInvestigationTool[];
  readonly depth: InvestigationDepth;
  readonly budget: EngineInvestigationBudget;
  /** The alias `research` resolved to. */
  readonly alias: string;
  /** The alias `research-plan` resolved to, or null to plan on {@link alias}. */
  readonly planAlias: string | null;
  /** The resolution both came from. */
  readonly resolutionVersion: string | null;
}

/** The engine task that took an investigation. */
export interface EngineInvestigationAccepted {
  readonly investigation: string;
  /** `investigations.engine_task_ref`. */
  readonly task: string;
  /** `already_running` when the answering process already held it. */
  readonly state: "accepted" | "already_running";
  readonly loopVersion: string;
}

/**
 * The request, in the engine's spelling.
 *
 * @param request - The investigation, in this service's names.
 * @returns The body to serialise.
 */
export function investigateRequestBody(request: EngineInvestigateRequest): Record<string, unknown> {
  return {
    investigation: request.investigation,
    kind: { slug: request.kind.slug, playbook: request.kind.playbook },
    question: request.question,
    tools: request.tools.map((tool) => ({
      slug: tool.slug,
      operations: [...tool.operations],
      description: tool.description,
    })),
    depth: request.depth,
    budget: {
      operations: request.budget.operations,
      sources: request.budget.sources,
      spend_cents: request.budget.spendCents,
    },
    alias: request.alias,
    plan_alias: request.planAlias,
    resolution_version: request.resolutionVersion,
  };
}

/** What a `202` must be. Parsed, not asserted: a field this service reads has to be there. */
export const investigationAcceptedSchema = z
  .object({
    investigation: z.string(),
    task: z.string().min(1),
    state: z.enum(["accepted", "already_running"]),
    loop_version: z.string().min(1),
  })
  .transform((answer): EngineInvestigationAccepted => ({
    investigation: answer.investigation,
    task: answer.task,
    state: answer.state,
    loopVersion: answer.loop_version,
  }));
