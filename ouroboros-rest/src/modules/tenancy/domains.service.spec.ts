import type { Tenant, TenantDomain } from "../db/schema";
import { recordingDatabase, type RecordingDatabase } from "./database.fixture";
import type { DomainsRepository } from "./domains.repository";
import { DomainsService } from "./domains.service";
import { TENANCY_ERRORS } from "./tenancy.errors";
import type { TenantsService } from "./tenants.service";

/**
 * The domain rules, and the transaction one of them needs.
 *
 * The interesting assertions here are about *order*: that the tenant is checked before
 * anything is written, that the current primary is demoted before another is promoted, and
 * that both happen inside one transaction. A partial unique index refuses the intermediate
 * state, so getting the order wrong is not a subtle bug — but getting the transaction wrong
 * is, because it only shows up when two requests arrive together.
 */

const TENANT: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

const ROW: TenantDomain = {
  id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
  tenant_id: TENANT.id,
  domain: "acme.example",
  is_primary: true,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

describe("the domains service", () => {
  let database: RecordingDatabase;
  let repository: jest.Mocked<DomainsRepository>;
  let tenants: jest.Mocked<TenantsService>;
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

    tenants = {
      require: jest.fn(() => {
        order.push("requireTenant");
        return Promise.resolve(TENANT);
      }),
    } as unknown as jest.Mocked<TenantsService>;

    domains = new DomainsService(repository, tenants, database.service);
  });

  describe("listing", () => {
    it("answers a page of resources", async () => {
      expect(await domains.list(TENANT.id, {})).toEqual({
        items: [expect.objectContaining({ domain: "acme.example", isPrimary: true })],
        total: 1,
        limit: 25,
        offset: 0,
      });
    });

    it("answers 404 about the tenant rather than an empty list", async () => {
      // A request for the domains of a tenant that does not exist is a question about the
      // tenant, and `[]` would be an answer to a different one.
      tenants.require.mockRejectedValue(new Error("404"));

      await expect(domains.list(TENANT.id, {})).rejects.toThrow();
      expect(repository.list).not.toHaveBeenCalled();
    });
  });

  describe("adding", () => {
    it("defaults to not primary, as the schema does", async () => {
      await domains.add(TENANT.id, { domain: "acme.example" });

      expect(repository.create).toHaveBeenCalledWith(
        TENANT.id,
        "acme.example",
        false,
        expect.anything(),
      );
      expect(repository.clearPrimary).not.toHaveBeenCalled();
    });

    it("demotes the current primary before promoting the new one", async () => {
      await domains.add(TENANT.id, { domain: "acme.example", isPrimary: true });

      expect(order).toEqual(["requireTenant", "clearPrimary", "create"]);
    });

    it("does all of it in one transaction", async () => {
      // Including the tenant check: a tenant deleted mid-request must not be able to leave a
      // domain behind.
      await domains.add(TENANT.id, { domain: "acme.example", isPrimary: true });

      expect(database.sql()).toEqual(["begin", "commit"]);
    });

    it("rolls back when the write fails", async () => {
      repository.create.mockRejectedValue(new Error("duplicate"));

      await expect(domains.add(TENANT.id, { domain: "acme.example" })).rejects.toThrow();
      expect(database.sql()).toEqual(["begin", "rollback"]);
    });
  });

  describe("setting the primary", () => {
    it("checks the domain belongs to this tenant", async () => {
      await domains.setPrimary(TENANT.id, ROW.id, { isPrimary: true });

      expect(repository.find).toHaveBeenCalledWith(TENANT.id, ROW.id, expect.anything());
    });

    it("answers 404 for a domain of another tenant", async () => {
      // The same answer as one that does not exist — anything else confirms to whoever asked
      // that the identifier is real.
      repository.find.mockResolvedValue(undefined);

      await expect(
        domains.setPrimary(TENANT.id, ROW.id, { isPrimary: true }),
      ).rejects.toMatchObject({ response: { code: TENANCY_ERRORS.domainNotFound } });
    });

    it("demotes the incumbent first", async () => {
      await domains.setPrimary(TENANT.id, ROW.id, { isPrimary: true });

      expect(order).toEqual(["requireTenant", "clearPrimary", "setPrimary"]);
    });

    it("demotes without promoting anything when asked to clear", async () => {
      // A tenant with no primary at all is legal, and refusing would make "replace the domain
      // we display" an operation with no order that works.
      await domains.setPrimary(TENANT.id, ROW.id, { isPrimary: false });

      expect(repository.clearPrimary).not.toHaveBeenCalled();
      expect(repository.setPrimary).toHaveBeenCalledWith(ROW.id, false, expect.anything());
    });

    it("answers 404 when the row disappeared between the check and the update", async () => {
      repository.setPrimary.mockResolvedValue(undefined);

      await expect(
        domains.setPrimary(TENANT.id, ROW.id, { isPrimary: true }),
      ).rejects.toMatchObject({ response: { code: TENANCY_ERRORS.domainNotFound } });
    });
  });

  describe("removing", () => {
    it("checks the tenant, then removes within it", async () => {
      await domains.remove(TENANT.id, ROW.id);

      expect(tenants.require).toHaveBeenCalledWith(TENANT.id);
      expect(repository.remove).toHaveBeenCalledWith(TENANT.id, ROW.id);
    });

    it("answers 404 when nothing was removed", async () => {
      repository.remove.mockResolvedValue(false);

      await expect(domains.remove(TENANT.id, ROW.id)).rejects.toMatchObject({
        response: { code: TENANCY_ERRORS.domainNotFound },
      });
    });

    it("answers nothing at all when it worked", async () => {
      await expect(domains.remove(TENANT.id, ROW.id)).resolves.toBeUndefined();
    });
  });
});
