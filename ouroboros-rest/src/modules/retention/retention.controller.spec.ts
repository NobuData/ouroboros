import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { RetentionController } from "./retention.controller";
import type { RetentionSettingsResource } from "./retention.resources";
import type { RetentionPolicyService } from "./retention.service";

/**
 * The routes' declarations (#482): every member reads the card, administrators write it, and the
 * workspace and roles come from the membership the guard established — never the request.
 */

const MEMBER = {
  tenant: { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization,
  roles: ["admin"],
} as unknown as ActiveMembership;

const PRINCIPAL = { user: { id: "user-admin" } } as Principal;

const CARD = { loopDays: 30 } as RetentionSettingsResource;

describe("the retention controller", () => {
  let service: jest.Mocked<RetentionPolicyService>;
  let controller: RetentionController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(CARD),
      update: jest.fn().mockResolvedValue(CARD),
    } as unknown as jest.Mocked<RetentionPolicyService>;

    controller = new RetentionController(service);
  });

  it("reads the card for the guard's workspace, as this caller", async () => {
    await expect(controller.read(MEMBER, PRINCIPAL)).resolves.toBe(CARD);

    expect(service.read).toHaveBeenCalledWith(MEMBER.tenant.id, {
      userId: "user-admin",
      roles: ["admin"],
    });
  });

  it("passes a save straight through, under the same workspace and caller", async () => {
    await expect(controller.update(MEMBER, PRINCIPAL, { loopDays: 14 })).resolves.toBe(CARD);

    expect(service.update).toHaveBeenCalledWith(
      MEMBER.tenant.id,
      { userId: "user-admin", roles: ["admin"] },
      { loopDays: 14 },
    );
  });

  it("asks administrators of the write, and of nothing else", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.update)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });
});
