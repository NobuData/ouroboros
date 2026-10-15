import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { principalFor } from "../auth/principal.fixture";
import { HUMAN_ONLY } from "../auth/service.scopes";
import type { Organization } from "../db/schema";
import { REQUIRED_CAPABILITY } from "../tenancy/capabilities";
import { ADMINISTRATORS, CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { ConfirmController, LiveExecutionSettingsController } from "./confirm.controller";
import type { ConfirmService } from "./confirm.service";

const TENANT: Organization = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  metadata: null,
};

const ITEM = "a1312000-0000-4000-8000-000000000001";

describe("the live-run admission routes", () => {
  let reflector: Reflector;
  let confirmations: jest.Mocked<Pick<ConfirmService, "confirm" | "settings" | "setCeiling">>;

  beforeEach(() => {
    reflector = new Reflector();
    confirmations = {
      confirm: jest.fn().mockResolvedValue({ id: ITEM }),
      settings: jest.fn().mockResolvedValue({ ceiling: 1 }),
      setCeiling: jest.fn().mockResolvedValue({ ceiling: 2 }),
    };
  });

  describe("POST /api/v1/queue/{id}/confirm", () => {
    const handler = ConfirmController.prototype.confirm;

    it("is a POST on :id/confirm under the queue prefix", () => {
      expect(Reflect.getMetadata(PATH_METADATA, ConfirmController)).toBe("queue");
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(":id/confirm");
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    });

    it("needs a contributor who holds can_approve_loops, and a person", () => {
      expect(reflector.get<string[]>(REQUIRED_ROLES, handler)).toEqual([...CONTRIBUTORS]);
      expect(reflector.get<string>(REQUIRED_CAPABILITY, handler)).toBe("can_approve_loops");
      expect(reflector.get<boolean>(HUMAN_ONLY, handler)).toBe(true);
    });

    it("confirms in the workspace, for the item, in the signed-in person's name", async () => {
      const controller = new ConfirmController(confirmations as unknown as ConfirmService);
      const principal = principalFor();

      await controller.confirm(TENANT, principal, { id: ITEM });

      expect(confirmations.confirm).toHaveBeenCalledWith(TENANT.id, ITEM, principal.user.id);
    });
  });

  describe("/api/v1/settings/live-execution", () => {
    const controller = () =>
      new LiveExecutionSettingsController(confirmations as unknown as ConfirmService);

    it("lives under settings/live-execution", () => {
      expect(Reflect.getMetadata(PATH_METADATA, LiveExecutionSettingsController)).toBe(
        "settings/live-execution",
      );
    });

    it("lets any member read", async () => {
      const read = LiveExecutionSettingsController.prototype.read;

      expect(reflector.get<string[]>(REQUIRED_ROLES, read)).toBeUndefined();
      await controller().read(TENANT);
      expect(confirmations.settings).toHaveBeenCalledWith(TENANT.id);
    });

    it("lets only an owner or admin, in person, change the ceiling", async () => {
      const update = LiveExecutionSettingsController.prototype.update;
      const principal = principalFor();

      expect(Reflect.getMetadata(METHOD_METADATA, update)).toBe(RequestMethod.PATCH);
      expect(reflector.get<string[]>(REQUIRED_ROLES, update)).toEqual([...ADMINISTRATORS]);
      expect(reflector.get<boolean>(HUMAN_ONLY, update)).toBe(true);

      await controller().update(TENANT, principal, { ceiling: 2 });
      expect(confirmations.setCeiling).toHaveBeenCalledWith(TENANT.id, 2, principal.user.id);
    });
  });
});
