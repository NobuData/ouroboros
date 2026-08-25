/**
 * The one row shape bulk import adds
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)) — the aliases a connection already
 * has, read so a candidate can be marked *already aliased* and pre-deselected.
 *
 * In a file of its own for `aliases.rows.ts`'s reason: the mapper and the repository both name
 * it, and the mapper importing the repository to do so is the cycle
 * `.dependency-cruiser.cjs` refuses.
 *
 * The database's column names, per `db/schema.ts`'s rule for anything mirroring a row.
 */

/** One alias bound to the connection being imported from, as the candidates read needs it. */
export interface ImportAliasRow {
  /** `model_aliases.id` — what the row links to when it says *already aliased*. */
  id: string;
  /** `model_aliases.alias`. */
  alias: string;
  /** `model_aliases.model_id` — the join key against `provider_models`. */
  model_id: string;
}
