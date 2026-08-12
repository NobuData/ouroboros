import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { Tenant } from "../db/schema";
import { AuthRepository } from "./auth.repository";
import type { MembershipRow } from "./auth.resources";

/**
 * The statements this module issues, read rather than mocked.
 *
 * `database.fixture.ts` explains why a repository is checked at this level: a mocked method
 * proves the repository was *called*, and the only mistake a repository can make is the
 * query.
 *
 * **Four of them were sign-in's and are gone.**
 * [#702](https://github.com/NobuData/ouroboros/issues/702) deleted `findUserByIdentity`,
 * `createUser`, `refreshProfile` and `linkIdentity` along with the flow that called them —
 * BetterAuth writes `"user"` and `account` through its own adapter now — so the suites that
 * covered them were deleted rather than skipped. What replaced the identity lookup is the
 * `account(providerId, accountId)` unique index and #706's back-fill into it, asserted in
 * `ouroboros-db/tests/constraints.sql`.
 *
 * **And two more were the guard's.**
 * [#703](https://github.com/NobuData/ouroboros/issues/703) deleted `findUserById` and
 * `findUserByEmail`: the signed-in person arrives with the session the library resolved, so
 * reading a `users` row to confirm them is a query per request that would also find nothing
 * for anybody who first signed in after V004. The two reads left are the two that answer
 * `GET /api/v1/auth/me`, and both are about tenancy rather than identity.
 */

const USER_ID = "5eed0003-0000-4000-8000-000000000001";

const MEMBERSHIP = {
  tenant_id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  role: "owner",
  invited_at: new Date("2026-08-11T10:20:23.114Z"),
  joined_at: null,
} satisfies MembershipRow;

const TENANT = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies Tenant;

describe("the auth repository", () => {
  let database: RecordingDatabase;
  let repository: AuthRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new AuthRepository(database.service);
  });

  describe("listing memberships", () => {
    it("is scoped to the person", async () => {
      await repository.listMemberships(USER_ID);

      expect(database.statements[0].sql).toContain(
        'where "ouroboros"."tenant_members"."user_id" = $1',
      );
      expect(database.statements[0].parameters).toEqual([USER_ID]);
    });

    it("joins the tenant, because a membership without it is a uuid and a role", async () => {
      await repository.listMemberships(USER_ID);

      expect(database.statements[0].sql).toContain('inner join "ouroboros"."tenants"');
      expect(database.statements[0].sql).toContain('"tenants"."slug"');
      expect(database.statements[0].sql).toContain('"tenants"."status"');
    });

    it("orders totally, so a switcher renders the same order twice running", async () => {
      await repository.listMemberships(USER_ID);

      expect(database.statements[0].sql).toContain(
        'order by "ouroboros"."tenants"."display_name", "ouroboros"."tenant_members"."tenant_id"',
      );
    });

    it("returns the joined rows", async () => {
      database.answers({ rows: [MEMBERSHIP] });

      expect(await repository.listMemberships(USER_ID)).toEqual([MEMBERSHIP]);
    });
  });

  describe("resolving a tenant from an email domain", () => {
    it("matches the folded domain column, which V001 makes globally unique", async () => {
      await repository.findTenantByDomain("acme-robotics.dev");

      expect(database.statements[0].sql).toContain(
        'where "ouroboros"."tenant_domains"."domain" = $1',
      );
      expect(database.statements[0].parameters).toEqual(["acme-robotics.dev"]);
    });

    it("returns the tenant's own columns, not the domain's", async () => {
      database.answers({ rows: [TENANT] });

      expect(await repository.findTenantByDomain("acme-robotics.dev")).toEqual(TENANT);
    });

    it("returns nothing when no tenant claims the domain", async () => {
      expect(await repository.findTenantByDomain("nowhere.example")).toBeUndefined();
    });
  });

  describe("every statement", () => {
    it("runs in the caller's transaction when it is given one", async () => {
      // The one mistake `DatabaseService.transaction` cannot prevent is a statement issued
      // on the pool instead: it takes its own connection, commits on its own, and is not
      // undone by a rollback. Every method here forwards the transaction for that reason.
      await database.service.transaction(async (trx) => {
        await repository.listMemberships(USER_ID, trx);
        await repository.findTenantByDomain("acme-robotics.dev", trx);
      });

      expect(database.sql()[0]).toBe("begin");
      expect(database.sql().at(-1)).toBe("commit");
      expect(database.statements).toHaveLength(4);
    });
  });
});
