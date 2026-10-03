/**
 * What `GET /api/v1/analyzer/suggestions` answers (BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518))
 * — mockup 18's **Suggested build-process changes** and **Suggested workflow changes** cards, with
 * everything a row's popovers and its Details sheet read.
 *
 * **Nothing is recomputed here.** A suggestion's title, evidence line, confidence and impact are
 * published as the composer stored them (V081: *a historical suggestion reads as it did*), and
 * beside each number is what produced it:
 *
 *   * `confidenceBasis` — V087's formula and every input it read;
 *   * `impact.basis` — the method, the formula's id, its inputs, the corpus window, the calibration
 *     applied and the estimate before it (`estimate = round(raw × factor)`);
 *   * `findings` — the cited findings as their analyzers wrote them, each with its own confidence
 *     basis and its evidence resolved to the surface it opens on.
 *
 * A key an older row does not carry is `null` — never a default that reads as a measurement.
 */

import { NO_REASON } from "../actions/actions.service";
import { studioPath } from "../actions/actions.resources";
import type { ActionPlane } from "../composer/composer.types";
import type { ResolvedEvidence } from "../evidence/evidence.repository";
import { evidenceResource, refsOf, type EvidenceResource } from "../evidence/evidence.resources";
import type { CalibrationRow, MeasurementRow } from "../measurement/measurement.repository";
import {
  calibrationResource,
  type CalibrationResource,
} from "../measurement/measurement.resources";
import { numberOf, objectOf, objectOrNull, textOf } from "../stored.json";
import type {
  CardKind,
  ComposedRun,
  SuggestionFindingRow,
  SuggestionListRow,
} from "./suggestions.repository";

/**
 * The most evidence references one finding answers with. A log signature may cite every build
 * that printed it; the page's poll carries the first of them and says how many there are.
 */
export const EVIDENCE_LIMIT = 25;

/** How a suggestion's confidence was computed (V087). */
export interface SuggestionConfidenceResource {
  /** The formula's id and text — `composer v1: round(100 * (1 - e^(-n/scale)) * …)`. */
  formula: string;
  inputs: {
    /** The template that composed the suggestion, whose constants `scale` and `effectTarget` are. */
    template: string | null;
    /** The smallest sample among the cited findings. */
    n: number | null;
    scale: number | null;
    /** `1 − e^(−n / scale)`. */
    support: number | null;
    /** The smallest stability among the cited findings. */
    stability: number | null;
    /** Null for an absence claim, which has no effect size to weigh. */
    effectSize: number | null;
    effectTarget: number | null;
    /** `min(1, |effectSize| / effectTarget)`; 1 for an absence claim. */
    effect: number | null;
  };
}

/** A suggestion's impact, with its basis. */
export interface SuggestionImpactResource {
  /** Signed, in `unit`; null exactly when the basis is `unquantified`. */
  estimate: number | null;
  unit: string;
  /** What the estimate is per — `per loop`, `queue p95`. */
  appliesTo: string;
  /** The share of builds it applies to, 0–1, when it is not all of them. */
  share: number | null;
  basis: {
    /** `measured`, `extrapolated` or `unquantified`. */
    method: string;
    description: string;
    /** The sample a `measured` basis was measured over. */
    sampleSize: number | null;
    /** The formula's id — `test_gate_split v1: -sum(pr_seconds_per_commit of the gated stages)`. */
    formula: string | null;
    /** Every number the formula read, by name. */
    inputs: Record<string, unknown> | null;
    /** The corpus window the inputs were measured over. */
    window: { from: string; to: string; days: number } | null;
    /** The calibration applied when it was composed. */
    calibration: { analyzer: string; impactClass: string; factor: number } | null;
    /** The estimate before calibration. */
    raw: number | null;
  };
}

/** One finding a suggestion cites. */
export interface SuggestionFindingResource {
  id: string;
  analyzer: string;
  analyzerVersion: number;
  findingType: string;
  subjectKey: string;
  /** The analyzer's typed data, as V081 stores it for this finding type. */
  data: Record<string, unknown>;
  /** The analyzer's own confidence in the finding, 0–100. */
  confidence: number;
  confidenceBasis: {
    method: string | null;
    sampleSize: number | null;
    effectSize: number | null;
    stability: number | null;
  };
  /** The first {@link EVIDENCE_LIMIT} references it cites, in their stored order, resolved. */
  evidence: EvidenceResource[];
  /** How many references it cites in all. */
  evidenceTotal: number;
}

