/**
 * Every statement this module issues — eight of them, all reads, all scoped to one workspace.
 *
 * Three are V015's routing foundation. The three CH.2
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)) added are what a param schema is
 * built from: a connection's kind, so the right adapter is asked; V017's `provider_models`
 * for what the provider reported about the model; and V012's `model_price()` for what the
 * bundled catalog knows about it. The last two are CH.4's
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)) batched twins of those last two —
 * the same joins and the same function, asked once about a whole connection's worth of models
 * rather than once per model, because the import wizard's list is where an N+1 would show.
 *
 * ## Resolution is one query, and the indexes it uses exist for other reasons
 *
 * *Alias → provider + model* is the hot read: every route hop, every simulation and every
 * swap menu goes through it. {@link RegistryRepository.resolveAlias} is one statement with
 * one join, and it is two index lookups and no scan — `model_aliases_organization_alias_key`
 * finds the alias and `provider_connections_organization_id_key` finds its connection. Both
 * of those indexes exist because a *rule* needed them (uniqueness per workspace, and the
 * composite foreign key's target), which is the arrangement worth having: the fast path is
 * the one the constraints already paid for. `ouroboros-db/tests/constraints.sql` asserts the
 * plan under `EXPLAIN`, which is where an assertion about a plan belongs.
 *
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` first and every statement carries it — the same rule
 * `dashboard.repository.ts` and `pricing.repository.ts` state, and sharper here for the
 * reason V015 makes the alias's foreign key composite: an alias resolved out of the wrong
 * workspace resolves onto *that* workspace's provider, and therefore onto its credential.
 * The value comes from the tenant context, never from anything a caller wrote.
 *
 * The join is written `c.organization_id = a.organization_id` rather than on the connection
 * id alone. Given the composite foreign key the two are equivalent, and writing it out is
 * what makes the workspace predicate visible in the statement instead of being a consequence
 * of a constraint the reader has to go and look up.
 *
 * ## Nothing here selects the credential
 *
 * `credentials_encrypted` appears in exactly one file in this module — `registry.secrets.ts`,
 * the vault's re-encryption store, which has to read a ciphertext to re-seal it — and in no
 * statement below. `registry.repository.spec.ts` compiles every one of these and asserts the
 * SQL does not name the column, which makes it a property of the statements rather than of
 * anybody's care.
 *
 * ## There are no writes
 *
 * Decision **M2**: creating, editing and deleting connections and aliases is mockup 07's and
 * mockup 21's surface. This module reads. The one statement in it that writes lives in the
 * re-encryption store and rewrites a value the row already held.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME, type ProviderConnectionKind } from "../db/schema";
import type { AliasResolutionRow } from "./resolution";

/** One alias on a connection, as far as a card's flag needs to know it. */
export interface AliasOnConnectionRow {
  /** `model_aliases.id`. */
  id: string;
  /** The alias's name. */
  alias: string;
  /** The model it names, in the provider's own spelling. */
  model_id: string;
}

