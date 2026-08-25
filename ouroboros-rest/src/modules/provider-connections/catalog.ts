/**
 * The add-provider catalog — what `GET /api/v1/providers/catalog` answers, and the one place
 * the adapter registry is turned into something a page can draw
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)).
 *
 * AE.5's first claim is that mockup 07's **Browse catalog** tiles *derive from the adapter
 * registry* rather than from a list somebody keeps in the UI, and its second is that the form
 * behind each tile renders from the adapter's own `configSchema()` with no per-kind UI code.
 * Both need the same thing from this service: the kinds this build can reach, each with the
 * form its adapter declares. `ouroboros-ui` talks to this service and to nothing else, so the
 * registry has to cross the wire, and this is the shape it crosses in.
 *
 * ---------------------------------------------------------------------------
 * **The fields are `provider.forms.ts`'s, not the schema.**
 *
 * The schema itself would have been the obvious payload, and it is deliberately not the one
 * sent. `provider.forms.ts` makes the argument at length: which widget a field gets, whether
 * it is required, what its placeholder is and — the one that matters — *which field is the
 * credential* are derivations, and a renderer handed the raw schema would make every one of
 * them again, differently from the card (AE.2, [#228](https://github.com/NobuData/ouroboros/issues/228)).
 * So {@link toFormFields} is called here, once, and what a page receives is an ordered list of
 * fields it iterates without an opinion.
 *
 * ---------------------------------------------------------------------------
 * **There is no provider kind in this file, and `catalog.spec.ts` checks.**
 *
 * The whole value of the endpoint is that an adapter registered tomorrow is in tomorrow's
 * catalog: the conformance kit's fake, registered under `custom` in a test, has to come out of
 * this function with a working form — the ticket's own proof — and a function with a
 * `switch (kind)` in it would be the thing decision **P1** exists to refuse. The spec reads
 * this file's source with its comments stripped and fails if any of V015's six spellings
 * appears in the code, exactly as `provider.forms.spec.ts` holds the renderer to it.
 *
 * ---------------------------------------------------------------------------
 * **What is deliberately not here.** No `coming soon` entries: the registry answers what this
 * build *has*, and a kind it does not have is honestly absent rather than listed with a flag
 * this service would have to keep in step with a roadmap. Which kinds are announced and where
 * they come from is the page's copy (`ouroboros-ui/app/providers/catalog.ts`), and it drops an
 * announcement the moment the kind turns up here — which is how AF.3's
 * ([#236](https://github.com/NobuData/ouroboros/issues/236)) tiles flip from *soon* to live
 * without a UI change.
 *
 * ---------------------------------------------------------------------------
 * **The capabilities cross the wire beside the fields, since AE.2.**
 *
 * The provider card ([#228](https://github.com/NobuData/ouroboros/issues/228)) is composed
 * from the same two answers the SPI gives core code — `configSchema()` decides the key row,
 * `capabilities()` decides whether the models region is a set of chips or Ollama's pull-list
 * — and the card lives in a module that can reach neither adapter nor registry. So the four
 * flags are copied onto each entry exactly as the adapter answers them. They are the
 * adapter's own `ProviderCapabilities` and not a summary of them: a card that received
 * *"pullable: yes"* would be reading a second vocabulary for one fact.
 */

import type { ProviderConnectionKind } from "../db/schema";
import type { ProviderCapabilities } from "../providers/provider.adapter";
import { toFormFields, type ProviderFormField } from "../providers/provider.forms";
import type { ModelProviderRegistry } from "../providers/provider.registry";

/**
 * One connectable kind — a tile in the catalog, and the form behind it.
 *
 * `openapi.yaml` § `ProviderCatalogEntry`.
 */
export interface ProviderCatalogEntryResource {
  /** The kind, as `POST /api/v1/providers` takes it back. */
  readonly kind: ProviderConnectionKind;
  /** The form's heading — the schema's own `title`: *Connect Anthropic*, *Connect an Ollama host*. */
  readonly title: string;
  /**
   * The fields, in the order the form renders them.
   *
   * Every one of them is a `ProviderFormField`, so the credential is the entry whose `widget`
   * is `secret` — there is no separate pointer at it, because a second way of saying which
   * field goes to the vault is a second thing that can disagree with the first.
   */
  readonly fields: readonly ProviderFormField[];
  /**
   * What the adapter can do — its own `capabilities()`, unchanged.
   *
   * The card reads `pull` to choose between model chips and the pull-list slot, `discovery`
   * to decide whether a refresh affordance means anything, and `entitlements` to know whether
   * a seat count can ever arrive. `invocation` is carried because the shape is total: a flag
   * left out here would be a flag every client had to decide a meaning for.
   */
  readonly capabilities: ProviderCapabilities;
}

/**
 * The catalog — every kind this build can connect, in V015's declaration order.
 *
 * `openapi.yaml` § `ProviderCatalog`.
 */
export interface ProviderCatalogResource {
  /** The entries. Empty only in a build that registers no adapter at all. */
  readonly kinds: readonly ProviderCatalogEntryResource[];
}

/**
 * The catalog for one registry.
 *
 * Total over any registry: every kind {@link ModelProviderRegistry.kinds} answers has an
 * adapter by construction, every adapter's schema is in the dialect by the conformance kit, and
 * {@link toFormFields} is total over the dialect. There is no branch here that can fail to
 * produce an entry.
 *
 * @param registry - The build's registry.
 * @returns One entry per registered kind, ordered as the registry orders them — V015's order,
 *   so the catalog is stable between builds rather than following an injector's whim.
 */
export function providerCatalog(registry: ModelProviderRegistry): ProviderCatalogResource {
  return {
    kinds: registry.kinds().map((kind) => {
      const adapter = registry.get(kind);
      const schema = adapter.configSchema();

      return {
        kind,
        title: schema.title,
        fields: toFormFields(schema),
        capabilities: adapter.capabilities(),
      };
    }),
  };
}
