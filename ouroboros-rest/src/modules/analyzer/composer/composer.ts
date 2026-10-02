/**
 * Compose a run's findings into suggestions — pure, deterministic, template by template (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)).
 *
 * The same findings and context always give the same suggestions, so re-analysis over an
 * unchanged corpus re-derives the same identities (V081's `analysis_suggestion_identity()` over
 * the cited findings) and `record_analysis_suggestion()` updates rather than duplicates.
 */

import { TEMPLATES, type SuggestionTemplate } from "./composer.templates";
import type { ComposeContext, ComposedSuggestion, ComposerFinding } from "./composer.types";

/** One template that could not compose, and why. */
export interface CompositionFailure {
  template: string;
  error: unknown;
}

/** What a composition produced. */
export interface Composition {
  suggestions: ComposedSuggestion[];
  /** Templates that threw — isolated, so one broken template never costs the others. */
  failures: CompositionFailure[];
}

/**
 * Run every template over a run's findings.
 *
 * @param findings - The run's findings.
 * @param context - The window, calibration and name lookups.
 * @param templates - The registry; the built-in one unless a test passes its own.
 * @returns The suggestions in template order, and any template that failed.
 */
export function compose(
  findings: readonly ComposerFinding[],
  context: ComposeContext,
  templates: readonly SuggestionTemplate[] = TEMPLATES,
): Composition {
  const suggestions: ComposedSuggestion[] = [];
  const failures: CompositionFailure[] = [];

  for (const template of templates) {
    try {
      suggestions.push(...template.compose(findings, context));
    } catch (error) {
      failures.push({ template: template.id, error });
    }
  }

  return { suggestions, failures };
}
