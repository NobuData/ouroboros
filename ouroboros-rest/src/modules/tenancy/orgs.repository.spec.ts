import type { GithubOrg, GithubRepo } from "../db/schema";
import { OrgsRepository } from "./orgs.repository";
import { recordingDatabase, type RecordingDatabase } from "./database.fixture";

/**
 * The enablement statements — and the upsert that makes a `PATCH` able to create.
 *
 * Two properties are worth asserting in the SQL. Organisations are scoped by tenant, because
 * enablement is per tenant and two tenants may each have added the same one. Repositories are
 * scoped by *organisation*, because V003 hangs them off `org_id` and the tenant is reachable
 * through it — a second copy of that fact here could disagree with the organisation's.
 */

const TENANT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ORG = "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f";

const ORG_ROW = {
  id: ORG,
  tenant_id: TENANT,
  login: "nobudata",
  enabled: true,
  installed_at: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies GithubOrg;

const REPO_ROW = {
  id: "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
  org_id: ORG,
  name: "ouroboros",
  enabled: true,
  default_branch: "main",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies GithubRepo;

describe("the organisations repository", () => {
  let database: RecordingDatabase;
  let orgs: OrgsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    orgs = new OrgsRepository(database.service);
  });

  describe("organisations", () => {
    it("are listed within the tenant, by login", async () => {
      await orgs.listOrgs(TENANT, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('where "tenant_id" = $1');
      expect(database.statements[0].sql).toContain('order by "login"');
    });

    it("are listed whether or not they are enabled", async () => {
      // A settings screen has to render the switch that is off, and a list that hid the
      // disabled ones would make turning one back on impossible through this API.
      await orgs.listOrgs(TENANT, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).not.toContain('"enabled"');
    });

    it("are counted within the tenant", async () => {
      database.answers({ rows: [{ total: "2" }] });

      expect(await orgs.countOrgs(TENANT)).toBe(2);
      expect(database.statements[0].sql).toContain('where "tenant_id" = $1');
    });

    it("are found by the pair the unique key is on", async () => {
      await orgs.findOrg(TENANT, "nobudata");

      expect(database.statements[0].sql).toContain('where "tenant_id" = $1 and "login" = $2');
      expect(database.statements[0].parameters).toEqual([TENANT, "nobudata"]);
    });

    it("are created with the flag stated rather than defaulted", async () => {
      // The caller passes V003's own default when the request said nothing, so the API's
      // default and the schema's are visibly the same decision rather than two.
      database.answers({ rows: [ORG_ROW] });

      await orgs.createOrg(TENANT, "nobudata", false);

      expect(database.statements[0].parameters).toEqual([TENANT, "nobudata", false]);
    });

    it("are enabled by id, and answer undefined when the row is gone", async () => {
      expect(await orgs.setOrgEnabled(ORG, true)).toBeUndefined();
      expect(database.statements[0].sql).toContain('where "id" = $2');
    });
  });

  describe("repositories", () => {
    it("are listed within their organisation, by name", async () => {
      await orgs.listRepos(ORG, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('where "org_id" = $1');
      expect(database.statements[0].sql).toContain('order by "name"');
    });

    it("are counted within their organisation", async () => {
      database.answers({ rows: [{ total: "9" }] });

      expect(await orgs.countRepos(ORG)).toBe(9);
    });

    it("are found by the pair the unique key is on", async () => {
      await orgs.findRepo(ORG, "ouroboros");

      expect(database.statements[0].sql).toContain('where "org_id" = $1 and "name" = $2');
    });

    describe("the upsert", () => {
      it("inserts and updates in one statement", async () => {
        // The whole reason a `PATCH` can create: there is no discovery flow yet to have made
        // the row, and select-then-insert is the race `github_repos_org_name_key` refuses.
        database.answers({ rows: [REPO_ROW] });

        await orgs.upsertRepo(ORG, "ouroboros", { enabled: true });

        expect(database.statements[0].sql).toContain('on conflict ("org_id", "name") do update');
      });

      it("sets the branch only when the caller named one", async () => {
        // Omitted means "I am not setting this", not "set this to nothing" — the branch is
        // discovered from GitHub, and an enable/disable should not forget it.
        database.answers({ rows: [REPO_ROW] });

        await orgs.upsertRepo(ORG, "ouroboros", { enabled: true });

        expect(database.statements[0].sql).not.toContain("default_branch");
      });

      it("sets the branch when it was named", async () => {
        database.answers({ rows: [REPO_ROW] });

        await orgs.upsertRepo(ORG, "ouroboros", { enabled: true, default_branch: "main" });

        expect(database.statements[0].sql).toContain('"default_branch"');
        expect(database.statements[0].parameters).toContain("main");
      });

      it("returns the row it stored", async () => {
        database.answers({ rows: [REPO_ROW] });

        expect(await orgs.upsertRepo(ORG, "ouroboros", { enabled: true })).toEqual(REPO_ROW);
      });
    });
  });
});
