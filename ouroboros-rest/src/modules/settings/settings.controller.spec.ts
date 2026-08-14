import { Reflector } from "@nestjs/core";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { SettingsController } from "./settings.controller";
import type { SettingsService } from "./settings.service";

/**
 * What a controller spec in this service is about — the routes' declarations, per
 * `domains.controller.spec.ts`'s argument — and the one declaration that *is* this ticket:
 * `@Roles(...ADMINISTRATORS)` on the write and nothing on the read. The guard honouring the
 * metadata is `roles.guard.spec.ts`; the whole pipeline refusing a member is the
 * integration suite. What is held here is that the handlers still carry the right ask.
 */

const WORKSPACE = { id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } as Organization;

const RESOURCE = {
  enabled: true,
  updatedAt: "2026-08-13T09:00:00.000Z",
  updatedBy: "user-someone",
};

describe("the settings controller", () => {
  let service: jest.Mocked<SettingsService>;
  let controller: SettingsController;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue(RESOURCE),
      update: jest.fn().mockResolvedValue(RESOURCE),
    } as unknown as jest.Mocked<SettingsService>;

    controller = new SettingsController(service);
  });

  it("scopes the read to the workspace the guard established", async () => {
    await expect(controller.read(WORKSPACE)).resolves.toEqual(RESOURCE);

    expect(service.read).toHaveBeenCalledWith(WORKSPACE.id);
  });

  it("passes a flip straight through, under the same workspace", async () => {
    await expect(controller.update(WORKSPACE, { enabled: true })).resolves.toEqual(RESOURCE);

    expect(service.update).toHaveBeenCalledWith(WORKSPACE.id, { enabled: true });
  });

  it("asks administrators of the write, and of nothing else", () => {
    // Decision F6 as metadata: the PATCH names `owner`/`admin`, and the GET names no roles
    // at all — under the roles guard's own rule a bare route is every member's, and a
    // viewer is a role that exists to be able to look at the switch it may not flip.
    const reflector = new Reflector();

    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.update)).toEqual([...ADMINISTRATORS]);
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
  });
});
