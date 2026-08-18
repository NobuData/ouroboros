import type { GithubOrg, GithubRepo } from "../db/schema";
import type { EnablementRepository } from "./enablement.repository";
import { GithubOrgsService } from "./github-orgs.service";
import { FIXTURE_ORGANIZATION } from "./organization.fixture";
import { TENANCY_ERRORS } from "./tenancy.errors";

/**
 * The two halves of the enablement boundary, and the rule that joins them.
 *
 * *A repo is in scope only when its own `enabled` and its org's are **both** true.* Neither
 * service enforces that — they are what *sets* the flags — so what is asserted here is the
 * other thing they own: that a flag can only be set through an organisation that belongs to
 * the workspace in the path, and that suspending an organisation leaves the per-repository
 * choices underneath it untouched.
 *
 * **No workspace lookup happens first**, and that is #714's change rather than an omission:
 * the tenant guard resolved `{orgId}` before the handler ran, and re-checking here would give
 * the `404`-not-`403` rule a second home. What remains is the organisation's own `404`, which
 * only this layer can answer.
 */

const WORKSPACE = FIXTURE_ORGANIZATION.id;

const ORG: GithubOrg = {
  id: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
  login: "nobudata",
  enabled: true,
  installed_at: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
  organization_id: WORKSPACE,
};

const REPO: GithubRepo = {
  id: "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
  org_id: ORG.id,
  name: "ouroboros",
  enabled: true,
  default_branch: "main",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
  // V014's sync cursor (#99), null as it is on every repository — nothing polls GitHub
  // yet, and enablement is not what will.
  issues_synced_at: null,
  issues_sync_cursor: null,
};

describe("the GitHub organisations service", () => {
  let repository: jest.Mocked<EnablementRepository>;
  let orgs: GithubOrgsService;

  beforeEach(() => {
    repository = {
      listOrgs: jest.fn().mockResolvedValue([ORG]),
      countOrgs: jest.fn().mockResolvedValue(1),
      countsFor: jest.fn().mockResolvedValue([]),
      findOrg: jest.fn().mockResolvedValue(ORG),
      createOrg: jest.fn().mockResolvedValue(ORG),
      setOrgEnabled: jest.fn().mockResolvedValue(ORG),
      listRepos: jest.fn().mockResolvedValue([REPO]),
      countRepos: jest.fn().mockResolvedValue(1),
      findRepo: jest.fn().mockResolvedValue(REPO),
      upsertRepo: jest.fn().mockResolvedValue(REPO),
    } as unknown as jest.Mocked<EnablementRepository>;

    orgs = new GithubOrgsService(repository);
  });

  describe("listing", () => {
    it("answers a page of resources", async () => {
      expect(await orgs.list(WORKSPACE, {})).toEqual({
        items: [expect.objectContaining({ login: "nobudata", enabled: true })],
        total: 1,
        limit: 25,
        offset: 0,
      });
    });

    it("scopes every read to the workspace in the path", async () => {
      await orgs.list(WORKSPACE, {});

      expect(repository.listOrgs).toHaveBeenCalledWith(WORKSPACE, { limit: 25, offset: 0 });
      expect(repository.countOrgs).toHaveBeenCalledWith(WORKSPACE);
    });
  });

  describe("adding", () => {
    it("starts it switched off unless asked", async () => {
      // V003's own default, stated here rather than omitted, so the API's default and the
      // schema's are visibly the same decision.
      await orgs.add(WORKSPACE, { login: "nobudata" });

      expect(repository.createOrg).toHaveBeenCalledWith(WORKSPACE, "nobudata", false);
    });

    it("starts it on when the request says so", async () => {
      await orgs.add(WORKSPACE, { login: "nobudata", enabled: true });

      expect(repository.createOrg).toHaveBeenCalledWith(WORKSPACE, "nobudata", true);
    });
  });

  describe("reading one", () => {
    it("resolves the login within the workspace", async () => {
      expect(await orgs.read(WORKSPACE, "nobudata")).toEqual(
        expect.objectContaining({ login: "nobudata", orgId: WORKSPACE }),
      );
      expect(repository.findOrg).toHaveBeenCalledWith(WORKSPACE, "nobudata", undefined);
    });

    it("answers 404 for an organisation this workspace has not added", async () => {
      repository.findOrg.mockResolvedValue(undefined);

      await expect(orgs.read(WORKSPACE, "nobudata")).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.orgNotFound },
      });
    });
  });

  describe("enabling", () => {
    it("resolves the login within the workspace before changing anything", async () => {
      await orgs.setEnabled(WORKSPACE, "nobudata", { enabled: false });

      expect(repository.findOrg).toHaveBeenCalledWith(WORKSPACE, "nobudata", undefined);
      expect(repository.setOrgEnabled).toHaveBeenCalledWith(ORG.id, false);
    });

    it("answers 404 for an organisation this workspace has not added", async () => {
      // Scoped, so an organisation another workspace enabled answers exactly as one nobody
      // has — the existence rule, applied one level below the guard's.
      repository.findOrg.mockResolvedValue(undefined);

      await expect(orgs.setEnabled(WORKSPACE, "nobudata", { enabled: true })).rejects.toMatchObject(
        { response: { code: TENANCY_ERRORS.orgNotFound } },
      );
      expect(repository.setOrgEnabled).not.toHaveBeenCalled();
    });

    it("answers 404 when the row vanished between the lookup and the update", async () => {
      repository.setOrgEnabled.mockResolvedValue(undefined);

      await expect(orgs.setEnabled(WORKSPACE, "nobudata", { enabled: true })).rejects.toMatchObject(
        { response: { code: TENANCY_ERRORS.orgNotFound } },
      );
    });

    it("touches only the organisation's flag", async () => {
      // Suspending an organisation preserves the per-repository choices underneath it, which
      // is why there are two flags rather than one.
      await orgs.setEnabled(WORKSPACE, "nobudata", { enabled: false });

      expect(repository.upsertRepo).not.toHaveBeenCalled();
    });
  });
});
