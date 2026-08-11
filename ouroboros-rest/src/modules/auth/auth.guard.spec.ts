import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { User } from "../db/schema";
import type { AuthService } from "./auth.service";
import { SessionGuard } from "./auth.guard";
import { AUTH_ERRORS } from "./auth.errors";
import { principalOf, type PrincipalRequest } from "./principal";
import { Public } from "./public.decorator";

/**
 * The guard that makes this service authenticated by default.
 *
 * Its two behaviours are worth one test each, and the third is worth more than both: that
 * a route with no `@Public()` on it is refused. That is the polarity the whole design rests
 * on — a controller written next year is protected because somebody wrote a controller, not
 * because they remembered a decorator — and it is the assertion that fails if the global
 * registration is ever quietly removed.
 */

const USER = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies User;

/** Controllers whose decorators are the thing under test. */
@Controller()
class ProtectedController {
  @Get()
  handler(): void {}
}

@Controller()
class PublicController {
  @Public()
  @Get()
  handler(): void {}
}

@Public()
@Controller()
class WhollyPublicController {
  @Get()
  handler(): void {}

  @Get("second")
  another(): void {}
}

/**
 * An execution context over a real controller class and a real request object.
 *
 * The metadata is read through a real `Reflector` from a real decorated method, so what is
 * exercised is the decorator rather than a mocked lookup.
 *
 * @param target - The controller the route belongs to.
 * @param handler - The method on it.
 * @param request - The request the guard will read and write.
 * @returns The context.
 */
function contextFor(
  target: new () => object,
  handler: (...args: never[]) => unknown,
  request: PrincipalRequest,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * A guard over an auth service that answers with the given principal.
 *
 * @param principal - What `authenticate` resolves to.
 * @returns The guard.
 */
function guardFor(principal: { user: User } | undefined): SessionGuard {
  const auth = { authenticate: jest.fn().mockResolvedValue(principal) } as unknown as AuthService;

  return new SessionGuard(new Reflector(), auth);
}

describe("a route with no @Public()", () => {
  it("is refused when the request carries no session", async () => {
    const guard = guardFor(undefined);
    const context = contextFor(ProtectedController, ProtectedController.prototype.handler, {});

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: AUTH_ERRORS.unauthenticated,
    });
  });

  it("is allowed when it does, and the principal is on the request afterwards", async () => {
    const guard = guardFor({ user: USER });
    const request: PrincipalRequest = {};
    const context = contextFor(ProtectedController, ProtectedController.prototype.handler, request);

    expect(await guard.canActivate(context)).toBe(true);
    expect(principalOf(request)?.user).toEqual(USER);
  });

  it("answers 401, not 403 — nobody is signed in, rather than not permitted", async () => {
    const guard = guardFor(undefined);
    const context = contextFor(ProtectedController, ProtectedController.prototype.handler, {});

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
  });

  it("hands the cookie header to the service and nothing else", async () => {
    const auth = { authenticate: jest.fn().mockResolvedValue({ user: USER }) };
    const guard = new SessionGuard(new Reflector(), auth as unknown as AuthService);
    const request: PrincipalRequest = { headers: { cookie: "ouro_session=token" } };

    await guard.canActivate(
      contextFor(ProtectedController, ProtectedController.prototype.handler, request),
    );

    expect(auth.authenticate).toHaveBeenCalledWith("ouro_session=token");
  });
});

describe("a route marked @Public()", () => {
  it("is allowed with no session at all", async () => {
    const guard = guardFor(undefined);
    const context = contextFor(PublicController, PublicController.prototype.handler, {});

    expect(await guard.canActivate(context)).toBe(true);
  });

  it("establishes no principal, because there may not be one", async () => {
    const guard = guardFor({ user: USER });
    const request: PrincipalRequest = {};

    await guard.canActivate(
      contextFor(PublicController, PublicController.prototype.handler, request),
    );

    expect(principalOf(request)).toBeUndefined();
  });

  it("costs nothing — the service is not even asked", async () => {
    const auth = { authenticate: jest.fn() };
    const guard = new SessionGuard(new Reflector(), auth as unknown as AuthService);

    await guard.canActivate(contextFor(PublicController, PublicController.prototype.handler, {}));

    expect(auth.authenticate).not.toHaveBeenCalled();
  });
});

describe("@Public() on a whole controller", () => {
  it("covers every handler in it", async () => {
    const guard = guardFor(undefined);

    for (const handler of [
      WhollyPublicController.prototype.handler,
      WhollyPublicController.prototype.another,
    ]) {
      expect(await guard.canActivate(contextFor(WhollyPublicController, handler, {}))).toBe(true);
    }
  });
});
