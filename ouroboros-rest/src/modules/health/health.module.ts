import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";

import { DatabaseHealthIndicator } from "./database.health";
import { DATABASE_PROBE_POOL, DatabaseProbePool } from "./database.pool";
import { EngineHealthIndicator } from "./engine.health";
import { HealthController } from "./health.controller";

/**
 * The health module — `/health/live`, `/health/ready`, and the two probes behind them.
 *
 * `TerminusModule` is imported without options, which takes its defaults: a failed check is
 * logged as one JSON line by the error logger it registers, and `@HealthCheck()` on the
 * routes adds the `Cache-Control: no-cache` a probe must have. What it contributes is
 * `HealthCheckService` and `HealthIndicatorService`, so the shape of a health response and
 * the 503 that carries it are the library's rather than this module's.
 *
 * It reads `OURO_DATABASE_URL` and `OURO_ENGINE_URL` by injecting `AppConfigService` and
 * imports nothing to do it: the configuration module is global
 * ([#28](https://github.com/NobuData/ouroboros/issues/28)).
 *
 * The pool is bound through a token rather than as a class provider, because the pool is
 * the part of this module with a successor: [#30](https://github.com/NobuData/ouroboros/issues/30)
 * brings a Kysely instance over a `pg` pool sized for request traffic, and swapping this
 * one line is what adopting it costs.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    { provide: DATABASE_PROBE_POOL, useClass: DatabaseProbePool },
    DatabaseHealthIndicator,
    EngineHealthIndicator,
  ],
})
export class HealthModule {}
