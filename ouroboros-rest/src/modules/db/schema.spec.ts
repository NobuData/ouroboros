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
  LIBRARY_OWNED_TABLES,
  type Database,
  type NewGithubOrg,
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
        .selectFrom("organization")
        // @ts-expect-error — `slugg` is not a column of ouroboros.organization. This is the
        // acceptance criterion: remove the typo and this line stops being an error, which
        // is what fails the compile.
        .select("slugg");

      // The builder still produced *something* — the point is that the compiler refused
      // it, not that it threw.
      expect(query.compile().sql).toContain("slugg");
    });

    it("does not compile a filter on a column that does not exist", () => {
      const query = db
        .selectFrom("github_orgs")
        .select("login")
        // @ts-expect-error — `org_login` is not a column of ouroboros.github_orgs.
        .where("org_login", "=", "acme-robotics");

      expect(query.compile().sql).toContain("org_login");
    });

    it("does not compile a query against a table that does not exist", () => {
      // @ts-expect-error — there is no `sessions` table in this mirror. BetterAuth owns the
      // one V004 created and nothing here reads it (`src/modules/auth/principal.ts` takes
      // the session off the request instead).
      const query = db.selectFrom("sessions").selectAll();

      expect(query.compile().sql).toContain("sessions");
    });

    it("does not compile a query against a table V006 dropped", () => {
      // The whole of #714's schema half, as one assertion. `tenants`, `tenant_members`,
      // `users` and `user_identities` no longer exist in PostgreSQL, so a mirror that still
      // declared them would let a query compile that the database would refuse at run time —
      // which is the failure this file exists to make impossible.
      //
      // @ts-expect-error — `tenant_members` was dropped by V006.
      const query = db.selectFrom("tenant_members").selectAll();

      expect(query.compile().sql).toContain("tenant_members");
    });

    it("does not accept an insert missing a column the migration requires", () => {
      // Asserted against the row type rather than against a builder call: `values()` takes
      // a union that includes a callback, and TypeScript reports a mismatched *object* as
      // "no overload matches" on the call rather than on the property — which is still an
      // error, but not one anchored to the line this comment is on.
      //
      // @ts-expect-error — `organization_id` is `not null` with no default, so it cannot be
      // omitted. `id`, `enabled` and the timestamps can be: they have defaults.
      const incomplete: NewGithubOrg = { login: "acme-robotics" };

      expect(incomplete.login).toBe("acme-robotics");
    });

    it("does not accept a value of the wrong type", () => {
      const wrongType: NewTenantDomain = {
        organization_id: "00000000-0000-0000-0000-000000000000",
        domain: "example.com",
        // @ts-expect-error — `is_primary` is a boolean column, not a string.
        is_primary: "yes",
      };

      expect(wrongType.domain).toBe("example.com");
    });

    it("does not compile a write to a column the trigger owns", () => {
      const query = db
        .updateTable("github_orgs")
        // @ts-expect-error — `ouroboros.touch_updated_at()` sets `updated_at` from the
        // server clock and discards whatever the statement supplied, so the type does not
        // offer it. See `Stamped` in schema.ts.
        .set({ updated_at: new Date() })
        .where("login", "=", "acme-robotics");

      expect(query.compile().sql).toContain("update");
    });
  });

  describe("accepts what the schema does have", () => {
    it("selects a column that exists", () => {
      const { sql } = db.selectFrom("organization").select(["id", "slug", "metadata"]).compile();

      expect(sql).toBe('select "id", "slug", "metadata" from "organization"');
    });

    it("inserts without the columns the database fills in", () => {
      // Every omitted column here — id, enabled, created_at, updated_at — has a default in
      // V003. That they *may* be omitted is as much a part of mirroring the migration as
      // the columns themselves.
      const { sql } = db
        .insertInto("github_orgs")
        .values({
          organization_id: "00000000-0000-0000-0000-000000000000",
          login: "acme-robotics",
        })
        .compile();

      expect(sql).toBe('insert into "github_orgs" ("organization_id", "login") values ($1, $2)');
    });

    it("joins across the foreign key V006 re-pointed", () => {
      const { sql } = db
        .selectFrom("github_orgs")
        .innerJoin("organization", "organization.id", "github_orgs.organization_id")
        .select(["organization.slug", "github_orgs.login"])
        .where("github_orgs.enabled", "=", true)
        .compile();

      expect(sql).toContain(
        'inner join "organization" on "organization"."id" = "github_orgs"."organization_id"',
      );
    });

    it("parameterises every value, which is what makes injection impossible", () => {
      const { sql, parameters } = db
        .selectFrom("organization")
        .selectAll()
        .where("slug", "=", "acme'; drop table ouroboros.organization; --")
        .compile();

      expect(sql).toBe('select * from "organization" where "slug" = $1');
      expect(parameters).toEqual(["acme'; drop table ouroboros.organization; --"]);
    });
  });
});

