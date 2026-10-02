/**
 * The shapes the suggestion composer reads and writes (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)).
 *
 * A {@link ComposerFinding} is one stored `analysis_findings` row (V081) as the composer reads it;
 * a {@link ComposedSuggestion} is one `analysis_suggestions` row as `record_analysis_suggestion()`
 * (V087) writes it. Everything in between is `composer.templates.ts`.
 */

/** A finding's confidence basis, as the analyzer stored it (V081). */
export interface FindingConfidenceBasis {
  method: string;
  sample_size: number;
  effect_size: number;
  stability: number;
}

/** One stored finding, as the composer reads it. */
export interface ComposerFinding {
  id: string;
  analyzer: string;
  analyzerVersion: number;
  findingType: string;
  subjectKey: string;
  identityKey: string;
  /** The analyzer's typed data — read only through `composer.slots.ts`. */
  data: Readonly<Record<string, unknown>>;
  confidence: number;
  confidenceBasis: FindingConfidenceBasis;
}

/** The corpus window the run read — UTC days, inclusive. */
export interface ComposeWindow {
  from: string;
  to: string;
  days: number;
}

/** What a composition may look up besides the findings themselves. */
export interface ComposeContext {
  /** The run's corpus window. */
  window: ComposeWindow;
  /**
   * BU.3's calibration factor for one analyzer's impact class in this repository (V085) — 1 when
   * no row exists.
   */
  factor: (analyzer: string, impactClass: string) => number;
  /** A runner pool's name by id, or `undefined` when the workspace has no such pool. */
  poolName: (id: string) => string | undefined;
  /** A runner's name by id, or `undefined` when the workspace has no such runner. */
  runnerName: (id: string) => string | undefined;
}

/** The suggestion kinds V081 knows. */
export type SuggestionKind = "build_process" | "workflow" | "ticket_draft";

/** The planes an action binding may name (V081). */
export type ActionPlane = "farm_config" | "job_hook" | "workflow" | "test_gate" | "planning";

/** `{plane, change}` — what Apply composes (decision A4). */
export interface ActionBinding {
  plane: ActionPlane;
  change: Record<string, unknown>;
}

/** How an impact was arrived at — V081's `basis`, plus the inputs that reconstruct it. */
export interface ImpactBasis {
  method: "measured" | "extrapolated" | "unquantified";
  description: string;
  /** For a measured basis: the sample it was measured over. */
  sample_size?: number;
  /** The formula's id — `composer.templates.ts` names each one. */
  formula: string;
  /** Every number the formula read, by name. */
  inputs: Record<string, unknown>;
  /** The corpus window the inputs were measured over. */
  window: ComposeWindow;
  /** The calibration applied (BU.3): which model, which impact class, which factor. */
  calibration: { analyzer: string; impact_class: string; factor: number };
  /** The estimate before calibration — `estimate = round(raw × factor)`. */
  raw: number | null;
}

/** A suggestion's impact (V081's `analysis_impact_valid`). */
export interface Impact {
  /** Null exactly when the basis is unquantified. */
  estimate: number | null;
  unit: "seconds" | "interventions" | "count";
  applies_to: string;
  share?: number;
  basis: ImpactBasis;
}

/** How the composer's confidence was computed — stored as `confidence_basis` (V087). */
export interface SuggestionConfidenceBasis {
  formula: string;
  inputs: {
    template: string;
    n: number;
    scale: number;
    support: number;
    stability: number;
    effect_size: number | null;
    effect_target: number | null;
    effect: number;
  };
  value: number;
}

/** One composed suggestion, ready for `record_analysis_suggestion()`. */
export interface ComposedSuggestion {
  /** The template that composed it. */
  template: string;
  kind: SuggestionKind;
  /** The findings it cites — all of them, so a composite links every one. */
  findingIds: string[];
  title: string;
  evidenceLine: string;
  confidence: number;
  confidenceBasis: SuggestionConfidenceBasis;
  /** Null only for a ticket draft. */
  impact: Impact | null;
  needsSpike: boolean;
  actionBinding: ActionBinding;
}
