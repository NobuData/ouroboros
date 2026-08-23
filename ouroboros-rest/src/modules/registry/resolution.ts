/**
 * What an alias resolves to — the shape every consumer of the registry reads, and the shape
 * a credential cannot fit into.
 *
 * Y.1 ([#189](https://github.com/NobuData/ouroboros/issues/189)) lands two tables and the
 * accessors over them. This file is the answer those accessors give: *this alias means this
 * model, on this connection*. Z.2 (#195) serves it to the swap menu, Y.2's routes reach it
 * through their alias foreign key, and AB.1's invocation path is what will eventually take
 * `modelId` and `params` and turn them into a request.
 *
 * ---------------------------------------------------------------------------
 * **There is no credential field here, and that is the design rather than an omission.**
 *
 * `provider_connections.credentials_encrypted` is not in {@link ResolvedConnection}, is not
 * selected by the statements that build one, and has nowhere to go if it were. Decision
 * **P3** (docs/ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md) says a credential never leaves the
 * control plane, and the way this module keeps that is by resolving to an *address and a
 * model* — everything an executor needs to choose a provider, and nothing it needs to
 * authenticate as one. Whatever eventually invokes a cloud provider asks the vault for the
 * plaintext at the moment of the call, and does not receive it through here.
 *
 * `registry.repository.spec.ts` compiles every read statement and asserts none of them names
 * the column; `registry.integration-spec.ts` puts a real ciphertext in the row and looks for
 * it in the answers. Both are probes rather than inspection, which is what the ticket asks
 * for.
 *
 * ---------------------------------------------------------------------------
 * **Names are camelCase here and snake_case in `db/schema.ts`**, which is the boundary this
 * file is: rows are the database's vocabulary, and this is what the rest of the service and
 * the API speak. {@link toResolvedAlias} is the single crossing point, so the mapping is one
 * function rather than an object literal at every call site.
 */

import type { ProviderConnectionKind, ProviderConnectionStatus } from "../db/schema";

/**
 * The connection an alias resolves on, as a consumer sees it.
 *
 * Enough to *reach* a provider and to render mockup 06's `.phealth` pill for it. Not enough
 * to authenticate as one — see this file's header.
 */
export interface ResolvedConnection {
  /** The connection's id, which is what mockup 07's surfaces address it by. */
  readonly id: string;
  /** Which adapter reaches it — the vocabulary AC.1's registry keys on. */
  readonly kind: ProviderConnectionKind;
  /** What the `.phealth` strip prints — `Anthropic`, `Ollama`. */
  readonly displayName: string;
  /**
   * Where it is, or `null` for a kind reached at its vendor's own endpoint.
   *
   * Never `undefined`: *this provider has no configured address* is a fact worth carrying,
   * and a missing key would leave a reader unable to tell it from a field nobody set.
   */
  readonly baseUrl: string | null;
  /**
   * Whether it is usable, as far as anything knows — `unknown` until Z.3 (#196) has looked.
   *
   * Carried on a *resolution* rather than left to a separate health read because the
   * consumers of a resolution are the ones that have to decide whether to use it: a fallback
   * chain skipping a `paused` hop needs the status in the same answer as the model.
   */
  readonly status: ProviderConnectionStatus;
}

/**
 * One alias, resolved.
 *
 * The whole of decision **M1** in one object: the caller asked with a name and got back a
 * `modelId`, which is the only place in the system that string exists.
 */
export interface ResolvedAlias {
  /** The name that was asked for — `coder-max`, `sizer`, `local-docs`. */
  readonly alias: string;
  /** The raw provider model string this alias means. Unfolded, as the vendor spells it. */
  readonly modelId: string;
  /**
   * Per-alias invocation defaults — a thinking budget, a pinned temperature.
   *
   * Always an object, never `undefined`: V015 defaults the column to `{}` and constrains it
   * to an object, so a caller merging it into a request body always has something to merge.
   */
  readonly params: Record<string, unknown>;
  /** Where the model runs. */
  readonly connection: ResolvedConnection;
}

/**
 * One row of the resolution join, exactly as the statements below select it.
 *
 * Declared here rather than in the repository because it is the *input* half of this file's
 * boundary, and a mapper whose input type lives somewhere else is a mapper that can drift
 * from what it maps. The column names are the database's, which is what
 * `db/schema.ts`'s header asks of anything mirroring a row.
 */
export interface AliasResolutionRow {
  alias: string;
  model_id: string;
  params: Record<string, unknown>;
  connection_id: string;
  kind: ProviderConnectionKind;
  display_name: string;
  base_url: string | null;
  status: ProviderConnectionStatus;
}

/**
 * Turn one joined row into the answer a consumer reads.
 *
 * The single crossing point between the database's vocabulary and the service's — see this
 * file's header. It copies fields and nothing else: no defaulting, no coercion, no `?? {}`.
 * V015 makes `params` an object and `status` one of four words at the *column*, so a value
 * arriving here has already been checked by the only thing that can check every writer, and
 * a fallback here would be this file quietly disagreeing with the schema about what is
 * possible.
 *
 * @param row - One row of the resolution join.
 * @returns The resolved alias.
 */
export function toResolvedAlias(row: AliasResolutionRow): ResolvedAlias {
  return {
    alias: row.alias,
    modelId: row.model_id,
    params: row.params,
    connection: {
      id: row.connection_id,
      kind: row.kind,
      displayName: row.display_name,
      baseUrl: row.base_url,
      status: row.status,
    },
  };
}
