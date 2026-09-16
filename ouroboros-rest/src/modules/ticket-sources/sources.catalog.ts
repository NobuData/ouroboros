/**
 * The add-source catalog — what `GET /api/v1/sources/catalog` answers, and the one place the
 * provider registry is turned into something a page can draw
 * (Q.4, [#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * `provider-connections/catalog.ts`, one SPI over. The settings surface's kind picker shows
 * *"GitHub as available and Jira / Linear / GitLab as coming-soon tiles"*, and the form behind
 * the available tile renders *"from the provider-declared config schema"* — both need the same
 * thing from this service: the kinds this build can reach, each with the form its provider
 * declares. `ouroboros-ui` talks to this service and to nothing else, so the registry has to
 * cross the wire, and this is the shape it crosses in.
 *
 * ---------------------------------------------------------------------------
 * **The fields are `ticket-source.config.ts`'s, not the schema.** Which widget a field gets,
 * whether it is required, what its placeholder is and which field is the credential are
 * derivations, and a renderer handed the raw schema would make every one of them again. So
 * `toSourceFormFields` is called here, once, and what a page receives is an ordered list it
 * iterates without an opinion.
 *
 * **There is no provider kind in this file, and `sources.catalog.spec.ts` checks.** A provider
 * registered tomorrow is in tomorrow's catalog, and a function with a `switch (kind)` in it
 * would be the thing decision **P5** exists to refuse. The *coming soon* tiles are therefore
 * not here either: the registry answers what this build *has*, and which kinds are announced
 * and where they come from is the page's copy (`ouroboros-ui/app/sources/catalog.ts`), which
 * drops an announcement the moment the kind turns up in this answer.
 *
 * **Each entry says whether a push may be offered, and why not.** AL.2's
 * ([#278](https://github.com/NobuData/ouroboros/issues/278)) *"capability flags gate UI
 * affordances"*: the tracker segment (AM.2, #284) draws a read-only kind's button disabled with the
 * entry's `push.reason` as its tooltip, rather than a push that fails on click. Composed by
 * `pushAffordance` from the flags alone, so the sentence is the same for every read-only tracker.
 */

import type { TicketSourceCatalogResource } from "./sources.resources";
import { toSourceFormFields } from "./ticket-source.config";
import type { TicketSourceRegistry } from "./ticket-source.registry";
import { pushAffordance } from "./ticket-source.write";

/**
 * The catalog for one registry.
 *
 * Total over any registry: every kind `kinds()` answers has a provider by construction, every
 * provider's schema is in the dialect by the registry's own boot-time gate, and
 * `toSourceFormFields` is total over the dialect.
 *
 * @param registry - The build's registry.
 * @returns One entry per registered kind, in V030's declaration order — the registry's own —
 *   so the picker is stable between builds rather than following an injector's whim.
 */
export function sourceCatalog(registry: TicketSourceRegistry): TicketSourceCatalogResource {
  return {
    kinds: registry.kinds().map((kind) => {
      const provider = registry.get(kind);
      const schema = provider.configSchema();
      const capabilities = provider.capabilities();

      return {
        kind,
        title: schema.title,
        fields: toSourceFormFields(schema),
        capabilities,
        push: pushAffordance(capabilities.write),
      };
    }),
  };
}
