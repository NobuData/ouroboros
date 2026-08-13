import type { TenantDomain } from "../db/schema";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { DomainsRepository } from "./domains.repository";
import { DomainsService } from "./domains.service";
import { FIXTURE_ORGANIZATION } from "./organization.fixture";
import { TENANCY_ERRORS } from "./tenancy.errors";

/**
 * The domain rules, and the transaction one of them needs.
 *
 * The interesting assertions here are about *order*: that the current primary is demoted
 * before another is promoted, and that both happen inside one transaction. A partial unique
 * index refuses the intermediate state, so getting the order wrong is not a subtle bug — but
 * getting the transaction wrong is, because it only shows up when two requests arrive
 * together.
 *
 * **The workspace is no longer checked here**, and one of the tests below is about the
 * absence. Every route under `/api/v1/orgs/{orgId}` is resolved by the tenant guard before a
 * handler runs, so a service that checked again would be a second place the `404`-not-`403`
 * rule lives — the thing #32 asked for it to stop being, and what
 * [#714](https://github.com/NobuData/ouroboros/issues/714) finished by deleting
 * `TenantsService`.
 */

const WORKSPACE = FIXTURE_ORGANIZATION.id;

const ROW: TenantDomain = {
  id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
  domain: "acme.example",
  is_primary: true,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
  organization_id: WORKSPACE,
};

describe("the domains service", () => {
  let database: RecordingDatabase;
  let repository: jest.Mocked<DomainsRepository>;
  let domains: DomainsService;
  /** What was called, in order, so the ordering assertions read as one list. */
  let order: string[];

  beforeEach(() => {
    order = [];
    database = recordingDatabase();

    repository = {
      list: jest.fn().mockResolvedValue([ROW]),
      count: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockResolvedValue(ROW),
      create: jest.fn(() => {
        order.push("create");
        return Promise.resolve(ROW);
      }),
      setPrimary: jest.fn(() => {
        order.push("setPrimary");
        return Promise.resolve(ROW);
      }),
      clearPrimary: jest.fn(() => {
        order.push("clearPrimary");
        return Promise.resolve();
      }),
      remove: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<DomainsRepository>;

    domains = new DomainsService(repository, database.service);
  });

  describe("listing", () => {
    it("answers a page of resources", async () => {
      expect(await domains.list(WORKSPACE, {})).toEqual({
        items: [expect.objectContaining({ domain: "acme.example", isPrimary: true })],
        total: 1,
        limit: 25,
        offset: 0,
      });
    });

    it("names the workspace on the resource it returns", async () => {
      // `orgId`, not `tenantId`: the column is `organization_id` and the path parameter is
      // `{orgId}`, so the field a client reads is the one it would send back.
      const page = await domains.list(WORKSPACE, {});

      expect(page.items[0].orgId).toBe(WORKSPACE);
    });
  });

  describe("adding", () => {
    it("defaults to not primary, as the schema does", async () => {
      await domains.add(WORKSPACE, { domain: "acme.example" });

      expect(repository.create).toHaveBeenCalledWith(
        WORKSPACE,
        "acme.example",
        false,
        expect.anything(),
      );
      expect(repository.clearPrimary).not.toHaveBeenCalled();
    });

    it("demotes the current primary before promoting the new one", async () => {
      await domains.add(WORKSPACE, { domain: "acme.example", isPrimary: true });

      expect(order).toEqual(["clearPrimary", "create"]);
    });

    it("does all of it in one transaction", async () => {
      await domains.add(WORKSPACE, { domain: "acme.example", isPrimary: true });

      expect(database.sql()).toEqual(["begin", "commit"]);
    });

    it("rolls back when the write fails", async () => {
      repository.create.mockRejectedValue(new Error("duplicate"));

      await expect(domains.add(WORKSPACE, { domain: "acme.example" })).rejects.toThrow();
      expect(database.sql()).toEqual(["begin", "rollback"]);
    });
  });

  describe("setting the primary", () => {
    it("checks the domain belongs to this workspace", async () => {
      await domains.setPrimary(WORKSPACE, ROW.id, { isPrimary: true });

      expect(repository.find).toHaveBeenCalledWith(WORKSPACE, ROW.id, expect.anything());
    });

    it("answers 404 for a domain of another workspace", async () => {
      // The same answer as one that does not exist — anything else confirms to whoever asked
      // that the identifier is real.
      repository.find.mockResolvedValue(undefined);

      await expect(
        domains.setPrimary(WORKSPACE, ROW.id, { isPrimary: true }),
      ).rejects.toMatchObject({ response: { code: TENANCY_ERRORS.domainNotFound } });
    });

    it("demotes the incumbent first", async () => {
      await domains.setPrimary(WORKSPACE, ROW.id, { isPrimary: true });

      expect(order).toEqual(["clearPrimary", "setPrimary"]);
    });

    it("demotes without promoting anything when asked to clear", async () => {
      // A workspace with no primary at all is legal, and refusing would make "replace the
      // domain we display" an operation with no order that works.
      await domains.setPrimary(WORKSPACE, ROW.id, { isPrimary: false });

      expect(repository.clearPrimary).not.toHaveBeenCalled();
      expect(repository.setPrimary).toHaveBeenCalledWith(ROW.id, false, expect.anything());
    });

    it("answers 404 when the row disappeared between the check and the update", async () => {
      repository.setPrimary.mockResolvedValue(undefined);

      await expect(
        domains.setPrimary(WORKSPACE, ROW.id, { isPrimary: true }),
      ).rejects.toMatchObject({ response: { code: TENANCY_ERRORS.domainNotFound } });
    });
  });

  describe("removing", () => {
    it("removes within the workspace", async () => {
      await domains.remove(WORKSPACE, ROW.id);

      expect(repository.remove).toHaveBeenCalledWith(WORKSPACE, ROW.id);
    });

    it("answers 404 when nothing was removed", async () => {
      repository.remove.mockResolvedValue(false);

      await expect(domains.remove(WORKSPACE, ROW.id)).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.domainNotFound },
      });
    });

    it("answers nothing at all when it worked", async () => {
      await expect(domains.remove(WORKSPACE, ROW.id)).resolves.toBeUndefined();
    });
  });

  describe("what it no longer does", () => {
    it("issues one statement per operation, with no workspace lookup in front of it", async () => {
      // The deletion, asserted. `TenantsService.require` used to run before every one of these
      // — a `select` against `tenants` on every domain request — and the guard has already
      // answered the same `404` by the time a handler is reached. A service that re-checked
      // would be paying for a round trip *and* giving the rule a second home.
      await domains.list(WORKSPACE, {});

      expect(repository.list).toHaveBeenCalledTimes(1);
      expect(repository.count).toHaveBeenCalledTimes(1);
      expect(database.sql()).toEqual([]);
    });
  });
});
