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
import { PreferencesModule } from "../preferences/preferences.module";
import { SettingsModule } from "../settings/settings.module";
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
 * ([#74](https://github.com/NobuData/ouroboros/issues/74)) closes the list: the page's one
 * write, tenant-required again and the first module outside `tenancy` to lean on the roles
 * guard — registered globally by `TenancyModule`, which is one more reason nothing here
 * could precede it.
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
      ],
    };
  }
}
