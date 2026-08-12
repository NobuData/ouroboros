import { Reflector } from "@nestjs/core";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import type { EngineClient } from "./engine.client";
import { EngineController } from "./engine.controller";
import { engineUnavailable } from "./engine.errors";

/**
 * The route, and the three things about it that are decisions rather than plumbing.
 *
 * What it answers, that it does *not* answer when the engine cannot, and the two decorators
 * — one present, one deliberately absent. The decorator assertions read like introspection
 * for its own sake and are not: `@TenantOptional()` is why this route works for somebody who
 * belongs to two workspaces, and the *absence* of `@AllowAnonymous()` is the only thing standing
 * between a signed-out visitor and a question about the inside of the deployment.
 */

/** An engine client that answers, or one that cannot. */
function clientThat(status: () => Promise<unknown>): EngineClient {
  return { status } as unknown as EngineClient;
}

/** A status the engine really could have answered with. */
function answered() {
  return Promise.resolve({
    service: "ouroboros-engine",
    version: "0.3.0",
    uptimeSeconds: 1234.567,
  });
}

describe("GET /api/v1/engine/status", () => {
  it("reports the engine as up, and which build answered", async () => {
    const controller = new EngineController(clientThat(answered));

    await expect(controller.status()).resolves.toEqual({ engine: "up", version: "0.3.0" });
  });

  it("asks the engine once per request rather than caching it", async () => {
    // A cached answer is a route that reports an engine that has since been replaced —
    // which is the one thing somebody calling this is trying to find out.
    const status = jest.fn(answered);
    const controller = new EngineController(clientThat(status));

    await controller.status();
    await controller.status();

    expect(status).toHaveBeenCalledTimes(2);
  });

  it("has no `down` body — an engine that cannot answer is the client's 502", async () => {
    // A `200` saying the system is broken is a `200` a client's success path handles.
    const controller = new EngineController(clientThat(() => Promise.reject(engineUnavailable())));

    await expect(controller.status()).rejects.toMatchObject({ code: "engine_unavailable" });
  });
});

describe("the decorators on it", () => {
  /** How Nest reads the metadata a decorator set. */
  const reflector = new Reflector();

  it("is tenant-optional, because there is one engine behind every workspace", () => {
    expect(reflector.get(TENANT_OPTIONAL, EngineController.prototype.status)).toBe(true);
  });

  it("is not anonymous", () => {
    // The polarity #33 established and #703 kept: a route is authenticated unless it says
    // otherwise. The engine's version is not much of a secret, and "this is the one route
    // we left open" is how a surface starts growing exceptions.
    expect(reflector.get(ALLOW_ANONYMOUS, EngineController.prototype.status)).toBeUndefined();
    expect(reflector.get(ALLOW_ANONYMOUS, EngineController)).toBeUndefined();
  });
});
