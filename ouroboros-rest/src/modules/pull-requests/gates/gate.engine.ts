/**
 * The gate engine's pure core — overlays, idempotent writes, the aggregate and the PR state it
 * drives.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)).
 *
 * ```
 * definition ──▶ org switched it off?      → not_required "not required by org config"
 *            ──▶ no provider for the key?  → unavailable  "no provider for <key>"
 *            ──▶ provider.evaluate(facts)
 *            ──▶ a gate waiver and red?    → waived       "waived: <reason>"
 *            ──▶ same as the latest row?   → nothing written (idempotent)
 * ```
 *
 * **The aggregate** mirrors V056's `pr_gate_aggregate` — over required definitions only; `green`
 * counts toward x; `green`, `waived` and `not_required` satisfy; `pending`, `unavailable`, `red`
 * and no result do not. The service reads the database's own function; this mirror is what the
 * unit suites and the state rule share with it.
 *
 * **The state** (V052's graph): any red required gate → `blocked`, otherwise `verifying`. Arming
 * is AX.4's act (#360), so a merge-ready revision stays `verifying` and is reported as
 * armed-ready. An `armed` PR stays armed while its gates are only pending — arming *"when all gates
 * go green"* is a promise about gates that have not reported yet — and leaves `armed` only for a
 * red gate, through `verifying` to `blocked`; the merge executor's listener disarms its plan with
 * the reason in the same breath.
 */

import type { PrGateVerdict, PullRequestState } from "../../db/schema";
import { boundEvidence } from "./gate.providers";
import type {
  GateDefinitionSpec,
  GateFacts,
  GateProvider,
  GateResultRow,
  GateWaiver,
  StoredGateDefinition,
} from "./gate.types";

/** The engine's own version, for the verdicts it decides without a provider. */
export const ENGINE_VERSION = "gate-engine@1.0.0";

/**
 * Evaluate one definition.
 *
 * @param definition - The stored definition.
 * @param spec - Its materialized spec, for the org switch — or undefined for a custom gate.
 * @param facts - The revision's facts.
 * @param providers - The registry.
 * @param waivers - Gate-level waivers.
 * @returns The row to write, before the idempotency check.
 */
export function evaluateGate(
  definition: StoredGateDefinition,
  spec: GateDefinitionSpec | undefined,
  facts: GateFacts,
  providers: ReadonlyMap<string, GateProvider>,
  waivers: readonly GateWaiver[],
): GateResultRow {
  const base = {
    definitionId: definition.id,
    gateKey: definition.gateKey,
    required: definition.required,
  };

  if (spec?.disabled === true) {
    return {
      ...base,
      verdict: "not_required",
      evidence: "not required by org config",
      evidenceRef: null,
      providerVersion: ENGINE_VERSION,
    };
  }

  const provider = providers.get(definition.gateKey);

  if (provider === undefined) {
    return {
      ...base,
      verdict: "unavailable",
      evidence: `no provider for ${definition.gateKey}`,
      evidenceRef: null,
      providerVersion: ENGINE_VERSION,
    };
  }

  const outcome = provider.evaluate(facts);
  const waiver = waivers.find((each) => each.gateKey === definition.gateKey);

  if (outcome.verdict === "red" && waiver !== undefined) {
    return {
      ...base,
      verdict: "waived",
      evidence: boundEvidence(`waived: ${waiver.reason} · ${outcome.evidence}`),
      evidenceRef: outcome.evidenceRef,
      providerVersion: provider.version,
    };
  }

  return {
    ...base,
    verdict: outcome.verdict,
    evidence: boundEvidence(outcome.evidence),
    evidenceRef: outcome.evidenceRef,
    providerVersion: provider.version,
  };
}

/** The latest stored result of one gate on one revision — what a new row is compared with. */
export interface LatestResult {
  readonly definitionId: string;
  readonly verdict: PrGateVerdict;
  readonly evidence: string | null;
  readonly evidenceRef: { readonly kind: string; readonly id: string } | null;
  readonly providerVersion: string;
}

/**
 * Whether a row says exactly what the latest stored result says — the idempotency rule.
 *
 * @param row - What the engine decided.
 * @param latest - What is stored, or undefined.
 * @returns `true` when nothing new would be recorded.
 */
export function unchanged(row: GateResultRow, latest: LatestResult | undefined): boolean {
  return (
    latest !== undefined &&
    latest.verdict === row.verdict &&
    latest.evidence === row.evidence &&
    latest.providerVersion === row.providerVersion &&
    latest.evidenceRef?.kind === row.evidenceRef?.kind &&
    latest.evidenceRef?.id === row.evidenceRef?.id
  );
}

/** `pr_gate_aggregate`'s answer. */
export interface GateAggregate {
  readonly requiredCount: number;
  readonly greenCount: number;
  readonly redCount: number;
  readonly satisfiedCount: number;
  readonly mergeReady: boolean;
}

/** The verdicts that satisfy the merge precondition. */
const SATISFYING: ReadonlySet<PrGateVerdict> = new Set(["green", "waived", "not_required"]);

/**
 * V056's aggregate, in TypeScript.
 *
 * @param gates - Every definition's `required` and its latest verdict on the revision, if any.
 * @returns x of y green, the red count, and the merge precondition.
 */
export function aggregate(
  gates: readonly { readonly required: boolean; readonly verdict: PrGateVerdict | undefined }[],
): GateAggregate {
  const required = gates.filter((gate) => gate.required);
  const count = (test: (verdict: PrGateVerdict | undefined) => boolean): number =>
    required.filter((gate) => test(gate.verdict)).length;
  const satisfiedCount = count((verdict) => verdict !== undefined && SATISFYING.has(verdict));

  return {
    requiredCount: required.length,
    greenCount: count((verdict) => verdict === "green"),
    redCount: count((verdict) => verdict === "red"),
    satisfiedCount,
    mergeReady: required.length > 0 && satisfiedCount === required.length,
  };
}

/**
 * The states a PR passes through to reflect an aggregate — each an edge of V052's graph.
 *
 * ```
 * open       → verifying, then blocked when red         (open has no edge to blocked)
 * verifying  → blocked when red
 * blocked    → verifying when no longer red
 * armed      → stays armed until a gate is red; then verifying, then blocked
 * merged, closed → nothing — the host owns those
 * ```
 *
 * @param current - Where the PR stands.
 * @param result - The latest revision's aggregate.
 * @returns The states to write in order; empty when nothing changes.
 */
export function statePath(current: PullRequestState, result: GateAggregate): PullRequestState[] {
  if (current === "merged" || current === "closed") {
    return [];
  }

  const target: PullRequestState = result.redCount > 0 ? "blocked" : "verifying";

  switch (current) {
    case "open":
      return target === "blocked" ? ["verifying", "blocked"] : ["verifying"];
    case "armed":
      return target === "blocked" ? ["verifying", "blocked"] : [];
    default:
      return current === target ? [] : [target];
  }
}
