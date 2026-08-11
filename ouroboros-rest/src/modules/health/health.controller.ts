import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { HealthCheck, HealthCheckService, type HealthCheckResult } from "@nestjs/terminus";

import { Public } from "../auth/public.decorator";
import { DatabaseHealthIndicator } from "./database.health";
import { EngineHealthIndicator } from "./engine.health";
import { HEALTH_PATH, LIVE_ROUTE, READY_ROUTE } from "./health.paths";

/**
 * `GET /health/live` and `GET /health/ready` — the two questions a platform asks.
 *
 * They are two routes because they have two different readers and two different
 * consequences, which is the whole of issue
 * [#29](https://github.com/NobuData/ouroboros/issues/29):
 *
 *   * **Liveness** answers *is this process still working?* Its reader restarts the
 *     container when the answer is no, so it must depend on nothing but the process — a
 *     liveness probe that fails because PostgreSQL is down restarts every replica of a
 *     service that was perfectly healthy, and does it repeatedly, while the database is
 *     the thing that needs attention.
 *   * **Readiness** answers *can this process serve a request?* Its reader takes the
 *     container out of rotation, or holds a compose dependency back, and putting it back
 *     costs nothing — so this one is allowed to say no because a dependency is missing, and
 *     names which.
 *
 * Both are `VERSION_NEUTRAL` and both sit at the origin root; see `health.paths.ts` for
 * why, and `src/application.ts` for the exclusion that puts them there.
 *
 * Both are `@Public()` too, and for the third time the same reason: their reader is a
 * container platform, which holds no session and could not be given one
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)). A probe behind authentication
 * is a probe that reports the service unhealthy the moment authentication is what is
 * broken. Nothing they answer with is worth protecting — see `probe.ts`, which is where a
 * driver's message is already kept out of a body that answers to strangers.
 */
@Public()
@Controller({ path: HEALTH_PATH, version: VERSION_NEUTRAL })
export class HealthController {
  /**
   * @param health - Terminus's aggregator: it runs the indicators, merges their results
   *   into one body, and throws a `ServiceUnavailableException` carrying that body when any
   *   of them is `down` — which is what makes the 503 and the per-dependency JSON one
   *   thing rather than two.
   * @param database - The `SELECT 1` probe.
   * @param engine - The `GET /healthz` probe.
   */
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly engine: EngineHealthIndicator,
  ) {}

  /**
   * Report that the process is up and serving.
   *
   * Deliberately shallow: no indicators, so it opens no connection, reads no configuration
   * and calls nothing downstream. Reaching this handler at all is the answer — exactly as
   * the engine's own `/healthz` is written
   * ([#51](https://github.com/NobuData/ouroboros/issues/51)).
   *
   * @returns Terminus's report with three empty sections and `status: "ok"`. It is checked
   *   through `HealthCheckService` rather than returned as a literal so that both probes
   *   answer in one shape, and so that a `SIGTERM` already received turns this into
   *   `shutting_down` — a process on its way out should stop being called live.
   */
  @Get(LIVE_ROUTE)
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /**
   * Report whether this service's dependencies are reachable.
   *
   * The two indicators run concurrently and independently — Terminus settles all of them
   * before deciding — so the body reports on both even when both are down, rather than
   * short-circuiting on the first failure. That independence is the issue's first
   * acceptance criterion.
   *
   * @returns Terminus's report, `status: "ok"` with both dependencies under `info` when
   *   they answered.
   * @throws {ServiceUnavailableException} `503`, carrying the same report with the failing
   *   dependencies under `error` and every dependency under `details`, when either is down.
   */
  @Get(READY_ROUTE)
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.check(), () => this.engine.check()]);
  }
}
