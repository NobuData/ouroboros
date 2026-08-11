import { ReposController } from "./repos.controller";
import type { ReposService } from "./repos.service";

/** See `tenants.controller.spec.ts` for what these specs are and are not about. */

const TENANT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

describe("the repositories controller", () => {
  let service: jest.Mocked<ReposService>;
  let controller: ReposController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      setEnabled: jest.fn().mockResolvedValue({ name: "ouroboros" }),
    } as unknown as jest.Mocked<ReposService>;

    controller = new ReposController(service);
  });

  it("reaches a repository through its organisation", async () => {
    await controller.list({ tenantId: TENANT, login: "nobudata" }, {});

    expect(service.list).toHaveBeenCalledWith(TENANT, "nobudata", {});
  });

  it("names all three of tenant, organisation and repository when enabling one", async () => {
    await controller.setEnabled(
      { tenantId: TENANT, login: "nobudata", name: "ouroboros" },
      { enabled: true, defaultBranch: "main" },
    );

    expect(service.setEnabled).toHaveBeenCalledWith(TENANT, "nobudata", "ouroboros", {
      enabled: true,
      defaultBranch: "main",
    });
  });

  it("offers no way to add a repository", () => {
    // Deliberate, and the reason the `PATCH` is an upsert: there is no discovery flow yet to
    // have recorded the row, so "turn this repository on" has to work whether or not
    // anything has mentioned it before.
    expect(controller).not.toHaveProperty("add");
    expect(controller).not.toHaveProperty("create");
  });
});
