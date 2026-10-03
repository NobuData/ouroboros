/**
 * What the suggestion action routes answer (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514)).
 */

import type { ActionBinding } from "../composer/composer.types";
import type { ActionPlan } from "./bindings";
import { planFingerprint } from "./bindings";

/** A consequence preview — what Apply would change, and where. */
export interface SuggestionPreviewResource {
  suggestionId: string;
  plane: ActionBinding["plane"];
  /** Whether Apply can run; when false, `reason` says why and nothing would be written. */
  appliable: boolean;
  /** Whether this suggestion is drafted as a ticket instead (a ticket draft or a spike). */
  draftable: boolean;
  /** The concrete change — runner, pool, window, stage — as one sentence. */
  summary: string;
  /** Where it lands — *Build farm · pool windows*, *Workflow studio · standard-fix draft*. */
  lands: string;
  reason: string | null;
  /** The exact payload Apply hands the plane; null when nothing would be applied. */
  change: unknown;
  /** The studio path a workflow draft opens at — `/workflows/standard-fix`. */
  studioPath: string | null;
  /** Pass back to Apply to insist it executes this preview and nothing else. */
  fingerprint: string;
}

/** A suggestion's resolution. */
export interface SuggestionResolutionResource {
  id: string;
  status: "applied" | "dismissed" | "drafted";
  resolvedAt: string;
  reason: string | null;
}

/** What an apply did. */
export interface AppliedSuggestionResource {
  suggestion: SuggestionResolutionResource;
  preview: SuggestionPreviewResource;
  /** Where the change landed — the window, the hook or the draft, by id. */
  target: { kind: string; id: string } & Record<string, unknown>;
  /** The audit event the apply is recorded as. */
  eventId: string;
  /** BU.3's measurement row, frozen at apply. */
  measurement: {
    id: string;
    targetMetric: string;
    windowDays: number;
    baseline: unknown;
    predicted: unknown;
  };
}

/**
 * The studio path a workflow plan opens at.
 *
 * @param slug - The workflow's slug.
 * @returns `/workflows/<slug>` — the studio opens the one draft slot.
 */
export function studioPath(slug: string): string {
  return `/workflows/${encodeURIComponent(slug)}`;
}

/**
 * @param suggestionId - The suggestion.
 * @param plan - Its plan.
 * @param draftable - Whether it is drafted rather than applied.
 * @returns The preview resource.
 */
export function previewResource(
  suggestionId: string,
  plan: ActionPlan,
  draftable: boolean,
): SuggestionPreviewResource {
  return {
    suggestionId,
    plane: plan.plane,
    appliable: plan.kind !== "unavailable",
    draftable,
    summary: plan.summary,
    lands: plan.lands,
    reason: plan.kind === "unavailable" ? plan.reason : null,
    change: plan.kind === "unavailable" ? null : plan.change,
    studioPath: plan.kind === "workflow_draft" ? studioPath(plan.change.slug) : null,
    fingerprint: planFingerprint(plan),
  };
}
