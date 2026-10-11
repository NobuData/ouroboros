"use server";

/**
 * The server hops for the roadmap pipeline card (CN.5,
 * [#631](https://github.com/NobuData/ouroboros/issues/631)) — the two writes its Client Component
 * cannot make itself; `app/research/composer-actions.ts` states the rule.
 *
 * - **Apply ⟳** — `POST …/suggestions/{id}/apply`. **A re-run, not a patch**: the service runs
 *   `create-roadmap` again with the suggestion and answers the card on the version that wrote.
 *   The call returns when the skill has answered, which is the progress the card shows.
 * - **Dismiss** — `POST …/suggestions/{id}/dismiss`. The service records who dismissed it in the
 *   audit log; nothing here does.
 *
 * A refusal comes back as a value with the service's own code and sentence
 * (`app/research/brief-actions.ts` § Failure posture). Both answer the whole card, so the caller
 * re-renders from the service's reading rather than from a guess.
 */

import { isApiError } from "@/app/api/errors";
import { type ResearchRoadmap, research } from "@/app/api/research";

import type { PipelineOutcome } from "./pipeline";

/**
 * Run a write, turning the service's refusal into an outcome.
 *
 * @param write The call.
 * @returns The card, or the refusal. Anything that was not an answer from the service is rethrown.
 */
async function outcomeOf(write: () => Promise<ResearchRoadmap>): Promise<PipelineOutcome> {
  try {
    return { ok: true, roadmap: await write() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, refusal: { code: error.code, message: error.message } };
  }
}

/**
 * **Apply ⟳** — re-run `create-roadmap` with a suggestion.
 *
 * @param investigationId The investigation.
 * @param suggestionId The suggestion.
 * @returns The card on its new version, or the service's refusal.
 */
export async function applyRoadmapSuggestion(
  investigationId: string,
  suggestionId: string,
): Promise<PipelineOutcome> {
  return outcomeOf(() => research.applyRoadmapSuggestion(investigationId, suggestionId));
}

/**
 * **Dismiss** a suggestion.
 *
 * @param investigationId The investigation.
 * @param suggestionId The suggestion.
 * @returns The card without it, or the service's refusal.
 */
export async function dismissRoadmapSuggestion(
  investigationId: string,
  suggestionId: string,
): Promise<PipelineOutcome> {
  return outcomeOf(() => research.dismissRoadmapSuggestion(investigationId, suggestionId));
}
