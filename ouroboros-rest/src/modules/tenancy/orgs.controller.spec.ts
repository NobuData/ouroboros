import { OrgsController } from "./orgs.controller";
import type { OrgsService } from "./orgs.service";

/** See `tenants.controller.spec.ts` for what these specs are and are not about. */

const TENANT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

describe("the organisations controller", () => {
  let service: jest.Mocked<OrgsService>;
  let controller: OrgsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      add: jest.fn().mockResolvedValue({ login: "nobudata" }),
      setEnabled: jest.fn().mockResolvedValue({ login: "nobudata" }),
    } as unknown as jest.Mocked<OrgsService>;

    controller = new OrgsController(service);
  });

  it("scopes a listing to the tenant in the path", async () => {
    await controller.list({ tenantId: TENANT }, { offset: 50 });

    expect(service.list).toHaveBeenCalledWith(TENANT, { offset: 50 });
  });

  it("passes a new organisation straight through", async () => {
    await controller.add({ tenantId: TENANT }, { login: "nobudata", enabled: true });

    expect(service.add).toHaveBeenCalledWith(TENANT, { login: "nobudata", enabled: true });
  });

  it("addresses an organisation by its login, not by an id", async () => {
    // The login is what a person types, what a URL elsewhere already carries, and what the
    // unique key makes unique within the tenant.
    await controller.setEnabled({ tenantId: TENANT, login: "nobudata" }, { enabled: false });

    expect(service.setEnabled).toHaveBeenCalledWith(TENANT, "nobudata", { enabled: false });
  });

  it("has no way to remove an organisation", () => {
    // Disabling is the operation; removing would discard the per-repository choices
    // underneath it, and V003 keeps two flags precisely so that suspension does not.
    expect(controller).not.toHaveProperty("remove");
  });
});
