/**
 * The suggestions' wire shapes (CD.5, [#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * Mockup 20's callouts as data. Two rules:
 *
 *   * **A confidence never travels without its basis** — `confidence` and `confidenceBasis` are
 *     one object's fields, and the copilot's suggestions carry `confidence: null` with a basis
 *     that says they are unscored.
 *   * **Provenance is a field, not a style.** `source` is `rule` or `llm`; a rule's suggestion
 *     names its rule and version, the copilot's names none.
 */

import type {
  DryRunConfidenceBasis,
  DryRunSuggestion,
  DryRunSuggestionSource,
  DryRunSuggestionStatus,
  StoredDraftOperation,
} from "../db/schema";
import { RULE_PACK_VERSION, ruleById } from "./suggestions.rules";

/** One callout. */
export interface DryRunSuggestionResource {
  readonly id: string;
  readonly dryRunId: string;
  /** `rule` — computed by the rule pack; `llm` — proposed by the copilot, validated, unscored. */
  readonly source: DryRunSuggestionSource;
  /** The rule and its version; `null` on a copilot suggestion. */
  readonly ruleId: string | null;
  readonly ruleVersion: number | null;
  readonly title: string;
  readonly body: string;
  /** 0–100, or `null` on a copilot suggestion. */
  readonly confidence: number | null;
  readonly confidenceBasis: DryRunConfidenceBasis;
  /** Whether Apply has anything to do — `false` on an advisory suggestion. */
  readonly applicable: boolean;
  readonly proposedOps: readonly StoredDraftOperation[];
  readonly status: DryRunSuggestionStatus;
  /** The operation batch an Apply produced. */
  readonly appliedOpBatchId: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

/** A dry run's callouts. */
export interface DryRunSuggestionsResource {
  readonly dryRunId: string;
  readonly suggestions: readonly DryRunSuggestionResource[];
}

/** What Apply answers — the suggestion, settled, and the draft it produced. */
export interface DryRunSuggestionAppliedResource {
  readonly suggestion: DryRunSuggestionResource;
  /** The draft's new revision — the `4` of `v0.4`. */
  readonly draftRev: number;
  /** `v0.4`, for the toast. */
  readonly draftLabel: string;
  /** The draft's new etag, for whichever editor is open. */
  readonly etag: string;
}

/** What Explain answers — the derivation, not a restatement. */
export interface DryRunSuggestionExplanationResource {
  readonly suggestionId: string;
  readonly source: DryRunSuggestionSource;
  /** The rule as the pack describes it; `null` on a copilot suggestion. */
  readonly rule: {
    readonly id: string;
    /** The version that made this suggestion. */
    readonly version: number;
    /** The pack this service runs. */
    readonly packVersion: number;
    /** When the rule fires; `null` when this pack no longer holds the rule. */
    readonly firesWhen: string | null;
    readonly proposes: string | null;
    /** How each factor is chosen. */
    readonly scoring: { readonly strength: string; readonly adequacy: string } | null;
  } | null;
  /** What was computed — stage keys, counts, samples. */
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly confidence: number | null;
  /** The scoring method and its inputs. */
  readonly confidenceBasis: DryRunConfidenceBasis;
  readonly proposedOps: readonly StoredDraftOperation[];
}

/**
 * One suggestion, as the card reads it.
 *
 * @param row - The stored suggestion.
 * @returns The resource.
 */
export function dryRunSuggestion(row: DryRunSuggestion): DryRunSuggestionResource {
  return {
    id: row.id,
    dryRunId: row.dry_run_id,
    source: row.source,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    title: row.title,
    body: row.body,
    confidence: row.confidence,
    confidenceBasis: row.confidence_basis,
    applicable: row.proposed_ops.length > 0,
    proposedOps: row.proposed_ops,
    status: row.status,
    appliedOpBatchId: row.applied_op_batch_id,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * A suggestion's derivation.
 *
 * @param row - The stored suggestion.
 * @returns The rule (as this pack describes it), its evidence and its scoring inputs.
 */
export function dryRunSuggestionExplanation(
  row: DryRunSuggestion,
): DryRunSuggestionExplanationResource {
  const rule = row.rule_id === null ? undefined : ruleById(row.rule_id);

  return {
    suggestionId: row.id,
    source: row.source,
    rule:
      row.rule_id === null || row.rule_version === null
        ? null
        : {
            id: row.rule_id,
            version: row.rule_version,
            packVersion: RULE_PACK_VERSION,
            firesWhen: rule?.firesWhen ?? null,
            proposes: rule?.proposes ?? null,
            scoring: rule?.scoring ?? null,
          },
    evidence: row.evidence,
    confidence: row.confidence,
    confidenceBasis: row.confidence_basis,
    proposedOps: row.proposed_ops,
  };
}
