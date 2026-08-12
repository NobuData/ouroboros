import { Controller, Get } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AppController } from "../app/app.controller";
import { HealthController } from "../health/health.controller";
import { AuthController } from "./auth.controller";
import { IS_PUBLIC, Public } from "./public.decorator";

/**
 * The exceptions to "every route is authenticated", enumerated.
 *
 * The decorator itself is three lines. What this file is really asserting is the *list*: a
 * route becoming public is a security change, and it should have to be made here, in a
 * test that names it, rather than by a decorator appearing in a diff nobody read.
 *
 * `GET /api/v1/auth/me` is deliberately in the second list. It is the route that answers
 * *who is signed in*, so it is the one that must require being signed in.
 */

const reflector = new Reflector();

/**
 * Is this handler — or its controller — marked public?
 *
 * @param target - The controller class.
 * @param handler - The method on it.
 * @returns What the guard would decide.
 */
function isPublic(target: new (...args: never[]) => object, handler: unknown): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      handler as () => unknown,
      target,
    ]) === true
  );
}

describe("the routes that need no session", () => {
  it.each([
    ["the heartbeat", AppController, AppController.prototype.heartbeat],
    ["liveness", HealthController, HealthController.prototype.live],
    ["readiness", HealthController, HealthController.prototype.ready],
    ["signing out", AuthController, AuthController.prototype.logout],
  ])("%s is public", (_description, target, handler) => {
    expect(isPublic(target as never, handler)).toBe(true);
  });
});

describe("the routes that need one", () => {
  it("reading the session does — it is the route that says who is signed in", () => {
    expect(isPublic(AuthController as never, AuthController.prototype.read)).toBe(false);
  });
});

describe("the decorator", () => {
  it("marks a single handler without marking its neighbours", () => {
    @Controller()
    class Mixed {
      @Public()
      @Get("open")
      open(): void {}

      @Get("closed")
      closed(): void {}
    }

    expect(isPublic(Mixed, Mixed.prototype.open)).toBe(true);
    expect(isPublic(Mixed, Mixed.prototype.closed)).toBe(false);
  });

  it("marks a whole controller when it is applied to the class", () => {
    @Public()
    @Controller()
    class Open {
      @Get()
      handler(): void {}
    }

    expect(isPublic(Open, Open.prototype.handler)).toBe(true);
  });

  it("uses a namespaced key, because Reflector metadata is one flat space", () => {
    expect(IS_PUBLIC).toBe("ouroboros:auth:public");
  });
});
