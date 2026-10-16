import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { ALLOW_HELD_ACCOUNT } from "../auth/held.account";
import type { Principal } from "../auth/principal";
import { HUMAN_ONLY } from "../auth/service.scopes";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";
import { AccountController, AdminAccountsController } from "./accounts.controller";
import type { AccountsService } from "./accounts.service";

/**
 * The routes' wiring: paths, verbs, status codes, the decorators that keep them out of the
 * tenant guard and away from service accounts, and the one route a held account may reach.
 * What the routes *do* is `accounts.service.spec.ts`.
 */

const reflector = new Reflector();
const PRINCIPAL = { user: { id: "u", email: "ken@acme-robotics.dev" } } as unknown as Principal;

/** A service whose every method answers its own name. */
function service(): jest.Mocked<AccountsService> {
  const names = [
    "status",
    "list",
    "approve",
    "deny",
    "listPreapproved",
    "addPreapproved",
    "removePreapproved",
  ];

  return Object.fromEntries(
    names.map((name) => [name, jest.fn().mockResolvedValue(name)]),
  ) as unknown as jest.Mocked<AccountsService>;
}

describe("the account controller", () => {
  it("serves GET /account/status, open to a held account", () => {
    const handler = AccountController.prototype.status;

    expect(Reflect.getMetadata(PATH_METADATA, AccountController)).toBe("account");
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("status");
    expect(reflector.get<boolean>(ALLOW_HELD_ACCOUNT, handler)).toBe(true);
  });

  it("passes the session's person to the service", async () => {
    const accounts = service();

    await expect(new AccountController(accounts).status(PRINCIPAL)).resolves.toBe("status");
    expect(accounts.status).toHaveBeenCalledWith(PRINCIPAL.user);
  });
});

describe("the admin controller", () => {
  const routes: [keyof AdminAccountsController, number, string, number | undefined][] = [
    ["list", 0, "accounts", undefined],
    ["approve", 1, "accounts/:userId/approve", HttpStatus.OK],
    ["deny", 1, "accounts/:userId/deny", HttpStatus.OK],
    ["listPreapproved", 0, "preapproved-emails", undefined],
    ["addPreapproved", 1, "preapproved-emails", undefined],
    ["removePreapproved", 3, "preapproved-emails/:email", HttpStatus.NO_CONTENT],
  ];

  it.each(routes)("routes %s", (name, method, path, code) => {
    const handler = AdminAccountsController.prototype[name] as (...args: never[]) => unknown;

    expect(Reflect.getMetadata(PATH_METADATA, AdminAccountsController)).toBe("admin");
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(code);
    // Never reachable by a held account: only the status route is.
    expect(reflector.get<boolean>(ALLOW_HELD_ACCOUNT, handler)).toBeUndefined();
    // No workspace role could stand in for OURO_APP_ADMIN_EMAILS.
    expect(reflector.get<string[]>(REQUIRED_ROLES, handler)).toBeUndefined();
  });

  it.each([AccountController, AdminAccountsController])(
    "%p takes no workspace and no service account",
    (controller) => {
      expect(reflector.get<boolean>(TENANT_OPTIONAL, controller)).toBe(true);
      expect(reflector.get<boolean>(HUMAN_ONLY, controller)).toBe(true);
    },
  );

  it("hands each route's inputs to the service with the session's person", async () => {
    const accounts = service();
    const controller = new AdminAccountsController(accounts);

    await controller.list(PRINCIPAL, { status: "denied" });
    await controller.approve(PRINCIPAL, "priya");
    await controller.deny(PRINCIPAL, "sam");
    await controller.listPreapproved(PRINCIPAL);
    await controller.addPreapproved(PRINCIPAL, { email: "lee@acme-robotics.dev", note: "x" });
    await controller.removePreapproved(PRINCIPAL, "lee@acme-robotics.dev");

    expect(accounts.list).toHaveBeenCalledWith(PRINCIPAL.user, "denied");
    expect(accounts.approve).toHaveBeenCalledWith(PRINCIPAL.user, "priya");
    expect(accounts.deny).toHaveBeenCalledWith(PRINCIPAL.user, "sam");
    expect(accounts.listPreapproved).toHaveBeenCalledWith(PRINCIPAL.user);
    expect(accounts.addPreapproved).toHaveBeenCalledWith(PRINCIPAL.user, {
      email: "lee@acme-robotics.dev",
      note: "x",
    });
    expect(accounts.removePreapproved).toHaveBeenCalledWith(
      PRINCIPAL.user,
      "lee@acme-robotics.dev",
    );
  });
});
