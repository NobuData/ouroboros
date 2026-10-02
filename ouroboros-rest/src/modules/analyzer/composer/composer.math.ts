/**
 * The composer's arithmetic — rounding, confidence and calibrated impact (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)).
 *
 * **Confidence is a formula, not a feeling.** One composition, documented here and stored with
 * every input it read, so the scoring popover — or a person with a calculator — can redo it:
 *
 * ```
 * confidence = round(100 × support × stability × effect)
 *   support   = 1 − e^(−n / scale)        n = the smallest sample among the cited findings
 *   stability = the smallest stability among the cited findings
 *   effect    = min(1, |effect size| / target)   — 1 for an absence claim (no target)
 * ```
 *
 * `scale` and `target` are each template's documented constants (`composer.templates.ts`): how
 * much evidence that kind of suggestion needs before it is sure, and how large an effect counts as
 * decisive. The inputs are the cited findings' own `confidence_basis` (V081) — never the
 * findings' confidence numbers, which are the analyzers' answers, not the composer's.
 *
 * **Impact is measured × calibrated.** A template's formula gives a raw estimate from the
 * finding's measured fields; BU.3's calibration factor for that analyzer and impact class
 * (V085) scales it; the result is rounded to a whole unit. All three are stored in the basis.
 */

import type { ComposerFinding, SuggestionConfidenceBasis } from "./composer.types";

/** The formula id stored with every composed confidence. */
export const CONFIDENCE_FORMULA =
  "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))";

/**
 * Round half away from zero — the engine's and the database's rule — immune to binary noise
 * (`0.072 × 100` is `7.199999…`).
 *
 * @param value - The number.
 * @param places - Decimal places to keep.
 * @returns The rounded number, with `-0` folded to `0`.
 */
export function roundHalf(value: number, places = 0): number {
  const scale = 10 ** places;
  const magnitude = Math.round(Math.abs(value) * scale + 1e-9) / scale;
  const rounded = Math.sign(value) * magnitude;
  return rounded === 0 ? 0 : rounded;
}

/**
 * A fraction as a whole percentage — `0.78` → `78`.
 *
 * @param fraction - A number in [0, 1].
 * @param places - Decimal places to keep (`0.072` → `7.2` at one place).
 * @returns The percentage.
 */
export function percent(fraction: number, places = 0): number {
  return roundHalf(fraction * 100, places);
}

/** A template's confidence constants. */
export interface ConfidenceShape {
  /** The sample at which support reaches 1 − 1/e. */
  scale: number;
  /** The effect size that counts as decisive, or null for an absence claim. */
  effectTarget: number | null;
}

/**
 * Compute a suggestion's confidence from the findings it cites.
 *
 * @param template - The template's id, stored in the basis.
 * @param shape - The template's constants.
 * @param findings - The cited findings (at least one).
 * @returns The confidence basis; its `value` is the confidence.
 */
export function confidenceOf(
  template: string,
  shape: ConfidenceShape,
  findings: readonly ComposerFinding[],
): SuggestionConfidenceBasis {
  const bases = findings.map((finding) => finding.confidenceBasis);
  const n = Math.min(...bases.map((basis) => basis.sample_size));
  const stability = Math.min(...bases.map((basis) => basis.stability));
  const effectSize = Math.min(...bases.map((basis) => Math.abs(basis.effect_size)));
  const support = 1 - Math.exp(-n / shape.scale);
  const effect = shape.effectTarget === null ? 1 : Math.min(1, effectSize / shape.effectTarget);

  return {
    formula: CONFIDENCE_FORMULA,
    inputs: {
      template,
      n,
      scale: shape.scale,
      support,
      stability,
      effect_size: shape.effectTarget === null ? null : effectSize,
      effect_target: shape.effectTarget,
      effect,
    },
    value: roundHalf(100 * support * stability * effect),
  };
}

/**
 * Apply a calibration factor to a raw estimate and round it to a whole unit.
 *
 * @param raw - The uncalibrated estimate.
 * @param factor - BU.3's factor (1 when the model has no history).
 * @returns `round(raw × factor)`.
 */
export function calibrated(raw: number, factor: number): number {
  return roundHalf(raw * factor);
}
