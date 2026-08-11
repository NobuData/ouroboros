import type { TenantDomain } from "../db/schema";
import { DomainsRepository } from "./domains.repository";
import { recordingDatabase, type RecordingDatabase } from "./database.fixture";

/**
 * The domain statements, and the two properties they have to have.
 *
 * **Everything is scoped by tenant.** A domain id is a uuid a caller can guess or be given,
 * and a lookup that trusted it alone would let one tenant read or delete another's rows. The
 * scoping is in the SQL, not in a check above it, so it is asserted in the SQL.
 *
 * **Promoting is two statements.** `tenant_domains_one_primary_per_tenant` is a partial
 * unique index, so the row that holds the flag has to give it up before another can take it.
 */

const TENANT = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const DOMAIN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

const ROW = {
  id: DOMAIN,
  tenant_id: TENANT,
  domain: "acme.example",
  is_primary: true,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies TenantDomain;

describe("the domains repository", () => {
  let database: RecordingDatabase;
  let domains: DomainsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    domains = new DomainsRepository(database.service);
  });

  describe("listing", () => {
    it("is scoped to the tenant", async () => {
      await domains.list(TENANT, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('where "tenant_id" = $1');
      expect(database.statements[0].parameters).toContain(TENANT);
    });

    it("puts the primary first, then sorts by name", async () => {
      // The settings screen's order: the domain the product displays back is the one a
      // reader looks for, so it is at the top rather than wherever creation time put it.
      await domains.list(TENANT, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('order by "is_primary" desc, "domain"');
    });
  });

  it("counts within the tenant", async () => {
    database.answers({ rows: [{ total: "3" }] });

    expect(await domains.count(TENANT)).toBe(3);
    expect(database.statements[0].sql).toContain('where "tenant_id" = $1');
  });

  describe("finding one", () => {
    it("requires the domain to belong to the tenant", async () => {
      // A domain id that exists under a *different* tenant must answer exactly as one that
      // exists nowhere, or the API confirms to whoever asked that an identifier is real.
      await domains.find(TENANT, DOMAIN);

      expect(database.statements[0].sql).toContain('where "tenant_id" = $1 and "id" = $2');
      expect(database.statements[0].parameters).toEqual([TENANT, DOMAIN]);
    });
  });

  describe("creating", () => {
    it("stores the tenant, the domain and the flag", async () => {
      database.answers({ rows: [ROW] });

      const created = await domains.create(TENANT, "acme.example", true);

      expect(database.statements[0].parameters).toEqual([TENANT, "acme.example", true]);
      expect(created).toEqual(ROW);
    });
  });

  describe("the primary flag", () => {
    it("is cleared in one statement over whichever row holds it", async () => {
      // One statement rather than a read followed by an update of the id it found: the index
      // guarantees at most one such row, and a single statement is what makes the promotion
      // race-free inside a transaction.
      await domains.clearPrimary(TENANT);

      expect(database.statements[0].sql).toContain('set "is_primary" = $1');
      expect(database.statements[0].sql).toContain('"tenant_id" = $2 and "is_primary" = $3');
      expect(database.statements[0].parameters).toEqual([false, TENANT, true]);
    });

    it("is set on one row, by id", async () => {
      database.answers({ rows: [ROW] });

      expect(await domains.setPrimary(DOMAIN, true)).toEqual(ROW);
      expect(database.statements[0].sql).toContain('where "id" = $2');
    });

    it("answers undefined when the row is gone", async () => {
      expect(await domains.setPrimary(DOMAIN, true)).toBeUndefined();
    });
  });

  describe("removing", () => {
    it("is scoped to the tenant", async () => {
      database.answers({ numAffectedRows: 1n });

      await domains.remove(TENANT, DOMAIN);

      expect(database.statements[0].sql).toContain('where "tenant_id" = $1 and "id" = $2');
    });

    it("reports whether anything was removed", async () => {
      // `false` is what the service turns into a 404 — the domain did not exist *for this
      // tenant*, which covers both "no such domain" and "somebody else's".
      database.answers({ numAffectedRows: 1n }, { numAffectedRows: 0n });

      expect(await domains.remove(TENANT, DOMAIN)).toBe(true);
      expect(await domains.remove(TENANT, DOMAIN)).toBe(false);
    });
  });
});
