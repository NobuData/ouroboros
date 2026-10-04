import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { WebhooksController } from "./webhooks.controller";
import type { WebhooksService } from "./webhooks.service";

/** The webhook routes (#487): owners and administrators only, reads included. */

const reflector = new Reflector();

describe("the webhook routes", () => {
  it("are an administrator's, every one", () => {
    expect(reflector.get(REQUIRED_ROLES, WebhooksController)).toEqual(ADMINISTRATORS);
  });

  it("answers rotate and ping 200, redeliver 202 and delete 204", () => {
    const code = (handler: keyof WebhooksController) =>
      Reflect.getMetadata(HTTP_CODE_METADATA, WebhooksController.prototype[handler]) as number;

    expect(code("rotate")).toBe(HttpStatus.OK);
    expect(code("ping")).toBe(HttpStatus.OK);
    expect(code("redeliver")).toBe(HttpStatus.ACCEPTED);
    expect(code("remove")).toBe(HttpStatus.NO_CONTENT);
  });

  it("acts in the session's workspace, as the session's user", async () => {
    const service = {
      list: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      read: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
      rotate: jest.fn().mockResolvedValue({}),
      ping: jest.fn().mockResolvedValue({}),
      deliveries: jest.fn().mockResolvedValue({}),
      redeliver: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<WebhooksService>;
    const controller = new WebhooksController(service);
    const tenant = { id: "org-1" } as Organization;
    const principal = { user: { id: "user-ken" } } as Principal;
    const body = { name: "SIEM", url: "https://siem.acme.dev/", eventFamilies: ["audit.*"] };

    await controller.list(tenant);
    await controller.create(tenant, principal, body);
    await controller.read(tenant, "wh-1");
    await controller.update(tenant, principal, "wh-1", { active: false });
    await controller.remove(tenant, principal, "wh-1");
    await controller.rotate(tenant, principal, "wh-1");
    await controller.ping(tenant, "wh-1");
    await controller.deliveries(tenant, "wh-1", { status: "dead_lettered" });
    await controller.redeliver(tenant, principal, "wh-1", "d-1");

    expect(service.list).toHaveBeenCalledWith("org-1");
    expect(service.create).toHaveBeenCalledWith("org-1", "user-ken", body);
    expect(service.read).toHaveBeenCalledWith("org-1", "wh-1");
    expect(service.update).toHaveBeenCalledWith("org-1", "user-ken", "wh-1", { active: false });
    expect(service.remove).toHaveBeenCalledWith("org-1", "user-ken", "wh-1");
    expect(service.rotate).toHaveBeenCalledWith("org-1", "user-ken", "wh-1");
    expect(service.ping).toHaveBeenCalledWith("org-1", "wh-1");
    expect(service.deliveries).toHaveBeenCalledWith("org-1", "wh-1", { status: "dead_lettered" });
    expect(service.redeliver).toHaveBeenCalledWith("org-1", "user-ken", "wh-1", "d-1");
  });
});