@Injectable()
export class RegistryRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * What one alias resolves to in this workspace.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param alias - The name to resolve, as the caller supplied it. Not folded here: V015
   *   stores aliases lower-case and constrains them to that shape, so a caller that sent
   *   `Coder-Max` asked for something this workspace does not have — and answering it with
   *   `coder-max`'s model would be this layer guessing at what somebody meant.
   * @returns The joined row, or `undefined` when there is no such alias. Absence is the
   *   ordinary answer for a name a caller supplied, not an exceptional one; turning it into
   *   a 404 is {@link RegistryService}'s job, one layer up, where the alias is known to have
   *   come from a request.
   */
  async resolveAlias(
    organizationId: string,
    alias: string,
  ): Promise<AliasResolutionRow | undefined> {
    return this.database.db
      .selectFrom("model_aliases as a")
      .innerJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select([
        "a.alias",
        "a.model_id",
        "a.params",
        "c.id as connection_id",
        "c.kind",
        "c.display_name",
        "c.base_url",
        "c.status",
      ])
      .where("a.organization_id", "=", organizationId)
      .where("a.alias", "=", alias)
      .executeTakeFirst();
  }

  /**
   * Every alias in this workspace, resolved.
   *
   * The read Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)) serves to the
   * inspector's swap menu, which needs the resolution beside each name — the menu renders
   * `coder-max` *and* `claude-fable-5 · Anthropic`, so a list of names alone would send it
   * back for one lookup per row.
   *
   * Unpaged, deliberately. A workspace's registry is the handful of aliases its routes name
   * — mockup 06 draws six — and a page over a list that short would cost a client a second
   * request to discover there was nothing more. If a workspace ever has enough aliases for
   * that to be wrong, the surface that discovers it is the one that should add the window.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every alias, ordered by name. Alphabetical rather than by creation, because the
   *   menu is something a person scans for a name they already know.
   */
  async listAliases(organizationId: string): Promise<AliasResolutionRow[]> {
    return this.database.db
      .selectFrom("model_aliases as a")
      .innerJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select([
        "a.alias",
        "a.model_id",
        "a.params",
        "c.id as connection_id",
        "c.kind",
        "c.display_name",
        "c.base_url",
        "c.status",
      ])
      .where("a.organization_id", "=", organizationId)
      .orderBy("a.alias")
      .execute();
  }

  /**
   * One connection's kind, for a caller that has an id and needs an adapter.
   *
   * The param-schema read's first step ([#585](https://github.com/NobuData/ouroboros/issues/585)):
   * a client names a connection, and what decides which adapter answers is its `kind`. Only the
   * two columns that question needs are selected — nothing here reads a credential, a health
   * blob or a display name, and `registry.repository.spec.ts` compiles this statement and
   * asserts it does not name `credentials_encrypted`.
   *
   * @param organizationId - The workspace, from the tenant context. Carried even though the id
   *   is globally unique: a caller who could ask this about another workspace's connection
   *   could learn which of its ids exist.
   * @param connectionId - The connection.
   * @returns The id and kind, or `undefined` when this workspace has no such connection.
   *   Absence is the ordinary answer for an id a caller supplied; turning it into a `404` is
   *   {@link RegistryService}'s job, one layer up.
   */
  async findConnection(
    organizationId: string,
    connectionId: string,
  ): Promise<{ id: string; kind: ProviderConnectionKind } | undefined> {
    return this.database.db
      .selectFrom("provider_connections")
      .select(["id", "kind"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();
  }

  /**
   * What discovery reported about one model on one connection.
   *
   * V017's `provider_models`, joined back to `provider_connections` for the workspace predicate
   * — the table carries no `organization_id` of its own, and V017's argument for that is that
   * its tenancy is the foreign key and every read should enter through one. This is that read,
   * written as the join rather than as a filter so the predicate is visible in the statement.
   *
   * It is two index lookups and no scan: `provider_connections_pkey` finds the connection and
   * `provider_models_connection_model_key` — the unique key discovery's upsert needs anyway —
   * finds the model.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection the model was discovered on.
   * @param modelId - The provider's own identifier, unfolded. Not normalised here: V017 stores
   *   it exactly as the provider spelled it, and a caller that sent a different case asked
   *   about a model this connection does not list.
   * @returns The row's `meta`, or `undefined` when discovery has not run, has not listed this
   *   model, or the connection is another workspace's. **All three are one answer**, and that
   *   is right for this caller: each of them means *nothing was discovered about this model*,
   *   and the param schema is built from what the adapter says either way.
   */
  async discoveredModelMeta(
    organizationId: string,
    connectionId: string,
    modelId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const row = await this.database.db
      .selectFrom("provider_models as m")
      .innerJoin("provider_connections as c", "c.id", "m.provider_connection_id")
      .select("m.meta")
      .where("c.organization_id", "=", organizationId)
      .where("m.provider_connection_id", "=", connectionId)
      .where("m.model_id", "=", modelId)
      .executeTakeFirst();

    return row?.meta;
  }

  /**
   * What the bundled price catalog knows about one model, beyond its price.
   *
   * `model_prices.meta` carries the context window, the maximum output and the capability flags
   * the transform kept for exactly this ticket
   * ([#580](https://github.com/NobuData/ouroboros/issues/580)) — and the merge treats them as
   * *fallback enrichment* only, which `params.merge.ts` argues at length.
   *
   * **Read through `ouroboros.model_price()`**, never by re-deriving the precedence: the
   * function is the one place override-beats-bundled and exact-beats-family live, it is
   * `language sql stable` so PostgreSQL inlines it, and `pricing/pricing.repository.ts` reads
   * it the same way for the price itself. Asking it here for `meta` rather than asking
   * `PricingService` is not a second lookup path — it is the same function — and it keeps this
   * module from importing a pricing service to get at a column that is not a price.
   *
   * @param organizationId - The workspace, from the tenant context. An override's `meta` is
   *   whatever a workspace's own row carries, which is the column's default: this service
   *   writes no `meta` when it records a correction, so a workspace that has overridden a price
   *   gets an empty enrichment rather than the catalog's. That is the honest reading — an
   *   override is a statement about money and not about a context window.
   * @param connectionKind - The provider kind, folded, or null for an unbound alias. A null
   *   matches nothing by construction, which is what makes an unbound alias's enrichment empty
   *   without a branch here.
   * @param modelId - The model identifier, unfolded.
   * @returns The winning row's `meta`, or `undefined` when the catalog covers nothing for the
   *   pair.
   */
  async catalogModelMeta(
    organizationId: string,
    connectionKind: string | null,
    modelId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const { rows } = await sql<{ meta: Record<string, unknown> }>`
      select meta
        from ${sql.id(SCHEMA_NAME)}.model_price(${organizationId}, ${connectionKind}, ${modelId})
    `.execute(this.database.db);

    return rows[0]?.meta;
  }

  /**
   * Which aliases resolve on one connection.
   *
   * The read behind the designed refusal — see `registry.errors.ts`. V015's
   * `model_aliases_provider_fk` is what *blocks* removing a connection aliases depend on;
   * this is what lets the refusal say which ones, which is the difference between a message
   * somebody can act on and a message they can only be annoyed by.
   *
   * It is an index scan rather than a filter: `model_aliases_provider_idx` exists for the
   * foreign key's referencing side and this read is its second job.
   *
   * @param organizationId - The workspace, from the tenant context. Carried even though the
   *   connection id is globally unique — a caller that could ask this question about another
   *   workspace's connection could enumerate one workspace's registry from another.
   * @param connectionId - The connection.
   * @returns The alias names, ordered, so a message built from them is stable between calls.
   *   Empty means nothing depends on it, which is what makes a removal safe to offer.
   */
  async aliasesForConnection(organizationId: string, connectionId: string): Promise<string[]> {
    const rows = await this.aliasRowsOn(organizationId, connectionId);

    return rows.map((row) => row.alias);
  }

  /**
   * Which aliases resolve on one connection, and which model each names.
   *
   * The same index scan as {@link aliasesForConnection}, answering the second question mockup
   * 07 asks of it ([#230](https://github.com/NobuData/ouroboros/issues/230)): after a discovery,
   * *which of these names points at a model the provider no longer lists*. A route through such
   * an alias is broken, and a card that quietly dropped the chip would hide that — so the card
   * flags it, and this is the read the flag is computed from.
   *
   * @param organizationId - The workspace, for {@link aliasesForConnection}'s reason.
   * @param connectionId - The connection.
   * @returns The rows, ordered by alias. Empty when nothing resolves on it.
   */
  async aliasRowsOn(organizationId: string, connectionId: string): Promise<AliasOnConnectionRow[]> {
    return this.database.db
      .selectFrom("model_aliases")
      .select(["id", "alias", "model_id"])
      .where("organization_id", "=", organizationId)
      .where("provider_connection_id", "=", connectionId)
      .orderBy("alias")
      .execute();
  }

  /**
   * What discovery reported about **many** models on one connection — one statement.
   *
   * The batched twin of {@link RegistryRepository.discoveredModelMeta}, added for CH.4
   * ([#587](https://github.com/NobuData/ouroboros/issues/587)): the import wizard asks the same
   * question about every model a connection has, and forty round trips to render one list is a
   * shape worth refusing at the repository rather than apologising for at the service. Same
   * join, same workspace predicate, same index — `provider_models_connection_model_key` serves
   * an `in` list as readily as an equality.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection the models were discovered on.
   * @param modelIds - The provider's own identifiers, unfolded. Empty answers empty without a
   *   round trip.
   * @returns The `meta` of each model that was found, keyed by model id. A model discovery has
   *   not listed is **absent from the map** rather than present with an empty document — the
   *   same distinction {@link RegistryRepository.discoveredModelMeta}'s `undefined` makes.
   */
  async discoveredModelMetaMany(
    organizationId: string,
    connectionId: string,
    modelIds: readonly string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    if (modelIds.length === 0) {
      return new Map();
    }

    const rows = await this.database.db
      .selectFrom("provider_models as m")
      .innerJoin("provider_connections as c", "c.id", "m.provider_connection_id")
      .select(["m.model_id", "m.meta"])
      .where("c.organization_id", "=", organizationId)
      .where("m.provider_connection_id", "=", connectionId)
      .where("m.model_id", "in", [...modelIds])
      .execute();

    return new Map(rows.map((row) => [row.model_id, row.meta]));
  }

  /**
   * What the bundled price catalog knows about **many** models — one statement, one function.
   *
   * The batched twin of {@link RegistryRepository.catalogModelMeta}, and it reaches the catalog
   * exactly the same way: `ouroboros.model_price()` once per model, called through a lateral
   * join over the ids rather than once per round trip. The precedence stays where it is; only
   * the number of trips changes.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionKind - The provider kind, folded, or null. A null matches nothing, so a
   *   caller with no binding gets an empty map without a branch here.
   * @param modelIds - The model identifiers, unfolded. Empty answers empty without a round trip.
   * @returns The winning row's `meta` per model, keyed by model id. A model the catalog covers
   *   nothing for is absent from the map.
   */
  async catalogModelMetaMany(
    organizationId: string,
    connectionKind: string | null,
    modelIds: readonly string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    if (modelIds.length === 0) {
      return new Map();
    }

    const { rows } = await sql<{ model_id: string; meta: Record<string, unknown> }>`
      select ids.model_id, p.meta
        from unnest(${[...modelIds]}::text[]) as ids(model_id)
        cross join lateral ${sql.id(SCHEMA_NAME)}.model_price(
          ${organizationId}, ${connectionKind}, ids.model_id
        ) p
    `.execute(this.database.db);

    return new Map(rows.map((row) => [row.model_id, row.meta]));
  }
}
