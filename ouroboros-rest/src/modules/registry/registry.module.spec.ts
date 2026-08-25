import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { AliasesController } from "./aliases.controller";
import { AliasesRepository } from "./aliases.repository";
import { AliasesService } from "./aliases.service";
import { ImportController } from "./import.controller";
import { ImportRepository } from "./import.repository";
import { ImportService } from "./import.service";
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
 * Three of these assertions are decisions rather than checks. **The controller list** is
 * decision **M2** as it now stands: the module declared none until mockup 21 arrived (CH.2,
 * [#585](https://github.com/NobuData/ouroboros/issues/585)), and what it declared was a schema
 * *read* — so every surface added since has had to appear in this assertion, which is where
 * CH.1 ([#584](https://github.com/NobuData/ouroboros/issues/584)) and CH.4
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)) each had to state their intent.
 * **Three exports and no more** is the second:
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

  it("declares exactly three controllers: the schema read, the lifecycle and the import", () => {
    // Decision M2 as it now stands. Until CH.2 this module had no controller at all; CH.2
    // added a read, CH.1 (#584) is mockup 21 writing its own API — the alias CRUD M2 left to
    // that roadmap — and CH.4 (#587) is the head's other button. A fourth entry in this list
    // is a new surface arriving, and this assertion is where that has to be said out loud
    // rather than noticed in review.
    expect(Reflect.getMetadata("controllers", RegistryModule) as unknown[] | undefined).toEqual([
      ParamSchemaController,
      AliasesController,
      ImportController,
    ]);
  });

  it("resolves the import's two layers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegistryModule],
    }).compile();

    expect(moduleRef.get(ImportService)).toBeInstanceOf(ImportService);
    expect(moduleRef.get(ImportRepository)).toBeInstanceOf(ImportRepository);

    await moduleRef.close();
  });

  it("resolves the alias lifecycle's two layers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegistryModule],
    }).compile();

    expect(moduleRef.get(AliasesService)).toBeInstanceOf(AliasesService);
    expect(moduleRef.get(AliasesRepository)).toBeInstanceOf(AliasesRepository);

    await moduleRef.close();
  });

  it("exports the three services and the credential store, and nothing else", () => {
    // The repositories stay private: a consumer that reached past a service would be one that
    // had skipped the refusal `resolve` raises for an unknown alias, which is the decision the
    // service exists to make once. `AliasesService` is CH.5's (#588) — its composed read builds
    // mockup 21's table on this list rather than querying `model_aliases` a second time — and
    // it is the service rather than `AliasesRepository` for exactly the reason above.
    const exports = Reflect.getMetadata("exports", RegistryModule) as unknown[] | undefined;

    expect(exports).toEqual([
      RegistryService,
      ProviderCredentialStore,
      ParamSchemaService,
      AliasesService,
    ]);
  });

  it("does not import the vault", () => {
    // Nothing here decrypts anything — a resolution carries an address and a model, never a
    // credential — and the sweep hands this module an already-sealed envelope rather than
    // asking it to produce one. The absent import is what keeps that true as the module
    // grows: the day something here needs a plaintext, adding it is a visible change. CH.5
    // (#588) is that day for the *registry page* and did not change this line — its composed
    // read needs a mask, so it lives in `RegistryReadModule`, which imports this module and the
    // vault. The seam is deliberate; `registry-read.module.ts` argues it, and a cycle is what
    // the alternative would have been.
    const imports = (Reflect.getMetadata("imports", RegistryModule) as { name?: string }[]) ?? [];

    // `ProvidersModule` is the one CH.2 added: a param schema is whatever the bound adapter
    // says it is, and decision P1 is that core code reaches one through `ModelProviderRegistry`
    // rather than by importing it. `PricingModule` is CH.4's (#587), for the candidate rows'
    // price preview — CH.3's single resolution, consumed rather than re-derived. Neither
    // brings a vault with it.
    expect(imports.map((imported) => imported.name)).toEqual([
      "DbModule",
      "PricingModule",
      "ProvidersModule",
    ]);
  });

  it("is importable on its own, so a consumer gets the service and nothing else", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegistryModule],
    }).compile();

    expect(moduleRef.get(RegistryService)).toBeInstanceOf(RegistryService);

    await moduleRef.close();
  });
});