/** One suggestion — a row of a card. */
export interface SuggestionResource {
  id: string;
  kind: CardKind;
  title: string;
  evidenceLine: string;
  /** 0–100. */
  confidence: number;
  /** Null on a suggestion composed before V087 stored it. */
  confidenceBasis: SuggestionConfidenceResource | null;
  impact: SuggestionImpactResource | null;
  /** Whether it is drafted as an investigation rather than applied. */
  needsSpike: boolean;
  /** The plane its change belongs to. */
  plane: ActionPlane;
  /**
   * For a `workflow` binding whose workflow the workspace still has: the workflow, the version a
   * draft becomes when a person publishes it, and where the studio opens it.
   */
  workflow: { slug: string; nextVersion: number; studioPath: string } | null;
  status: "open" | "applied" | "dismissed" | "drafted";
  /** Null while open. */
  resolution: {
    at: string;
    /** Who, by display name; null once that person is removed. */
    by: string | null;
    /** A dismissal's reason; null when none was given. */
    reason: string | null;
    /** The planning batch a spike was drafted into. */
    draftBatchId: string | null;
  } | null;
  /** The measurement an apply opened — day N of its window, and the verdict once it closes. */
  measurement: {
    id: string;
    appliedOn: string;
    day: number;
    windowDays: number;
    windowEndsOn: string;
    verdict: string;
  } | null;
  /** The findings it cites, from the analysis that last composed it. */
  findings: SuggestionFindingResource[];
}

/** The read: the current suggestions, and the calibration their impacts were scaled by. */
export interface SuggestionsResource {
  repo: string;
  /** The newest analysis that composed a suggestion; null before any has. */
  runId: string | null;
  /** When that analysis ended. */
  analyzedAt: string | null;
  /** Most confident first. */
  suggestions: SuggestionResource[];
  /** The repository's calibration cells with their history — the Details sheet's. */
  calibration: CalibrationResource[];
}

/**
 * A stored confidence basis, renamed.
 *
 * @param value - `analysis_suggestions.confidence_basis`.
 * @returns The resource, or null for a row composed before V087.
 */
export function confidenceResource(value: unknown): SuggestionConfidenceResource | null {
  const basis = objectOrNull(value);
  if (basis === null) {
    return null;
  }
  const inputs = objectOf(basis.inputs);

  return {
    formula: textOf(basis.formula) ?? "",
    inputs: {
      template: textOf(inputs.template),
      n: numberOf(inputs.n),
      scale: numberOf(inputs.scale),
      support: numberOf(inputs.support),
      stability: numberOf(inputs.stability),
      effectSize: numberOf(inputs.effect_size),
      effectTarget: numberOf(inputs.effect_target),
      effect: numberOf(inputs.effect),
    },
  };
}

/**
 * A stored impact, renamed.
 *
 * @param value - `analysis_suggestions.impact`.
 * @returns The resource, or null when the suggestion carries none.
 */
export function impactResource(value: unknown): SuggestionImpactResource | null {
  const impact = objectOrNull(value);
  if (impact === null) {
    return null;
  }
  const basis = objectOf(impact.basis);
  const window = objectOrNull(basis.window);
  const calibration = objectOrNull(basis.calibration);
  const from = textOf(window?.from);
  const to = textOf(window?.to);
  const days = numberOf(window?.days);
  const analyzer = textOf(calibration?.analyzer);
  const impactClass = textOf(calibration?.impact_class);
  const factor = numberOf(calibration?.factor);

  return {
    estimate: numberOf(impact.estimate),
    unit: textOf(impact.unit) ?? "",
    appliesTo: textOf(impact.applies_to) ?? "",
    share: numberOf(impact.share),
    basis: {
      method: textOf(basis.method) ?? "",
      description: textOf(basis.description) ?? "",
      sampleSize: numberOf(basis.sample_size),
      formula: textOf(basis.formula),
      inputs: objectOrNull(basis.inputs),
      window: from === null || to === null || days === null ? null : { from, to, days },
      calibration:
        analyzer === null || impactClass === null || factor === null
          ? null
          : { analyzer, impactClass, factor },
      raw: numberOf(basis.raw),
    },
  };
}

/**
 * The references one finding answers with — the first {@link EVIDENCE_LIMIT}, in stored order.
 *
 * @param finding - The finding.
 * @returns The references this read resolves.
 */
