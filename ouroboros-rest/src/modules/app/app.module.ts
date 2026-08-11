import { Module, type DynamicModule } from "@nestjs/common";

import { ConfigurationModule } from "../config/config.module";
import type { Configuration } from "../config/configuration";
import { HealthModule } from "../health/health.module";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

/**
 * The root module — the heartbeat, and the place every feature module is imported.
 *
 * `src/modules/` is one directory per concern. `health`
 * ([#29](https://github.com/NobuData/ouroboros/issues/29)) is in; the ones the epic adds
 * next are already named: `db` ([#30](https://github.com/NobuData/ouroboros/issues/30)),
 * `tenancy` ([#31](https://github.com/NobuData/ouroboros/issues/31)), `auth`
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)) and `engine`
 * ([#35](https://github.com/NobuData/ouroboros/issues/35)). Each arrives as a sibling
 * directory and one entry in the `imports` below, so what a module contributes is visible
 * in one line here rather than spread through the tree.
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
      imports: [ConfigurationModule.forRoot(configuration), HealthModule],
    };
  }
}
