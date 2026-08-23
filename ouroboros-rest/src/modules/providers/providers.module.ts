/**
 * The provider adapter framework — AC.1
 * ([#216](https://github.com/NobuData/ouroboros/issues/216)), roadmap decision **P1**.
 *
 * ```
 * provider.adapter.ts    the SPI, and the capability gate     → ModelProviderAdapter
 * provider.errors.ts     five error classes → five pills      → the shared vocabulary
 * provider.config.ts     the JSON Schema dialect              → configSchema()'s contract
 * provider.forms.ts      schema → form fields, no kind in it  → AE.5's renderer input
 * provider.registry.ts   lookup by kind, and its two refusals → MODEL_PROVIDER_ADAPTERS
 * adapters/              the implementations                  → nothing else may import these
 * conformance.fixture.ts the kit every adapter must pass
 * ```
 *
 * **It exports one thing.** {@link ModelProviderRegistry} is what AD.2's credential lifecycle
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)), Z.3's health service and the
 * discovery scheduler import; {@link REGISTERED_ADAPTERS} is the list AC.2–AC.5 each add one
 * line to. `anthropic` is registered as of AC.2
 * ([#217](https://github.com/NobuData/ouroboros/issues/217)) and `openai_compatible` as of AC.3
 * ([#218](https://github.com/NobuData/ouroboros/issues/218)); the other three kinds are still a
 * `501`, which is the accurate answer rather than a stub — see `provider.registry.ts` on why an
 * unregistered kind is a `501` and not a `404`.
 *
 * `VaultModule` is deliberately **not** imported, and neither is `DbModule`. Nothing here reads
 * a row or opens a credential: an adapter is handed an already-opened
 * {@link import("./provider.adapter").ProviderConnectionContext} by whoever called it, which is
 * what keeps the plaintext's lifetime the caller's request scope rather than this module's.
 * The absent imports are what keep that true as adapters land — the day one needs a database,
 * adding the import is a visible change with a reviewer attached to it.
 *
 * It declares **no controller**. Every surface that would sit on top of this is somebody
 * else's ticket: AD.2 owns add/reveal/rotate, AE.4 ([#230](https://github.com/NobuData/ouroboros/issues/230))
 * owns test and discovery, AE.5 ([#231](https://github.com/NobuData/ouroboros/issues/231)) owns
 * the add-form. `registry/` made the same choice under decision **M2** and for the same reason:
 * a CRUD surface written here first is one those tickets would have to negotiate with rather
 * than write.
 */

import { Module } from "@nestjs/common";

import { AnthropicAdapter } from "./adapters/anthropic.adapter";
import { OpenAiCompatibleAdapter } from "./adapters/openai-compatible.adapter";
import type { ModelProviderAdapter } from "./provider.adapter";
import { MODEL_PROVIDER_ADAPTERS, ModelProviderRegistry } from "./provider.registry";

/**
 * The adapters this build registers, as the providers that implement them.
 *
 * A named constant rather than a literal in the `inject` array, so the list has somewhere to be
 * documented and so `providers.module.spec.ts` can assert what is in it — which is what stops
 * an adapter being written, tested, and then never reachable because nobody added the line.
 * `vault.module.ts`'s `REGISTERED_SECRET_STORES` is the same shape for the same reason.
 *
 * **AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217)) is the first entry and AC.3
 * ([#218](https://github.com/NobuData/ouroboros/issues/218)) the second** — one line each, and
 * nothing else in the service learned either provider's name. AC.4 and AC.5 append theirs the
 * same way. The list is spread into `providers` as well as into `inject`, because a class Nest
 * is asked to inject is a class Nest also has to have been told to construct.
 */
export const REGISTERED_ADAPTERS = [AnthropicAdapter, OpenAiCompatibleAdapter] as const;

@Module({
  providers: [
    ...REGISTERED_ADAPTERS,
    {
      provide: MODEL_PROVIDER_ADAPTERS,
      // Frozen because `ModelProviderRegistry` reads this list once at construction and the
      // registry it builds is immutable; a list something could append to at run time would be
      // a set of adapters this module's own documentation does not mention.
      useFactory: (...adapters: ModelProviderAdapter[]): readonly ModelProviderAdapter[] =>
        Object.freeze(adapters),
      inject: [...REGISTERED_ADAPTERS],
    },
    ModelProviderRegistry,
  ],
  exports: [ModelProviderRegistry],
})
export class ProvidersModule {}
