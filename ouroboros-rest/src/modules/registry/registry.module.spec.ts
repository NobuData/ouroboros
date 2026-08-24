import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { ParamSchemaController } from "./params.controller";
import { ParamSchemaService } from "./params.service";
import { RegistryModule } from "./registry.module";
import { RegistryRepository } from "./registry.repository";
import { RegistryService } from "./registry.service";
import { ProviderCredentialStore } from "./registry.secrets";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg`
 * connects lazily, and no query is issued.
 *
 * Three of these assertions are decisions rather than checks. **One controller and only the
 * read** is decision **M2** as it now stands: the module declared none until mockup 21 arrived
 * (CH.2, [#585](https://github.com/NobuData/ouroboros/issues/585)), and what it declares is a
 * schema *read* — so the day a create, update or delete appears here it appears in this
 * assertion too, which is where CH.1 ([#584](https://github.com/NobuData/ouroboros/issues/584))
 * should have to state its intent. **Three exports and no more** is the second:
 * `RegistryService` is the internal contract Y.2, Z.1, Z.2 and the estimator were told to
 * consume, `ProviderCredentialStore` exists for exactly one importer — `VaultModule` — and
 * `ParamSchemaService` is what CH.1's writes validate through. **No vault import** is the
 * third.
 */

describe("the registry module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegistryModule],
    }).compile();

    expect(moduleRef.get(RegistryService)).toBeInstanceOf(RegistryService);
    expect(moduleRef.get(RegistryRepository)).toBeInstanceOf(RegistryRepository);
    expect(moduleRef.get(ProviderCredentialStore)).toBeInstanceOf(ProviderCredentialStore);
    expect(moduleRef.get(ParamSchemaService)).toBeInstanceOf(ParamSchemaService);

    await moduleRef.close();
  });

  it("declares exactly one controller, and it is the param-schema read", () => {
    // Decision M2 as it now stands. Until CH.2 this module had none at all, and what it has is
    // a read: `GET /registry/param-schema` creates, updates and deletes nothing. A second entry
    // in this list is mockup 21's alias CRUD arriving, which is CH.1's (#584) to write here —
    // and this assertion is where that has to be said out loud rather than noticed in review.
    expect(Reflect.getMetadata("controllers", RegistryModule) as unknown[] | undefined).toEqual([
      ParamSchemaController,
    ]);
  });

  it("exports the two services and the credential store, and nothing else", () => {
    // The repository stays private: a consumer that reached past the service would be one
    // that had skipped the refusal `resolve` raises for an unknown alias, which is the
    // decision the service exists to make once.
    const exports = Reflect.getMetadata("exports", RegistryModule) as unknown[] | undefined;

    expect(exports).toEqual([RegistryService, ProviderCredentialStore, ParamSchemaService]);
  });

  it("does not import the vault", () => {
    // Nothing here decrypts anything — a resolution carries an address and a model, never a
    // credential — and the sweep hands this module an already-sealed envelope rather than
    // asking it to produce one. The absent import is what keeps that true as the module
    // grows: the day something here needs a plaintext, adding it is a visible change.
    const imports = (Reflect.getMetadata("imports", RegistryModule) as { name?: string }[]) ?? [];

    // `ProvidersModule` is the second and the only one CH.2 added: a param schema is whatever
    // the bound adapter says it is, and decision P1 is that core code reaches one through
    // `ModelProviderRegistry` rather than by importing it. It brings no vault with it.
    expect(imports.map((imported) => imported.name)).toEqual(["DbModule", "ProvidersModule"]);
  });

  it("is importable on its own, so a consumer gets the service and nothing else", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegistryModule],
    }).compile();

    expect(moduleRef.get(RegistryService)).toBeInstanceOf(RegistryService);

    await moduleRef.close();
  });
});
