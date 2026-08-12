/**
 * The engine-status resource — whether `ouroboros-engine` is reachable, and which build
 * answered.
 *
 * The engine is internal: it is reachable from `ouroboros-rest` and from nothing else
 * (`docs/ARCHITECTURE.md` § 10), so this operation is the only way a signed-in person
 * learns anything about it at all. This module adds no more to it than
 * `app/api/tenants.ts` adds to the workspaces listing — a name, a path written down once,
 * and the body rather than the body-or-nothing a raw call returns.
 *
 * **Every way the engine can fail to answer is one `502`.** Down, too slow, at an address
 * that no longer resolves, holding a different shared secret, answering outside its own
 * contract — the contract makes them indistinguishable on purpose, so that a caller learns
 * the system cannot serve the request and nothing it could use to probe the inside of the
 * network. That is why {@link EngineStatus.engine} is the constant `"up"`: a body that
 * exists at all came from a reachable engine, and *not reachable* arrives as a rejection
 * rather than as a second value of that field. `app/dashboard/data.ts` is where that
 * rejection becomes a degraded pill.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** What the engine reported: that it is up, and which build said so. */
export type EngineStatus = components["schemas"]["EngineStatus"];

/**
 * The `code` the contract answers with when the engine could not serve the request.
 *
 * Named here rather than matched on the status, because `code` is what the contract asks a
 * caller to branch on — the status is for the log line (`app/api/errors.ts`).
 */
export const ENGINE_UNAVAILABLE_CODE = "engine_unavailable";

/**
 * The engine, as `ouroboros-rest` sees it.
 *
 * One method, because the contract has one.
 */
export const engine = {
  /**
   * Whether the engine is reachable, and which build answered.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The status. `engine` is always `"up"` — see this file's own note for why.
   * @throws {ApiError} What the service answered. `502 engine_unavailable` is the engine
   *   being unreachable by any of the five routes to it, and is the failure a caller is
   *   expected to handle; a `401` redirects to login before this rejects.
   */
  async status(client: ApiClient = api()): Promise<EngineStatus> {
    return unwrap(await client.GET("/api/v1/engine/status", {}));
  },
};
