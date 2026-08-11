import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { Tenant, User } from "../db/schema";
import { AuthRepository, GITHUB_PROVIDER } from "./auth.repository";
import type { MembershipRow } from "./auth.resources";

/**
 * The statements sign-in issues, read rather than mocked.
 *
 * `database.fixture.ts` explains why a repository is checked at this level: a mocked method
 * proves the repository was *called*, and the only mistake a repository can make is the
 * query. Two of these matter more than the rest — the identity lookup is what makes a
 * repeat sign-in reuse a row instead of creating a second person, and the address lookup is
 * what attaches an invitation to the person who accepts it.
 */

const USER_ID = "5eed0003-0000-4000-8000-000000000001";
const EXTERNAL_ID = "900000001";
const EMAIL = "ken@acme-robotics.dev";

const USER = {
  id: USER_ID,
  email: EMAIL,
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies User;

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

  describe("finding a person by their external account", () => {
    it("keys on the provider and the immutable id, never the login", async () => {
      // A GitHub login can be changed at any time; the numeric id cannot. Keying on the
      // login would make a rename look like a new person.
      await repository.findUserByIdentity(GITHUB_PROVIDER, EXTERNAL_ID);

      expect(database.statements[0].sql).toContain(
        'where "ouroboros"."user_identities"."provider" = $1',
      );
      expect(database.statements[0].sql).toContain(
        'and "ouroboros"."user_identities"."external_id" = $2',
      );
      expect(database.statements[0].parameters).toEqual([GITHUB_PROVIDER, EXTERNAL_ID]);
    });

    it("joins the person, so one statement answers the whole question", async () => {
      await repository.findUserByIdentity(GITHUB_PROVIDER, EXTERNAL_ID);

      expect(database.statements[0].sql).toContain('inner join "ouroboros"."users"');
    });

    it("returns the person when there is one", async () => {
      database.answers({ rows: [USER] });

      expect(await repository.findUserByIdentity(GITHUB_PROVIDER, EXTERNAL_ID)).toEqual(USER);
    });

    it("returns nothing when this account has never signed in here", async () => {
      expect(await repository.findUserByIdentity(GITHUB_PROVIDER, EXTERNAL_ID)).toBeUndefined();
    });
  });

  describe("finding a person by address", () => {
    it("matches the stored column exactly, which is why the caller folds the address", async () => {
      await repository.findUserByEmail(EMAIL);

      expect(database.statements[0].sql).toContain('where "email" = $1');
      expect(database.statements[0].parameters).toEqual([EMAIL]);
    });
  });

  describe("finding a person by id", () => {
    it("is a primary-key lookup — this runs on every authenticated request", async () => {
      await repository.findUserById(USER_ID);

      expect(database.statements[0].sql).toContain('where "id" = $1');
      expect(database.statements[0].parameters).toEqual([USER_ID]);
    });
  });

  describe("creating a person", () => {
    it("writes what it was given and returns the stored row", async () => {
      database.answers({ rows: [USER] });

      const created = await repository.createUser({
        email: EMAIL,
        display_name: "Ken Suenobu",
        avatar_url: null,
      });

      expect(database.statements[0].sql).toContain('insert into "ouroboros"."users"');
      expect(database.statements[0].parameters).toEqual([EMAIL, "Ken Suenobu", null]);
      expect(created).toEqual(USER);
    });
  });

  describe("refreshing a profile", () => {
    it("writes the name and the avatar", async () => {
      database.answers({ rows: [USER] });

      await repository.refreshProfile(USER_ID, "Ken S.", "https://avatars.example/1");

      expect(database.statements[0].sql).toContain('update "ouroboros"."users"');
      expect(database.statements[0].parameters).toEqual([
        "Ken S.",
        "https://avatars.example/1",
        USER_ID,
      ]);
    });

    it("does not touch the address", async () => {
      // `users_email_key` is unique and is what an outstanding invitation was addressed to.
      // Rewriting it on every sign-in would let a GitHub-side change collide with another
      // row, or quietly detach somebody from the invitation that created theirs.
      database.answers({ rows: [USER] });

      await repository.refreshProfile(USER_ID, "Ken S.", null);

      expect(database.statements[0].sql).not.toContain('"email"');
    });
  });

  describe("linking an identity", () => {
    it("records the account and nothing that could be a credential", async () => {
      await repository.linkIdentity(USER_ID, GITHUB_PROVIDER, EXTERNAL_ID);

      expect(database.statements[0].sql).toContain('insert into "ouroboros"."user_identities"');
      expect(database.statements[0].sql).toContain('"user_id", "provider", "external_id"');
      expect(database.statements[0].parameters).toEqual([USER_ID, GITHUB_PROVIDER, EXTERNAL_ID]);
    });
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
        await repository.findUserByIdentity(GITHUB_PROVIDER, EXTERNAL_ID, trx);
        await repository.findUserByEmail(EMAIL, trx);
        await repository.linkIdentity(USER_ID, GITHUB_PROVIDER, EXTERNAL_ID, trx);
      });

      expect(database.sql()[0]).toBe("begin");
      expect(database.sql().at(-1)).toBe("commit");
      expect(database.statements).toHaveLength(5);
    });
  });
});
