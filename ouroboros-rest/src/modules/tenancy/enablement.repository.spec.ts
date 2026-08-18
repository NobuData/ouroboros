import type { GithubOrg, GithubRepo } from "../db/schema";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { EnablementRepository } from "./enablement.repository";

/**
 * The enablement statements — the upsert that makes a `PATCH` able to create, and the one
 * grouped query the Step 2 row model is counted with.
 *
 * Three properties are worth asserting in the SQL:
 *
 *   * **Organisations are scoped by `organization_id`**, because enablement is per workspace
 *     and two workspaces may each have added the same GitHub organisation. That column is
 *     V006's — it was `tenant_id` until #708 — and the whole of what made this module
 *     uncompilable in between, so the scoping is checked by *name* rather than by shape.
 *   * **Repositories are scoped by *organisation***, because V003 hangs them off `org_id` and
 *     the workspace is reachable through it — a second copy of that fact here could disagree
 *     with the organisation's, which is why V006 had no reason to touch the table.
 *   * **{@link EnablementRepository.countsFor} is one statement for a whole page**, which is
 *     what keeps `GET /api/v1/orgs` from being two hundred round trips at the contract's page
 *     ceiling.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const OTHER_WORKSPACE = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const ORG = "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f";

const ORG_ROW = {
  id: ORG,
  login: "nobudata",
  enabled: true,
  installed_at: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
  organization_id: WORKSPACE,
} satisfies GithubOrg;

const REPO_ROW = {
  id: "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
  org_id: ORG,
  name: "ouroboros",
  enabled: true,
  default_branch: "main",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
  // V014's sync cursor (#99), null as it is on every repository — nothing polls GitHub
  // yet, and enablement is not what will.
  issues_synced_at: null,
  issues_sync_cursor: null,
} satisfies GithubRepo;

describe("the enablement repository", () => {
  let database: RecordingDatabase;
  let enablement: EnablementRepository;

  beforeEach(() => {
    database = recordingDatabase();
    enablement = new EnablementRepository(database.service);
  });

  describe("GitHub organisations", () => {
    it("are listed within the workspace, by login", async () => {
      await enablement.listOrgs(WORKSPACE, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('where "organization_id" = $1');
      expect(database.statements[0].sql).toContain('order by "login"');
    });

    it("name the column V006 re-parented them onto, and not the one it dropped", async () => {
      // The assertion that would have failed for every day between #708 and #714. `tenant_id`
      // does not exist in the database any more, so a statement still naming it compiles
      // against the mirror and is refused by PostgreSQL — which is a 500 on a settings screen.
      await enablement.listOrgs(WORKSPACE, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).not.toContain("tenant_id");
    });

    it("are listed whether or not they are enabled", async () => {
      // A settings screen has to render the switch that is off, and a list that hid the
      // disabled ones would make turning one back on impossible through this API.
      await enablement.listOrgs(WORKSPACE, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).not.toContain('"enabled"');
    });

    it("are counted within the workspace", async () => {
      database.answers({ rows: [{ total: "2" }] });

      expect(await enablement.countOrgs(WORKSPACE)).toBe(2);
      expect(database.statements[0].sql).toContain('where "organization_id" = $1');
    });

    it("are found by the pair the unique key is on", async () => {
      await enablement.findOrg(WORKSPACE, "nobudata");

      expect(database.statements[0].sql).toContain('where "organization_id" = $1 and "login" = $2');
      expect(database.statements[0].parameters).toEqual([WORKSPACE, "nobudata"]);
    });

    it("are created with the flag stated rather than defaulted", async () => {
      // The caller passes V003's own default when the request said nothing, so the API's
      // default and the schema's are visibly the same decision rather than two.
      database.answers({ rows: [ORG_ROW] });

      await enablement.createOrg(WORKSPACE, "nobudata", false);

      expect(database.statements[0].parameters).toEqual([WORKSPACE, "nobudata", false]);
    });

    it("are enabled by id, and answer undefined when the row is gone", async () => {
      expect(await enablement.setOrgEnabled(ORG, true)).toBeUndefined();
      expect(database.statements[0].sql).toContain('where "id" = $2');
    });
  });

  describe("the Step 2 counts", () => {
    it("are one statement for every workspace on the page", async () => {
      // The property that matters at a hundred rows, which is the contract's ceiling: the
      // obvious implementation — list, then count per workspace — is two hundred round trips.
      await enablement.countsFor([WORKSPACE, OTHER_WORKSPACE]);

      expect(database.statements).toHaveLength(1);
      // Every workspace on the page is a parameter of the one statement, beside the literals
      // the aggregate filter and the subquery contribute.
      expect(database.statements[0].parameters).toEqual(
        expect.arrayContaining([WORKSPACE, OTHER_WORKSPACE]),
      );
      expect(database.statements[0].sql).toContain('"organization_id" in ($');
    });

    it("count the enabled repositories apart from the total", async () => {
      await enablement.countsFor([WORKSPACE]);

      // `filter (where …)` rather than a second query or a `sum(case …)`: the mockup's line is
      // "4 repos enabled" beside a switch that can be off, so both numbers travel together.
      expect(database.statements[0].sql).toContain("filter");
      expect(database.statements[0].sql).toContain("enabled_repos");
      expect(database.statements[0].sql).toContain("total_repos");
    });

    it("keep an organisation with no repositories rather than dropping it", async () => {
      // A `left join`, and the reason is the mockup's `acme-labs` row: a workspace whose
      // organisation has nothing under it still renders, with a zero and a switch that is off.
      await enablement.countsFor([WORKSPACE]);

      expect(database.statements[0].sql).toContain("left join");
    });

    it("choose the featured repository by record order rather than alphabetically", async () => {
      // `min(name)` would answer "atlas-scheduler" for the seed; the mockup says
      // "incl. helios-firmware", which is the first one recorded. A correlated subquery is what
      // lets the choice be made by `created_at` rather than by the name being aggregated.
      await enablement.countsFor([WORKSPACE]);

      expect(database.statements[0].sql).toContain("featured_repo");
      expect(database.statements[0].sql).toContain('order by "featured"."created_at"');
    });

    it("group by the organisation, so each switch carries its own numbers", async () => {
      await enablement.countsFor([WORKSPACE]);

      expect(database.statements[0].sql).toContain("group by");
      expect(database.statements[0].sql).toContain('order by "org"."organization_id"');
    });

    it("issue no statement at all for a page of no workspaces", async () => {
      // `in ()` is not valid SQL, and a page of nothing has no counts by definition — so the
      // guard is correctness rather than an optimisation.
      expect(await enablement.countsFor([])).toEqual([]);
      expect(database.statements).toEqual([]);
    });
  });

  describe("repositories", () => {
    it("are listed within their organisation, by name", async () => {
      await enablement.listRepos(ORG, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('where "org_id" = $1');
      expect(database.statements[0].sql).toContain('order by "name"');
    });

    it("are counted within their organisation", async () => {
      database.answers({ rows: [{ total: "9" }] });

      expect(await enablement.countRepos(ORG)).toBe(9);
    });

    it("are found by the pair the unique key is on", async () => {
      await enablement.findRepo(ORG, "ouroboros");

      expect(database.statements[0].sql).toContain('where "org_id" = $1 and "name" = $2');
    });

    describe("the upsert", () => {
      it("inserts and updates in one statement", async () => {
        // The whole reason a `PATCH` can create: there is no discovery flow yet to have made
        // the row, and select-then-insert is the race `github_repos_org_name_key` refuses.
        database.answers({ rows: [REPO_ROW] });

        await enablement.upsertRepo(ORG, "ouroboros", { enabled: true });

        expect(database.statements[0].sql).toContain('on conflict ("org_id", "name") do update');
      });

      it("sets the branch only when the caller named one", async () => {
        // Omitted means "I am not setting this", not "set this to nothing" — the branch is
        // discovered from GitHub, and an enable/disable should not forget it.
        database.answers({ rows: [REPO_ROW] });

        await enablement.upsertRepo(ORG, "ouroboros", { enabled: true });

        expect(database.statements[0].sql).not.toContain("default_branch");
      });

      it("sets the branch when it was named", async () => {
        database.answers({ rows: [REPO_ROW] });

        await enablement.upsertRepo(ORG, "ouroboros", { enabled: true, default_branch: "main" });

        expect(database.statements[0].sql).toContain('"default_branch"');
        expect(database.statements[0].parameters).toContain("main");
      });

      it("returns the row it stored", async () => {
        database.answers({ rows: [REPO_ROW] });

        expect(await enablement.upsertRepo(ORG, "ouroboros", { enabled: true })).toEqual(REPO_ROW);
      });
    });
  });
});
