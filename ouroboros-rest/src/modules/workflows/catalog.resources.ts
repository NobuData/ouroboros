/**
 * What the stage catalog looks like on the wire — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * ```
 * StageCatalog          the whole answer: the schema it came from, the node types, the suggestions
 * StageCatalogEntry     one node type: menu label, glyph, class, config schema, defaults
 * StageSuggestions      skill names and task-route names — advice, never an enumeration
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## Suggestions are advisory, and this file is where that is enforced
 *
 * Decision **P7**: a skill, model or task-route reference is a validated *string*. The catalog
 * therefore offers names; it does not constrain the field. A document naming a skill that is
 * not suggested still saves and still publishes — `publish.gate.ts` never considers warnings —
 * and when the inspector asks whether a name is known, {@link toDslCatalogue} turns these
 * suggestions into the catalogue `dsl.references.ts` answers **warnings** from.
 *
 * **Skills are registry truth** (BF.1, [#410](https://github.com/NobuData/ouroboros/issues/410)).
 * The skill suggestions are the workspace's skills registry — every skill that is not a draft and
 * has a published version — so {@link toDslCatalogue} always carries them: an empty registry
 * means no skill exists, and every name a workflow references is then genuinely unknown. That is
 * decision **P7**'s deferred behaviour upgraded; the reference itself stays a validated string.
 *
 * Task routes keep the older rule. An empty list there means *nothing to suggest*, not *nothing
 * exists*, so it is left out of the catalogue and no task route is flagged.
 */

import type { NodeTypeSchema } from "./catalog.schema";
import { deepFreeze, presentationFor, type StagePresentation } from "./catalog.presentation";
import type { DslCatalogue } from "./dsl.references";

/** One node type — an Add-stage menu item, and the form the inspector draws for it. */
export interface StageCatalogEntry extends StagePresentation, NodeTypeSchema {}

/** The names the inspector offers — as suggestions, per decision **P7**. */
export interface StageSuggestions {
  /** Skill slugs from the skills registry (#410) — non-draft skills with a published version. */
  readonly skills: readonly string[];
  /** The workspace's task kinds (`task_kinds`, V016), in the routing matrix's order. */
  readonly taskRoutes: readonly string[];
}

/** `GET /api/v1/workflows/catalog`. */
export interface StageCatalog {
  /** The `$id` of the published schema every `configSchema` was read from. */
  readonly schemaId: string;
  /** Every node type the schema declares, in its order. */
  readonly nodeTypes: readonly StageCatalogEntry[];
  /** What the inspector suggests for skill and task-route fields. */
  readonly suggestions: StageSuggestions;
}

/**
 * The node types, each with its presentation.
 *
 * @param schemas - `nodeTypeSchemas()`' answer.
 * @returns One frozen entry per type, in the same order.
 */
export function stageCatalogEntries(
  schemas: readonly NodeTypeSchema[],
): readonly StageCatalogEntry[] {
  return deepFreeze(schemas.map((schema) => ({ ...presentationFor(schema.type), ...schema })));
}

/**
 * The whole answer.
 *
 * @param schemaId - The published schema's `$id`.
 * @param nodeTypes - {@link stageCatalogEntries}' answer, built once at boot.
 * @param suggestions - This request's suggestions.
 * @returns The catalog. The suggestion lists are copied, so the answer never aliases
 *   configuration or a repository's rows.
 */
export function stageCatalog(
  schemaId: string,
  nodeTypes: readonly StageCatalogEntry[],
  suggestions: StageSuggestions,
): StageCatalog {
  return {
    schemaId,
    nodeTypes,
    suggestions: { skills: [...suggestions.skills], taskRoutes: [...suggestions.taskRoutes] },
  };
}

/**
 * The suggestions, as the catalogue decision **P7**'s warnings are checked against.
 *
 * @param suggestions - The catalog's suggestions.
 * @returns A catalogue carrying the skills always, and the task routes when there are any — see
 *   this file's header. `aliases` is never set: the catalog suggests no alias names, so it has no
 *   opinion about them — the publish gate reads the registry for itself (CH.6, #589).
 */
export function toDslCatalogue(suggestions: StageSuggestions): DslCatalogue {
  return {
    skills: suggestions.skills,
    ...(suggestions.taskRoutes.length > 0 ? { tasks: suggestions.taskRoutes } : {}),
  };
}
