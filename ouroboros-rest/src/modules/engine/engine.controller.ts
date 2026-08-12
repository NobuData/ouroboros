/**
 * `GET /api/v1/engine/status` — the controlled pass-through to `ouroboros-engine`.
 *
 * One route, and its narrowness is the design. `docs/ARCHITECTURE.md` § 10's first
 * invariant is that the UI never touches the engine, and the way an invariant like that
 * fails in practice is a generic proxy: a route that forwards a path, a method and a body to
 * an internal service is the boundary written as a hole. So this is a *pass-through* rather
 * than a proxy — a named operation, with its own contract in `openapi.yaml`, that happens to
 * be answered by asking the engine one question. The next engine feature is another named
 * operation beside it.
 *
 * It requires a session, by the polarity `@AllowAnonymous()` establishes: a route is
 * authenticated unless it says otherwise
 * ([#33](https://github.com/NobuData/ouroboros/issues/33), and
 * [#703](https://github.com/NobuData/ouroboros/issues/703) for the guard that enforces it
 * now). The
 * engine's version and reachability are not a secret worth much, but they are also nothing a
 * signed-out visitor has any business asking, and "this is the one route we left open" is
 * how a surface starts growing exceptions.
 *
 * It is `@TenantOptional()` for the reason `/auth/me` is
 * ([#32](https://github.com/NobuData/ouroboros/issues/32)): the question is about the
 * *installation*, not about a workspace. There is one engine behind every tenant, so
 * requiring the caller to name one first would be asking for something the answer does not
 * depend on.
 */

import { Controller, Get } from "@nestjs/common";

import { TenantOptional } from "../tenancy/tenant.decorators";
import { EngineClient } from "./engine.client";
import { engineStatusResource, type EngineStatusResource } from "./engine.resources";

/** Path segment this controller's routes sit under, below `/api/v1`. */
export const ENGINE_PATH = "engine";

/** The route that reports the engine's health and version. */
export const STATUS_ROUTE = "status";

@Controller(ENGINE_PATH)
export class EngineController {
  /**
   * @param engine - The typed client. Injected rather than constructed so a suite can
   *   replace the whole of the engine with an object.
   */
  constructor(private readonly engine: EngineClient) {}

  /**
   * Report whether the engine is reachable, and which build answered.
   *
   * @returns `{engine: "up", version}`. There is no "down" body: an engine that cannot
   *   answer is a `502`, because a `200` saying the system is broken is a `200` a client's
   *   success path handles.
   * @throws {UpstreamError} `502 engine_unavailable` when the engine is unreachable, too
   *   slow, holding a different shared secret, or answering outside its own contract. The
   *   message names no address — see `engine.errors.ts`.
   */
  @Get(STATUS_ROUTE)
  @TenantOptional()
  async status(): Promise<EngineStatusResource> {
    return engineStatusResource(await this.engine.status());
  }
}
