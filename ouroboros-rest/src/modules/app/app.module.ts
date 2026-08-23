import { Module, type DynamicModule } from "@nestjs/common";

import { BetterAuthModule } from "../../auth/auth.module";
import { AuthModule } from "../auth/auth.module";
import { ConfigurationModule } from "../config/config.module";
import type { Configuration } from "../config/configuration";
import { DashboardModule } from "../dashboard/dashboard.module";
import { QueueModule } from "../queue/queue.module";
import { RunsModule } from "../runs/runs.module";
import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { HealthModule } from "../health/health.module";
import { InternalModule } from "../internal/internal.module";
import { PreferencesModule } from "../preferences/preferences.module";
import { PricingModule } from "../pricing/pricing.module";
import { RegistryModule } from "../registry/registry.module";
import { SettingsModule } from "../settings/settings.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { VaultModule } from "../vault/vault.module";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

/**
 * The root module — the heartbeat, and the place every feature module is imported.
 *
 * `src/modules/` is one directory per concern. `health`
 * ([#29](https://github.com/NobuData/ouroboros/issues/29)), `db`
 * ([#30](https://github.com/NobuData/ouroboros/issues/30)), `tenancy`
 * ([#31](https://github.com/NobuData/ouroboros/issues/31)), `auth`
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)) and now `engine`
 * ([#35](https://github.com/NobuData/ouroboros/issues/35)) are in. Each arrives as a sibling
 * directory and one entry in the `imports` below, so what a module contributes is visible
 * in one line here rather than spread through the tree.
 *
 * `AuthModule` is imported before `TenancyModule` for a reason that is not alphabetical:
 * it registers the global session guard, and reading this list top to bottom should say
 * *authentication, then the routes it protects* rather than leave the reader to discover
 * the guard inside a module three lines further down. `EngineModule` comes after both,
 * which is the same thought once more: its one route is authenticated and tenant-optional,
 * and it is a route only because both guards are already registered above it.
 * `PreferencesModule` ([#649](https://github.com/NobuData/ouroboros/issues/649)) follows
 * for the same reason again — two authenticated, tenant-optional routes, listed after the
 * guards they depend on. `DashboardModule`
 * ([#70](https://github.com/NobuData/ouroboros/issues/70)) is the first module
 * whose route is tenant-*required* without naming a workspace in its path: it reads the one
 * `TenancyModule`'s guard resolved from the session, which is why it is listed after it and
 * could not be listed before. `RunsModule`
 * ([#71](https://github.com/NobuData/ouroboros/issues/71)) and `QueueModule`
 * ([#73](https://github.com/NobuData/ouroboros/issues/73)) follow — the paged
 * drill-ins over the same read-model, tenant-required the same way, listed beside the
 * aggregate they page. `SettingsModule`
 * ([#74](https://github.com/NobuData/ouroboros/issues/74)) is the page's one
 * write, tenant-required again and the first module outside `tenancy` to lean on the roles
 * guard — registered globally by `TenancyModule`, which is one more reason nothing here
 * could precede it.
 *
 * `PricingModule` ([#586](https://github.com/NobuData/ouroboros/issues/586)) follows it, and
 * is the first module here whose reason for existing is only half its routes. Its three
 * `/api/v1/registry/prices` operations are tenant-required and role-gated exactly as the
 * settings write is, so its position says the same thing theirs does; what is new is that it
 * *exports* a provider. DASH-J.4 (#92), Z.5 (#198), AB.4 (#210) and CH.5 (#588) all have to
 * answer *what does this model cost*, and importing this module is what stops that being four
 * answers.
 *
 * `RegistryModule` ([#189](https://github.com/NobuData/ouroboros/issues/189)) follows it and
 * has no routes at all, so its position says nothing about middleware. It is here for the
 * reason `DbModule` and `VaultModule` are — a provider has to be *in* the running
 * application to be injectable — and it is listed *before* `VaultModule` because
 * `VaultModule` now imports it: the vault's re-encryption sweep reaches
 * `provider_connections.credentials_encrypted` through this module's store. Its own reason
 * for having no controller is decision **M2**: the CRUD over V015's two tables belongs to
 * mockup 07 and mockup 21, and Z.2
 * ([#195](https://github.com/NobuData/ouroboros/issues/195)) is what gives the alias list a
 * route.
 *
 * `VaultModule` ([#222](https://github.com/NobuData/ouroboros/issues/222)) closes the list,
 * and breaks its pattern: it declares no controller and no route, so its position says
 * nothing about middleware or guards. It is listed for the reason `DbModule` is — a provider
 * has to be *in* the running application to be injectable into the modules that will come to
 * need it (AD.2, AC.2/3/5), and because its key wrapper decodes `OURO_VAULT_MASTER_KEY` when
 * it is constructed, which is at boot. A deployment with a malformed key therefore fails
 * while it is starting rather than on the first credential anybody stores.
 *
 * `BetterAuthModule` is the exception to that reading and comes first, from `src/auth/`
 * rather than from `src/modules/` ([#701](https://github.com/NobuData/ouroboros/issues/701)).
 * It declares no controller and protects nothing: it mounts a handler on the HTTP adapter
 * at `/api/auth/*` and re-adds the body parsers `src/application.ts` switched off for
 * everything else. Both are middleware, both apply to routes no module below has declared
 * yet, and Nest registers middleware in the order the modules are listed — so first is
 * where a body parser every other module's routes depend on belongs. It sits *beside*
 * `AuthModule` rather than replacing it for now: the sign-in that works today is still
 * #33's, and [#702](https://github.com/NobuData/ouroboros/issues/702) and
 * [#703](https://github.com/NobuData/ouroboros/issues/703) are what move people over and
 * delete it.
 *
 * `InternalModule` ([#224](https://github.com/NobuData/ouroboros/issues/224)) is last, and
 * its position is the only one it could have. It registers a global guard, and Nest runs
 * global guards in the order their modules are initialised — so being listed after
 * `BetterAuthModule` and `TenancyModule` is what lets its two routes be `@AllowAnonymous()`
 * without being public: the session guard steps aside for them, the tenant guard steps aside
 * behind it, and `InternalKeyGuard` then refuses anything that cannot prove it came from
 * inside the network. It is also the first module here whose routes are *not* under
 * `/api/v1`, which `src/application.ts` and `src/modules/internal/internal.paths.ts` between
 * them make true.
 *
 * `errors` is the exception to that shape and has no module: it holds the envelope every
 * failure is answered in, and the filter and pipe that produce it are registered on the
 * *application* rather than on a module, in `src/application.ts`, because they apply to
 * routes no module declared — a path nothing claims, a body the parser refused.
 *
 * `DbModule` is imported here rather than only by the feature modules that need a
 * repository, and that is deliberate: the pool has to be *in* the running application for
 * its shutdown hook to be called at all, and a connection that learns to drain only once
 * something is already using it drains for the first time in production. `TenancyModule`
 * imports it too, and that is not redundant — the import there is what makes
 * `DatabaseService` injectable into its repositories, and what makes "who can reach the
 * tenancy schema" a question the `imports` lists answer.
 *
 * The root is registered through {@link forRoot} rather than as a plain class, because
 * configuration is validated before the application is built and has to be handed *in* —
 * see `../config/config.module.ts` for why that ordering is not negotiable. Feature
 * modules are imported there rather than by the decorator for the same reason: they read
 * configuration, so a tree assembled without it would fail to resolve them, and the
 * decorator is what a suite that only wants the heartbeat compiles.
 */
@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  /**
   * Assemble the application's module tree around a validated configuration.
   *
   * @param configuration - The validated configuration, from `loadConfiguration`.
   * @returns The root module, with configuration registered globally.
   */
  static forRoot(configuration: Configuration): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigurationModule.forRoot(configuration),
        BetterAuthModule,
        DbModule,
        HealthModule,
        AuthModule,
        TenancyModule,
        EngineModule,
        PreferencesModule,
        DashboardModule,
        RunsModule,
        QueueModule,
        SettingsModule,
        PricingModule,
        RegistryModule,
        VaultModule,
        InternalModule,
      ],
    };
  }
}
