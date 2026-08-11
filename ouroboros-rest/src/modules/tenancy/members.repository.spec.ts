import { MembersRepository, OWNER } from "./members.repository";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { MemberRow } from "./resources";

/**
 * The membership statements — and one of them is the whole last-owner rule.
 *
 * {@link MembersRepository.ownerIdsForUpdate} is the only query in this module whose *lock*
 * is the point rather than its rows. V002 leaves "a tenant keeps at least one owner" to this
 * service because it spans rows; a service that checked it with a plain `select count(*)`
 * would be answering about a moment that had already passed, and two requests demoting two
 * different owners would both pass the check. `for update` is what makes the second one wait
 * and then see the truth, so `for update` is asserted here rather than assumed.
 */

const TENANT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const USER = "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85";

const ROW = {
  tenant_id: TENANT,
  user_id: USER,
  email: "ada@acme.example",
  display_name: "Ada Lovelace",
  avatar_url: null,
  role: "owner",
  invited_at: new Date("2026-08-11T10:20:23.114Z"),
  joined_at: null,
} satisfies MemberRow;

describe("the members repository", () => {
  let database: RecordingDatabase;
  let members: MembersRepository;

  beforeEach(() => {
    database = recordingDatabase();
    members = new MembersRepository(database.service);
  });

  describe("listing", () => {
    it("joins the person, because a membership without them is two uuids and a role", async () => {
      await members.list(TENANT, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('inner join "ouroboros"."users"');
      expect(database.statements[0].sql).toContain('"users"."email"');
      expect(database.statements[0].sql).toContain('"users"."avatar_url"');
    });

    it("is scoped to the tenant", async () => {
      await members.list(TENANT, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain(
        'where "ouroboros"."tenant_members"."tenant_id" = $1',
      );
    });

    it("orders by name, with the id as the tiebreaker", async () => {
      await members.list(TENANT, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain(
        'order by "ouroboros"."users"."display_name", "ouroboros"."tenant_members"."user_id"',
      );
    });

    it("returns the joined rows", async () => {
      database.answers({ rows: [ROW] });

      expect(await members.list(TENANT, { limit: 25, offset: 0 })).toEqual([ROW]);
    });
  });

  describe("finding one", () => {
    it("takes both halves of the primary key", async () => {
      await members.find(TENANT, USER);

      expect(database.statements[0].parameters).toEqual([TENANT, USER]);
    });
  });

  describe("locking the owners", () => {
    it("selects them for update", async () => {
      // The load-bearing four words in this module.
      await database.service.transaction(async (trx) => {
        await members.ownerIdsForUpdate(TENANT, trx);
      });

      expect(database.statements[1].sql).toContain("for update");
      expect(database.statements[1].parameters).toEqual([TENANT, OWNER]);
    });

    it("selects ids rather than a count", async () => {
      // Two reasons, and either is sufficient: PostgreSQL refuses `for update` behind an
      // aggregate, and the caller has to know *which* owner, not only how many.
      database.answers({ rows: [{ user_id: USER }] });

      const owners = await database.service.transaction((trx) =>
        members.ownerIdsForUpdate(TENANT, trx),
      );

      expect(owners).toEqual([USER]);
      expect(database.statements[1].sql).not.toContain("count(");
    });
  });

  describe("the person a membership points at", () => {
    it("is looked up by the folded address the unique index holds", async () => {
      // `users_email_key` is a plain unique index over a folded column, so a differently
      // cased address would silently miss.
      await members.findUserByEmail("ada@acme.example");

      expect(database.statements[0].sql).toContain('where "email" = $1');
      expect(database.statements[0].parameters).toEqual(["ada@acme.example"]);
    });

    it("is created with nothing but an address and a name", async () => {
      // Everything else about them arrives when they sign in (#33). This row exists so a
      // membership has something to point at in the meantime.
      database.answers({ rows: [{ id: USER }] });

      await members.createUser("grace@acme.example", "Grace Hopper");

      expect(database.statements[0].sql).toContain('("email", "display_name")');
      expect(database.statements[0].parameters).toEqual(["grace@acme.example", "Grace Hopper"]);
    });
  });

  describe("inviting", () => {
    it("leaves joined_at unset, because nothing yet knows they accepted", async () => {
      await members.invite(TENANT, USER, "admin");

      expect(database.statements[0].sql).toContain('("tenant_id", "user_id", "role")');
      expect(database.statements[0].sql).not.toContain("joined_at");
      expect(database.statements[0].parameters).toEqual([TENANT, USER, "admin"]);
    });
  });

  describe("changing a role", () => {
    it("is scoped to both halves of the key", async () => {
      database.answers({ numAffectedRows: 1n });

      await members.setRole(TENANT, USER, "viewer");

      expect(database.statements[0].sql).toContain('"tenant_id" = $2 and "user_id" = $3');
      expect(database.statements[0].parameters).toEqual(["viewer", TENANT, USER]);
    });

    it("reports whether anything changed", async () => {
      database.answers({ numAffectedRows: 1n }, { numAffectedRows: 0n });

      expect(await members.setRole(TENANT, USER, "viewer")).toBe(true);
      expect(await members.setRole(TENANT, USER, "viewer")).toBe(false);
    });
  });

  describe("removing", () => {
    it("deletes the membership and not the person", async () => {
      // They may hold roles in other tenants, and V002 makes `users` global precisely so one
      // human is one row however many workspaces they belong to.
      database.answers({ numAffectedRows: 1n });

      await members.remove(TENANT, USER);

      expect(database.statements[0].sql).toContain('delete from "ouroboros"."tenant_members"');
      expect(database.statements[0].sql).not.toContain('"users"');
    });

    it("reports whether anything was removed", async () => {
      database.answers({ numAffectedRows: 0n });

      expect(await members.remove(TENANT, USER)).toBe(false);
    });
  });
});
