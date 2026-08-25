/**
 * The registry's composed read model — one payload behind mockup 21's eight columns
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)), decision **R8**.
 *
 * ## What this is, and why it is not eight requests
 *
 * The table's columns come from five subsystems: bindings and references (CH.1
 * [#584](https://github.com/NobuData/ouroboros/issues/584) over CG.3
 * [#581](https://github.com/NobuData/ouroboros/issues/581)), chips (CH.2
 * [#585](https://github.com/NobuData/ouroboros/issues/585)), provider health (Z.3
 * [#196](https://github.com/NobuData/ouroboros/issues/196)), pricing (CH.3
 * [#586](https://github.com/NobuData/ouroboros/issues/586)) and discovery (AC.6
 * [#221](https://github.com/NobuData/ouroboros/issues/221)). A client assembling that itself
 * would be slow, and — the ticket's actual objection — **assembly order is where
 * inconsistencies appear**: a page that reads aliases, then health a second later, then prices
 * after that renders a row nobody's database was ever in. This composes once, and three
 * surfaces consume the result (the table #592, the inspector prefill #593, and routing's swap
 * menus — the amended Z.2 #195), so those three cannot disagree.
 *
 * ## Nothing here calls a provider, and there is no path from here to one
 *
 * Decision **R8**: alias health is **composed**, and no alias-level synthetic call is ever
 * made. The obvious Health column is a probe per alias, which would spend tokens against every
 * provider on every page load to learn what the system already knows — whether the connection
 * is healthy (Z.3 tracks it), whether the alias is bound at all (a fact, not a network
 * question), and whether the bound model is still in discovery (AC.6 refreshes it).
 *
 * That is structural rather than careful. `RegistryReadModule` does **not** import
 * `ProvidersModule`, so `ModelProviderRegistry` is not injectable here and an adapter cannot be
 * reached even by mistake; `.dependency-cruiser.cjs`'s `core-imports-the-spi-only` rule refuses
 * the import that would route around it. `registry-read.module.spec.ts` asserts the absent
 * import and `registry-read.integration-spec.ts` counts adapter lookups across a real request
 * and expects zero.
 *
 * The chips are the reason that is worth saying twice: CH.2's `ParamSchemaService` **does**
 * reach an adapter, because a param *schema* is whatever the bound adapter says it is. This
 * read does not use it. It uses `paramChips`, the pure derivation over the two stored
 * documents, which is the same function the inspector's cell is drawn from.
 *
 * ## The query count is constant in the number of aliases
 *
 * Six statements for a workspace of any registry size — four in the first round trip, and the
 * prices in a fifth (`PricingService.resolveMany` batches the whole table into one lookup, or
 * none when its cache is warm):
 *
 * ```
 * AliasesService.list          model_aliases ⟕ provider_connections      1
 *                              alias_references, one `in` list            1
 * RegistryReadRepository       provider_connections                       1
 *                              provider_models ⟖ provider_connections     1
 *                              provider_connections (sealed column only)  1
 * PricingService.resolveMany   model_price(), one lateral join           ≤1
 * ```
 *
 * `registry-read.integration-spec.ts` asserts that adding aliases does not add statements, at
 * the driver rather than by inspecting this file.
 *
 * **The masks are the one cost that scales with something**, and it is the number of
 * *connections* rather than aliases: opening each envelope is one key lookup per distinct key
 * version inside `VaultService`. That is the trade
 * `provider-connections.repository.ts`'s `envelopesFor` documents and accepts for mockup 07's
 * five cards, taken here for the same reason — there is no stored suffix column, and adding one
 * is a schema change neither ticket's scope includes.
 *
 * ## A credential that will not open is a null, not a failed page
 *
 * `VaultService.decrypt` throws when a workspace has no key at the envelope's version — a
 * database restored without `tenant_keys`, a workspace whose rows outlived its key. That is
 * this deployment's problem and says nothing about the eight aliases somebody is trying to
 * look at, so it is logged for an operator and the binding's `mask` is null. Exactly the
 * reading `provider-health/provider-health.service.ts` gives the same failure: it declines to
 * put this service's own fault on somebody else's row.
 */

import { Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../errors/failure";
import { maskCredential } from "../provider-connections/masking";
import { modelPriceResource, type ModelPriceResource } from "../pricing/resources";
import type { ModelKey } from "../pricing/price";
import { PricingService } from "../pricing/pricing.service";
import { readHealth } from "../provider-health/snapshot";
import { AliasesService } from "../registry/aliases.service";
import type { ModelAliasResource } from "../registry/aliases.resources";
import { zeroize } from "../vault/envelope";
import { VaultService } from "../vault/vault.service";
import { aliasHealth, type AliasHealthConnection } from "./alias.health";
import { RegistryReadRepository } from "./registry-read.repository";
import { toRegistryAliasResource, type RegistryReadModelResource } from "./registry-read.resources";
import type { RegistryConnectionRow } from "./registry-read.rows";

/**
 * A connection as this read holds it: the health facts, and the mask its inspector line shows.
 *
 * Assembled once per connection and shared by every alias bound to it — which is the whole
 * difference between this and the N+1 the ticket refuses.
 */
interface ConnectionState extends AliasHealthConnection {
  /** `••••Xq4A`, or null for a provider that stores no credential or one that would not open. */
  readonly mask: string | null;
}

@Injectable()
export class RegistryReadService {
  /** Where a deployment fault goes. Never a provider's state, and never a credential. */
  private readonly logger = new Logger(RegistryReadService.name);

  /**
   * @param aliases - CH.1's list. The rows and their references come from the one read
   *   `/api/v1/registry/aliases` serves, so this payload cannot describe an alias differently
   *   from the endpoint that writes it.
   * @param registry - This module's own three statements — connections, discovery, envelopes.
   * @param pricing - CH.3's single resolution of *what does this model cost*. Never re-derived:
   *   four surfaces consume it and the thing they would disagree about is money.
   * @param vault - The one dependency here that opens anything. See this file's header.
   */
  constructor(
    private readonly aliases: AliasesService,
    private readonly registry: RegistryReadRepository,
    private readonly pricing: PricingService,
    private readonly vault: VaultService,
  ) {}

  /**
   * The whole registry page, for one workspace.
   *
   * @param organizationId - The workspace, from the tenant context. Every read below carries
   *   it, so a cross-workspace request answers an empty registry rather than somebody else's.
   * @returns Every alias, ordered by name, each with its binding, chips, health, price and
   *   references. Empty `aliases` for a workspace with none — CI.6's empty registry, which is a
   *   state to render rather than a failure.
   */
  async read(organizationId: string): Promise<RegistryReadModelResource> {
    // Four independent statements, issued together: none of them is an input to another, and
    // the page's latency is the slowest rather than the sum.
    const [list, connectionRows, discoveredRows, envelopes] = await Promise.all([
      this.aliases.list(organizationId),
      this.registry.connections(organizationId),
      this.registry.discoveredModels(organizationId),
      this.registry.sealedCredentials(organizationId),
    ]);

    const [connections, prices] = await Promise.all([
      this.connectionStates(organizationId, connectionRows, envelopes),
      this.prices(organizationId, list.aliases),
    ]);

    // Which models each connection still lists — the set the `model_missing` state is decided
    // against, and the set that tells a connection discovery has never visited from one whose
    // catalog no longer holds a model.
    const discovered = new Set(
      discoveredRows.map((row) => pairKey(row.provider_connection_id, row.model_id)),
    );
    const catalogued = new Set(discoveredRows.map((row) => row.provider_connection_id));

    return {
      aliases: list.aliases.map((alias, index) => {
        const binding = alias.connection;
        const state = binding === null ? null : connections.get(binding.id);

        return toRegistryAliasResource(
          alias,
          state?.mask ?? null,
          aliasHealth({
            modelId: alias.modelId,
            // `unchecked` covers the case the two reads disagree — a connection deleted
            // between them. It cannot happen through this API (V015's foreign key is what
            // stops it), and the answer is still the honest one rather than a contradiction:
            // the row *is* bound, so it keeps its provider cell, and nothing is known about
            // that provider, which is what `unknown` means.
            connection: binding === null ? null : (state ?? unchecked(binding.displayName)),
            discovered: binding !== null && discovered.has(pairKey(binding.id, alias.modelId)),
            catalogued: binding !== null && catalogued.has(binding.id),
          }),
          prices[index],
        );
      }),
    };
  }

  /**
   * Every connection in the workspace, as the state an alias row reads it through.
   *
   * @param organizationId - The workspace, for the vault's additional authenticated data.
   * @param rows - What the connection read answered.
   * @param envelopes - The sealed credential of each, by id.
   * @returns The states, by connection id.
   */
  private async connectionStates(
    organizationId: string,
    rows: readonly RegistryConnectionRow[],
    envelopes: ReadonlyMap<string, string | null>,
  ): Promise<Map<string, ConnectionState>> {
    const states = await Promise.all(
      rows.map(async (row) => {
        // Z.3's own reader, rather than a second reading of the `health` column: it is jsonb,
        // three things legitimately write it, and `snapshot.ts` is where the rules for reading
        // it tolerantly live.
        const measured = readHealth(row.health);

        const state: ConnectionState = {
          displayName: row.display_name,
          enabled: row.enabled,
          status: row.status,
          detail: measured.detail,
          checkedAt: row.last_checked_at,
          mask: await this.mask(organizationId, row.id, envelopes.get(row.id) ?? null),
        };

        return [row.id, state] as const;
      }),
    );

    return new Map(states);
  }

  /**
   * The mask for one connection's stored credential.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection the envelope is bound to.
   * @param envelope - The sealed value, or null when the provider stores none.
   * @returns `••••Xq4A`, or null when there is nothing to mask or nothing this deployment can
   *   open. See this file's header for why the second is not a failure.
   */
  private async mask(
    organizationId: string,
    connectionId: string,
    envelope: string | null,
  ): Promise<string | null> {
    if (envelope === null) {
      return null;
    }

    try {
      const opened = await this.vault.decrypt(organizationId, connectionId, envelope);

      try {
        return maskCredential(opened);
      } finally {
        // The vault hands the buffer over and says the caller owns it. This is the caller.
        zeroize(opened);
      }
    } catch (failure) {
      this.logger.warn(
        `the registry could not open the sealed value on connection ${connectionId}, ` +
          `so its key row is blank: ${describeForLog(failure)}`,
      );

      return null;
    }
  }

  /**
   * The price cell for every row, in the order the rows are drawn.
   *
   * One batched resolution rather than one lookup per alias — CH.3's `resolveMany` deduplicates
   * the pairs and issues a single statement — and the rendering is CH.3's `display`, never
   * re-derived here.
   *
   * @param organizationId - The workspace.
   * @param aliases - The rows, in the order they will be published.
   * @returns One price resource per row, `price: null` and `display: "—"` where the catalog
   *   covers nothing. That is not `$0`, which is a `free` row.
   */
  private async prices(
    organizationId: string,
    aliases: readonly ModelAliasResource[],
  ): Promise<ModelPriceResource[]> {
    const keys: ModelKey[] = aliases.map((alias) => ({
      // Null for an unbound alias: nothing has told us who would be billing, so it resolves to
      // nothing and renders `—` rather than to a zero somebody could size a budget from.
      connectionKind: alias.connection?.kind ?? null,
      modelId: alias.modelId,
    }));

    const resolved = await this.pricing.resolveMany(keys, organizationId);

    return keys.map((key, index) => modelPriceResource(key, resolved[index]));
  }
}

/**
 * A bound connection nothing is known about — the state a row reads through when the
 * connection read did not answer for it.
 *
 * Decision **M8**'s answer, reached from the other direction: `unknown` is the absence of a
 * measurement, and that is exactly what this is. Never `ok`, which would claim something, and
 * never `no_key`, which would contradict the provider cell drawn beside it.
 *
 * @param displayName - The connection's name, from the alias's own row.
 * @returns The state.
 */
function unchecked(displayName: string): AliasHealthConnection {
  return { displayName, enabled: true, status: "unknown", detail: null, checkedAt: null };
}

/**
 * The identity of a (connection, model) pair inside this read's sets.
 *
 * A newline separates the halves because it is the one character neither a uuid nor V017's
 * `model_id` can contain — so two different pairs cannot collide on one key, which a `:` could
 * not promise against a model called `qwen3-coder:32b`.
 *
 * @param connectionId - The connection.
 * @param modelId - The model, in the provider's own spelling.
 * @returns The key.
 */
function pairKey(connectionId: string, modelId: string): string {
  return `${connectionId}\n${modelId}`;
}
