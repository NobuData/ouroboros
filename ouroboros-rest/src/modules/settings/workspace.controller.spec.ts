import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ConstraintViolationInterceptor } from "../tenancy/constraints";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { WorkspaceController } from "./workspace.controller";
import type { WorkspaceSettingsResource } from "./workspace.resources";
import type { WorkspaceService } from "./workspace.service";

/**
 * The routes' declarations: every member reads the card, administrators write it, and the
 * workspace and roles come from the membership the guard established — never the request.
 */

const MEMBER = {
  tenant: { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization,
  roles: ["admin"],
} as unknown as ActiveMembership;

const PRINCIPAL = { user: { id: "user-admin" } } as Principal;

const CARD = { id: MEMBER.tenant.id } as WorkspaceSettingsResource;

describe("the workspace controller", () => {
  let service: jest.Mocked<WorkspaceService>;
  let controller: WorkspaceController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(CARD),
      update: jest.fn().mockResolvedValue(CARD),
    } as unknown as jest.Mocked<WorkspaceService>;

    controller = new WorkspaceController(service);
  });

  it("reads the card for the guard's workspace, as this caller", async () => {
    await expect(controller.read(MEMBER, PRINCIPAL)).resolves.toBe(CARD);

    expect(service.read).toHaveBeenCalledWith(MEMBER.tenant.id, {
      userId: "user-admin",
      roles: ["admin"],
    });
  });

  it("passes a save straight through, under the same workspace and caller", async () => {
    await expect(controller.update(MEMBER, PRINCIPAL, { name: "Acme" })).resolves.toBe(CARD);

    expect(service.update).toHaveBeenCalledWith(
      MEMBER.tenant.id,
      { userId: "user-admin", roles: ["admin"] },
      { name: "Acme" },
    );
  });

  it("asks administrators of the write, and of nothing else", () => {
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.update)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });

  it("maps constraint violations as the tenancy routes do — a racing primary is a 409", () => {
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, WorkspaceController)).toEqual([
      ConstraintViolationInterceptor,
    ]);
  });
});