export function answeredRefs(
  finding: Pick<SuggestionFindingRow, "evidence_refs">,
): { kind: string; id: string }[] {
  return refsOf(finding).slice(0, EVIDENCE_LIMIT);
}

/**
 * One cited finding, as the Details sheet reads it.
 *
 * @param finding - The stored finding.
 * @param resolved - What the references name.
 * @returns The resource.
 */
export function findingResource(
  finding: SuggestionFindingRow,
  resolved: ResolvedEvidence,
): SuggestionFindingResource {
  const basis = objectOf(finding.confidence_basis);

  return {
    id: finding.id,
    analyzer: finding.analyzer,
    analyzerVersion: finding.analyzer_version,
    findingType: finding.finding_type,
    subjectKey: finding.subject_key,
    data: objectOf(finding.data),
    confidence: finding.confidence,
    confidenceBasis: {
      method: textOf(basis.method),
      sampleSize: numberOf(basis.sample_size),
      effectSize: numberOf(basis.effect_size),
      stability: numberOf(basis.stability),
    },
    evidence: answeredRefs(finding).map((ref) => evidenceResource(ref, resolved)),
    evidenceTotal: refsOf(finding).length,
  };
}

/**
 * One suggestion, as a card's row reads it.
 *
 * @param row - The stored suggestion.
 * @param findings - The findings it cites.
 * @param measurement - The measurement its apply opened, if it was applied.
 * @param resolved - What the findings' references name.
 * @returns The resource.
 */
export function suggestionResource(
  row: SuggestionListRow,
  findings: readonly SuggestionFindingRow[],
  measurement: MeasurementRow | undefined,
  resolved: ResolvedEvidence,
): SuggestionResource {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    evidenceLine: row.evidence_line,
    confidence: row.confidence,
    confidenceBasis: confidenceResource(row.confidence_basis),
    impact: impactResource(row.impact),
    needsSpike: row.needs_spike,
    plane: row.action_binding.plane,
    workflow:
      row.workflow_slug === null
        ? null
        : {
            slug: row.workflow_slug,
            nextVersion: (row.workflow_version ?? 0) + 1,
            studioPath: studioPath(row.workflow_slug),
          },
    status: row.status,
    resolution:
      row.resolved_at === null
        ? null
        : {
            at: row.resolved_at.toISOString(),
            by: row.resolved_by_name,
            reason: row.resolution_reason === NO_REASON ? null : row.resolution_reason,
            draftBatchId: row.draft_batch_id,
          },
    measurement:
      measurement === undefined
        ? null
        : {
            id: measurement.id,
            appliedOn: measurement.applied_on,
            day: measurement.day,
            windowDays: measurement.window_days,
            windowEndsOn: measurement.window_ends_on,
            verdict: measurement.verdict,
          },
    findings: findings.map((finding) => findingResource(finding, resolved)),
  };
}

/**
 * What a repository answers before any analysis has composed a suggestion.
 *
 * @param repo - The repository.
 * @returns No run, no suggestions.
 */
export function emptySuggestions(repo: string): SuggestionsResource {
  return { repo, runId: null, analyzedAt: null, suggestions: [], calibration: [] };
}

/**
 * The read, composed.
 *
 * @param repo - The repository.
 * @param run - The newest analysis that composed a suggestion.
 * @param rows - The current suggestions, most confident first.
 * @param findings - The findings they cite.
 * @param measurements - The repository's measurements.
 * @param calibration - The repository's calibration cells.
 * @param resolved - What the findings' references name.
 * @returns The resource.
 */
export function suggestionsResource(
  repo: string,
  run: ComposedRun,
  rows: readonly SuggestionListRow[],
  findings: readonly SuggestionFindingRow[],
  measurements: readonly MeasurementRow[],
  calibration: readonly CalibrationRow[],
  resolved: ResolvedEvidence,
): SuggestionsResource {
  return {
    repo,
    runId: run.id,
    analyzedAt: run.finished_at === null ? null : run.finished_at.toISOString(),
    suggestions: rows.map((row) =>
      suggestionResource(
        row,
        findings.filter((finding) => finding.suggestion_id === row.id),
        measurements.find((measurement) => measurement.suggestion_id === row.id),
        resolved,
      ),
    ),
    calibration: calibration.map(calibrationResource),
  };
}
