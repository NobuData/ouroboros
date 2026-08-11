/**
 * Where the probes answer — written once, because four things have to agree about it.
 *
 * The controller declares these routes, `src/application.ts` excludes them from the
 * global `/api` prefix, `openapi.yaml` describes them, and a `HEALTHCHECK`
 * ([#36](https://github.com/NobuData/ouroboros/issues/36)) and the compose stack
 * ([#55](https://github.com/NobuData/ouroboros/issues/55)) call them. A probe path that
 * moved in one of those places and not the others is a container that reports unhealthy
 * while the service is fine, so there is one definition and everything reads it — the way
 * `ouroboros-engine` hands its own `HEALTH_PATH` to the middleware that exempts it.
 *
 * **The probes sit at the origin root, outside `/api/v1`.** That is the load-bearing
 * decision in this file. A probe is read by infrastructure with no notion of an API
 * version — a Dockerfile's `HEALTHCHECK`, a compose healthcheck, a scheduler's liveness
 * probe — and each of those is configured once and must keep working when the API adds a
 * version or retires one. `/api/v1/health/live` would tie a container's own liveness to
 * the lifetime of `v1`; `/health/live` does not, which is also why the engine's is
 * `/healthz` rather than `/v0/healthz`.
 */

/** Path segment both probes sit under, as the controller declares it. */
export const HEALTH_PATH = "health";

/** Route segment of the liveness probe, relative to {@link HEALTH_PATH}. */
export const LIVE_ROUTE = "live";

/** Route segment of the readiness probe, relative to {@link HEALTH_PATH}. */
export const READY_ROUTE = "ready";

/** The liveness probe, as a client calls it: `/health/live`. */
export const HEALTH_LIVE_PATH = `/${HEALTH_PATH}/${LIVE_ROUTE}`;

/** The readiness probe, as a client calls it: `/health/ready`. */
export const HEALTH_READY_PATH = `/${HEALTH_PATH}/${READY_ROUTE}`;

/**
 * Both probe paths.
 *
 * This is the list `src/application.ts` hands `setGlobalPrefix` as its exclusions and the
 * list the specification suite allows outside the versioned base path — so the routes
 * that escape `/api/v1` are enumerated in one place rather than being whatever a
 * controller happened to opt out of.
 */
export const PROBE_PATHS = [HEALTH_LIVE_PATH, HEALTH_READY_PATH] as const;
