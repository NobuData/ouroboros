/**
 * The param and capability service — *what can this model be tuned with*, answered once for
 * every surface that asks.
 *
 * CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)). Two methods, and they are
 * two uses of one value:
 *
 * ```
 * schemaFor(connection, model)   → GET /registry/param-schema → CI.3's fields (#593)
 * assertWriteValid(…, {params})  → every CH.1 write (#584)    → 422 with per-field errors
 * ```
 *
 * The value is the same merged schema in both, which is the whole design: a form rendered from
 * one description and checked against a second is a form that will one day offer a field the
 * server refuses. Here there is nothing to drift.
 *
 * ---------------------------------------------------------------------------
 * **What it composes.** `params.merge.ts` has the precedence rule and holds no dependencies;
 * this is what fetches the four contributors and hands them over — the adapter from
 * `ModelProviderRegistry`, the discovered model and the catalog row from
 * `RegistryRepository`. Splitting it that way is what lets the merge's own suite state a
 * precedence case in three literals instead of a database.
 *
 * ---------------------------------------------------------------------------
 * **A kind with no adapter is answered, not refused.**
 *
 * `ModelProviderRegistry.get` turns an unregistered kind into a `501`, which is right for
 * *pull this model* — there is no way to do it. It is wrong here. Mockup 21's table has a row
 * per alias and every one of them needs an inspector; a `custom` connection whose adapter
 * nobody has written yet should render a form that says so, not take the panel down with a
 * status code. So this reads {@link ModelProviderRegistry.find} and turns absence into the
 * generic schema with `provider_unsupported` — which is the same shape, and the same honesty,
 * as the unbound answer beside it.
 *
 * ---------------------------------------------------------------------------
 * **It reads three rows at most and never opens a credential.** A param schema is a question
 * about *what a model supports*, and nothing about the answer needs a key: the adapters answer
 * it from their own code, and the two metadata reads are ordinary selects. This service holds
 * no `VaultService` and imports none, exactly as `registry.service.ts` does not — see
 * `registry.module.ts` for why the absent import is load-bearing.
 */

import { Injectable } from "@nestjs/common";

import type { ProviderConnectionKind } from "../db/schema";
import { ModelProviderRegistry } from "../providers/provider.registry";
import { registryConnectionNotFound } from "./registry.errors";
import { RegistryRepository } from "./registry.repository";
import {
  NO_METADATA,
  mergeParamSchema,
  readModelMetadata,
  type MergedParamSchema,
} from "./params.merge";
import { assertParamsValid, type AliasParamWrite } from "./params.validation";

@Injectable()
export class ParamSchemaService {
  /**
   * @param registry - The statements. Injected so a unit suite can answer them without a
   *   database.
   * @param adapters - The adapter registry — the only way this module reaches a provider's own
   *   knowledge, and the seam decision **P1** exists for. Nothing here imports an adapter, and
   *   `.dependency-cruiser.cjs` is what keeps that true.
   */
  constructor(
    private readonly registry: RegistryRepository,
    private readonly adapters: ModelProviderRegistry,
  ) {}

  /**
   * The schema for one model, on one connection or on none.
   *
   * @param organizationId - The workspace, from the tenant context. Every read below carries
   *   it: a connection resolved out of the wrong workspace would answer a schema shaped by
   *   another workspace's discovery.
   * @param connectionId - The connection the alias is bound to, or `null` for an unbound one.
   *   `null` is a first-class argument rather than an error, because an unbound alias is a
   *   state mockup 21 draws and CH.1 creates on purpose.
   * @param modelId - The model's own identifier, unfolded and exactly as the alias stores it.
   * @returns The merged schema, its restrictions, and the reason there are no params when there
   *   are none.
   * @throws {NotFoundError} `404 provider_connection_not_found` when `connectionId` names no
   *   connection in this workspace. Not answered as *unbound*: a client that asked about a
   *   connection that is not there has a stale list, and telling it the alias is unbound would
   *   send it to fix the wrong thing.
   */
  async schemaFor(
    organizationId: string,
    connectionId: string | null,
    modelId: string,
  ): Promise<MergedParamSchema> {
    if (connectionId === null) {
      return mergeParamSchema(null, NO_METADATA, NO_METADATA);
    }

    const connection = await this.registry.findConnection(organizationId, connectionId);

    if (connection === undefined) {
      throw registryConnectionNotFound(connectionId);
    }

    const adapter = this.adapters.find(connection.kind);

    if (adapter === undefined) {
      // See this class's header: a kind with no adapter renders a form that explains itself
      // rather than a `501` that takes the inspector down.
      return mergeParamSchema(null, NO_METADATA, NO_METADATA, connection.kind);
    }

    const [discovered, catalogued] = await Promise.all([
      this.discoveredMetadata(organizationId, connectionId, modelId),
      this.catalogMetadata(organizationId, connection.kind, modelId),
    ]);

    return mergeParamSchema(adapter.paramSchema(modelId), discovered, catalogued);
  }

  /**
   * Check what is about to be written against what the model accepts.
   *
   * The seam CH.1 ([#584](https://github.com/NobuData/ouroboros/issues/584)) calls before every
   * create and every update. It re-reads the schema rather than taking one from the caller,
   * which is deliberate: a client holding a schema from before a rebind would otherwise be
   * validating against the model it *used* to point at.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection the alias will be bound to after this write, or `null`
   *   when it will be unbound. **After**, not before: a rebind changes what the params have to
   *   be legal for, and checking against the old binding would let a write land params the new
   *   model has no notion of.
   * @param modelId - The model the alias will name after this write.
   * @param write - The two documents. Either may be absent, which is how an alias with no
   *   tuning at all is created.
   * @returns Nothing when the write is acceptable.
   * @throws {InvalidRequestError} `422 model_alias_params_invalid` with one `details` entry per
   *   offending field.
   * @throws {NotFoundError} `404 provider_connection_not_found` — see {@link schemaFor}.
   */
  async assertWriteValid(
    organizationId: string,
    connectionId: string | null,
    modelId: string,
    write: AliasParamWrite,
  ): Promise<void> {
    const schema = await this.schemaFor(organizationId, connectionId, modelId);

    assertParamsValid(schema, write, modelId);
  }

  /**
   * What discovery reported about the model, in the merge's vocabulary.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection.
   * @param modelId - The model.
   * @returns The metadata. {@link NO_METADATA} when discovery has not run or does not list it —
   *   an ordinary state, and the reason this is not an error: a schema built from the adapter
   *   alone is a smaller answer, not a wrong one.
   */
  private async discoveredMetadata(organizationId: string, connectionId: string, modelId: string) {
    return readModelMetadata(
      await this.registry.discoveredModelMeta(organizationId, connectionId, modelId),
    );
  }

  /**
   * What the bundled catalog knows about the model, in the merge's vocabulary.
   *
   * @param organizationId - The workspace.
   * @param kind - The connection's kind, which is half the catalog's lookup key.
   * @param modelId - The model.
   * @returns The metadata. {@link NO_METADATA} when the catalog covers nothing for the pair.
   */
  private async catalogMetadata(
    organizationId: string,
    kind: ProviderConnectionKind,
    modelId: string,
  ) {
    return readModelMetadata(await this.registry.catalogModelMeta(organizationId, kind, modelId));
  }
}
