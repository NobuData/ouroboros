import { Test } from "@nestjs/testing";

import type { ModelProviderAdapter } from "./provider.adapter";
import { MODEL_PROVIDER_ADAPTERS, ModelProviderRegistry } from "./provider.registry";
import { ProvidersModule, REGISTERED_ADAPTERS } from "./providers.module";

/**
 * The wiring, and the registration seam AC.2–AC.5 each add one line to.
 *
 * The seam is the thing worth asserting. {@link REGISTERED_ADAPTERS} being empty is accurate
 * today and will be wrong the moment AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217))
 * lands, so what this suite pins is not the contents but the *mechanism*: the list is what the
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

  it("ships with no adapters, which is what makes every kind a 501 today", async () => {
    // Accurate rather than a stub — `provider.registry.ts` argues why, and AD.1's empty
    // VAULT_SECRET_STORES is the precedent. This assertion is expected to be *changed* by AC.2
    // rather than to keep passing, and that is the point: adding an adapter is a visible diff
    // here.
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();

    expect(REGISTERED_ADAPTERS).toEqual([]);
    expect(moduleRef.get(ModelProviderRegistry).kinds()).toEqual([]);

    await moduleRef.close();
  });

  it("freezes the injected list", async () => {
    // The registry reads it once at construction; a list something could append to at run time
    // would be a set of adapters this module's documentation does not mention.
    const moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] }).compile();

    expect(Object.isFrozen(moduleRef.get(MODEL_PROVIDER_ADAPTERS))).toBe(true);

    await moduleRef.close();
  });

  it("exports the registry, and only the registry", () => {
    // Everything else stays private. A consumer reaching for MODEL_PROVIDER_ADAPTERS would be
    // iterating adapters, which is the thing the registry exists to stop.
    const exports = Reflect.getMetadata("exports", ProvidersModule) as unknown[] | undefined;

    expect(exports).toEqual([ModelProviderRegistry]);
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
    // with rather than write.
    const controllers = Reflect.getMetadata("controllers", ProvidersModule) as
      unknown[] | undefined;

    expect(controllers ?? []).toEqual([]);
  });
});
