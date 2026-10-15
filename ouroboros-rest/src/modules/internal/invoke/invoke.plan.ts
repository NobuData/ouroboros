/**
 * What an invocation will walk, decided before any socket opens — AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)).
 *
 * ```
 * alias + runCtx.stage routes it ─▶ chainPlan(resolution, alias)   the kept hops from that alias on,
 *                                                                   routing's floor, routing's cap
 * otherwise                       ─▶ singleHopPlan(target)          one hop, no fallback, no floor
 * connection                      ─▶ singleHopPlan(target)          "this provider and no other"
 * ```
 *
 * Pure, so every rule the requirements doc states about the chain (R1, R3, R4, R5) is a unit
 * test rather than a database fixture. The rules, as the code keeps them:
 *
 * - **Never re-decide (R1).** The hops are the resolution's `kept` hops in array order; nothing
 *   here reorders, adds or skips one. Starting at the requested alias's hop is not a decision:
 *   the worker named that alias, and the hops before it are ones it did not ask for.
 * - **Never run a `fail_run` resolution**, and **never drop a vote silently** (G5): both refuse
 *   before any call.
 * - **The floor is a stored position (G4).** A worker's `floorHopIndex` may only tighten it.
 * - **The cap is routing's (R4).** A worker's `costCapCents` may only lower it.
 */

import type { ProviderConnectionKind } from "../../db/schema";
import type { CostCapSource, Resolution } from "../../routing/resolution";
import {
  INVOKE_ERROR_CODES,
  type InvokeCap,
  type InvokeErrorCode,
  type RunContext,
} from "../invoke.contract";

/** One hop the executor will attempt. */
export interface PlannedHop {
  /** Zero-based, in walk order — the `hop` every event and usage row carries. */
  readonly index: number;
  /** `route_hops.position`, or null for a hop a rule prepended or a single-hop call. */
  readonly position: number | null;
  /** The routing alias, or null when the worker named a connection. */
  readonly alias: string | null;
  /** The model's own id. */
  readonly modelId: string;
  /** The alias's params, merged over the worker's payload. */
  readonly params: Readonly<Record<string, unknown>>;
  /** `provider_connections.id`. */
  readonly connectionId: string;
  /** The connection's kind — what `token_usage.provider` records. */
  readonly kind: ProviderConnectionKind;
}

/** A per-run cap and who set it. */
export interface RunCap {
  readonly source: Exclude<InvokeCap["source"], "provider">;
  readonly limitCents: number;
}

/** What the executor walks. */
export interface InvokePlan {
  readonly hops: readonly PlannedHop[];
  /** True when a failed hop may hand over to the next; false for a single-hop call. */
  readonly chained: boolean;
  /** The effective floor position, or null for none. Decides `floor_exhausted` vs `chain_exhausted`. */
  readonly floorPosition: number | null;
  /** Routing's sentence for the floor, carried into `floor_exhausted` (R3), or null. */
  readonly floorReason: string | null;
  /** The per-run cap, or null for none. */
  readonly cap: RunCap | null;
}

/** A plan that refuses before any call. */
export interface PlanRefusal {
  readonly refused: true;
  readonly code: InvokeErrorCode;
  readonly message: string;
  /** Routing's `failure.code`, for `resolution_failed`. */
  readonly reason?: string;
}

/** A single-hop target: an unrouted alias, or a connection the worker named. */
export interface SingleHopTarget {
  readonly alias: string | null;
  readonly modelId: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly connectionId: string;
  readonly kind: ProviderConnectionKind;
}

/**
 * Is this a refusal rather than a plan?
 *
 * @param value - Either.
 * @returns True for a refusal.
 */
export function isRefusal(value: InvokePlan | PlanRefusal): value is PlanRefusal {
  return "refused" in value;
}

/**
 * The effective per-run cap: routing's, lowered by the worker's when that is tighter.
 *
 * @param routeCents - `resolution.maxCostCents`, or null.
 * @param source - `resolution.costCap`, naming which of route and spend guard set it.
 * @param workerCents - `runCtx.costCapCents`, or undefined.
 * @returns The cap, or null when nothing caps the run.
 */
