/**
 * The credential lifecycle — `/api/v1/providers`, over V015's `provider_connections`
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)), roadmap decision **P4**.
 *
 * The same three layers as everywhere, with four files beside them that carry a rule each:
 *
 * ```
 * controller   the six routes, the role gate            → provider-connections.controller.ts
 * service      the order of operations, which is the    → provider-connections.service.ts
 *              whole ticket: check, then write
 * repository   the statements, and the two that name    → provider-connections.repository.ts
 *              the sealed column
 * ---
 * masking.ts        ••••Xq4A, computed from bytes       → what a list is allowed to say
 * step-up.ts        the price of a reveal               → BetterAuth's two capabilities
 * reveal.limiter.ts how often a key may be asked for    → per user, per connection
 * connection.audit.ts the trail, on AD.3's interim seam → AD.4 (#225) replaces the sink
 * config.validation.ts the dialect, as a checker        → the adapter's own schema
 * config.mapping.ts    field name ↔ column              → and the honest 501 where there is none
 * ```
 *
 * **Four modules are imported and each one is a capability this module is not allowed to
 * have of its own.**
 *
 *   * `DbModule` — the answer to *who can reach `provider_connections`*, and non-global so
 *     the question has one.
 *   * `VaultModule` — AD.1's ([#222](https://github.com/NobuData/ouroboros/issues/222))
 *     envelope encryption. Nothing here implements cryptography; V015's own CHECK is what
 *     makes that true of every other writer too.
 *   * `ProvidersModule` — AC.1's ([#216](https://github.com/NobuData/ouroboros/issues/216))
 *     adapter registry, and **only** the registry. `.dependency-cruiser.cjs` fails the build
 *     on a core service that imports an adapter, which is what keeps decision **P1**'s
 *     promise that no module outside `providers/adapters/` learns a vendor's name.
 *   * `RegistryModule` — Y.1's ([#189](https://github.com/NobuData/ouroboros/issues/189))
 *     alias resolution, for the one question `DELETE` asks. Y.1 wrote
 *     `providerConnectionInUse` *for* this ticket and left it unthrown; this is where it is
 *     thrown.
 *
 * `BetterAuthModule` is **not** imported and does not need to be: the library's own module
 * is global, so `AuthService` — the typed access to `auth.api` the step-up's password check
 * goes through — is injectable wherever it has been registered. `AuthController` reaches
 * sign-out the same way.
 *
 * **It exports nothing.** The routes are the surface. A module that exported its service
 * would be inviting a second caller to bypass the role gate, the rate limiter and the
 * step-up — which is the whole of what this module is. `PricingModule`'s export is the
 * deliberate exception in this service and it argues its own case; there is no equivalent
 * argument here, and AE.2/AE.3/AE.5 consume these routes rather than this class.
 *
 * `RevealLimiter` and `StepUpRegistry` are **singletons with state**, which nothing else in
 * this module is: an attempt and a confirmation both outlive the request that made them, so
 * what remembers one has to outlive that request too. `ModelPullTracker` is the precedent,
 * and each file states what its memory costs in a deployment with more than one replica.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { ProvidersModule } from "../providers/providers.module";
import { RegistryModule } from "../registry/registry.module";
import { VaultModule } from "../vault/vault.module";
import { ProviderAudit } from "./connection.audit";
import { ProviderConnectionsController } from "./provider-connections.controller";
import { ProviderConnectionsRepository } from "./provider-connections.repository";
import { ProviderConnectionsService } from "./provider-connections.service";
import { RevealLimiter } from "./reveal.limiter";
import { StepUpRegistry, StepUpService } from "./step-up";

@Module({
  imports: [DbModule, VaultModule, ProvidersModule, RegistryModule],
  controllers: [ProviderConnectionsController],
  providers: [
    ProviderConnectionsService,
    ProviderConnectionsRepository,
    ProviderAudit,
    RevealLimiter,
    StepUpRegistry,
    StepUpService,
  ],
})
export class ProviderConnectionsModule {}
