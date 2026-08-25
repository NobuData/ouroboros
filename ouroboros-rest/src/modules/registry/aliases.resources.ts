/**
 * Row → resource, for the alias lifecycle
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)) — the same seam
 * `provider-connections/resources.ts` keeps, for the same two reasons.
 *
 * The rows are the database's (snake_case, `Date`s, a joined connection flattened into two
 * columns); the resources are the contract's (camelCase, ISO 8601, and exactly what
 * `openapi.yaml` promises). Two decisions are made here rather than at every call site:
 *
 * **1. `Used by` is a list, not a number.** Mockup 21's table prints `4 routes` and its
 * inspector prints four chips, and both are the same rows of CG.3's `alias_references`
 * (decision **R5**). The resource carries the rows and a client counts them, so the column
 * and the chips cannot disagree — and so a `409` on delete, which names the same rows, is the
 * list the client already had.
 *
 * **2. A write answers with what it did, not only with what is now stored.** The ticket asks
 * that a rebind *"state what the next resolution will do"* and that disabling a referenced
 * alias *"return the referrer list so the UI can warn about the dropped hops"*. Both are facts
 * about the transition, gone once the row is re-read, so {@link AliasChangeResource} carries
 * them beside the alias: `nextResolution`, `droppedHops`, and the `warnings` — the AC.6
 * discovery warning surfaced rather than swallowed, and the *Fix in Providers →* pointer for
 * an unbound alias.
 */

import type { AliasReferenceKind, ProviderConnectionKind } from "../db/schema";
import type { AliasReferenceRow, AliasRow, ModelOptionRow } from "./aliases.rows";

/** Where an alias resolves — the connection half of a binding, as the table's monogram needs it. */
export interface AliasConnectionResource {
  /** `provider_connections.id`. */
  readonly id: string;
  /** Which adapter reaches it — the table's `AN`, `GH`, `CU`, `OL`, `VL` monogram is derived from this. */
  readonly kind: ProviderConnectionKind;
  /** What mockup 07's card calls it. */
  readonly displayName: string;
}

/** One reference to an alias — one `Used by` chip, one line of a `409`. */
export interface AliasReferenceResource {
  /** Which storage shape it lives in. */
  readonly kind: AliasReferenceKind;
  /** The referring row, stable enough to link to. */
  readonly refId: string;
  /** Mockup 21's chip, verbatim — `implement-primary`, `escalation:effort≥L`. */
  readonly label: string;
  /** Whether it refuses a delete rather than warns about one. True for every live kind today. */
  readonly blocking: boolean;
}

/** One row of mockup 21's allowed-models table, and the inspector's whole state. */
export interface ModelAliasResource {
  /** `model_aliases.id` — what every write addresses. */
  readonly id: string;
  /** The name routes use. */
  readonly alias: string;
  /** The **On** switch. Always false for an unbound alias. */
  readonly enabled: boolean;
  /** Where it resolves, or null for the unbound state — mockup 21's `✗ no key` row. */
  readonly connection: AliasConnectionResource | null;
  /** The raw model id. */
  readonly modelId: string;
  /** Per-alias invocation defaults — what CH.2 derives the chips from. */
  readonly params: Record<string, unknown>;
  /** Registry policy flags. */
  readonly restrictions: Record<string, unknown>;
  /** An operator's note, or null. */
  readonly notes: string | null;
  /** Everything that references the alias — the `Used by` column is this list's length. */
  readonly references: readonly AliasReferenceResource[];
  /** Who last wrote it, or null for a seed or an import. */
  readonly updatedBy: string | null;
  /** ISO 8601. */
  readonly createdAt: string;
  /** ISO 8601 — moved by every write. */
  readonly updatedAt: string;
}

/** The list. Unpaged, for the routing list's reason: a registry is a handful of names. */
export interface ModelAliasListResource {
  /** Every alias in the workspace, ordered by name, unbound ones included. */
  readonly aliases: readonly ModelAliasResource[];
}

/** The codes a write can warn with — a warning is not a refusal; the write happened. */
export const ALIAS_WARNINGS = {
  /** The alias has no connection: it is stored disabled and nothing routes through it. */
  unbound: "alias_unbound",
  /** Discovery (AC.6) has not reported the model on the connection — V017's soft warning, surfaced. */
  modelNotDiscovered: "model_not_discovered",
} as const;

/** One of {@link ALIAS_WARNINGS}. */
export type AliasWarningCode = (typeof ALIAS_WARNINGS)[keyof typeof ALIAS_WARNINGS];

/** Something a write wants the client to know, beside the alias it stored. */
export interface AliasWarningResource {
  /** Stable; what a client branches on. */
  readonly code: AliasWarningCode;
  /** For a person. */
  readonly message: string;
  /** Where to go to resolve it, or null when it is only information. */
  readonly fix: string | null;
}

