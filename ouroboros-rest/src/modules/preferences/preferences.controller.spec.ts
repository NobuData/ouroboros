import { Reflector } from "@nestjs/core";

import { PreferencesController } from "./preferences.controller";
import type { PreferencesService } from "./preferences.service";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { TENANT_OPTIONAL } from "../tenancy/tenant.decorators";

/**
 * Two routes whose whole meaning is in what they do *not* carry: no workspace in the path,
 * no `@Roles()`, no id parameter. The controller is the thinnest layer in the module, so
 * what a spec can hold it to is its decorations and its delegation — the rules live in
 * `preferences.service.spec.ts`.
 */

describe("the preferences controller", () => {
  let service: jest.Mocked<PreferencesService>;
  let controller: PreferencesController;
  let reflector: Reflector;

  beforeEach(() => {
    service = {
      read: jest.fn().mockResolvedValue({ fontScale: "100" }),
      update: jest.fn().mockResolvedValue({ fontScale: "125" }),
    } as unknown as jest.Mocked<PreferencesService>;

    controller = new PreferencesController(service);
    reflector = new Reflector();
  });

  it("answers a read with what the service reads", async () => {
    await expect(controller.read()).resolves.toEqual({ fontScale: "100" });

    expect(service.read).toHaveBeenCalledWith();
  });

  it("passes a patch straight through, and answers with the surface it returns", async () => {
    await expect(controller.update({ fontScale: "125" })).resolves.toEqual({
      fontScale: "125",
    });

    expect(service.update).toHaveBeenCalledWith({ fontScale: "125" });
  });

  it("takes no workspace, because a font size belongs to the reader's eyes", () => {
    // On the class rather than per handler, so both routes are exempt together: a PATCH
    // that required a workspace while its GET did not is an asymmetry a client would only
    // discover in production. The guard reads the class when the handler says nothing.
    expect(reflector.get<boolean>(TENANT_OPTIONAL, PreferencesController)).toBe(true);
  });

  it("names no roles, because there is no workspace for a role to be held in", () => {
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.read)).toBeUndefined();
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.update)).toBeUndefined();
  });

  it("offers no route addressed by user id", () => {
    // `/me/preferences` is the whole surface: whose preferences is the session's answer,
    // never the request's, so there is no handler a caller could point at somebody else.
    expect(controller).not.toHaveProperty("readFor");
    expect(controller).not.toHaveProperty("updateFor");
    expect(controller).not.toHaveProperty("remove");
  });
});
