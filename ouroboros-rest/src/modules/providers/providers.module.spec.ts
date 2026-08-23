import { Test } from "@nestjs/testing";

import { AnthropicAdapter } from "./adapters/anthropic.adapter";
import { CopilotAdapter } from "./adapters/copilot.adapter";
import { CursorAdapter } from "./adapters/cursor.adapter";
import { OllamaAdapter } from "./adapters/ollama.adapter";
import { OpenAiCompatibleAdapter } from "./adapters/openai-compatible.adapter";
import type { ModelProviderAdapter } from "./provider.adapter";
import { ModelPullTracker } from "./provider.pulls";
import { MODEL_PROVIDER_ADAPTERS, ModelProviderRegistry } from "./provider.registry";
import { ProvidersModule, REGISTERED_ADAPTERS } from "./providers.module";

/**
 * The wiring, and the registration seam AC.2–AC.5 each add one line to.
 *
 * The seam is the thing worth asserting. {@link REGISTERED_ADAPTERS} grew with every adapter —
 * AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217)) put the first entry in it and
 * AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)) the last two —
 * so what this suite pins is not mainly the contents but the *mechanism*: the list is what the
 * factory injects, the factory's answer is what the registry reads, and the result is frozen.
 * `vault.module.spec.ts` guards `VAULT_SECRET_STORES` the same way — an adapter written, tested
 * and then never reachable because nobody added the line is the failure both are for.
 *
 * Nothing connects and nothing is initialised: the module holds no database and no vault, which
 * is itself part of the design and is asserted below.
 */

describe("the providers module", () => {
  it("compiles and resolves the registry", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();

    expect(moduleRef.get(ModelProviderRegistry)).toBeInstanceOf(ModelProviderRegistry);

    await moduleRef.close();
  });

  it("registers the adapters named in REGISTERED_ADAPTERS, and no others", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();
    const adapters = moduleRef.get<readonly ModelProviderAdapter[]>(MODEL_PROVIDER_ADAPTERS);

    expect(adapters).toHaveLength(REGISTERED_ADAPTERS.length);
    expect(moduleRef.get(ModelProviderRegistry).kinds()).toHaveLength(REGISTERED_ADAPTERS.length);

    await moduleRef.close();
  });

  it("reaches five of V015's six kinds, leaving custom a 501", async () => {
    // Accurate rather than a stub — `provider.registry.ts` argues why, and AD.1's
    // VAULT_SECRET_STORES is the precedent. AC.5 (#220) is what changed this assertion from
    // three kinds to five, and that is the point: adding an adapter is a visible diff here.
    //
    // `custom` is what is left, and it is honestly unsupported: V015 accepts the row and
    // nothing in this build knows what a custom provider would be. It is not a gap for a
    // ticket to close — mockup 07's add-card promises *OpenAI, Google, Bedrock, or any
    // OpenAI-compatible endpoint*, and the third of those is `openai_compatible`.
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();
    const registry = moduleRef.get(ModelProviderRegistry);

    expect(REGISTERED_ADAPTERS).toEqual([
      AnthropicAdapter,
      OpenAiCompatibleAdapter,
      OllamaAdapter,
      CopilotAdapter,
      CursorAdapter,
    ]);
    // V015's declaration order, which is what `kinds()` answers in — deliberately not the order
    // the module registers them, because a catalog's order must not depend on an injector's.
    expect(registry.kinds()).toEqual([
      "anthropic",
      "openai_compatible",
      "ollama",
      "copilot",
      "cursor",
    ]);
    expect(registry.find("custom")).toBeUndefined();

    await moduleRef.close();
  });

  it("gates pullModel on the flag rather than on the provider", async () => {
    // Four of the five do not pull, and each of them is a `422` rather than a member that
    // exists and throws. AC.1's fifth acceptance criterion, from the registry's side.
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();
    const registry = moduleRef.get(ModelProviderRegistry);

    for (const kind of ["anthropic", "openai_compatible", "copilot", "cursor"] as const) {
      expect(() => registry.pullCapable(kind)).toThrow(/does not pull models/);
    }

    await moduleRef.close();
  });

  it("reaches pullModel through the registry, and only through it", async () => {
    // AC.1's fifth acceptance criterion, live for the first time: until AC.4 there was no
    // registered adapter that declared the capability, so `pullCapable` had nothing to answer.
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();
    const registry = moduleRef.get(ModelProviderRegistry);

    expect(registry.pullCapable("ollama")).toBeInstanceOf(OllamaAdapter);
    expect(() => registry.pullCapable("anthropic")).toThrow(/does not pull models/);

    await moduleRef.close();
  });

  it("resolves the registered adapter as one Nest constructed", async () => {
    // The half a `REGISTERED_ADAPTERS` list alone cannot prove: a class named in `inject` that
    // is not also in `providers` fails to resolve, and the failure is at boot rather than here.
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();

    const registry = moduleRef.get(ModelProviderRegistry);

    expect(registry.get("anthropic")).toBeInstanceOf(AnthropicAdapter);
    expect(registry.get("openai_compatible")).toBeInstanceOf(OpenAiCompatibleAdapter);
    expect(registry.get("ollama")).toBeInstanceOf(OllamaAdapter);
    expect(registry.get("copilot")).toBeInstanceOf(CopilotAdapter);
    expect(registry.get("cursor")).toBeInstanceOf(CursorAdapter);

    await moduleRef.close();
  });

  it("freezes the injected list", async () => {
    // The registry reads it once at construction; a list something could append to at run time
    // would be a set of adapters this module's documentation does not mention.
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();

    expect(Object.isFrozen(moduleRef.get(MODEL_PROVIDER_ADAPTERS))).toBe(true);

    await moduleRef.close();
  });

  it("exports the registry and the pull tracker, and nothing else", () => {
    // Everything else stays private. A consumer reaching for MODEL_PROVIDER_ADAPTERS would be
    // iterating adapters, which is the thing the registry exists to stop. The tracker is the
    // second export and arrived with AC.4 (#219): a pull outlives the request that started it, so
    // what remembers one has to be reachable from whatever answers the next request.
    const exports = Reflect.getMetadata("exports", ProvidersModule) as unknown[] | undefined;

    expect(exports).toEqual([ModelProviderRegistry, ModelPullTracker]);
  });

  it("resolves the pull tracker as one shared instance", async () => {
    // A request-scoped tracker would forget everything the moment a page reloaded, which is the
    // failure `provider.pulls.ts` exists to prevent.
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();

    expect(moduleRef.get(ModelPullTracker)).toBe(moduleRef.get(ModelPullTracker));

    await moduleRef.close();
  });

  it("imports nothing — no database, no vault", () => {
    // The absent imports are load-bearing. An adapter is handed an already-opened connection
    // context by its caller, so a plaintext credential's lifetime is that caller's request
    // scope. The day something here needs a vault, adding the import is a visible change with a
    // reviewer attached to it.
    const imports = Reflect.getMetadata("imports", ProvidersModule) as unknown[] | undefined;

    expect(imports ?? []).toEqual([]);
  });

  it("declares no controller", () => {
    // Decision M2's shape, again: AD.2 owns add/reveal/rotate, AE.4 owns test and discovery,
    // AE.5 owns the add-form. A surface written here first is one they would have to negotiate
    // with rather than write — which is why AC.4 (#219) shipped `ModelPullTracker` as a service
    // and left the route AE.4 polls to the ticket that owns `/api/v1/providers`.
    const controllers = Reflect.getMetadata("controllers", ProvidersModule) as
      unknown[] | undefined;

    expect(controllers ?? []).toEqual([]);
  });
});
