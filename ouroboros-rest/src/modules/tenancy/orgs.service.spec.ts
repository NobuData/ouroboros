import type { EnablementRepository, GithubOrgCountsRow } from "./enablement.repository";
import type { OrganizationRepository } from "./organization.repository";
import { FIXTURE_ORGANIZATION, FIXTURE_OTHER_ORGANIZATION } from "./organization.fixture";
import { OrgsService } from "./orgs.service";
import { runWithTenantContext, setTenantContext } from "./tenant.context";
import { FIXTURE_USER } from "../auth/principal.fixture";

/**
 * The Step 2 row model, assembled.
 *
 * `GET /api/v1/orgs` composes three tables into one answer, and the composition is where the
 * mistakes are — not in any of the statements, which `enablement.repository.spec.ts` and
 * `organization.repository.spec.ts` cover. Four properties matter:
 *
 *   * **It is scoped to the caller.** The route is `@TenantOptional()`, so nothing above the
 *     service narrows it: a listing that read the wrong user id — or none — would be a
 *     listing of somebody else's workspaces, which is the leak the exemption could otherwise
 *     become.
 *   * **It is two statements plus one, not two per row.** A hundred workspaces must not be
 *     two hundred round trips.
 *   * **A workspace with nothing recorded still renders.** The mockup's `acme-labs` row is a
 *     zero and a switch that is off, not an absence.
 *   * **The counts land on the right workspace.** The grouped query answers flat, and the
 *     regrouping is the one place two workspaces' numbers could be swapped.
 */

/** One row of the grouped counts query, as `pg` returns it — aggregates as strings. */
function counts(
  organizationId: string,
  login: string,
  overrides: Partial<GithubOrgCountsRow> = {},
): GithubOrgCountsRow {
  return {
    organization_id: organizationId,
    login,
    enabled: true,
    enabled_repos: "0",
    total_repos: "0",
    featured_repo: null,
    ...overrides,
  };
}

