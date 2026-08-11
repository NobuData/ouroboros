import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";

import {
  SCHEMA_NAME,
  TABLE_COLUMNS,
  TABLE_NAMES,
  type Database,
  type NewTenant,
  type NewTenantDomain,
} from "./schema";

/**
 * The type-level half of this module's contract — and the one acceptance criterion that
 * cannot be checked by running anything.
 *
 * > *Typecheck fails on a query against a nonexistent column.*
 *
 * A test cannot observe a compile error at run time, so the assertions below are written as
 * `@ts-expect-error`: the comment fails the compile when the line beneath it *stops* being
 * an error. `yarn typecheck` and `yarn test` both read `tsconfig.json`, so a change that
 * loosened `Database` — a stray index signature, a table typed as `any` — breaks the build
 * in two places rather than passing quietly with a green suite.
 *
 * Queries are `compile()`d rather than executed. Kysely's builders are lazy and the
 * compiler needs no connection, so this file proves what SQL the types produce without a
 * database, a mock, or a millisecond of waiting. Whether PostgreSQL accepts that SQL is
 * `db.integration-spec.ts`'s question.
 */

/**
 * A Kysely instance that can compile a query and cannot run one.
 *
 * `DummyDriver` is Kysely's own no-op driver, paired with the real PostgreSQL adapter and
 * query compiler — so the SQL asserted below is the SQL the service would send, while
 * `execute()` on this instance connects to nothing.
 */
const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (instance) => new PostgresIntrospector(instance),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

describe("Database", () => {
  describe("rejects what the schema does not have", () => {
    it("does not compile a select of a column that does not exist", () => {
      const query = db
        .selectFrom("tenants")
        // @ts-expect-error — `slugg` is not a column of ouroboros.tenants. This is the
        // acceptance criterion: remove the typo and this line stops being an error, which
        // is what fails the compile.
        .select("slugg");

      // The builder still produced *something* — the point is that the compiler refused
      // it, not that it threw.
      expect(query.compile().sql).toContain("slugg");
    });

    it("does not compile a filter on a column that does not exist", () => {
      const query = db
        .selectFrom("users")
        .select("email")
        // @ts-expect-error — `email_address` is not a column of ouroboros.users.
        .where("email_address", "=", "someone@example.com");

      expect(query.compile().sql).toContain("email_address");
    });

    it("does not compile a query against a table that does not exist", () => {
      // @ts-expect-error — there is no `sessions` table; #33 has not added one.
      const query = db.selectFrom("sessions").selectAll();

      expect(query.compile().sql).toContain("sessions");
    });

    it("does not accept an insert missing a column the migration requires", () => {
      // Asserted against the row type rather than against a builder call: `values()` takes
      // a union that includes a callback, and TypeScript reports a mismatched *object* as
      // "no overload matches" on the call rather than on the property — which is still an
      // error, but not one anchored to the line this comment is on.
      //
      // @ts-expect-error — `display_name` is `not null` with no default, so it cannot be
      // omitted. `id`, `status` and the timestamps can be: they have defaults.
      const incomplete: NewTenant = { slug: "acme" };

      expect(incomplete.slug).toBe("acme");
    });

    it("does not accept a value of the wrong type", () => {
      const wrongType: NewTenantDomain = {
        tenant_id: "00000000-0000-0000-0000-000000000000",
        domain: "example.com",
        // @ts-expect-error — `is_primary` is a boolean column, not a string.
        is_primary: "yes",
      };

      expect(wrongType.domain).toBe("example.com");
    });

    it("does not compile a status the check constraint would reject", () => {
      const query = db
        .updateTable("tenants")
        // @ts-expect-error — `tenants_status_valid` admits active, suspended and deleted.
        .set({ status: "archived" })
        .where("slug", "=", "acme");

      expect(query.compile().sql).toContain("update");
    });

    it("does not compile a role the check constraint would reject", () => {
      const query = db.insertInto("tenant_members").values({
        tenant_id: "00000000-0000-0000-0000-000000000000",
        user_id: "00000000-0000-0000-0000-000000000001",
        // @ts-expect-error — `tenant_members_role_valid` admits owner, admin, member, viewer.
        role: "superuser",
      });

      expect(query.compile().sql).toContain("insert into");
    });

    it("does not compile a write to a column the trigger owns", () => {
      const query = db
        .updateTable("tenants")
        // @ts-expect-error — `ouroboros.touch_updated_at()` sets `updated_at` from the
        // server clock and discards whatever the statement supplied, so the type does not
        // offer it. See `Stamped` in schema.ts.
        .set({ updated_at: new Date() })
        .where("slug", "=", "acme");

      expect(query.compile().sql).toContain("update");
    });
  });

  describe("accepts what the schema does have", () => {
    it("selects a column that exists", () => {
      const { sql } = db.selectFrom("tenants").select(["id", "slug", "status"]).compile();

      expect(sql).toBe('select "id", "slug", "status" from "tenants"');
    });

    it("inserts without the columns the database fills in", () => {
      // Every omitted column here — id, status, created_at, updated_at — has a default in
      // V001. That they *may* be omitted is as much a part of mirroring the migration as
      // the columns themselves.
      const { sql } = db
        .insertInto("tenants")
        .values({ slug: "acme", display_name: "Acme" })
        .compile();

      expect(sql).toBe('insert into "tenants" ("slug", "display_name") values ($1, $2)');
    });

    it("joins across a foreign key", () => {
      const { sql } = db
        .selectFrom("tenant_members")
        .innerJoin("users", "users.id", "tenant_members.user_id")
        .select(["users.email", "tenant_members.role"])
        .where("tenant_members.tenant_id", "=", "00000000-0000-0000-0000-000000000000")
        .compile();

      expect(sql).toContain('inner join "users" on "users"."id" = "tenant_members"."user_id"');
    });

    it("parameterises every value, which is what makes injection impossible", () => {
      const { sql, parameters } = db
        .selectFrom("tenants")
        .selectAll()
        .where("slug", "=", "acme'; drop table ouroboros.tenants; --")
        .compile();

      expect(sql).toBe('select * from "tenants" where "slug" = $1');
      expect(parameters).toEqual(["acme'; drop table ouroboros.tenants; --"]);
    });
  });
});

