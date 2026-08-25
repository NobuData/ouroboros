/**
 * The param and capability service — *what can this model be tuned with*, answered once for
 * every surface that asks.
 *
 * CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)). Three methods, and they are
 * three uses of one value:
 *
 * ```
 * schemaFor(connection, model)   → GET /registry/param-schema → CI.3's fields (#593)
 * assertWriteValid(…, {params})  → every CH.1 write (#584)    → 422 with per-field errors
 * forModels(connection, models)  → CH.4's import (#587)       → a headline and a schema each
 * ```
 *
 * The value is the same merged schema in all three, which is the whole design: a form rendered
 * from one description and checked against a second is a form that will one day offer a field
 * the server refuses. Here there is nothing to drift.
 *
 * The third is the same question asked about a list. It exists rather than a caller looping
 * over {@link ParamSchemaService.schemaFor} because the loop is what costs: a connection with
 * forty models would be eighty round trips to draw one wizard, so the connection and the
 * adapter are resolved once and the two metadata reads are batched. Everything after that is
 * `params.merge.ts`'s, unchanged and unduplicated — the merge is called per model exactly as
 * the single read calls it, and {@link ParamSchemaService.binding} is the one piece of
 * resolution both paths share.
 *
 * It answers a **schema and a headline together** because CH.4 needs both about the same
 * models: the headline draws its candidate row, and the schema validates the params that row
 * submits. Handing back one and making the caller re-fetch the other would be the N+1 this
 * method exists to remove, arriving one step later.
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
  summariseCapabilities,
  type MergedParamSchema,
  type ModelCapabilitySummary,
} from "./params.merge";
import { assertParamsValid, type AliasParamWrite } from "./params.validation";

/**
 * What {@link ParamSchemaService.forModels} answers per model — the two uses of one merge.
 *
 * Together rather than separately because they are the same value read twice: a client that
 * validated against one and rendered from the other would be back where CH.2 started.
 */
export interface ModelParamAnswer {
  /** What the model accepts — the value CH.1's writes are checked against. */
  readonly schema: MergedParamSchema;
  /** The one-line version of it, for a list that has no room for a form. */
  readonly capabilities: ModelCapabilitySummary;
}

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

    const { kind, adapter } = await this.binding(organizationId, connectionId);

    if (adapter === undefined) {
      // See this class's header: a kind with no adapter renders a form that explains itself
      // rather than a `501` that takes the inspector down.
      return mergeParamSchema(null, NO_METADATA, NO_METADATA, kind);
    }

    const [discovered, catalogued] = await Promise.all([
      this.discoveredMetadata(organizationId, connectionId, modelId),
      this.catalogMetadata(organizationId, kind, modelId),
    ]);

    return mergeParamSchema(adapter.paramSchema(modelId), discovered, catalogued);
  }

  /**
   * The schema and the headline for every model of one connection — CH.4's candidate rows and
   * the validation of what they submit
   * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
   *
   * The same merge as {@link ParamSchemaService.schemaFor}, per model, with the connection and
   * the adapter resolved once and both metadata reads batched — **three statements for a whole
   * connection**, whatever its catalog's size, against two per model for a loop over the single
   * read.
   *
   * **A kind with no adapter still gets an answer.** Its params are empty with
   * `reason: provider_unsupported`, and its context window is whatever discovery reported —
   * which is a fact about the model rather than about this build's adapter coverage, and
   * withholding it would make an importable model look like an unknown one.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param connectionId - The connection the models belong to. Never null: this answers about a
   *   binding, and an unbound alias is {@link ParamSchemaService.schemaFor}'s single-model case.
   * @param modelIds - The models to answer for, unfolded. Duplicates are answered once; an
   *   empty list is answered with an empty map and no statements at all.
   * @returns One answer per **distinct** model id, keyed by it. Every id asked about is
   *   present — an id nothing has discovered still has an adapter schema and a headline saying
   *   nothing is known about its size.
   * @throws {NotFoundError} `404 provider_connection_not_found` — see
   *   {@link ParamSchemaService.schemaFor}.
   */
  async forModels(
    organizationId: string,
    connectionId: string,
    modelIds: readonly string[],
  ): Promise<Map<string, ModelParamAnswer>> {
    const wanted = [...new Set(modelIds)];
    const { kind, adapter } = await this.binding(organizationId, connectionId);
    const [discovered, catalogued] = await Promise.all([
      this.registry.discoveredModelMetaMany(organizationId, connectionId, wanted),
      this.registry.catalogModelMetaMany(organizationId, kind, wanted),
    ]);
    const answers = new Map<string, ModelParamAnswer>();

    for (const modelId of wanted) {
      const reported = readModelMetadata(discovered.get(modelId));
      const published = readModelMetadata(catalogued.get(modelId));
      const schema =
        adapter === undefined
          ? mergeParamSchema(null, NO_METADATA, NO_METADATA, kind)
          : mergeParamSchema(adapter.paramSchema(modelId), reported, published);

      answers.set(modelId, {
        schema,
        capabilities: summariseCapabilities(schema, reported, published),
      });
    }

    return answers;
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
   * The connection's kind and the adapter that speaks it, or the designed 404.
   *
   * The one piece of resolution {@link ParamSchemaService.schemaFor} and
   * {@link ParamSchemaService.summariesFor} share. `adapter` is `undefined` for a kind this
   * build has no adapter for, which is an answer rather than a failure — see the class header.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection.
   * @returns The kind, and the adapter for it when there is one.
   * @throws {NotFoundError} `404 provider_connection_not_found`.
   */
  private async binding(organizationId: string, connectionId: string) {
    const connection = await this.registry.findConnection(organizationId, connectionId);

    if (connection === undefined) {
      throw registryConnectionNotFound(connectionId);
    }

    return { kind: connection.kind, adapter: this.adapters.find(connection.kind) };
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
