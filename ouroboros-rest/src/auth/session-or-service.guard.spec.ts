import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import {
  SERVICE_PRINCIPAL_PROPERTY,
  SERVICE_TOKEN_REJECTED_PROPERTY,
} from "../modules/auth/service.principal";
import { AUTH_ERRORS } from "../modules/auth/auth.errors";
import { AllowHeldAccount } from "../modules/auth/held.account";
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

  @AllowHeldAccount()
  @Get()
  status(): void {}
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
    const { guard, getSession } = guardWith({
      session: { id: "s" },
      user: { id: "u", email: "maya@acme-robotics.dev", accountStatus: "approved" },
    });

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

/** A session for a person in one status. */
function sessionOf(accountStatus: string | undefined, email = "priya@contractor.dev") {
  return {
    session: { id: "s", activeOrganizationId: null },
    user: { id: "u", email, ...(accountStatus === undefined ? {} : { accountStatus }) },
  };
}

/**
 * The guard as Nest builds it: the library's lookup answering `snapshot`, the cache-bypassing
 * re-read answering `fresh`, and `OURO_APP_ADMIN_EMAILS` set to `admins`.
 */
function approvalGuard(snapshot: unknown, fresh: unknown = snapshot, admins: string[] = []) {
  const getSession = jest.fn().mockResolvedValue(snapshot);
  const reread = jest.fn().mockResolvedValue(fresh);
  const guard = new SessionOrServiceGuard(new Reflector(), {
    auth: { api: { getSession } },
  } as never);

  guard.appConfig = { appAdminEmails: admins };
  guard.betterAuth = { api: { getSession: reread } } as never;

  return { guard, getSession, reread };
}

describe("the guard under account approval", () => {
  it("admits an approved account without a second lookup", async () => {
    const { guard, reread } = approvalGuard(sessionOf("approved"));

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, { headers: {} })),
    ).resolves.toBe(true);
    expect(reread).not.toHaveBeenCalled();
  });

  it("refuses a pending account with 403 account_pending_approval", async () => {
    const { guard } = approvalGuard(sessionOf("pending"));

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, { headers: {} })),
    ).rejects.toMatchObject({ code: AUTH_ERRORS.accountPendingApproval, status: 403 });
  });

  it("refuses a denied account with 403 account_denied", async () => {
    const { guard } = approvalGuard(sessionOf("denied"));

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, { headers: {} })),
    ).rejects.toMatchObject({ code: AUTH_ERRORS.accountDenied, status: 403 });
  });

  it("lets a held account reach an @AllowHeldAccount route", async () => {
    const { guard } = approvalGuard(sessionOf("pending"));

    await expect(
      guard.canActivate(contextFor(Routes.prototype.status, { headers: {} })),
    ).resolves.toBe(true);
  });

  it("leaves an @AllowAnonymous route alone for a held account", async () => {
    const { guard, reread } = approvalGuard(sessionOf("denied"));

    await expect(
      guard.canActivate(contextFor(Routes.prototype.open, { headers: {} })),
    ).resolves.toBe(true);
    expect(reread).not.toHaveBeenCalled();
  });

  it("admits an application administrator whose stored status is pending", async () => {
    const { guard, reread } = approvalGuard(
      sessionOf("pending", "Ken@Acme-Robotics.dev"),
      undefined,
      ["ken@acme-robotics.dev"],
    );

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, { headers: {} })),
    ).resolves.toBe(true);
    expect(reread).not.toHaveBeenCalled();
  });

  it("re-reads a held snapshot past the cookie cache, so an approval works on the next request", async () => {
    const fresh = {
      session: { id: "s", activeOrganizationId: "org-personal" },
      user: { id: "u", email: "priya@contractor.dev", accountStatus: "approved" },
    };
    const { guard, reread } = approvalGuard(sessionOf("pending"), fresh);
    const request: Record<string, unknown> = { headers: { cookie: "a=b", accept: ["x", "y"] } };

    await expect(guard.canActivate(contextFor(Routes.prototype.guarded, request))).resolves.toBe(
      true,
    );
    expect(reread).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    );
    const headers = (reread.mock.calls[0] as [{ headers: Headers }])[0].headers;
    expect(headers.get("cookie")).toBe("a=b");
    expect(headers.get("accept")).toBe("x, y");
    // The rest of the pipeline — the tenant guard above all — reads the fresh session.
    expect(request.session).toBe(fresh);
    expect(request.user).toBe(fresh.user);
  });

  it("re-reads a snapshot older than V149, and refuses what the database says is held", async () => {
    const { guard, reread } = approvalGuard(sessionOf(undefined), sessionOf("denied"));

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, { headers: {} })),
    ).rejects.toMatchObject({ code: AUTH_ERRORS.accountDenied });
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it("keeps refusing when the re-read finds no session", async () => {
    const { guard } = approvalGuard(sessionOf("pending"), null);

    await expect(
      guard.canActivate(contextFor(Routes.prototype.guarded, { headers: {} })),
    ).rejects.toMatchObject({ code: AUTH_ERRORS.accountPendingApproval });
  });

  it("never holds a service principal", async () => {
    const { guard, getSession } = approvalGuard(sessionOf("pending"));
    const request = { headers: {}, [SERVICE_PRINCIPAL_PROPERTY]: servicePrincipalFor() };

    await expect(guard.canActivate(contextFor(Routes.prototype.guarded, request))).resolves.toBe(
      true,
    );
    expect(getSession).not.toHaveBeenCalled();
  });
});
