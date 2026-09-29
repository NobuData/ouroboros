/**
 * Rows → step 3's contract: the template tiles and a selection's answer
 * ([#386](https://github.com/NobuData/ouroboros/issues/386), BB.3), exactly as `openapi.yaml`'s
 * `OnboardingTemplateTiles` and `OnboardingTemplateSelection` schemas promise them.
 *
 * Pure functions, so the two honesty rules the ticket makes testable are tested here:
 *
 *   * **The lock is a computation.** A gated tile carries its evaluated state and the progress
 *     pair — `3 of 10 merged loops` — built from the merged-run count and the threshold in
 *     force, never an opaque tag.
 *   * **Captions stay qualitative (decision O8).** V068's CHECK already refuses a digit or a
 *     percent sign in a caption; {@link qualitativeCaption} refuses one again on the way out,
 *     so no statistic reaches a tile even from a row that somehow slipped past the database.
 */

import type { OnboardingResource } from "./resources";
import type { InstantiatedWorkflowRow, TemplateTileRow } from "./templates.repository";

/** The studio's root — the tile grid's `Open Workflow Studio →`. Mirrors the UI's `WORKFLOWS_PATH`. */
export const STUDIO_PATH = "/workflows";

/**
 * What a caption may not contain: a digit or a percent sign — the shape of an invented
 * statistic such as *"92% of teams start here"* (decision O8, V068's
 * `workflow_templates_caption_qualitative`).
 */
export const FABRICATED_STATISTIC = /[0-9%]/;

/** A tier's evaluated gate. */
export interface TemplateUnlockResource {
  /** True while the workspace has fewer merged loops than the threshold. */
  readonly locked: boolean;
  /** The workspace's merged loops, off the runs read-model. */
  readonly mergedLoops: number;
  /** The threshold in force — the operator's override, else the template's own rule. */
  readonly threshold: number;
  /** The tag the tile prints — `unlock after 10 merged loops`. */
  readonly rule: string;
  /** The progress the tile prints — `3 of 10 merged loops`, capped at the threshold. */
  readonly progress: string;
}

/** A workflow instantiated from a template, as a tile or a selection names it. */
export interface InstantiatedWorkflowResource {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** The version in force — `1` straight after instantiation. */
  readonly currentVersion: number | null;
  readonly templateSlug: string;
  readonly templateVersion: number;
  /** Where the studio opens it — `/workflows/quick-fixes`. */
  readonly studioPath: string;
}

/** One tile. */
export interface TemplateTileResource {
  readonly slug: string;
  readonly version: number;
  readonly scope: "global" | "organization";
  readonly name: string;
  readonly description: string;
  readonly stageDots: readonly string[];
  readonly effortRange: readonly string[];
  /** The qualitative footnote, or null. Never a statistic (O8). */
  readonly caption: string | null;
  readonly tier: "starter" | "advanced";
  /** Whether this is the wizard's active choice for the repository. */
  readonly selected: boolean;
  /** Null for a starter tile; the evaluated gate for an advanced one. */
  readonly unlock: TemplateUnlockResource | null;
  /** The newest live workflow instantiated from this template, or null. */
  readonly workflow: InstantiatedWorkflowResource | null;
}

/** `GET /api/v1/onboarding/templates`. */
export interface TemplateTilesResource {
  readonly repo: string;
  /** The wizard's active choice for the repository, or null. */
  readonly selectedTemplate: string | null;
  /** The workspace's merged loops — the number every gate was evaluated against. */
  readonly mergedLoops: number;
  /** The studio's root, for `Open Workflow Studio →`. */
  readonly studioPath: string;
  /** The tiles, in tile order. */
  readonly tiles: readonly TemplateTileResource[];
}

/** `POST /api/v1/onboarding/select-template`. */
export interface TemplateSelectionResource {
  /** False when the template already had a live workflow, which was reused rather than copied. */
  readonly created: boolean;
  /** The workflow now behind the wizard's choice. */
  readonly workflow: InstantiatedWorkflowResource;
  /**
   * Every other live workflow instantiated from a template — left intact by a re-selection,
   * because each is a real workflow of the workspace, not a wizard draft.
   */
  readonly kept: readonly InstantiatedWorkflowResource[];
  /** The wizard after the selection. */
  readonly onboarding: OnboardingResource;
}

/**
 * The studio path of one workflow — the UI's `workflowPath`.
 *
 * @param slug - The workflow's slug.
 * @returns `/workflows/<slug>`.
 */
export function studioPath(slug: string): string {
  return `${STUDIO_PATH}/${encodeURIComponent(slug)}`;
}

/**
 * A caption, or null when it is absent or carries the shape of a statistic (O8).
 *
 * @param caption - The row's caption.
 * @returns The caption to print, or null.
 */
export function qualitativeCaption(caption: string | null): string | null {
  if (caption === null || FABRICATED_STATISTIC.test(caption)) {
    return null;
  }

  return caption;
}

/**
 * A tier's evaluated gate, or null for a tile with nothing to unlock.
 *
 * @param row - The tile, with V068's evaluation.
 * @param mergedLoops - The workspace's merged loops.
 * @returns The gate.
 */
export function unlockResource(
  row: TemplateTileRow,
  mergedLoops: number,
): TemplateUnlockResource | null {
  if (row.threshold === null) {
    return null;
  }

  const { threshold } = row;

  return {
    locked: !row.unlocked,
    mergedLoops,
    threshold,
    rule: `unlock after ${threshold} merged ${loops(threshold)}`,
    progress: `${Math.min(mergedLoops, threshold)} of ${threshold} merged ${loops(threshold)}`,
  };
}

/**
 * One instantiated workflow.
 *
 * @param row - The workflow.
 * @returns The resource.
 */
export function instantiatedWorkflowResource(
  row: InstantiatedWorkflowRow,
): InstantiatedWorkflowResource {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    currentVersion: row.current_version,
    templateSlug: row.template_slug,
    templateVersion: row.template_version,
    studioPath: studioPath(row.slug),
  };
}

/**
 * One tile.
 *
 * @param row - The template, with its gate evaluated.
 * @param context - The count, the active choice and the workflows instantiated so far.
 * @returns The tile.
 */
export function tileResource(
  row: TemplateTileRow,
  context: {
    mergedLoops: number;
    selectedTemplate: string | null;
    workflows: readonly InstantiatedWorkflowRow[];
  },
): TemplateTileResource {
  // Newest first, so the first match is the one a repeat selection reuses.
  const workflow = context.workflows.find((candidate) => candidate.template_slug === row.slug);

  return {
    slug: row.slug,
    version: row.version,
    scope: row.organization_id === null ? "global" : "organization",
    name: row.name,
    description: row.description,
    stageDots: stringArray(row.stage_dots),
    effortRange: [...row.effort_range],
    caption: qualitativeCaption(row.caption),
    tier: row.tier === "advanced" ? "advanced" : "starter",
    selected: context.selectedTemplate === row.slug,
    unlock: unlockResource(row, context.mergedLoops),
    workflow: workflow === undefined ? null : instantiatedWorkflowResource(workflow),
  };
}

/**
 * `loop` or `loops`, by count.
 *
 * @param count - How many.
 * @returns The word.
 */
function loops(count: number): string {
  return count === 1 ? "loop" : "loops";
}

/**
 * `stage_dots` as strings — V068's CHECK guarantees a non-empty array of strings, and anything
 * else reads as no dots rather than a crash.
 *
 * @param value - The jsonb column.
 * @returns The dots.
 */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
