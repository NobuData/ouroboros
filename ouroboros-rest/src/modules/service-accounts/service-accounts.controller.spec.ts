import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { ServiceAccountsController } from "./service-accounts.controller";
import type { ServiceAccountsService } from "./service-accounts.service";

/**
 * The service-account routes (#485): administrators only — which no service account can be.
 */

const reflector = new Reflector();

describe("the service-account routes", () => {
  it("are an administrator's, every one", () => {
    expect(reflector.get(REQUIRED_ROLES, ServiceAccountsController)).toEqual(ADMINISTRATORS);
  });

  it("answers a rotate and a revoke 200", () => {
    for (const handler of ["rotate", "revoke"] as const) {
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, ServiceAccountsController.prototype[handler]),
      ).toBe(HttpStatus.OK);
    }
  });

  it("acts in the session's workspace, as the session's user", async () => {
    const accounts = {
      create: jest.fn().mockResolvedValue({}),
      rotate: jest.fn().mockResolvedValue({}),
      revoke: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<ServiceAccountsService>;
    const controller = new ServiceAccountsController(accounts);
    const tenant = { id: "org-1" } as Organization;
    const principal = { user: { id: "user-ken" } } as Principal;

    await controller.list(tenant);
    await controller.create(tenant, principal, { name: "devops-bot", scopes: ["api.read"] });
    await controller.rotate(tenant, principal, "sa-1");
    await controller.revoke(tenant, principal, "sa-1");

    expect(accounts.list).toHaveBeenCalledWith("org-1");
    expect(accounts.create).toHaveBeenCalledWith("org-1", "user-ken", {
      name: "devops-bot",
      scopes: ["api.read"],
    });
    expect(accounts.rotate).toHaveBeenCalledWith("org-1", "user-ken", "sa-1");
    expect(accounts.revoke).toHaveBeenCalledWith("org-1", "user-ken", "sa-1");
  });
});
