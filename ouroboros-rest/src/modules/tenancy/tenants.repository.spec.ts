import type { Tenant } from "../db/schema";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { TenantsRepository } from "./tenants.repository";

/**
 * The statements this repository issues, checked as statements.
 *
 * See `database.fixture.ts` for why these specs read SQL rather than mock a method: a
 * repository holds no rules, so the only thing it can get wrong is the query — and a mock
 * that recorded the call would agree with a query that forgot half its `where` clause.
 */

/** A row, for the answers a spec queues. */
const ROW = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
} satisfies Tenant;

/** A person, for the scoped listing. */
const USER = "5eed0003-0000-4000-8000-000000000001";

describe("the tenants repository", () => {
  let database: RecordingDatabase;
  let tenants: TenantsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    tenants = new TenantsRepository(database.service);
  });

  describe("listing", () => {
    it("orders totally, so a row cannot appear on two pages", async () => {
      // `created_at` is not unique. Without the primary key as a tiebreaker two rows sharing
      // one are free to swap places between queries, and a paginated read can show the same
      // tenant twice and never show another.
      await tenants.list({ limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('order by "created_at", "id"');
    });

    it("applies the window as parameters", async () => {
      await tenants.list({ limit: 10, offset: 20 });

      expect(database.statements[0].sql).toContain("limit $1 offset $2");
      expect(database.statements[0].parameters).toEqual([10, 20]);
    });

    it("reads from the schema Flyway owns", async () => {
      // `WithSchemaPlugin` qualifies every generated statement, so the service does not
      // depend on a `search_path` it did not set.
      await tenants.list({ limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('from "ouroboros"."tenants"');
    });

    it("returns the rows the database gave it", async () => {
      database.answers({ rows: [ROW] });

      expect(await tenants.list({ limit: 25, offset: 0 })).toEqual([ROW]);
    });
  });

  describe("counting", () => {
    it("counts every row, ignoring the window", async () => {
      database.answers({ rows: [{ total: "42" }] });

      const total = await tenants.count();

      expect(database.statements[0].sql).not.toContain("limit");
      expect(total).toBe(42);
    });

    it("reads the bigint the driver returns as a string", async () => {
      // `pg` hands `count(*)` back as a string rather than risk a silent loss of precision.
      // A total that stayed a string would be `"12"`, and the specification says `integer`.
      database.answers({ rows: [{ total: "12" }] });

      expect(await tenants.count()).toBe(12);
    });
  });

  describe("listing a person's tenants", () => {
    it("joins the membership, which is what scopes it", async () => {
      // The listing every caller actually gets. Unscoped, it would hand anybody with a
      // session the name and handle of every customer on the installation.
      await tenants.listForUser(USER, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('inner join "ouroboros"."tenant_members"');
      expect(database.statements[0].sql).toContain(
        'where "ouroboros"."tenant_members"."user_id" = $1',
      );
      expect(database.statements[0].parameters).toEqual([USER, 25, 0]);
    });

    it("selects the tenant's own columns, not the membership's", async () => {
      await tenants.listForUser(USER, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain('select "ouroboros"."tenants".*');
    });

    it("orders totally, so a row cannot appear on two pages", async () => {
      await tenants.listForUser(USER, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain(
        'order by "ouroboros"."tenants"."created_at", "ouroboros"."tenants"."id"',
      );
    });

    it("counts the same set", async () => {
      database.answers({ rows: [{ total: "3" }] });

      expect(await tenants.countForUser(USER)).toBe(3);
      expect(database.statements[0].sql).toContain('inner join "ouroboros"."tenant_members"');
      expect(database.statements[0].parameters).toEqual([USER]);
    });
  });

  describe("finding one by slug", () => {
    it("matches the stored column exactly", async () => {
      // V001 admits only lower-case slugs, so a differently-cased value is a miss rather
      // than a match — and a miss is a 404, which is the right answer either way.
      await tenants.findBySlug("acme");

      expect(database.statements[0].sql).toContain('where "slug" = $1');
      expect(database.statements[0].parameters).toEqual(["acme"]);
    });

    it("returns the row when there is one", async () => {
      database.answers({ rows: [ROW] });

      expect(await tenants.findBySlug("acme")).toEqual(ROW);
    });
  });

  describe("finding one", () => {
    it("looks up by id and parameterises it", async () => {
      await tenants.find(ROW.id);

      expect(database.statements[0].sql).toContain('where "id" = $1');
      expect(database.statements[0].parameters).toEqual([ROW.id]);
    });

    it("answers undefined rather than throwing when there is none", async () => {
      // Whether an absent tenant is a 404 or an empty list is the caller's question, not a
      // query's.
      expect(await tenants.find(ROW.id)).toBeUndefined();
    });
  });

  describe("creating", () => {
    it("supplies only what the caller chose", async () => {
      database.answers({ rows: [ROW] });

      await tenants.create("acme", "Acme, Inc.");

      // The id, the status and both timestamps are the database's — a statement that named
      // them would be one that could disagree with the defaults V001 declares.
      expect(database.statements[0].sql).toContain('("slug", "display_name")');
      expect(database.statements[0].parameters).toEqual(["acme", "Acme, Inc."]);
    });

    it("returns the row as it was stored, defaults and all", async () => {
      database.answers({ rows: [ROW] });

      expect(await tenants.create("acme", "Acme, Inc.")).toEqual(ROW);
      expect(database.statements[0].sql).toContain("returning *");
    });
  });

  describe("updating", () => {
    it("sets only the columns it was given", async () => {
      database.answers({ rows: [ROW] });

      await tenants.update(ROW.id, { display_name: "Acme Corporation" });

      expect(database.statements[0].sql).toContain('set "display_name" = $1');
      expect(database.statements[0].sql).not.toContain("slug");
    });

    it("answers undefined when no tenant has that id", async () => {
      // How the service tells "changed nothing" from "there was nothing to change" in one
      // statement rather than a select and then an update.
      expect(await tenants.update(ROW.id, { status: "suspended" })).toBeUndefined();
    });
  });

  describe("a transaction the caller opened", () => {
    it("issues the statement on it rather than taking its own connection", async () => {
      // The one mistake `DatabaseService.transaction` cannot prevent: a statement issued on
      // the pool instead is not part of the transaction and is not rolled back with it.
      await database.service.transaction(async (trx) => {
        await tenants.find(ROW.id, trx);
      });

      expect(database.sql()).toEqual([
        "begin",
        expect.stringContaining('from "ouroboros"."tenants"') as unknown as string,
        "commit",
      ]);
    });
  });
});
