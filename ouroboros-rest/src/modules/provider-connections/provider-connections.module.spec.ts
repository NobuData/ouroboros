import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { DatabaseService } from "../db/db.service";
import { ProvidersModule } from "../providers/providers.module";
import { RegistryModule } from "../registry/registry.module";
import { RegistryService } from "../registry/registry.service";
import { ModelProviderRegistry } from "../providers/provider.registry";
import { VaultModule } from "../vault/vault.module";
import { VaultService } from "../vault/vault.service";
import { ProviderAudit } from "./connection.audit";
import { ProviderConnectionsController } from "./provider-connections.controller";
import { ProviderConnectionsModule } from "./provider-connections.module";
import { ProviderConnectionsRepository } from "./provider-connections.repository";
import { ProviderConnectionsService } from "./provider-connections.service";
import { RevealLimiter } from "./reveal.limiter";
import { StepUpRegistry, StepUpService } from "./step-up";

/**
 * What the module wires, and the two claims about it that are worth an assertion.
 *
 * **The stateful singletons really are singletons.** An attempt and a step-up confirmation
 * both outlive the request that made them, so a limiter resolved per request would be a limit
 * of one attempt per request — which is to say, no limit at all. The injector is the thing
 * that decides that, so the injector is what is asked.
 *
 * **It exports nothing.** The routes are the surface; a module that exported its service
 * would be inviting a second caller to bypass the role gate, the rate limiter and the
 * step-up, which is the whole of what this module is.
 */

/** A container with the module's real graph, and only its two edges to the world stubbed. */
async function container() {
  return (
    Test.createTestingModule({
      // The configuration module is global in the running application; a testing container
      // has to be given it, exactly as `vault.module.spec.ts` gives it one.
      imports: [ConfigurationModule.forRoot(testConfiguration()), ProviderConnectionsModule],
    })
      // The database and BetterAuth are the two things a unit suite has neither of — the
      // first because constructing the real `DatabaseService` opens a pool, which is
      // precisely what a suite that starts nothing must not do. Everything else — the vault,
      // the adapter registry, the alias resolution — is the real graph, so a provider this
      // module forgot to import would fail to resolve here rather than in production.
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(StepUpService)
      .useValue({ satisfied: jest.fn() })
      .compile()
  );
}

describe("the provider connections module", () => {
  it("resolves the surface and its three layers", async () => {
    const app = await container();

    expect(app.get(ProviderConnectionsController)).toBeInstanceOf(ProviderConnectionsController);
    expect(app.get(ProviderConnectionsService)).toBeInstanceOf(ProviderConnectionsService);
    expect(app.get(ProviderConnectionsRepository)).toBeInstanceOf(ProviderConnectionsRepository);
    expect(app.get(ProviderAudit)).toBeInstanceOf(ProviderAudit);
  });

  it("holds one limiter and one step-up registry for the whole process", async () => {
    // A limiter resolved per request would be a limit of one attempt per request, which is no
    // limit; a registry resolved per request would forget every confirmation immediately.
    const app = await container();

    expect(app.get(RevealLimiter)).toBe(app.get(RevealLimiter));
    expect(app.get(StepUpRegistry)).toBe(app.get(StepUpRegistry));
  });

  it("reaches a provider only through the adapter registry", async () => {
    // Decision **P1**: no core service imports an adapter. `.dependency-cruiser.cjs` is what
    // makes that a build failure; this is the positive half — the registry is injectable here
    // because `ProvidersModule` is imported, and nothing else from it is.
    const app = await container();

    expect(app.get(ModelProviderRegistry)).toBeInstanceOf(ModelProviderRegistry);
  });

  it("reaches the vault and the alias resolution through their own modules", async () => {
    const app = await container();

    expect(app.get(VaultService)).toBeInstanceOf(VaultService);
    expect(app.get(RegistryService)).toBeInstanceOf(RegistryService);
  });

  it("imports exactly the five modules whose capabilities it borrows", () => {
    // `AuditModule` joined the four with AD.4 (#225): the trail is another module's
    // capability, reached through its exported service, on the same terms as the vault's and
    // the registry's. It is not a provider declared here, which is what keeps *the address
    // comes from the request rather than from the caller* true of every event.
    const imports = Reflect.getMetadata("imports", ProviderConnectionsModule) as unknown[];

    expect(imports).toEqual([DbModule, VaultModule, ProvidersModule, RegistryModule, AuditModule]);
  });

  it("exports nothing", () => {
    // The routes are the surface. `PricingModule` is this service's one deliberate exception
    // and argues its own case; there is no equivalent argument here.
    expect(Reflect.getMetadata("exports", ProviderConnectionsModule)).toBeUndefined();
  });

  it("declares one controller", () => {
    expect(Reflect.getMetadata("controllers", ProviderConnectionsModule)).toEqual([
      ProviderConnectionsController,
    ]);
  });
});