describe("the workspaces service", () => {
  let organizations: jest.Mocked<OrganizationRepository>;
  let enablement: jest.Mocked<EnablementRepository>;
  let orgs: OrgsService;

  beforeEach(() => {
    organizations = {
      listFor: jest
        .fn()
        .mockResolvedValue([{ organization: FIXTURE_ORGANIZATION, roles: ["owner"] }]),
      countFor: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<OrganizationRepository>;

    enablement = {
      countsFor: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EnablementRepository>;

    orgs = new OrgsService(organizations, enablement);
  });

  /**
   * Run a listing as the fixture person, inside a request context.
   *
   * @param query - The window, if the test cares.
   * @returns The page.
   */
  function asSignedIn(query = {}): ReturnType<OrgsService["list"]> {
    return runWithTenantContext(() => {
      setTenantContext({ user: FIXTURE_USER });
      return orgs.list(query);
    });
  }

  describe("scoping", () => {
    it("reads only the signed-in person's memberships", async () => {
      await asSignedIn();

      expect(organizations.listFor).toHaveBeenCalledWith(FIXTURE_USER.id, {
        limit: 25,
        offset: 0,
      });
      expect(organizations.countFor).toHaveBeenCalledWith(FIXTURE_USER.id);
    });

    it("applies the window the caller asked for", async () => {
      await asSignedIn({ limit: 100, offset: 50 });

      expect(organizations.listFor).toHaveBeenCalledWith(FIXTURE_USER.id, {
        limit: 100,
        offset: 50,
      });
    });

    it("refuses loudly rather than answering an empty page for nobody", async () => {
      // The route is @TenantOptional(), not @AllowAnonymous(). An empty page is what "you
      // belong to nothing" looks like, so a listing scoped to nobody must not be able to
      // produce one — the two would be indistinguishable to a screen.
      await expect(runWithTenantContext(() => orgs.list({}))).rejects.toThrow(/@TenantOptional/);
      expect(organizations.listFor).not.toHaveBeenCalled();
    });
  });

  describe("the counts", () => {
    it("are one query for the whole page", async () => {
      organizations.listFor.mockResolvedValue([
        { organization: FIXTURE_ORGANIZATION, roles: ["owner"] },
        { organization: FIXTURE_OTHER_ORGANIZATION, roles: ["member"] },
      ]);
      organizations.countFor.mockResolvedValue(2);

      await asSignedIn();

      expect(enablement.countsFor).toHaveBeenCalledTimes(1);
      expect(enablement.countsFor).toHaveBeenCalledWith([
        FIXTURE_ORGANIZATION.id,
        FIXTURE_OTHER_ORGANIZATION.id,
      ]);
    });

    it("land on the workspace they belong to", async () => {
      // The regrouping, which is the one place two workspaces' numbers could be swapped: the
      // query answers flat, ordered by workspace and then login.
      organizations.listFor.mockResolvedValue([
        { organization: FIXTURE_ORGANIZATION, roles: ["owner"] },
        { organization: FIXTURE_OTHER_ORGANIZATION, roles: ["member"] },
      ]);
      organizations.countFor.mockResolvedValue(2);
      enablement.countsFor.mockResolvedValue([
        counts(FIXTURE_ORGANIZATION.id, "acme-robotics", {
          enabled_repos: "4",
          total_repos: "4",
          featured_repo: "helios-firmware",
        }),
        counts(FIXTURE_OTHER_ORGANIZATION.id, "globex", {
          enabled: false,
          enabled_repos: "0",
          total_repos: "2",
        }),
      ]);

      const page = await asSignedIn();

      expect(page.items[0]).toMatchObject({
        id: FIXTURE_ORGANIZATION.id,
        enabled: true,
        repoCounts: { enabled: 4, total: 4 },
        featuredRepo: "helios-firmware",
      });
      expect(page.items[1]).toMatchObject({
        id: FIXTURE_OTHER_ORGANIZATION.id,
        enabled: false,
        repoCounts: { enabled: 0, total: 2 },
        featuredRepo: null,
      });
    });

    it("arrive as numbers rather than as the strings pg counts in", async () => {
      // `count(*)` is `bigint`, which `pg` hands back as a string. A `total` that reached the
      // wire as `"4"` would be a contract violation the specification calls an `integer`.
      enablement.countsFor.mockResolvedValue([
        counts(FIXTURE_ORGANIZATION.id, "acme-robotics", {
          enabled_repos: "4",
          total_repos: "9",
        }),
      ]);

      const page = await asSignedIn();

      expect(page.items[0].repoCounts).toEqual({ enabled: 4, total: 9 });
      expect(page.items[0].githubOrgs[0].repoCounts).toEqual({ enabled: 4, total: 9 });
    });

    it("sum across a workspace's several organisations", async () => {
      enablement.countsFor.mockResolvedValue([
        counts(FIXTURE_ORGANIZATION.id, "first", { enabled_repos: "2", total_repos: "5" }),
        counts(FIXTURE_ORGANIZATION.id, "second", {
          enabled: false,
          enabled_repos: "1",
          total_repos: "1",
        }),
      ]);

      const page = await asSignedIn();

      expect(page.items[0].repoCounts).toEqual({ enabled: 3, total: 6 });
      expect(page.items[0].githubOrgs).toHaveLength(2);
      // Any of them being on is the row's switch being on.
      expect(page.items[0].enabled).toBe(true);
    });

    it("take the first organisation with an enabled repository as the featured one", async () => {
      // The query returns a workspace's organisations by login, so the choice is stable
      // between two identical requests — which is what a line beside a count has to be.
      enablement.countsFor.mockResolvedValue([
        counts(FIXTURE_ORGANIZATION.id, "first", { featured_repo: null }),
        counts(FIXTURE_ORGANIZATION.id, "second", {
          enabled_repos: "1",
          total_repos: "1",
          featured_repo: "helios-firmware",
        }),
      ]);

      expect((await asSignedIn()).items[0].featuredRepo).toBe("helios-firmware");
    });
  });

  describe("a workspace with nothing recorded", () => {
    it("still renders, switched off and counted at zero", async () => {
      // The mockup's `acme-labs` row. An absence here would be a workspace a person belongs to
      // and cannot see, which is the opposite of what Step 2 is for.
      const page = await asSignedIn();

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        enabled: false,
        repoCounts: { enabled: 0, total: 0 },
        featuredRepo: null,
        githubOrgs: [],
      });
    });
  });

  describe("the page", () => {
    it("echoes the window and the total the way every list in this API does", async () => {
      organizations.countFor.mockResolvedValue(37);

      expect(await asSignedIn({ limit: 10, offset: 20 })).toMatchObject({
        total: 37,
        limit: 10,
        offset: 20,
      });
    });

    it("is empty for somebody who belongs to nothing yet", async () => {
      // A state, not a failure: it is what the login screen's `no-workspace` step draws, and
      // it is why this route cannot require a workspace to answer.
      organizations.listFor.mockResolvedValue([]);
      organizations.countFor.mockResolvedValue(0);

      expect(await asSignedIn()).toEqual({ items: [], total: 0, limit: 25, offset: 0 });
      expect(enablement.countsFor).toHaveBeenCalledWith([]);
    });

    it("carries the roles the caller holds in each workspace", async () => {
      organizations.listFor.mockResolvedValue([
        { organization: FIXTURE_ORGANIZATION, roles: ["admin", "member"] },
      ]);

      expect((await asSignedIn()).items[0].roles).toEqual(["admin", "member"]);
    });
  });
});
