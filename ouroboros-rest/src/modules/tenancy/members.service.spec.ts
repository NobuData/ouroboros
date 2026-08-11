import type { Tenant, User } from "../db/schema";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { MembersRepository } from "./members.repository";
import { MembersService } from "./members.service";
import type { MemberRow } from "./resources";
import { TENANCY_ERRORS } from "./tenancy.errors";
import type { TenantsService } from "./tenants.service";

/**
 * Membership, and the acceptance criterion this whole file exists for.
 *
 * > *Last-owner demotion or removal is rejected.*
 *
 * The rule is enforced against the **locked** owner list rather than against anything read
 * before it, so the cases below are about which list is consulted as much as about the
 * answer: a demotion is refused when the locked list is exactly this person, and allowed
 * whenever it is not.
 */

const TENANT: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

const ADA = "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85";
const GRACE = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

const USER: User = {
  id: ADA,
  email: "ada@acme.example",
  display_name: "Ada Lovelace",
  avatar_url: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

const MEMBER: MemberRow = {
  tenant_id: TENANT.id,
  user_id: ADA,
  email: "ada@acme.example",
  display_name: "Ada Lovelace",
  avatar_url: null,
  role: "owner",
  invited_at: new Date("2026-08-11T10:20:23.114Z"),
  joined_at: null,
};

describe("the members service", () => {
  let database: RecordingDatabase;
  let repository: jest.Mocked<MembersRepository>;
  let tenants: jest.Mocked<TenantsService>;
  let members: MembersService;

  beforeEach(() => {
    database = recordingDatabase();

    repository = {
      list: jest.fn().mockResolvedValue([MEMBER]),
      count: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockResolvedValue(MEMBER),
      ownerIdsForUpdate: jest.fn().mockResolvedValue([ADA, GRACE]),
      findUserByEmail: jest.fn().mockResolvedValue(USER),
      createUser: jest.fn().mockResolvedValue(USER),
      invite: jest.fn().mockResolvedValue(undefined),
      setRole: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<MembersRepository>;

    tenants = {
      require: jest.fn().mockResolvedValue(TENANT),
    } as unknown as jest.Mocked<TenantsService>;

    members = new MembersService(repository, tenants, database.service);
  });

  describe("listing", () => {
    it("answers a page of members with the person's details on each row", async () => {
      const page = await members.list(TENANT.id, {});

      expect(page.items[0]).toEqual({
        tenantId: TENANT.id,
        userId: ADA,
        email: "ada@acme.example",
        displayName: "Ada Lovelace",
        avatarUrl: null,
        role: "owner",
        invitedAt: "2026-08-11T10:20:23.114Z",
        joinedAt: null,
      });
    });

    it("requires the tenant first", async () => {
      tenants.require.mockRejectedValue(new Error("404"));

      await expect(members.list(TENANT.id, {})).rejects.toThrow();
      expect(repository.list).not.toHaveBeenCalled();
    });
  });

  describe("inviting", () => {
    it("folds the address before looking anyone up", async () => {
      // `users_email_key` is over a folded column, so a differently cased address would
      // create a second row for the same human.
      await members.invite(TENANT.id, { email: "Ada@Acme.Example", role: "admin" });

      expect(repository.findUserByEmail).toHaveBeenCalledWith(
        "ada@acme.example",
        expect.anything(),
      );
    });

    it("reuses a person who already exists, and does not rename them", async () => {
      // One human is one row across every tenant they belong to. An inviter typing a name
      // into a form is not authority to rename them in the others.
      await members.invite(TENANT.id, {
        email: "ada@acme.example",
        role: "admin",
        displayName: "Someone Else",
      });

      expect(repository.createUser).not.toHaveBeenCalled();
      expect(repository.invite).toHaveBeenCalledWith(TENANT.id, ADA, "admin", expect.anything());
    });

    it("creates the stub of somebody nobody has heard of", async () => {
      repository.findUserByEmail.mockResolvedValue(undefined);

      await members.invite(TENANT.id, {
        email: "grace@acme.example",
        role: "member",
        displayName: "Grace Hopper",
      });

      expect(repository.createUser).toHaveBeenCalledWith(
        "grace@acme.example",
        "Grace Hopper",
        expect.anything(),
      );
    });

    it("names them after their address when the invitation did not", async () => {
      repository.findUserByEmail.mockResolvedValue(undefined);

      await members.invite(TENANT.id, { email: "grace@acme.example", role: "member" });

      expect(repository.createUser).toHaveBeenCalledWith(
        "grace@acme.example",
        "grace",
        expect.anything(),
      );
    });

    it("creates the person and the membership in one transaction", async () => {
      // A `users` row with no membership is a person Ouroboros has heard of for no reason,
      // and it would hold their address against the unique index.
      await members.invite(TENANT.id, { email: "ada@acme.example", role: "admin" });

      expect(database.sql()).toEqual(["begin", "commit"]);
    });

    it("rolls back when the membership cannot be written", async () => {
      repository.invite.mockRejectedValue(new Error("already a member"));

      await expect(
        members.invite(TENANT.id, { email: "ada@acme.example", role: "admin" }),
      ).rejects.toThrow();
      expect(database.sql()).toEqual(["begin", "rollback"]);
    });

    it("reads the membership back rather than assembling it", async () => {
      // The resource carries the person's columns *and* the membership's timestamps, and
      // `invited_at` is a default the database chose.
      const invited = await members.invite(TENANT.id, {
        email: "ada@acme.example",
        role: "admin",
      });

      expect(repository.find).toHaveBeenCalledWith(TENANT.id, ADA, expect.anything());
      expect(invited.invitedAt).toBe("2026-08-11T10:20:23.114Z");
    });
  });

  describe("changing a role", () => {
    it("answers 404 for somebody who is not a member", async () => {
      repository.find.mockResolvedValue(undefined);

      await expect(members.changeRole(TENANT.id, ADA, { role: "admin" })).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.memberNotFound },
      });
    });

    it("demotes an owner while another remains", async () => {
      repository.ownerIdsForUpdate.mockResolvedValue([ADA, GRACE]);

      await members.changeRole(TENANT.id, ADA, { role: "admin" });

      expect(repository.setRole).toHaveBeenCalledWith(TENANT.id, ADA, "admin", expect.anything());
    });

    it("refuses to demote the last one", async () => {
      repository.ownerIdsForUpdate.mockResolvedValue([ADA]);

      await expect(members.changeRole(TENANT.id, ADA, { role: "admin" })).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.lastOwner, details: { userId: ADA } },
      });
      expect(repository.setRole).not.toHaveBeenCalled();
    });

    it("asks the locked list, not the membership it already read", async () => {
      // The membership was read before the lock was taken, so it is a statement about a
      // moment that has passed. The locked list is what is true now.
      repository.find.mockResolvedValue({ ...MEMBER, role: "admin" });
      repository.ownerIdsForUpdate.mockResolvedValue([ADA]);

      await expect(members.changeRole(TENANT.id, ADA, { role: "viewer" })).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.lastOwner },
      });
    });

    it("allows demoting somebody who is not an owner", async () => {
      repository.ownerIdsForUpdate.mockResolvedValue([GRACE]);

      await members.changeRole(TENANT.id, ADA, { role: "viewer" });

      expect(repository.setRole).toHaveBeenCalled();
    });

    it("asks nothing at all when the change is a promotion to owner", async () => {
      // It cannot reduce the number of owners, so there is nothing to lock and nothing to
      // check.
      await members.changeRole(TENANT.id, ADA, { role: "owner" });

      expect(repository.ownerIdsForUpdate).not.toHaveBeenCalled();
    });

    it("holds the lock inside the same transaction as the write", async () => {
      // A lock taken outside a transaction is released by the next statement, which would
      // make the check decorative.
      await members.changeRole(TENANT.id, ADA, { role: "admin" });

      expect(database.sql()).toEqual(["begin", "commit"]);
    });

    it("answers 404 when the membership vanished between the check and the update", async () => {
      repository.setRole.mockResolvedValue(false);

      await expect(members.changeRole(TENANT.id, ADA, { role: "admin" })).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.memberNotFound },
      });
    });
  });

  describe("removing", () => {
    it("removes a member while another owner remains", async () => {
      repository.ownerIdsForUpdate.mockResolvedValue([ADA, GRACE]);

      await expect(members.remove(TENANT.id, ADA)).resolves.toBeUndefined();
      expect(repository.remove).toHaveBeenCalledWith(TENANT.id, ADA, expect.anything());
    });

    it("refuses to remove the last owner", async () => {
      // Removal is a demotion to nothing, and the rule does not care which of the two it is.
      repository.ownerIdsForUpdate.mockResolvedValue([ADA]);

      await expect(members.remove(TENANT.id, ADA)).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.lastOwner },
      });
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it("removes somebody who is not the last owner because they are not an owner", async () => {
      repository.ownerIdsForUpdate.mockResolvedValue([GRACE]);

      await expect(members.remove(TENANT.id, ADA)).resolves.toBeUndefined();
    });

    it("answers 404 for somebody who is not a member", async () => {
      repository.find.mockResolvedValue(undefined);

      await expect(members.remove(TENANT.id, ADA)).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.memberNotFound },
      });
    });

    it("does it in one transaction", async () => {
      await members.remove(TENANT.id, ADA);

      expect(database.sql()).toEqual(["begin", "commit"]);
    });
  });
});
