import { Module, type DynamicModule } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ConfigurationModule } from "../config/config.module";
import type { Configuration } from "../config/configuration";
import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { HealthModule } from "../health/health.module";
import { TenancyModule } from "../tenancy/tenancy.module";
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
        DbModule,
        HealthModule,
        AuthModule,
        TenancyModule,
        EngineModule,
      ],
    };
  }
}
