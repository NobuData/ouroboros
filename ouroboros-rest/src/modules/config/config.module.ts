import { Module, type DynamicModule } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";

import { AppConfigService } from "./config.service";
import type { Configuration } from "./configuration";

/**
 * Configuration, as the module tree sees it.
 *
 * It takes an *already validated* {@link Configuration} rather than validating one
 * itself, and that is the load-bearing decision in this file. Validation belongs to the
 * process entry point, before `NestFactory.create` is called at all: a schema evaluated
 * while Nest is building the tree fails inside the framework's own error handling, which
 * prints a stack trace — the exact outcome
 * [#28](https://github.com/NobuData/ouroboros/issues/28) exists to prevent. `main.ts`
 * parses the environment first, prints one line naming the variable if it does not
 * validate, and only builds an application when there is a configuration to build it
 * with. The type is what enforces that ordering: there is no way to register this module
 * without having already produced a `Configuration`, and the only way to produce one is
 * `loadConfiguration`.
 *
 * The module is **global**. Every feature module the epic adds — health
 * ([#29](https://github.com/NobuData/ouroboros/issues/29)), the database pool
 * ([#30](https://github.com/NobuData/ouroboros/issues/30)), auth
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)), the engine client
 * ([#35](https://github.com/NobuData/ouroboros/issues/35)) — needs configuration, so
 * importing it in each of them would be ceremony rather than information.
 */
@Module({})
export class ConfigurationModule {
  /**
   * Register configuration for the application.
   *
   * @param configuration - The validated configuration, from `loadConfiguration`.
   * @returns A global module exporting {@link AppConfigService}.
   */
  static forRoot(configuration: Configuration): DynamicModule {
    return {
      module: ConfigurationModule,
      global: true,
      imports: [
        NestConfigModule.forRoot({
          // The process environment is the only source, matching ouroboros-engine: what a
          // container is started with is exactly what the service runs with, and there is
          // no file on disk that can disagree with it.
          ignoreEnvFile: true,
          // Without this, ConfigService falls back to process.env for a key it does not
          // hold — so a typo would read an unvalidated value instead of failing. The
          // validated object below is the whole of what this service is configured by.
          skipProcessEnv: true,
          cache: true,
          load: [() => configuration],
        }),
      ],
      providers: [AppConfigService],
      exports: [AppConfigService],
    };
  }
}
