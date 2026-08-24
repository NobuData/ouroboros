/**
 * The rows the alias lifecycle reads
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)) — the shapes
 * `aliases.repository.ts` selects, in a file of their own so that the pure helpers
 * (`aliases.changes.ts`) and the mappers (`aliases.resources.ts`) can name them without
 * importing the repository, and the repository can name the helpers' `AliasState` without
 * importing them back. `.dependency-cruiser.cjs` refuses the cycle that would otherwise be.
 *
 * The database's column names, per `db/schema.ts`'s rule for anything mirroring a row.
 */

import type { AliasReferenceKind, ProviderConnectionKind } from "../db/schema";

/**
 * One alias, with its connection flattened in.
 *
 * The connection's two columns are null for an unbound alias — a left join, because the
 * unbound row is a row mockup 21 draws and an inner join would make it vanish from the list
 * the moment it lost its key.
 */
export interface AliasRow {
  id: string;
  organization_id: string;
  alias: string;
  provider_connection_id: string | null;
  model_id: string;
  enabled: boolean;
  params: Record<string, unknown>;
  restrictions: Record<string, unknown>;
  notes: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  connection_kind: ProviderConnectionKind | null;
  connection_display_name: string | null;
}

/** One row of `alias_references`, as the lifecycle reads it. */
export interface AliasReferenceRow {
  alias_id: string;
  kind: AliasReferenceKind;
  ref_id: string;
  ref_label: string;
  blocking: boolean;
}

/** A connection, as far as an alias needs to know it. */
export interface AliasConnectionRow {
  id: string;
  kind: ProviderConnectionKind;
  display_name: string;
}

/** One row of `provider_models`, for the inspector's select. */
export interface ModelOptionRow {
  model_id: string;
  display: string;
  discovered_at: Date;
  meta: Record<string, unknown>;
}

/** What discovery has to say about a (connection, model) pair. */
export interface DiscoveryVerdict {
  /** Whether discovery reported this model on this connection. */
  discovered: boolean;
  /** Whether discovery reported *anything* on this connection — a gap and a mismatch are told apart by this. */
  catalogued: boolean;
}