export function effectiveCap(
  routeCents: number | null,
  source: CostCapSource | undefined,
  workerCents: number | undefined,
): RunCap | null {
  const routed: RunCap | null =
    routeCents === null
      ? null
      : {
          source: source?.limit === "spend_guard" ? "spend_guard" : "route",
          limitCents: routeCents,
        };

  if (workerCents === undefined || (routed !== null && routed.limitCents <= workerCents)) {
    return routed;
  }

  return { source: "worker", limitCents: workerCents };
}

/**
 * The effective floor: routing's, tightened by the worker's.
 *
 * A *lower* position is a tighter floor — fewer hops are allowed above it.
 *
 * @param routed - `resolution.floor.hopIndex` (a stored position), or null.
 * @param worker - `runCtx.floorHopIndex`, or undefined.
 * @returns The floor position, or null for none.
 */
export function effectiveFloor(routed: number | null, worker: number | undefined): number | null {
  if (worker === undefined) {
    return routed;
  }

  return routed === null ? worker : Math.min(routed, worker);
}

/**
 * Plan a walk of a resolution, starting at the requested alias.
 *
 * @param resolution - Z.1's answer for the stage's task kind.
 * @param alias - The alias the worker named.
 * @param runCtx - The worker's run context.
 * @returns The plan; a refusal for `fail_run` or a vote; or null when the alias is not a kept
 *   hop of this resolution, which the caller turns into a single-hop call.
 */
export function chainPlan(
  resolution: Resolution,
  alias: string,
  runCtx: RunContext,
): InvokePlan | PlanRefusal | null {
  if (resolution.outcome === "fail_run") {
    return {
      refused: true,
      code: INVOKE_ERROR_CODES.resolutionFailed,
      message:
        resolution.failure?.explanation ?? "Routing refused this run, so no model was called.",
      reason: resolution.failure?.code,
    };
  }

  if (resolution.votes.length > 0) {
    return {
      refused: true,
      code: INVOKE_ERROR_CODES.voteExecutionUnavailable,
      message:
        "This route asks for a second opinion, and vote execution is not available yet " +
        "(AZ.1, #371). The call was refused rather than run without its vote.",
    };
  }

  const kept = resolution.chain.filter((hop) => hop.decision === "kept" && hop.provider !== null);
  const start = kept.findIndex((hop) => hop.alias === alias);

  if (start === -1) {
    return null;
  }

  const floorPosition = effectiveFloor(resolution.floor.hopIndex, runCtx.floorHopIndex);
  const hops: PlannedHop[] = [];

  for (const hop of kept.slice(start)) {
    // A hop below a floor the worker tightened. Routing already dropped every hop below its
    // own floor; this only ever cuts further, and never reaches a hop routing dropped.
    if (floorPosition !== null && hop.position !== null && hop.position > floorPosition) {
      break;
    }

    // `provider` is non-null by the filter above; the guard is for the compiler.
    if (hop.provider !== null) {
      hops.push({
        index: hops.length,
        position: hop.position,
        alias: hop.alias,
        modelId: hop.modelId,
        params: hop.params,
        connectionId: hop.provider.id,
        kind: hop.provider.kind,
      });
    }
  }

  return {
    hops,
    chained: true,
    floorPosition,
    floorReason: floorPosition === null ? null : resolution.floor.explanation,
    cap: effectiveCap(resolution.maxCostCents, resolution.costCap, runCtx.costCapCents),
  };
}

/**
 * Plan a single-hop call: no chain, no fallback, no floor (`invoke.contract.ts` decision 1).
 *
 * @param target - The alias's binding or the named connection.
 * @param cap - The per-run cap that applies: the spend guard's, lowered by the worker's.
 * @returns The plan.
 */
export function singleHopPlan(target: SingleHopTarget, cap: RunCap | null): InvokePlan {
  return {
    hops: [{ index: 0, position: null, ...target }],
    chained: false,
    floorPosition: null,
    floorReason: null,
    cap,
  };
}
