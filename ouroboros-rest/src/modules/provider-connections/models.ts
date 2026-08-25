/**
 * The discovered catalog, as mockup 07's cards read it — the chips, the pull-list's sizes,
 * and the flag on a model a routing alias still names
 * ([#230](https://github.com/NobuData/ouroboros/issues/230), decision **P6**).
 *
 * Pure. Rows come in from `provider-models.repository.ts` and alias rows from the registry;
 * resources go out. Nothing here reads, and the two decisions worth stating are made here so
 * that neither the repository nor the service has to make them:
 *
 * ---------------------------------------------------------------------------
 * **1. A model discovery no longer lists is deleted, and the *alias* is what is flagged.**
 *
 * V017 calls `provider_models` *discovery's report of what exists*, and three other surfaces
 * read it as exactly that: mockup 21's registry prints it as *listed live from the provider*,
 * Y.1's `provider_model_discovered()` answers an alias validation from it, and CH.4's import
 * wizard offers its rows. A row kept for a model the provider has removed would make all
 * three lie. So the catalog is replaced by what discovery said — and the thing the ticket
 * refuses to lose, *a route that is now broken*, is recovered from the other table: an alias
 * on this connection whose `model_id` the catalog no longer holds is {@link UnlistedModelResource},
 * with the aliases that name it, so the card can draw the flag and link to the alias.
 *
 * **2. A gap is not a mismatch.** A connection nothing has discovered on has an empty
 * catalog, and every alias on it would then read as unlisted — which is V017's own warning
 * about telling the two apart. So {@link unlistedModels} flags nothing until the catalog
 * holds something; a fresh connection's aliases are unverified rather than broken.
 */

import type { ProviderModelRow } from "./provider-models.repository";

/** One alias that names a model on a connection, as far as a flag needs to know it. */
export interface AliasReference {
  /** `model_aliases.id`. */
  readonly id: string;
  /** The alias's name — `local-ds`. */
  readonly alias: string;
}

/**
 * One alias row on a connection, as the registry reads it.
 *
 * Mirrored from `registry/registry.repository.ts`'s `AliasOnConnectionRow` rather than
 * imported, so this file's only import is its sibling repository: the shape is three columns
 * and a duplicated `interface` is cheaper than a dependency on another module's row types.
 */
export interface AliasOnConnection {
  readonly id: string;
  readonly alias: string;
  readonly model_id: string;
}

/** One discovered model, as a chip or a pull-list row reads it. */
export interface ProviderModelResource {
  /** The provider's own identifier — `claude-fable-5`, `qwen3-coder:32b`. */
  readonly modelId: string;
  /** What the chip prints. */
  readonly display: string;
  /**
   * On-disk size in **bytes**, or null for a model that has no such thing.
   *
   * The pull-list's `19 GB` is this, formatted by the card — V017's column comment says the
   * rendering decision is AE.4's, and AE.4 made it in `ouroboros-ui`. A number here because a
   * number is a fact.
   */
  readonly sizeBytes: number | null;
  /** What else discovery reported — `context_tokens`, `tier`. */
  readonly meta: Readonly<Record<string, unknown>>;
  /** When discovery last reported it, ISO 8601. */
  readonly discoveredAt: string;
}

/** A model a routing alias names that the provider no longer lists. */
export interface UnlistedModelResource {
  /** The model's id, as the alias spells it — there is no display, because there is no row. */
  readonly modelId: string;
  /** The aliases that still point at it, ordered by name. Never empty. */
  readonly aliases: readonly AliasReference[];
}

/** One connection's catalog, as the card's models region reads it. */
export interface ProviderModelsResource {
  /** The connection this catalog belongs to. */
  readonly connectionId: string;
  /** When discovery last reported anything on it, ISO 8601, or null when it never has. */
  readonly discoveredAt: string | null;
  /** The models, ordered by id. Empty when discovery has not run or the provider has none. */
  readonly models: readonly ProviderModelResource[];
  /** Aliased models the catalog does not list — see this file's header. */
  readonly unlisted: readonly UnlistedModelResource[];
}

/** What a discovery run answers: the catalog as it now stands, and what changed. */
export interface ProviderDiscoveryResource extends ProviderModelsResource {
  /** Model ids discovery reported that the catalog did not hold, ordered. */
  readonly added: readonly string[];
  /** Model ids the catalog held that discovery no longer reported, ordered. */
  readonly removed: readonly string[];
}

/**
 * One row as a resource.
 *
 * @param row - The row, as the repository selected it.
 * @returns The resource. `size_bytes` arrives as a string — `pg` will not narrow a `bigint` —
 *   and leaves as a number: a 63 GB model is 6.3e10, well inside a double's exact range.
 */
export function providerModelResource(row: ProviderModelRow): ProviderModelResource {
  return {
    modelId: row.model_id,
    display: row.display,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    meta: row.meta,
    discoveredAt: row.discovered_at.toISOString(),
  };
}

/**
 * The aliased models a catalog does not list, grouped by model.
 *
 * @param rows - The catalog, as discovery left it.
 * @param aliases - Every alias on the connection.
 * @returns One entry per unlisted model id, ordered by id, each naming its aliases in name
 *   order. **Empty when the catalog is empty**, whatever the aliases say — see this file's
 *   header on gaps and mismatches.
 */
export function unlistedModels(
  rows: readonly ProviderModelRow[],
  aliases: readonly AliasOnConnection[],
): UnlistedModelResource[] {
  if (rows.length === 0) {
    return [];
  }

  const listed = new Set(rows.map((row) => row.model_id));
  const byModel = new Map<string, AliasReference[]>();

  for (const alias of aliases) {
    if (listed.has(alias.model_id)) {
      continue;
    }

    const references = byModel.get(alias.model_id) ?? [];

    references.push({ id: alias.id, alias: alias.alias });
    byModel.set(alias.model_id, references);
  }

  return [...byModel.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([modelId, references]) => ({
      modelId,
      aliases: [...references].sort((left, right) => left.alias.localeCompare(right.alias)),
    }));
}

/**
 * One connection's catalog as the contract publishes it.
 *
 * @param connectionId - The connection.
 * @param rows - Its catalog rows, in the repository's order.
 * @param aliases - Every alias on it.
 * @returns The resource.
 */
export function providerModelsResource(
  connectionId: string,
  rows: readonly ProviderModelRow[],
  aliases: readonly AliasOnConnection[],
): ProviderModelsResource {
  const latest = rows.reduce<Date | null>(
    (newest, row) =>
      newest === null || row.discovered_at.getTime() > newest.getTime()
        ? row.discovered_at
        : newest,
    null,
  );

  return {
    connectionId,
    discoveredAt: latest === null ? null : latest.toISOString(),
    models: rows.map(providerModelResource),
    unlisted: unlistedModels(rows, aliases),
  };
}

/**
 * What one discovery pass changed.
 *
 * @param before - The model ids the catalog held.
 * @param after - The model ids discovery reported.
 * @returns The ids that appeared and the ids that vanished, each ordered. A model reported
 *   twice counts once; the repository's upsert has the same opinion.
 */
export function discoveryDiff(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const was = new Set(before);
  const now = new Set(after);

  return {
    added: [...now].filter((id) => !was.has(id)).sort((a, b) => a.localeCompare(b)),
    removed: [...was].filter((id) => !now.has(id)).sort((a, b) => a.localeCompare(b)),
  };
}
