import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import {
  SERVICE_PRINCIPAL_PROPERTY,
  SERVICE_TOKEN_REJECTED_PROPERTY,
} from "../modules/auth/service.principal";
import { servicePrincipalFor } from "../modules/auth/service.principal.fixture";
import { SessionOrServiceGuard } from "./session-or-service.guard";

/**
 * The global authentication guard's one addition to the library's (#485): a service principal
 * stands in for a session, and a refused service token is a 401 even beside a cookie.
 *
 * The library's own behaviour behind it — the session lookup, the 401 — is `auth.module.spec.ts`'s,
 * against the real class.
 */

@Controller()
class Routes {
  @Get()
  guarded(): void {}

  @AllowAnonymous()
  @Get()
  open(): void {}
}

/** An HTTP context for one handler and request. */
function contextFor(handler: unknown, request: object): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** The guard, over a library whose session lookup answers `session`. */
function guardWith(session: unknown = null) {
  const getSession = jest.fn().mockResolvedValue(session);
  const guard = new SessionOrServiceGuard(new Reflector(), {
    auth: { api: { getSession } },
  } as never);

  return { guard, getSession };
}

describe("the session-or-service guard", () => {
  it("admits a service principal without asking for a session", async () => {
    const { guard, getSession } = guardWith();
    const request = { headers: {}, [SERVICE_PRINCIPAL_PROPERTY]: servicePrincipalFor() };

    await expect(guard.canActivate(contextFor(Routes.prototype.guarded, request))).resolves.toBe(
      true,
    );
    expect(getSession).not.toHaveBeenCalled();
  });

  it("refuses a rejected service token with 401 service_token_invalid, even with a session beside it", async () => {
    const { guard } = guardWith({ session: { id: "s" }, user: { id: "u" } });
    const request = { headers: {}, [SERVICE_TOKEN_REJECTED_PROPERTY]: true };

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, request)),
    ).rejects.toMatchObject({
      code: "service_token_invalid",
    });
  });

  it("leaves an anonymous route alone, whatever token rode on it", async () => {
    const { guard } = guardWith();
    const request = { headers: {}, [SERVICE_TOKEN_REJECTED_PROPERTY]: true };

    await expect(guard.canActivate(contextFor(Routes.prototype.open, request))).resolves.toBe(true);
  });

  it("is the library's guard for everybody else", async () => {
    const { guard, getSession } = guardWith({ session: { id: "s" }, user: { id: "u" } });

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, { headers: {} })),
    ).resolves.toBe(true);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("still refuses a request with neither", async () => {
    const { guard } = guardWith(null);

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, { headers: {} })),
    ).rejects.toThrow();
  });
});
