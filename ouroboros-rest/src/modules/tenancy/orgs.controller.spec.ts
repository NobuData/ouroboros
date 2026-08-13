import { Reflector } from "@nestjs/core";

import { OrgsController } from "./orgs.controller";
import type { OrgsService } from "./orgs.service";
import { REQUIRED_ROLES } from "./roles.guard";
import { TENANT_OPTIONAL } from "./tenant.decorators";

/**
 * The one route in this module with no workspace in its path.
 *
 * Two decorations carry the whole of its meaning, and both are assertions rather than
 * readings: `@TenantOptional()`, without which the guard would demand a workspace before
 * saying which workspaces there are, and *no* `@Roles()`, because every row is a workspace the
 * caller already belongs to.
 *
 * See `domains.controller.spec.ts` for what a controller spec in this module is otherwise
 * about.
 */

describe("the workspaces controller", () => {
  let service: jest.Mocked<OrgsService>;
  let controller: OrgsController;
  let reflector: Reflector;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
    } as unknown as jest.Mocked<OrgsService>;

    controller = new OrgsController(service);
    reflector = new Reflector();
  });

  it("passes the window straight through", async () => {
    await controller.list({ limit: 100 });

    expect(service.list).toHaveBeenCalledWith({ limit: 100 });
  });

  it("takes no workspace, because its answer is which workspaces there are", () => {
    // Asking somebody to choose a workspace before being told which they have is circular —
    // and it is exactly the state `400 organization_required` tells them to leave.
    expect(reflector.get<boolean>(TENANT_OPTIONAL, controller.list)).toBe(true);
  });

  it("names no roles, because holding one is what every row reports", () => {
    // A route with no `@Roles()` is open to every *member*, which is the right default here:
    // the listing is scoped to the caller in the service, and what they hold in each workspace
    // is a field of the answer rather than a condition on it.
    expect(reflector.get<string[]>(REQUIRED_ROLES, controller.list)).toBeUndefined();
  });

  it("offers nothing but the listing", () => {
    // Creating, renaming and switching into a workspace are the organization plugin's since
    // #704. A second write path to `organization` and `member` is how two role checks drift
    // apart, which is why #714 deleted this module's rather than re-pointing them.
    expect(controller).not.toHaveProperty("add");
    expect(controller).not.toHaveProperty("create");
    expect(controller).not.toHaveProperty("update");
    expect(controller).not.toHaveProperty("remove");
  });
});