/** What the next resolution through the alias will reach, after a rebind. */
export interface AliasResolutionPreviewResource {
  /** The connection it will run on, or null when the alias was unbound. */
  readonly connection: AliasConnectionResource | null;
  /** The model it will name. */
  readonly modelId: string;
}

/** What a write answers with: the alias as stored, and what the write did. */
export interface AliasChangeResource {
  /** The alias, re-read after the commit rather than echoed from the body. */
  readonly alias: ModelAliasResource;
  /**
   * The `alias_revisions` row this write left, or **null** when it changed nothing.
   *
   * Null is not a failure: it is a `PATCH` whose every field already held that value. V025
   * refuses an empty diff, so there is no row to name.
   */
  readonly revisionId: string | null;
  /** What the client should know. Empty is the ordinary case. */
  readonly warnings: readonly AliasWarningResource[];
  /**
   * Where the next resolution goes, present when the write **rebound** the alias and null
   * otherwise — the BYOK story, stated: the references stood still and this moved.
   */
  readonly nextResolution: AliasResolutionPreviewResource | null;
  /**
   * The references whose hops the next resolution will **drop**, present when the write
   * switched a referenced alias off and empty otherwise (#589's dropped-hop semantics).
   */
  readonly droppedHops: readonly AliasReferenceResource[];
}

/** One model a connection has, as discovery reported it — an entry of the inspector's model select. */
export interface ModelOptionResource {
  /** The provider's own identifier — what an alias's `modelId` would be set to. */
  readonly modelId: string;
  /** What the select prints. */
  readonly display: string;
  /** When discovery last reported it, ISO 8601. */
  readonly discoveredAt: string;
  /** What else discovery reported — `context_tokens`, `tier`. */
  readonly meta: Record<string, unknown>;
}

/** The inspector's model select — *listed live from the provider*. */
export interface ModelOptionListResource {
  /** The connection the models belong to. */
  readonly connection: AliasConnectionResource;
  /** Its models, ordered by id. Empty when discovery has not run — an honest empty select. */
  readonly models: readonly ModelOptionResource[];
}

/**
 * One row as the contract publishes it.
 *
 * @param row - The row, with its connection flattened in by the repository's left join.
 * @param references - The rows of `alias_references` for this alias.
 * @returns The resource.
 */
export function toAliasResource(
  row: AliasRow,
  references: readonly AliasReferenceRow[],
): ModelAliasResource {
  return {
    id: row.id,
    alias: row.alias,
    enabled: row.enabled,
    connection: connectionOf(row),
    modelId: row.model_id,
    params: row.params,
    restrictions: row.restrictions,
    notes: row.notes,
    references: references.map(toReferenceResource),
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Reference rows, keyed by the alias they belong to.
 *
 * The one read of `alias_references` a list makes covers every alias in it — the view is read
 * once with an `in` list, never once per row — and this is what turns that answer back into
 * per-alias arrays. Shared by CH.1's list and CH.4's import
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)) rather than written twice, because
 * two groupings of one query are two chances for a `Used by` column to disagree with itself.
 *
 * @param references - The rows, in the order the repository answered them — routes before
 *   rules, each by label, which is the order the chips are drawn in and which this preserves.
 * @returns Alias id to its references. An alias with none is **absent**, so a caller supplies
 *   the empty array itself rather than relying on a map to invent one.
 */
export function referencesByAlias(
  references: readonly AliasReferenceRow[],
): Map<string, AliasReferenceRow[]> {
  const byAlias = new Map<string, AliasReferenceRow[]>();

  for (const reference of references) {
    const held = byAlias.get(reference.alias_id) ?? [];

    held.push(reference);
    byAlias.set(reference.alias_id, held);
  }

  return byAlias;
}

/**
 * One reference as the contract publishes it.
 *
 * @param row - A row of `alias_references`.
 * @returns The resource.
 */
export function toReferenceResource(row: AliasReferenceRow): AliasReferenceResource {
  return {
    kind: row.kind,
    refId: row.ref_id,
    label: row.ref_label,
    blocking: row.blocking,
  };
}

/**
 * One discovered model as the contract publishes it.
 *
 * @param row - A row of `provider_models`.
 * @returns The resource.
 */
export function toModelOptionResource(row: ModelOptionRow): ModelOptionResource {
  return {
    modelId: row.model_id,
    display: row.display,
    discoveredAt: row.discovered_at.toISOString(),
    meta: row.meta,
  };
}

/**
 * The connection half of a row, or null for an unbound alias.
 *
 * @param row - The row.
 * @returns The connection resource, or null.
 */
export function connectionOf(row: AliasRow): AliasConnectionResource | null {
  if (
    row.provider_connection_id === null ||
    row.connection_kind === null ||
    row.connection_display_name === null
  ) {
    return null;
  }

  return {
    id: row.provider_connection_id,
    kind: row.connection_kind,
    displayName: row.connection_display_name,
  };
}
