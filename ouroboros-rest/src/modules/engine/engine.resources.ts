/**
 * What `GET /api/v1/engine/status` returns, and the one place an engine answer becomes it.
 *
 * The same division `src/modules/tenancy/resources.ts` sets out: what a dependency says
 * keeps that dependency's names, a resource keeps the API's, and the translation happens in
 * one function rather than wherever a controller happens to build a response.
 *
 * It is deliberately narrower than what the engine reports. `GET /v0/status` also carries
 * the engine's uptime and its distribution name; neither is in the answer, because this
 * route exists to tell an authenticated person *whether the engine is there and which build
 * it is* (`docs/ARCHITECTURE.md` § 3.2), and uptime is a number whose only reader is an
 * operator — who has the engine's own logs and the readiness probe. Adding a field later is
 * a compatible change to this API; removing one a screen has started rendering is not.
 */

import type { EngineStatus } from "./engine.contract";

/**
 * The engine, as this API reports it.
 *
 * `engine` is `"up"` and nothing else, and that is honest rather than redundant: every way
 * the engine can fail to answer this route is a `502` (`engine.errors.ts`), so a body that
 * exists at all is a body from a reachable engine. It is a field rather than nothing so the
 * shape can grow a second state — `degraded`, once there is something that could be
 * degraded — without a client having to change how it reads the first one.
 */
export interface EngineStatusResource {
  engine: "up";
  version: string;
}

/**
 * Turn what the engine said into what this API answers.
 *
 * @param status - The parsed `GET /v0/status` body.
 * @returns The resource, carrying the engine's version and nothing about its address.
 */
export function engineStatusResource(status: EngineStatus): EngineStatusResource {
  return { engine: "up", version: status.version };
}
