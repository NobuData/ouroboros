import { Reflector } from "@nestjs/core";

import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { LifecycleController } from "./lifecycle.controller";
import { LIFECYCLE_EXEMPT } from "./lifecycle.freeze.guard";

const reflector = new Reflector();
const routes = LifecycleController.prototype;

describe("who may reach the Danger zone (#489)", () => {
  it("lets any member read the state", () => {
    expect(reflector.get(REQUIRED_ROLES, routes.read)).toBeUndefined();
  });

  it.each(["pause", "resume", "previewDisconnect", "disconnect"] as const)(
    "gives %s to owners and admins",
    (route) => {
      expect(reflector.get(REQUIRED_ROLES, routes[route])).toEqual([...ADMINISTRATORS]);
    },
  );

  it.each(["requestDelete", "restore"] as const)("gives %s to owners alone", (route) => {
    expect(reflector.get(REQUIRED_ROLES, routes[route])).toEqual(["owner"]);
  });

  it("exempts exactly the recovery screen's routes from the freeze", () => {
    const exempt = Object.getOwnPropertyNames(routes).filter(
      (name) =>
        reflector.get(LIFECYCLE_EXEMPT, (routes as unknown as Record<string, () => void>)[name]) ===
        true,
    );

    expect(exempt.sort()).toEqual(["read", "restore"]);
  });
});
