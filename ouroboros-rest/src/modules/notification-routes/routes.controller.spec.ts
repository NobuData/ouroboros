import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { NotificationRoutesController } from "./routes.controller";
import type { NotificationRouteResource, NotificationRoutesResource } from "./routes.resources";
import type { NotificationRoutesService } from "./routes.service";

/**
 * The routes' declarations (#488): every member reads the card, administrators save a route, and
 * the workspace and actor come from the session — never the request.
 */

const TENANT = { id: "org-acme" } as Organization;
const PRINCIPAL = { user: { id: "u-ken" } } as Principal;
const CARD = { items: [], channels: [] } as NotificationRoutesResource;
const ROUTE = { kind: "daily_digest" } as NotificationRouteResource;

describe("the notification routes controller", () => {
  let service: jest.Mocked<NotificationRoutesService>;
  let controller: NotificationRoutesController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue(CARD),
      read: jest.fn().mockResolvedValue(ROUTE),
      update: jest.fn().mockResolvedValue(ROUTE),
    } as unknown as jest.Mocked<NotificationRoutesService>;
    controller = new NotificationRoutesController(service);
  });

  it("reads the card and one route for the session's workspace", async () => {
    await expect(controller.list(TENANT)).resolves.toBe(CARD);
    await expect(controller.read(TENANT, "daily_digest")).resolves.toBe(ROUTE);

    expect(service.list).toHaveBeenCalledWith("org-acme");
    expect(service.read).toHaveBeenCalledWith("org-acme", "daily_digest");
  });

  it("saves as the session's person", async () => {
    await controller.update(TENANT, PRINCIPAL, "loop_failures", { enabled: true });

    expect(service.update).toHaveBeenCalledWith("org-acme", "u-ken", "loop_failures", {
      enabled: true,
    });
  });

  it("asks administrators of the save, and of nothing else", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.update)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });
});
