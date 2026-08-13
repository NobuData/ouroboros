import type { GithubOrg, GithubRepo } from "../db/schema";
import type { EnablementRepository } from "./enablement.repository";
import { GithubOrgsService } from "./github-orgs.service";
import { FIXTURE_ORGANIZATION } from "./organization.fixture";
import { ReposService } from "./repos.service";
import { TENANCY_ERRORS } from "./tenancy.errors";

/**
 * Repository enablement, and the one `PATCH` in this module that creates.
 *
 * Two asymmetries are what this file is about, and both are deliberate:
 *
 *   * **A `GET` can answer `404 repo_not_found` and the `PATCH` beside it cannot.** Naming a
 *     repository in a `PATCH` is how one comes to exist — there is no discovery flow yet — so
 *     the only operation with nothing to create is the one that can honestly report a miss.
 *   * **Neither can create an *organisation*.** The boundary a workspace chose is not
 *     something a repository name may widen, so an unrecorded login is a `404` on every path
 *     through this service.
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
};

describe("the repositories service", () => {
  let repository: jest.Mocked<EnablementRepository>;
  let repos: ReposService;

  beforeEach(() => {
    repository = {
      findOrg: jest.fn().mockResolvedValue(ORG),
      listRepos: jest.fn().mockResolvedValue([REPO]),
      countRepos: jest.fn().mockResolvedValue(1),
      findRepo: jest.fn().mockResolvedValue(REPO),
      upsertRepo: jest.fn().mockResolvedValue(REPO),
    } as unknown as jest.Mocked<EnablementRepository>;

    repos = new ReposService(repository, new GithubOrgsService(repository));
  });

  describe("listing", () => {
    it("resolves the organisation and lists within it", async () => {
      expect(await repos.list(WORKSPACE, "nobudata", {})).toEqual({
        items: [expect.objectContaining({ name: "ouroboros", githubOrgId: ORG.id })],
        total: 1,
        limit: 25,
        offset: 0,
      });
      expect(repository.listRepos).toHaveBeenCalledWith(ORG.id, { limit: 25, offset: 0 });
    });

    it("answers the organisation's 404 when the workspace has not added it", async () => {
      repository.findOrg.mockResolvedValue(undefined);

      await expect(repos.list(WORKSPACE, "nobudata", {})).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.orgNotFound },
      });
      expect(repository.listRepos).not.toHaveBeenCalled();
    });
  });

  describe("reading one", () => {
    it("resolves the organisation, then the repository within it", async () => {
      expect(await repos.read(WORKSPACE, "nobudata", "ouroboros")).toEqual(
        expect.objectContaining({ name: "ouroboros", enabled: true, defaultBranch: "main" }),
      );
      expect(repository.findRepo).toHaveBeenCalledWith(ORG.id, "ouroboros");
    });

    it("answers 404 for a repository Ouroboros has never heard of", async () => {
      // The one operation that can. Its `PATCH` counterpart would create the row instead,
      // which is why `repo_not_found` is documented on this method alone.
      repository.findRepo.mockResolvedValue(undefined);

      await expect(repos.read(WORKSPACE, "nobudata", "ouroboros")).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.repoNotFound },
      });
    });

    it("answers the organisation's 404 ahead of the repository's", async () => {
      // Which is the more specific truth: if the organisation is not recorded, nothing can be
      // said about what is inside it — and saying "no such repository" would imply there was
      // an organisation to look in.
      repository.findOrg.mockResolvedValue(undefined);
      repository.findRepo.mockResolvedValue(undefined);

      await expect(repos.read(WORKSPACE, "nobudata", "ouroboros")).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.orgNotFound },
      });
      expect(repository.findRepo).not.toHaveBeenCalled();
    });
  });

  describe("enabling", () => {
    it("upserts, so naming one that was never recorded records it", async () => {
      // There is no discovery flow yet to have created the row, which is why the `PATCH` is
      // the operation that can create.
      await repos.setEnabled(WORKSPACE, "nobudata", "ouroboros", { enabled: true });

      expect(repository.upsertRepo).toHaveBeenCalledWith(ORG.id, "ouroboros", { enabled: true });
    });

    it("leaves the branch alone when the request omits it", async () => {
      await repos.setEnabled(WORKSPACE, "nobudata", "ouroboros", { enabled: false });

      expect(repository.upsertRepo).toHaveBeenCalledWith(ORG.id, "ouroboros", { enabled: false });
    });

    it("sets the branch when the request names one", async () => {
      await repos.setEnabled(WORKSPACE, "nobudata", "ouroboros", {
        enabled: true,
        defaultBranch: "main",
      });

      expect(repository.upsertRepo).toHaveBeenCalledWith(ORG.id, "ouroboros", {
        enabled: true,
        default_branch: "main",
      });
    });

    it("answers the organisation's 404 rather than creating one", async () => {
      // The upsert creates a repository, never an organisation: the boundary a workspace
      // chose is not something a repository name may widen.
      repository.findOrg.mockResolvedValue(undefined);

      await expect(
        repos.setEnabled(WORKSPACE, "nobudata", "ouroboros", { enabled: true }),
      ).rejects.toMatchObject({ response: { code: TENANCY_ERRORS.orgNotFound } });
      expect(repository.upsertRepo).not.toHaveBeenCalled();
    });
  });
});