describe("TABLE_COLUMNS", () => {
  /**
   * A column declared on a table interface that {@link TABLE_COLUMNS} does not list.
   *
   * `satisfies` in `schema.ts` already rejects a *wrong* name; this is the other direction,
   * which it cannot check — a column added to an interface and forgotten in the list. It
   * matters because the list is what the integration suite compares against
   * `information_schema`, so a column missing from it is a column the drift check would
   * never notice had gone.
   */
  type Unlisted = {
    [T in keyof Database]: Exclude<keyof Database[T], (typeof TABLE_COLUMNS)[T][number]>;
  }[keyof Database];

  it("lists every column of every table", () => {
    // `never` is the only type this variable can be given a value of, so a compile error
    // here names the columns that are missing. There is nothing to assert at run time —
    // the check is the annotation.
    const unlisted: Unlisted[] = [];

    expect(unlisted).toHaveLength(0);
  });

  it("names every table in the Database interface", () => {
    expect(TABLE_NAMES).toEqual(Object.keys(TABLE_COLUMNS));
    expect(TABLE_NAMES).toHaveLength(7);
  });

  it.each(TABLE_NAMES)("gives %s no duplicate columns", (table) => {
    const columns: readonly string[] = TABLE_COLUMNS[table];

    expect(new Set(columns).size).toBe(columns.length);
  });

  it("uses the database's own names rather than JavaScript's", () => {
    // A camel-cased name here would mean a `CamelCasePlugin` had been added, and the drift
    // check compares these strings against `information_schema` literally.
    const everyColumn = TABLE_NAMES.flatMap((table) => [...TABLE_COLUMNS[table]]);

    expect(everyColumn.filter((column) => /[A-Z]/.test(column))).toEqual([]);
  });
});

describe("SCHEMA_NAME", () => {
  it("is the schema the migrations qualify their DDL with", () => {
    expect(SCHEMA_NAME).toBe("ouroboros");
  });
});
