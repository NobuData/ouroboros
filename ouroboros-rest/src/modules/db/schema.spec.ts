import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";

import {
  ACTIVE_RUN_STATUSES,
  QUEUE_EFFORTS,
  READ_ONLY_VIEWS,
  SCHEMA_NAME,
  TABLE_COLUMNS,
  TABLE_NAMES,
  TERMINAL_RUN_STATUSES,
  LIBRARY_OWNED_TABLES,
  type Database,
  type NewGithubOrg,
  type NewRun,
  type NewTenantDomain,
  type RunStatus,
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
    //
    // Six more arrived with the dashboard read-model (#70): V008–V011's `runs`,
    // `queue_items`, `token_usage` and `workspace_settings`, and the two views V010 and V011
    // publish over the last two of them.
    //
    // The thirteenth is V013's `tenant_keys` (#222) — the credential vault's sealed
    // per-workspace keys, and the first table here this service is the *only* writer of.
    //
    // The fourteenth is V012's `model_prices` (#580), which CH.3 (#586) reads and writes
    // overrides in.
    expect(TABLE_NAMES).toHaveLength(14);
  });

  it("mirrors the model pricing catalog V012 created", () => {
    // Named as well as counted, for the reason the vault's table is: a mirror missing this one
    // is a registry that renders "—" for every model in the catalog, and the failure would
    // otherwise read as an off-by-one in a total.
    expect(TABLE_NAMES).toContain("model_prices");
    expect(READ_ONLY_VIEWS).not.toContain("model_prices");
  });

  it("mirrors the vault's key table V013 created", () => {
    // Named as well as counted, for the same reason the read-model is: a mirror missing this
    // one is a service that cannot seal a credential at all, and the failure would otherwise
    // read as an off-by-one in a total.
    expect(TABLE_NAMES).toContain("tenant_keys");
    expect(READ_ONLY_VIEWS).not.toContain("tenant_keys");
  });

  it("mirrors the dashboard read-model V008–V011 created", () => {
    // The named form of the count above, for the half of it #70 added. A mirror missing one
    // of these is an aggregate the dashboard cannot compute; the drift check in
    // `db.integration-spec.ts` is what proves the columns are the migrations'.
    for (const table of ["runs", "queue_items", "token_usage", "workspace_settings"]) {
      expect(TABLE_NAMES).toContain(table);
    }
  });

  it("declares both views, and declares them as views", () => {
    // A view is in `Database` because it is read, and in `READ_ONLY_VIEWS` because it may not
    // be written — `Database` itself has no way to say the second thing. The pairing is what
    // stops a view being added to the mirror and quietly acquiring an `insertInto`.
    for (const view of READ_ONLY_VIEWS) {
      expect(TABLE_NAMES).toContain(view);
    }
    expect(READ_ONLY_VIEWS).toHaveLength(2);
  });

  it("mirrors, for each view, the table a write to it belongs in", () => {
    // The rule `READ_ONLY_VIEWS` states, as an assertion about the mirror rather than about a
    // caller: refusing a write is only useful if the mirror also declares somewhere for that
    // write to go.
    expect(TABLE_NAMES).toContain("token_usage");
    expect(TABLE_NAMES).toContain("workspace_settings");
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

describe("the dashboard read-model's vocabularies", () => {
  /**
   * Both halves of `runs_status`, as one list.
   *
   * The CHECK names six words and the mirror splits them in two, so what has to be asserted
   * is that the split loses none of them and invents none — the failure that would let a
   * status the database accepts fall out of every query that reads by status.
   */
  const everyStatus: readonly RunStatus[] = [...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES];

  it("splits the six statuses V008 declares into active and terminal, losing none", () => {
    expect(everyStatus).toEqual([
      "coding",
      "building",
      "review",
      "merged",
      "needs_human",
      "failed",
    ]);
    expect(new Set(everyStatus).size).toBe(everyStatus.length);
  });

  it("keeps the active statuses in lifecycle order, which the active card sorts by", () => {
    // Not alphabetical, and the difference is what the card reads like: a loop is coded,
    // then built, then reviewed, and `dashboard/repository` orders by the index into this
    // list. Sorting it would reorder the card.
    expect([...ACTIVE_RUN_STATUSES]).toEqual(["coding", "building", "review"]);
  });

  it("names the five effort chips smallest first", () => {
    expect([...QUEUE_EFFORTS]).toEqual(["xs", "s", "m", "l", "xl"]);
  });

  it("does not compile a run whose status is not one of the six", () => {
    const run: NewRun = {
      organization_id: "org",
      github_repo_id: "00000000-0000-4000-8000-000000000000",
      issue_number: 482,
      issue_title: "Fix flaky CAN-bus telemetry test",
      workflow_tag: "standard-fix",
      model: "claude-fable-5",
      // @ts-expect-error — `queued` is not a status V008's CHECK admits. The union is the
      // CHECK, mirrored; a value outside it is a `23514` at run time and this is where it
      // becomes a compile error instead.
      status: "queued",
      stage_label: "Implementing",
      stage_index: 4,
      stage_total: 6,
    };

    expect(run.issue_number).toBe(482);
  });

  it("does not compile a query against a view's base column that the view does not publish", () => {
    const query = db
      .selectFrom("token_usage_daily")
      // @ts-expect-error — `run_id` is a column of `token_usage`, not of the rollup over it.
      // The view groups by workspace, day and provider, so a run is not a thing it can name.
      .select("run_id");

    expect(query.compile().sql).toContain("run_id");
  });

  it("selects the aggregate the token stat is rendered from", () => {
    const { sql } = db
      .selectFrom("token_usage_daily")
      .select(["tokens_total", "cost_cents", "unpriced_events"])
      .where("organization_id", "=", "org")
      .compile();

    expect(sql).toBe(
      'select "tokens_total", "cost_cents", "unpriced_events" from "token_usage_daily" ' +
        'where "organization_id" = $1',
    );
  });

  it("resolves a workspace's settings through the view rather than the table", () => {
    // The read side of V011's lazy-creation decision: a workspace with no row still has an
    // answer, and it comes from the database rather than from an application default.
    const { sql } = db
      .selectFrom("workspace_settings_effective")
      .select("auto_merge_on_checks")
      .where("organization_id", "=", "org")
      .compile();

    expect(sql).toBe(
      'select "auto_merge_on_checks" from "workspace_settings_effective" ' +
        'where "organization_id" = $1',
    );
  });
});

describe("SCHEMA_NAME", () => {
  it("is the schema the migrations qualify their DDL with", () => {
    expect(SCHEMA_NAME).toBe("ouroboros");
  });
});
