/**
 * Is `ouroboros-engine` reachable? — the second half of `/health/ready`.
 *
 * The engine is internal-only and requires `X-Ouro-Internal-Key` on every path except one:
 * `GET /healthz`, which [#51](https://github.com/NobuData/ouroboros/issues/51) landed open
 * precisely so a probe can read it. So this probe carries **no secret** — there is nothing
 * for a misconfigured shared key to break here, and nothing for the request to leak. The
 * key belongs to the typed client that calls `/v0/*` — `engine/engine.client.ts`
 * ([#35](https://github.com/NobuData/ouroboros/issues/35)), which this file shares its URL
 * resolution with and nothing else.
 *
 * The request is a plain `fetch`. Node 24 has one, and a readiness probe is a single GET
 * with a deadline — `@nestjs/axios` and Terminus's own `HttpHealthIndicator` would add two
 * dependencies to this module for one request, and the interceptors, retries and base-URL
 * handling they exist for belong to the engine client rather than to a probe that must
 * answer within two seconds or not at all. It does not go *through* that client either: the
 * client's job is to turn a failure into a `502` a client reads, and a probe's job is to
 * report the failure rather than to answer one.
 */

import { Injectable, Logger } from "@nestjs/common";
import { HealthIndicatorService, type HealthIndicatorResult } from "@nestjs/terminus";

import { AppConfigService } from "../config/config.service";
import { engineRouteUrl } from "../engine/engine.contract";
import { describeForLog } from "../errors/failure";
import { PROBE_TIMEOUT_MS, describeFailure } from "./probe";

/**
 * How this dependency is named in the response body — the counterpart of
 * `DATABASE_KEY`, and what a 503 names when the engine is what is missing.
 */
export const ENGINE_KEY = "engine";

/** The engine's liveness route, relative to `OURO_ENGINE_URL`. Open, per #51. */
export const ENGINE_HEALTH_ROUTE = "healthz";

/**
 * Where to probe the engine, given its base URL.
 *
 * The resolution itself is `engine/engine.contract.ts`'s, which is where every URL this
 * service builds for the engine is built — including the ones that carry a path, because an
 * engine behind a reverse proxy on `/engine` is a deployment decision this service does not
 * get to make and a probe that resolved it differently from the client would probe a
 * different service.
 *
 * @param baseUrl - `OURO_ENGINE_URL`, already validated as an absolute `http(s)` URL by
 *   the configuration schema.
 * @returns The absolute URL of the engine's liveness route.
 */
export function engineHealthUrl(baseUrl: string): string {
  return engineRouteUrl(baseUrl, ENGINE_HEALTH_ROUTE);
}

/** The engine half of the readiness probe. */
@Injectable()
export class EngineHealthIndicator {
  /** Where the real failure goes. The response body gets a classified phrase; see `probe.ts`. */
  private readonly logger = new Logger(EngineHealthIndicator.name);

  /**
   * @param config - The typed configuration, for `OURO_ENGINE_URL`.
   * @param indicators - Terminus's result builder.
   */
  constructor(
    private readonly config: AppConfigService,
    private readonly indicators: HealthIndicatorService,
  ) {}

  /**
   * Ask the engine whether it is there.
   *
   * @returns `{engine: {status: "up"}}` when `GET /healthz` answered `2xx`, and
   *   `{engine: {status: "down", message}}` otherwise — `GET /healthz responded 503`,
   *   `GET /healthz failed (ECONNREFUSED)`, `GET /healthz timed out after 2000 ms`. Never a
   *   rejected promise, for the reason `database.health.ts` gives.
   */
  async check(): Promise<HealthIndicatorResult> {
    const session = this.indicators.check(ENGINE_KEY);
    const url = engineHealthUrl(this.config.engineUrl);

    try {
      const response = await fetch(url, {
        // The deadline that makes this probe bounded. Unlike a race, an abort actually
        // ends the request — a probe polled every few seconds that left its predecessors
        // in flight would hold a socket per poll against a service that is already
        // struggling.
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });

      // The body is never read, and an unread body keeps its connection checked out of
      // undici's pool until the garbage collector gets to it. Cancelling is how a probe
      // that only wants a status code gives the socket back immediately.
      await response.body?.cancel();

      if (!response.ok) {
        const outcome = `responded ${response.status}`;

        // The URL is in the log and not in the body: `OURO_ENGINE_URL` is internal topology,
        // and this route answers without authentication.
        this.logger.error(`GET ${url} ${outcome}`);
        return session.down(`GET /${ENGINE_HEALTH_ROUTE} ${outcome}`);
      }

      return session.up();
    } catch (error) {
      const outcome = describeFailure(error);

      this.logger.error(`GET ${url} ${outcome}`, describeForLog(error));
      return session.down(`GET /${ENGINE_HEALTH_ROUTE} ${outcome}`);
    }
  }
}
