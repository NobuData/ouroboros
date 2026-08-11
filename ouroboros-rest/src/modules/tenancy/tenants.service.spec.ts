import { recordingDatabase } from "../db/database.fixture";
import type { Tenant, User } from "../db/schema";
import { NotFoundError } from "../errors/error.envelope";
import type { MembersRepository } from "./members.repository";
import { runWithTenantContext, setTenantContext } from "./tenant.context";
import { TENANCY_ERRORS } from "./tenancy.errors";
import type { TenantsRepository } from "./tenants.repository";
import { CREATOR_ROLE, TenantsService } from "./tenants.service";

/**
 * The rules about a tenant, with the statements mocked away.
 *
 * What is left when the SQL is somebody else's problem is exactly the layer's job: turning
 * "no row" into a `404`, turning a row into the resource a client reads, and deciding what a
 * `PATCH` that asked for nothing means.
 */

const ROW: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

/** The signed-in person every test below is acting as. */
const USER: User = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

describe("the tenants service", () => {
  let repository: jest.Mocked<TenantsRepository>;
  let members: jest.Mocked<MembersRepository>;
  let tenants: TenantsService;

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue([ROW]),
      count: jest.fn().mockResolvedValue(1),
      listForUser: jest.fn().mockResolvedValue([ROW]),
      countForUser: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockResolvedValue(ROW),
      create: jest.fn().mockResolvedValue(ROW),
      update: jest.fn().mockResolvedValue(ROW),
    } as unknown as jest.Mocked<TenantsRepository>;

    members = {
      join: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MembersRepository>;

    tenants = new TenantsService(recordingDatabase().service, repository, members);
  });

  /**
   * Run something as the signed-in person, inside a request context.
   *
   * `list` reads `currentUser()` rather than taking a parameter — see the service's header
   * for why — so a test of it has to open the context the guard would have opened.
   *
   * @param work - What to run.
   * @returns Whatever it returned.
   */
  async function asSignedIn<T>(work: () => Promise<T>): Promise<T> {
    return runWithTenantContext(() => {
      setTenantContext({ user: USER });
      return work();
    });
  }

  describe("listing", () => {
    it("answers the page in the shape the convention defines", async () => {
      expect(await asSignedIn(() => tenants.list({ limit: 10, offset: 20 }))).toEqual({
        items: [expect.objectContaining({ slug: "acme" })],
        total: 1,
        limit: 10,
        offset: 20,
      });
    });

    it("applies the defaults when the request named no window", async () => {
      await asSignedIn(() => tenants.list({}));

      expect(repository.listForUser).toHaveBeenCalledWith(USER.id, { limit: 25, offset: 0 });
    });

    it("is scoped to the signed-in person, never the whole table", async () => {
      // An unscoped listing would hand anybody with a session the name and handle of every
      // customer on the installation — a larger existence leak than the 403 this issue
      // replaced with a 404, and one request rather than a scan.
      await asSignedIn(() => tenants.list({}));

      expect(repository.list).not.toHaveBeenCalled();
      expect(repository.count).not.toHaveBeenCalled();
      expect(repository.countForUser).toHaveBeenCalledWith(USER.id);
    });

    it("answers an empty page when there is no request context at all", async () => {
      // Not reachable through the pipeline — the guard establishes the person before any
      // handler runs. Empty rather than a throw, because "no context" is honestly "no
      // tenants for whoever this is".
      expect(await tenants.list({})).toEqual({ items: [], total: 0, limit: 25, offset: 0 });
      expect(repository.listForUser).not.toHaveBeenCalled();
    });

    it("asks for the rows and the count at once", async () => {
      // They are independent and take different connections from the same pool; waiting for
      // one before asking for the other would make every list endpoint twice as slow for no
      // reason. The count is therefore expected to have *started* while the rows are still
      // outstanding.
      const started: string[] = [];
      let releaseRows!: () => void;

      repository.listForUser.mockImplementation(async () => {
        started.push("list");
        await new Promise<void>((resolve) => (releaseRows = resolve));
        return [ROW];
      });
      repository.countForUser.mockImplementation(() => {
        started.push("count");
        return Promise.resolve(1);
      });

      const page = asSignedIn(() => tenants.list({}));
      await new Promise((resolve) => setImmediate(resolve));

      expect(started).toEqual(["list", "count"]);

      releaseRows();
      await expect(page).resolves.toMatchObject({ total: 1 });
    });

    it("returns resources rather than rows", async () => {
      const page = await asSignedIn(() => tenants.list({}));

      expect(page.items[0]).toHaveProperty("displayName");
      expect(page.items[0]).not.toHaveProperty("display_name");
    });
  });

  describe("creating", () => {
    it("does not check the slug first", async () => {
      // `tenants_slug_key` is the thing that is actually true. A check here would be a
      // second, weaker answer with a race between it and the insert — `constraints.ts` maps
      // the index's own refusal instead.
      await tenants.create(USER, { slug: "acme", displayName: "Acme, Inc." });

      expect(repository.find).not.toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledWith("acme", "Acme, Inc.", expect.anything());
    });

    it("makes the creator its owner", async () => {
      // Without this the workspace has no members, and every route under it answers 404 to
      // everybody — including the person who has just made it.
      await tenants.create(USER, { slug: "acme", displayName: "Acme, Inc." });

      expect(members.join).toHaveBeenCalledWith(ROW.id, USER.id, CREATOR_ROLE, expect.anything());
      expect(CREATOR_ROLE).toBe("owner");
    });

    it("records them as joined rather than invited", async () => {
      // `invite` leaves `joined_at` null, which is what an outstanding invitation is.
      // Somebody who created the workspace has plainly accepted.
      await tenants.create(USER, { slug: "acme", displayName: "Acme, Inc." });

      expect(members.join).toHaveBeenCalled();
    });

    it("writes both rows in one transaction", async () => {
      const database = recordingDatabase();
      const scoped = new TenantsService(database.service, repository, members);

      await scoped.create(USER, { slug: "acme", displayName: "Acme, Inc." });

      expect(database.sql()[0]).toBe("begin");
      expect(database.sql().at(-1)).toBe("commit");
    });
  });

  describe("reading", () => {
    it("answers with the tenant", async () => {
      expect(await tenants.read(ROW.id)).toMatchObject({ id: ROW.id, slug: "acme" });
    });

    it("answers 404 when there is none", async () => {
      repository.find.mockResolvedValue(undefined);

      await expect(tenants.read(ROW.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe("changing", () => {
    it("translates the API's names into the database's", async () => {
      await tenants.update(ROW.id, { displayName: "Acme Corporation" });

      expect(repository.update).toHaveBeenCalledWith(ROW.id, {
        display_name: "Acme Corporation",
      });
    });

    it("sets only the fields the request named", async () => {
      await tenants.update(ROW.id, { status: "suspended" });

      expect(repository.update).toHaveBeenCalledWith(ROW.id, { status: "suspended" });
    });

    it("can change all three at once", async () => {
      await tenants.update(ROW.id, {
        slug: "acme-inc",
        displayName: "Acme Corporation",
        status: "suspended",
      });

      expect(repository.update).toHaveBeenCalledWith(ROW.id, {
        slug: "acme-inc",
        display_name: "Acme Corporation",
        status: "suspended",
      });
    });

    it("answers a body that asked for nothing with the tenant unchanged", async () => {
      // `update … set` with nothing to set is not a statement, and refusing a request that
      // asked for nothing and got it would be a `422` for a correct `PATCH`.
      const answer = await tenants.update(ROW.id, {});

      expect(repository.update).not.toHaveBeenCalled();
      expect(answer).toMatchObject({ id: ROW.id });
    });

    it("answers 404 when the tenant a no-op names does not exist", async () => {
      repository.find.mockResolvedValue(undefined);

      await expect(tenants.update(ROW.id, {})).rejects.toThrow(NotFoundError);
    });

    it("answers 404 when the update matched no row", async () => {
      repository.update.mockResolvedValue(undefined);

      await expect(tenants.update(ROW.id, { status: "deleted" })).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.tenantNotFound },
      });
    });
  });

  describe("the guard every nested resource runs first", () => {
    it("returns the row rather than the resource", async () => {
      // Its callers are services, not clients: they need the id and the columns, and one of
      // them would otherwise map a resource back into a row.
      expect(await tenants.require(ROW.id)).toBe(ROW);
    });

    it("passes a transaction through, so it sees what that transaction wrote", async () => {
      const trx = Symbol("transaction") as unknown as Parameters<TenantsService["require"]>[1];

      await tenants.require(ROW.id, trx);

      expect(repository.find).toHaveBeenCalledWith(ROW.id, trx);
    });

    it("answers 404 with the id the caller sent", async () => {
      repository.find.mockResolvedValue(undefined);

      await expect(tenants.require(ROW.id)).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.tenantNotFound, details: { tenantId: ROW.id } },
      });
    });
  });
});
