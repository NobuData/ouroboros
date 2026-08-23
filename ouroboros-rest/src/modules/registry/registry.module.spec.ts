import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { RegistryModule } from "./registry.module";
import { RegistryRepository } from "./registry.repository";
import { RegistryService } from "./registry.service";
import { ProviderCredentialStore } from "./registry.secrets";

/**
 * The wiring — the one thing about a Nest module that can be wrong at run time and right at
 * compile time; `tenancy.module.spec.ts` carries the argument. Nothing connects: `pg`
 * connects lazily, and no query is issued.
 *
 * Two of these assertions are decisions rather than checks. **No controller** is decision
 * **M2** — the CRUD over V015's tables belongs to mockups 07 and 21 — and it should fail here
 * on the day somebody adds one rather than be noticed in review. **Two exports and no more**
 * is the other: `RegistryService` is the internal contract Y.2, Z.1, Z.2 and the estimator
 * were told to consume, and `ProviderCredentialStore` exists for exactly one importer, which
 * is `VaultModule`.
 */

describe("the registry module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegistryModule],
    }).compile();

    expect(moduleRef.get(RegistryService)).toBeInstanceOf(RegistryService);
    expect(moduleRef.get(RegistryRepository)).toBeInstanceOf(RegistryRepository);
    expect(moduleRef.get(ProviderCredentialStore)).toBeInstanceOf(ProviderCredentialStore);

    await moduleRef.close();
  });

  it("declares no controller — decision M2, and nothing here is reachable over HTTP", () => {
    // Z.2 (#195) is what puts the alias list on a route, and it imports this module rather
    // than reaching past it. A controller here would be mockup 07's and 21's surfaces being
    // pre-empted by the roadmap that only needed to read their data.
    expect(Reflect.getMetadata("controllers", RegistryModule) as unknown[] | undefined).toEqual(
      undefined,
    );
  });

  it("exports the service and the credential store, and nothing else", () => {
    // The repository stays private: a consumer that reached past the service would be one
    // that had skipped the refusal `resolve` raises for an unknown alias, which is the
    // decision the service exists to make once.
    const exports = Reflect.getMetadata("exports", RegistryModule) as unknown[] | undefined;

    expect(exports).toEqual([RegistryService, ProviderCredentialStore]);
  });

  it("does not import the vault", () => {
    // Nothing here decrypts anything — a resolution carries an address and a model, never a
    // credential — and the sweep hands this module an already-sealed envelope rather than
    // asking it to produce one. The absent import is what keeps that true as the module
    // grows: the day something here needs a plaintext, adding it is a visible change.
    const imports = (Reflect.getMetadata("imports", RegistryModule) as { name?: string }[]) ?? [];

    expect(imports.map((imported) => imported.name)).toEqual(["DbModule"]);
  });

  it("is importable on its own, so a consumer gets the service and nothing else", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegistryModule],
    }).compile();

    expect(moduleRef.get(RegistryService)).toBeInstanceOf(RegistryService);

    await moduleRef.close();
  });
});
