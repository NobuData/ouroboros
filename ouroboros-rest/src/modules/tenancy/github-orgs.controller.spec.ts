import { GithubOrgsController } from "./github-orgs.controller";
import type { GithubOrgsService } from "./github-orgs.service";

/** See `domains.controller.spec.ts` for what these specs are and are not about. */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

describe("the GitHub organisations controller", () => {
  let service: jest.Mocked<GithubOrgsService>;
  let controller: GithubOrgsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      add: jest.fn().mockResolvedValue({ login: "nobudata" }),
      read: jest.fn().mockResolvedValue({ login: "nobudata" }),
      setEnabled: jest.fn().mockResolvedValue({ login: "nobudata" }),
    } as unknown as jest.Mocked<GithubOrgsService>;

    controller = new GithubOrgsController(service);
  });

  it("scopes a listing to the workspace in the path", async () => {
    await controller.list({ orgId: WORKSPACE }, { offset: 50 });

    expect(service.list).toHaveBeenCalledWith(WORKSPACE, { offset: 50 });
  });

  it("passes a new organisation straight through", async () => {
    await controller.add({ orgId: WORKSPACE }, { login: "nobudata", enabled: true });

    expect(service.add).toHaveBeenCalledWith(WORKSPACE, { login: "nobudata", enabled: true });
  });

  it("addresses an organisation by its login, not by an id", async () => {
    // The login is what a person types, what a URL elsewhere already carries, and what
    // `github_orgs_org_login_key` makes unique within the workspace.
    await controller.read({ orgId: WORKSPACE, login: "nobudata" });
    await controller.setEnabled({ orgId: WORKSPACE, login: "nobudata" }, { enabled: false });

    expect(service.read).toHaveBeenCalledWith(WORKSPACE, "nobudata");
    expect(service.setEnabled).toHaveBeenCalledWith(WORKSPACE, "nobudata", { enabled: false });
  });

  it("has no way to remove an organisation", () => {
    // Disabling is the operation; removing would discard the per-repository choices
    // underneath it, and V003 keeps two flags precisely so that suspension does not.
    expect(controller).not.toHaveProperty("remove");
  });
});
