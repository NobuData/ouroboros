import type { GithubOrg, GithubRepo, Tenant } from "../db/schema";
import type { OrgsRepository } from "./orgs.repository";
import { OrgsService } from "./orgs.service";
import { ReposService } from "./repos.service";
import { TENANCY_ERRORS } from "./tenancy.errors";
import type { TenantsService } from "./tenants.service";

/**
 * The two halves of the enablement boundary.
 *
 * Both services are here because they share a repository and because the property worth
 * checking spans them: a repository is reached *through* its organisation, so every
 * repository operation has to fail with the organisation's `404` — and, before that, with
 * the tenant's. Neither service applies the "both flags true" rule, and that is deliberate:
 * they set the flags, and whatever is about to act on a repository is what reads them.
 */

const TENANT: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

const ORG: GithubOrg = {
  id: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
  tenant_id: TENANT.id,
  login: "nobudata",
  enabled: true,
  installed_at: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

const REPO: GithubRepo = {
  id: "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
  org_id: ORG.id,
  name: "ouroboros",
  enabled: true,
  default_branch: "main",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

describe("the organisations and repositories services", () => {
  let repository: jest.Mocked<OrgsRepository>;
  let tenants: jest.Mocked<TenantsService>;
  let orgs: OrgsService;
  let repos: ReposService;

  beforeEach(() => {
    repository = {
      listOrgs: jest.fn().mockResolvedValue([ORG]),
      countOrgs: jest.fn().mockResolvedValue(1),
      findOrg: jest.fn().mockResolvedValue(ORG),
      createOrg: jest.fn().mockResolvedValue(ORG),
      setOrgEnabled: jest.fn().mockResolvedValue(ORG),
      listRepos: jest.fn().mockResolvedValue([REPO]),
      countRepos: jest.fn().mockResolvedValue(1),
      findRepo: jest.fn().mockResolvedValue(REPO),
      upsertRepo: jest.fn().mockResolvedValue(REPO),
    } as unknown as jest.Mocked<OrgsRepository>;

    tenants = {
      require: jest.fn().mockResolvedValue(TENANT),
    } as unknown as jest.Mocked<TenantsService>;

    orgs = new OrgsService(repository, tenants);
    repos = new ReposService(repository, orgs);
  });

  describe("listing organisations", () => {
    it("answers a page of resources", async () => {
      expect(await orgs.list(TENANT.id, {})).toEqual({
        items: [expect.objectContaining({ login: "nobudata", enabled: true })],
        total: 1,
        limit: 25,
        offset: 0,
      });
    });

    it("requires the tenant first", async () => {
      tenants.require.mockRejectedValue(new Error("404"));

      await expect(orgs.list(TENANT.id, {})).rejects.toThrow();
      expect(repository.listOrgs).not.toHaveBeenCalled();
    });
  });

  describe("adding an organisation", () => {
    it("starts it switched off unless asked", async () => {
      // V003's own default, stated here rather than omitted, so the API's default and the
      // schema's are visibly the same decision.
      await orgs.add(TENANT.id, { login: "nobudata" });

      expect(repository.createOrg).toHaveBeenCalledWith(TENANT.id, "nobudata", false);
    });

    it("starts it on when the request says so", async () => {
      await orgs.add(TENANT.id, { login: "nobudata", enabled: true });

      expect(repository.createOrg).toHaveBeenCalledWith(TENANT.id, "nobudata", true);
    });
  });

  describe("enabling an organisation", () => {
    it("resolves the login within the tenant before changing anything", async () => {
      await orgs.setEnabled(TENANT.id, "nobudata", { enabled: false });

      expect(repository.findOrg).toHaveBeenCalledWith(TENANT.id, "nobudata", undefined);
      expect(repository.setOrgEnabled).toHaveBeenCalledWith(ORG.id, false);
    });

    it("answers 404 for an organisation this tenant has not added", async () => {
      repository.findOrg.mockResolvedValue(undefined);

      await expect(orgs.setEnabled(TENANT.id, "nobudata", { enabled: true })).rejects.toMatchObject(
        { response: { code: TENANCY_ERRORS.orgNotFound } },
      );
    });

    it("answers 404 when the row vanished between the lookup and the update", async () => {
      repository.setOrgEnabled.mockResolvedValue(undefined);

      await expect(orgs.setEnabled(TENANT.id, "nobudata", { enabled: true })).rejects.toMatchObject(
        { response: { code: TENANCY_ERRORS.orgNotFound } },
      );
    });

    it("touches only the organisation's flag", async () => {
      // Suspending an organisation preserves the per-repository choices underneath it, which
      // is why there are two flags rather than one.
      await orgs.setEnabled(TENANT.id, "nobudata", { enabled: false });

      expect(repository.upsertRepo).not.toHaveBeenCalled();
    });
  });

  describe("listing repositories", () => {
    it("resolves the organisation and lists within it", async () => {
      expect(await repos.list(TENANT.id, "nobudata", {})).toEqual({
        items: [expect.objectContaining({ name: "ouroboros" })],
        total: 1,
        limit: 25,
        offset: 0,
      });
      expect(repository.listRepos).toHaveBeenCalledWith(ORG.id, { limit: 25, offset: 0 });
    });

    it("answers the tenant's 404 before the organisation's", async () => {
      tenants.require.mockRejectedValue(new Error("404"));

      await expect(repos.list(TENANT.id, "nobudata", {})).rejects.toThrow();
      expect(repository.findOrg).not.toHaveBeenCalled();
    });

    it("answers the organisation's 404 when the tenant has not added it", async () => {
      repository.findOrg.mockResolvedValue(undefined);

      await expect(repos.list(TENANT.id, "nobudata", {})).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.orgNotFound },
      });
    });
  });

  describe("enabling a repository", () => {
    it("upserts, so naming one that was never recorded records it", async () => {
      // There is no discovery flow yet to have created the row, which is why the `PATCH` is
      // the operation that can create.
      await repos.setEnabled(TENANT.id, "nobudata", "ouroboros", { enabled: true });

      expect(repository.upsertRepo).toHaveBeenCalledWith(ORG.id, "ouroboros", { enabled: true });
    });

    it("leaves the branch alone when the request omits it", async () => {
      await repos.setEnabled(TENANT.id, "nobudata", "ouroboros", { enabled: false });

      expect(repository.upsertRepo).toHaveBeenCalledWith(ORG.id, "ouroboros", { enabled: false });
    });

    it("sets the branch when the request names one", async () => {
      await repos.setEnabled(TENANT.id, "nobudata", "ouroboros", {
        enabled: true,
        defaultBranch: "main",
      });

      expect(repository.upsertRepo).toHaveBeenCalledWith(ORG.id, "ouroboros", {
        enabled: true,
        default_branch: "main",
      });
    });

    it("answers the organisation's 404 rather than creating one", async () => {
      // The upsert creates a repository, never an organisation: the boundary a tenant chose
      // is not something a repository name may widen.
      repository.findOrg.mockResolvedValue(undefined);

      await expect(
        repos.setEnabled(TENANT.id, "nobudata", "ouroboros", { enabled: true }),
      ).rejects.toMatchObject({ response: { code: TENANCY_ERRORS.orgNotFound } });
      expect(repository.upsertRepo).not.toHaveBeenCalled();
    });
  });
});