/**
 * The tables in {@link Database} that BetterAuth owns rather than this repository.
 *
 * V004's and V005's DDL is the library's own, down to the quoting, and two of the rules below
 * are about *our* conventions — which the library is not bound by and must not be edited into.
 */
const LIBRARY_TABLES: readonly (keyof Database)[] = [...LIBRARY_OWNED_TABLES];

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
    // Four of ours — `tenant_domains`, `github_orgs`, `github_repos`, and V007's
    // `user_preferences` (#649) — plus the two of the library's that tenancy is authorized
    // against: `organization` and `member`. It was nine until #714; V006 dropped `tenants`,
    // `tenant_members`, `users` and `user_identities`, and this number is what fails if one
    // of them is ever mirrored again.
    expect(TABLE_NAMES).toHaveLength(6);
  });

  it("mirrors no table V006 dropped", () => {
    // The named form of the count above, so the failure says *which* table came back rather
    // than only that one did. `ouroboros-db/tests/constraints.sql` asserts the same four stay
    // gone from the database; this is the same assertion about the mirror.
    for (const dropped of ["tenants", "tenant_members", "users", "user_identities"]) {
      expect(TABLE_NAMES).not.toContain(dropped);
    }
  });

  it("names the column V006 re-parented the extension tables onto", () => {
    // Both of *our* surviving parented tables hang off `organization` now. A mirror still
    // saying `tenant_id` is the drift that made every tenancy query uncompilable between
    // #708 and #714.
    expect(TABLE_COLUMNS.tenant_domains).toContain("organization_id");
    expect(TABLE_COLUMNS.github_orgs).toContain("organization_id");
    expect(TABLE_COLUMNS.tenant_domains).not.toContain("tenant_id");
    expect(TABLE_COLUMNS.github_orgs).not.toContain("tenant_id");
  });

  it.each(TABLE_NAMES)("gives %s no duplicate columns", (table) => {
    const columns: readonly string[] = TABLE_COLUMNS[table];

    expect(new Set(columns).size).toBe(columns.length);
  });

  it("uses the database's own names rather than JavaScript's", () => {
    // A camel-cased name on one of *our* tables would mean a `CamelCasePlugin` had been
    // added, and the drift check compares these strings against `information_schema`
    // literally.
    //
    // The library's two tables are exempt and are the reason this test names them: V004 and
    // V005 are BetterAuth's own DDL, their columns really are `"organizationId"` and
    // `"createdAt"` in the database, and translating them here would be the very thing this
    // check exists to catch — a name that differs between the migration and the type.
    const ours = TABLE_NAMES.filter((table) => !LIBRARY_TABLES.includes(table));
    const everyColumn = ours.flatMap((table) => [...TABLE_COLUMNS[table]]);

    expect(everyColumn.filter((column) => /[A-Z]/.test(column))).toEqual([]);
  });

  it("keeps the library's tables spelled the way the library spells them", () => {
    // The other direction of the same rule: these columns are quoted camelCase in V005, so a
    // snake_cased one here would be a mirror that had started translating.
    expect(TABLE_COLUMNS.member).toContain("organizationId");
    expect(TABLE_COLUMNS.organization).toContain("createdAt");
  });
});

describe("SCHEMA_NAME", () => {
  it("is the schema the migrations qualify their DDL with", () => {
    expect(SCHEMA_NAME).toBe("ouroboros");
  });
});
