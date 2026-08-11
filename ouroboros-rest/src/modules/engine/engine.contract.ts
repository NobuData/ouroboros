/**
 * `ouroboros-engine`'s `/v0` contract, mirrored — the shapes, the routes, and the header.
 *
 * The engine publishes a versioned contract and this service is its only caller
 * (`docs/ARCHITECTURE.md` § 5.2). Mirroring it *here* rather than inside the client is what
 * makes the mirror reviewable: this file and
 * [`ouroboros-engine/openapi.yaml`](../../../../ouroboros-engine/openapi.yaml) can be read
 * side by side, and nothing else in this service needs to know what the engine's JSON looks
 * like.
 *
 * Three decisions about how it is mirrored:
 *
 *   * **The wire is parsed, not asserted.** Every response goes through a zod schema before
 *     a caller sees it, so an engine that answered with something else — a proxy's error
 *     page, an older build, a field that changed type — is a `502` at the boundary rather
 *     than an `undefined` several layers into a handler. A cast would have compiled and been
 *     wrong at exactly the moment it mattered.
 *   * **Unknown fields are ignored rather than refused.** `/v0` is unstable by definition
 *     and its compatibility rule says a field may be *added* to a response; a client that
 *     rejected one would turn every forward-compatible engine release into an outage here.
 *     zod's default is to strip, which is that rule spelled correctly, and the fields this
 *     service actually reads are the ones below.
 *   * **The naming convention changes at this boundary.** The engine speaks `snake_case`
 *     because it is Python; this service and its own API speak `camelCase`. The translation
 *     happens once, in the schemas' `transform`, so no NestJS code below this file carries
 *     `uptime_seconds` and no reader has to remember which side of the boundary they are on.
 */

import { z } from "zod";

/**
 * The header the shared secret travels on.
 *
 * Written the way `ouroboros-engine/src/ouroboros_engine/core/security.py` writes it, and
 * the value is `OURO_ENGINE_SHARED_SECRET` — the same variable on both sides.
 */
export const INTERNAL_KEY_HEADER = "X-Ouro-Internal-Key";

/** The engine's versioned prefix. A breaking change to the contract is a new one. */
export const ENGINE_API_VERSION = "v0";

/** `GET` — which build is answering, and for how long it has been. */
export const ENGINE_STATUS_ROUTE = `${ENGINE_API_VERSION}/status`;

/** `POST` — the contract exemplar: a task, handed straight back. */
export const ENGINE_ECHO_ROUTE = `${ENGINE_API_VERSION}/tasks/echo`;

/**
 * Resolve a route against the engine's base URL.
 *
 * Resolved against a base with a trailing slash rather than concatenated, so a base URL
 * that carries a path — an engine behind a reverse proxy on `/engine`, which is a
 * deployment decision this service does not get to make — keeps it. `new URL("v0/status",
 * "http://host/engine")` would drop the `/engine`; `new URL("v0/status",
 * "http://host/engine/")` does not.
 *
 * @param baseUrl - `OURO_ENGINE_URL`, already validated as an absolute `http(s)` URL by the
 *   configuration schema.
 * @param route - A route relative to it, without a leading slash — one of the constants
 *   above, or `health.ENGINE_HEALTH_ROUTE`.
 * @returns The absolute URL to call.
 */
export function engineRouteUrl(baseUrl: string, route: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(route, base).toString();
}

/** What `GET /v0/status` answers, in this service's names. */
export interface EngineStatus {
  /** The engine's distribution name — constant across deployments. */
  service: string;
  /** The installed version of the build that answered. */
  version: string;
  /** Seconds since that process built its application. */
  uptimeSeconds: number;
}

/** A task for `POST /v0/tasks/echo`, in this service's names. */
export interface EchoTask {
  /** Which kind of task this is, as the engine's registry would name it. */
  taskKind: string;
  /** The task's own arguments. Opaque to this service — it brokers, it does not read. */
  payload: Record<string, unknown>;
}

/** What `POST /v0/tasks/echo` answers, in this service's names. */
export interface EchoResult {
  /** Always `true`: a task the engine did not accept is an error, not a `false`. */
  accepted: true;
  /** The task as the engine parsed it — what it understood, not what was sent. */
  echo: EchoTask;
  /** The installed version of the build that accepted it. */
  engineVersion: string;
}

/** `GET /v0/status`, as it arrives. */
export const engineStatusSchema = z
  .object({
    service: z.string(),
    version: z.string(),
    uptime_seconds: z.number(),
  })
  .transform((body): EngineStatus => ({
    service: body.service,
    version: body.version,
    uptimeSeconds: body.uptime_seconds,
  }));

/** The task shape, in both directions — it is the request body and the `echo` in the answer. */
const echoTaskSchema = z
  .object({
    task_kind: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .transform((body): EchoTask => ({ taskKind: body.task_kind, payload: body.payload }));

/** `POST /v0/tasks/echo`, as it arrives. */
export const echoResultSchema = z
  .object({
    // The engine documents this as `const: true`, so anything else is an engine this
    // client does not understand rather than a task that was declined.
    accepted: z.literal(true),
    echo: echoTaskSchema,
    engine_version: z.string(),
  })
  .transform((body): EchoResult => ({
    accepted: body.accepted,
    echo: body.echo,
    engineVersion: body.engine_version,
  }));

/**
 * A task, as the engine's request body.
 *
 * The only place this service writes `snake_case`, and the counterpart of the schemas
 * above — so the translation is in one file in both directions.
 *
 * @param task - The task to send.
 * @returns The body to serialise.
 */
export function echoRequestBody(task: EchoTask): Record<string, unknown> {
  return { task_kind: task.taskKind, payload: task.payload };
}
