/**
 * The provider adapter framework — AC.1
 * ([#216](https://github.com/NobuData/ouroboros/issues/216)), roadmap decision **P1**.
 *
 * ```
 * provider.adapter.ts    the SPI, and the capability gate     → ModelProviderAdapter
 * provider.errors.ts     five error classes → five pills      → the shared vocabulary
 * provider.config.ts     the JSON Schema dialect              → configSchema()'s contract
 * provider.forms.ts      schema → form fields, no kind in it  → AE.5's renderer input
 * provider.address.ts    the SSRF policy (AC.3)               → for the two that take a URL
 * provider.entitlements.ts  seats in a detail, written & read → AE.2/AE.6's cap line (AC.5)
 * provider.registry.ts   lookup by kind, and its two refusals → MODEL_PROVIDER_ADAPTERS
 * provider.pulls.ts      server-side pull tracking (AC.4)     → ModelPullTracker
 * adapters/              the implementations                  → nothing else may import these
 * conformance.fixture.ts the kit every adapter must pass
 * ```
 *
 * **It exports two things.** {@link ModelProviderRegistry} is what AD.2's credential lifecycle
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)), Z.3's health service and the
 * discovery scheduler import; {@link REGISTERED_ADAPTERS} is the list AC.2–AC.5 each added a
 * line to. `anthropic` is registered as of AC.2
 * ([#217](https://github.com/NobuData/ouroboros/issues/217)), `openai_compatible` as of AC.3
 * ([#218](https://github.com/NobuData/ouroboros/issues/218)), `ollama` as of AC.4
 * ([#219](https://github.com/NobuData/ouroboros/issues/219)), and `copilot` and `cursor` as of
 * AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)) — which leaves `custom`, and
 * that is honestly a `501`: V015 accepts the row and nothing here knows what a custom provider
 * would be. See `provider.registry.ts` on why an unregistered kind is a `501` and not a `404`.
 *
 * {@link ModelPullTracker} is the second export and it arrived with the first pulling adapter.
 * It is a *singleton with state*, which nothing else in this module is: a pull outlives the
 * request that started it, so what remembers one has to outlive that request too. It holds no
 * adapter and no credential — `provider.pulls.ts` explains why it takes a thunk — so registering
 * it here changes nothing about the absent imports below.
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
import { CopilotAdapter } from "./adapters/copilot.adapter";
import { CursorAdapter } from "./adapters/cursor.adapter";
import { OllamaAdapter } from "./adapters/ollama.adapter";
import { OpenAiCompatibleAdapter } from "./adapters/openai-compatible.adapter";
import type { ModelProviderAdapter } from "./provider.adapter";
import { ModelPullTracker } from "./provider.pulls";
import { MODEL_PROVIDER_ADAPTERS, ModelProviderRegistry } from "./provider.registry";

/**
 * The adapters this build registers, as the providers that implement them.
 *
 * A named constant rather than a literal in the `inject` array, so the list has somewhere to be
 * documented and so `providers.module.spec.ts` can assert what is in it — which is what stops
 * an adapter being written, tested, and then never reachable because nobody added the line.
 * `vault.module.ts`'s `REGISTERED_SECRET_STORES` is the same shape for the same reason.
 *
 * **AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217)) is the first entry, AC.3
 * ([#218](https://github.com/NobuData/ouroboros/issues/218)) the second, AC.4
 * ([#219](https://github.com/NobuData/ouroboros/issues/219)) the third and AC.5
 * ([#220](https://github.com/NobuData/ouroboros/issues/220)) the last two** — one line each,
 * and nothing else in the service learned any of those providers' names. Five adapters, five
 * lines, and the five differences between the cards they draw are all data. The list is spread
 * into `providers` as well as into `inject`, because a class Nest is asked to inject is a class
 * Nest also has to have been told to construct.
 */
export const REGISTERED_ADAPTERS = [
  AnthropicAdapter,
  OpenAiCompatibleAdapter,
  OllamaAdapter,
  CopilotAdapter,
  CursorAdapter,
] as const;

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
    ModelPullTracker,
  ],
  exports: [ModelProviderRegistry, ModelPullTracker],
})
export class ProvidersModule {}
