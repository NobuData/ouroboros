/**
 * The statements against `provider_models` — V017's discovered catalog, and the one place it
 * is written ([#230](https://github.com/NobuData/ouroboros/issues/230), decision **P6**).
 *
 * V017's header writes the statement out — `insert … on conflict (provider_connection_id,
 * model_id) do update` — and says why the unique key is a constraint rather than a convention:
 * without it a second discovery pass doubles every chip on the card. {@link replace} is that
 * statement, plus the half V017 leaves to the writer: a model discovery no longer lists is
 * deleted, because this table is *discovery's report of what exists* and three other surfaces
 * read it as exactly that. `models.ts` argues that half and recovers what it costs.
 *
 * **The workspace is in every statement**, as `provider-connections.repository.ts`'s rule
 * has it — here by way of the connection, since this table deliberately carries no
 * `organization_id`. A read joins the connection for its workspace predicate; the write locks
 * the connection row *for this workspace* first, and every statement after it runs inside the
 * same transaction against a connection that lock proved is the caller's. Two discoveries of
 * one connection at once — the page's refresh and the refresh a finished pull triggers — then
 * run one after the other rather than interleaving their deletes.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { NewProviderModel } from "../db/schema";
import type { NormalizedModel } from "../providers/provider.adapter";

/** The columns every read below selects — everything but the surrogate key and the connection. */
export const PROVIDER_MODEL_COLUMNS = [
  "model_id",
  "display",
  "size_bytes",
  "meta",
  "discovered_at",
] as const;

/** One row of the catalog, as this module reads it — {@link PROVIDER_MODEL_COLUMNS}, typed. */
export interface ProviderModelRow {
  model_id: string;
  display: string;
  /** A `bigint`, and therefore a string — `db/schema.ts` says why. Null for a cloud model. */
  size_bytes: string | null;
  meta: Record<string, unknown>;
  discovered_at: Date;
}

/**
 * The key `NormalizedModel.contextLength` is stored under — the one `model_prices.meta` (V012)
 * already uses, so CH.2 merging a price and a discovered model is not made to translate.
 */
export const CONTEXT_TOKENS_KEY = "context_tokens";

/** The key `NormalizedModel.tier` is stored under — what `R__dev_seed_providers.sql` writes. */
export const TIER_KEY = "tier";

/**
 * The row the upsert writes — V017's insert shape, with `meta` as the cast expression `pg` needs.
 *
 * `pg` sends a JavaScript object to a `jsonb` column as `[object Object]`, which the column
 * refuses; `provider-health.repository.ts` and `registry/aliases.repository.ts` both write
 * their documents through the same `::jsonb` cast, and this is that shape with the cast in
 * the type.
 */
export type ProviderModelInsert = Omit<NewProviderModel, "meta"> & {
  readonly meta: RawBuilder<Record<string, unknown>>;
};

/**
 * One discovered model as the row the upsert writes.
 *
 * The four V017 columns from the four `NormalizedModel` fields, by the mapping
 * `provider.adapter.ts` documents beside the type. `size_bytes` is floored at one byte by the
 * adapter contract — V017 refuses a zero — and crosses as a string because the column is a
 * `bigint`. Absent facts are absent keys in `meta`, never nulls: `{"context_tokens": null}`
 * would be a claim about a context length, and P8 says report what was said or say nothing.
 *
 * @param connectionId - The connection the model was discovered on.
 * @param model - What the adapter reported.
 * @param at - When it reported it.
 * @returns The row.
 */
export function rowOf(connectionId: string, model: NormalizedModel, at: Date): ProviderModelInsert {
  return {
    provider_connection_id: connectionId,
    model_id: model.id,
    display: model.display,
    size_bytes: model.sizeBytes === null ? null : model.sizeBytes.toString(),
    meta: sql<Record<string, unknown>>`${JSON.stringify(metaOf(model))}::jsonb`,
    discovered_at: at,
  };
}

/**
 * What else discovery reported, as V017's `meta` document.
 *
 * @param model - What the adapter reported.
 * @returns `{"context_tokens": …}` and `{"tier": …}` where the provider said so, and no key
 *   at all where it did not.
 */
export function metaOf(model: NormalizedModel): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  if (model.contextLength !== null) {
    meta[CONTEXT_TOKENS_KEY] = model.contextLength;
  }

  if (model.tier !== null) {
    meta[TIER_KEY] = model.tier;
  }

  return meta;
}

@Injectable()
export class ProviderModelsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The catalog one connection has, as discovery left it.
   *
   * Ordered by model id, so the chips do not reshuffle between renders — the same reason the
   * health strip orders by name.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection.
   * @returns The rows. Empty when discovery has not run, or the provider listed nothing.
   */
  async forConnection(organizationId: string, connectionId: string): Promise<ProviderModelRow[]> {
    return this.database.db
      .selectFrom("provider_models as m")
      .innerJoin("provider_connections as c", "c.id", "m.provider_connection_id")
      .select(PROVIDER_MODEL_COLUMNS.map((column) => `m.${column}` as const))
      .where("c.organization_id", "=", organizationId)
      .where("m.provider_connection_id", "=", connectionId)
      .orderBy("m.model_id")
      .execute();
  }

  /**
   * Make the catalog say what discovery just reported — V017's upsert, and the delete it implies.
   *
   * One transaction: lock the connection, read what the catalog held, upsert every reported
   * model, delete every row the report did not name. A report of nothing empties the catalog,
   * which is the honest reading of a daemon with no models rather than a case to special-case
   * — and a report that failed never reaches here, so *could not read the list* and *the list
   * is empty* stay the different facts V017 says they are.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection.
   * @param models - What the adapter reported. Ids are the provider's own spellings, unique
   *   within an answer — the adapter contract, and what makes the key an upsert.
   * @param at - When it reported them; stamped on every row the report named.
   * @returns The model ids the catalog held **before** this write, ordered — what a caller
   *   diffs the report against. `undefined` when this workspace has no such connection,
   *   in which case nothing was written.
   */
  async replace(
    organizationId: string,
    connectionId: string,
    models: readonly NormalizedModel[],
    at: Date,
  ): Promise<string[] | undefined> {
    return this.database.transaction(async (trx) => {
      const locked = await trx
        .selectFrom("provider_connections")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("id", "=", connectionId)
        .forUpdate()
        .executeTakeFirst();

      if (locked === undefined) {
        return undefined;
      }

      const held = await trx
        .selectFrom("provider_models")
        .select("model_id")
        .where("provider_connection_id", "=", connectionId)
        .orderBy("model_id")
        .execute();

      const reported = [...new Set(models.map((model) => model.id))];

      if (models.length > 0) {
        await trx
          .insertInto("provider_models")
          .values(models.map((model) => rowOf(connectionId, model, at)))
          .onConflict((conflict) =>
            conflict.columns(["provider_connection_id", "model_id"]).doUpdateSet({
              display: (eb) => eb.ref("excluded.display"),
              size_bytes: (eb) => eb.ref("excluded.size_bytes"),
              meta: (eb) => eb.ref("excluded.meta"),
              discovered_at: (eb) => eb.ref("excluded.discovered_at"),
            }),
          )
          .execute();
      }

      const stale = trx
        .deleteFrom("provider_models")
        .where("provider_connection_id", "=", connectionId);

      await (reported.length === 0 ? stale : stale.where("model_id", "not in", reported)).execute();

      return held.map((row) => row.model_id);
    });
  }
}
