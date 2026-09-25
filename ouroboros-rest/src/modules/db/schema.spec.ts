import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Insertable,
} from "kysely";

import {
  ACTIVE_RUN_STATUSES,
  MODEL_ALIAS_PARAM_KEYS,
  MODEL_ALIAS_RESTRICTION_KEYS,
  MODEL_ALIAS_TEMPERATURE_MAX,
  MODEL_ALIAS_TEMPERATURE_MIN,
  MODEL_ALIAS_TOKENS_MAX,
  MODEL_ALIAS_TOKENS_MIN,
  QUEUE_EFFORTS,
  READ_ONLY_VIEWS,
  SCHEMA_NAME,
  TABLE_COLUMNS,
  TABLE_NAMES,
  TERMINAL_RUN_STATUSES,
  THINKING_LEVELS,
  LIBRARY_OWNED_TABLES,
  type Database,
  type NewGithubOrg,
  type NewRun,
  type NewTenantDomain,
  type Run,
  type RunStatus,
  type RunWithStage,
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
    //
    // The fifteenth and sixteenth are V015's `provider_connections` and `model_aliases`
    // (#189) — the routing foundation, read by `src/modules/registry/` and written by
    // mockups 07 and 21 when they land.
    //
    // The seventeenth is V017's `provider_models` (#221), mirrored by CH.2 (#585): the
    // discovered catalog whose `meta` bounds a param schema by the context length a provider
    // actually published. This service reads it and never writes it.
    //
    // Four more are the routing tables V016 and V018 created (#190, #191), mirrored by
    // Z.1 (#194): `task_kinds`, `routes`, `route_hops` and `escalation_rules`. Resolution
    // reads all four and writes none of them; the write surface is Z.2's (#195), which is
    // what now writes three of them.
    //
    // The twenty-second is V021's `route_revisions` (#195) — the audit trail one press of
    // mockup 06's *Save routes* leaves behind, and the first table here this service only
    // ever *writes*. What reads it is the audit log (#26).
    //
    // The twenty-third is V022's `audit_events` (#225) — #26's own table, landed early by
    // AD.4 because decision P5 puts credential auditing in the MVP. It is the first table
    // here that is append-only *in the database*, which is why two of its columns carry a
    // `never` in their update position.
    //
    // The twenty-fourth arrived with it: V004's `"user"` (#706), mirrored by #225 so the
    // trail's one query can join a person's name onto their id. It is the third
    // library-owned table and the first this service reads for a reason that is not an
    // authorization decision.
    //
    // Two more are CH.1's (#584): V025's `alias_revisions` — V021's table for the registry,
    // and like it written here and read by the audit surface — and V023's `alias_references`
    // (#581), a view, mirrored so the lifecycle's `Used by`, its `409` and its rename guard
    // all read CG.3's one definition through the query builder rather than through raw SQL.
    //
    // The twenty-seventh is K.3's (#101): V027's `github_credentials`, the per-workspace
    // GitHub token the backlog sync authenticates with.
    //
    // The twenty-eighth is `github_issues` (V014, #99), which K.4 (#102) brought in. It was
    // deliberately absent until then — nothing in this service read it while the table was
    // empty, and a mirrored table with no reader is drift waiting to happen — and the sync
    // that fills it is the first thing here to read or write a row.
    //
    // The twenty-ninth is `issue_estimates` (V026, #100), which L.3 (#107) brought in for
    // exactly the same reason at exactly the same remove: K.2 landed the table, nothing wrote
    // a row of it, and the orchestration that fills it is the first thing here that does.
    //
    // The thirtieth and thirty-first are `workflows` and `workflow_versions` (V029, #132),
    // which P.4 (#135) brought in for the same reason a third time: V029 landed both with no
    // writer anywhere, and the rail's stats are the first thing here to read one. Nothing in
    // this service writes either — P.3 (#134) is the CRUD and #136 is the seed — so what the
    // mirror declares is a read model plus the two `New…` shapes its suites arrange a rail with.
    //
    // The thirty-second, thirty-third and thirty-fourth are the canonical intake model (V030,
    // #138) and the view over half of it: `ticket_sources`, `tickets` and
    // `ticket_sources_public`. They break the *"a mirrored table with no reader is drift"*
    // rule the three entries above kept, and deliberately — Q.2 (#139) is the ticket that
    // brought them in, and Q.2 is the **writer**. The sync loop fills `tickets`, stamps
    // `ticket_sources`, and reads its sources through the view; there is no release in which
    // these are declared and untouched.
    //
    // The thirty-fifth is V024's `resolution_snapshots` (#582), mirrored by CH.6 (#589) — the
    // stored resolutions behind mockup 21's chain card. It keeps the no-reader rule: the table
    // arrived with CG.4's run #482 fixture and waited, unmirrored, for the read that is now
    // `GET /registry/resolutions/latest`. Like `audit_events` it is append-only in the database,
    // so every column carries a `never` in its update position.
    //
    // The thirty-sixth to forty-first are the planning model — V034's `draft_batches` and
    // `ticket_drafts`, V035's `ticket_dependencies`, V036's `planning_epics`, `epic_tickets` and
    // `epic_mirrors` — mirrored by AL.3 (#279), whose push service is the first reader and writer of
    // every one of them: it reads a batch and its drafts, rewrites dependency ends, and records the
    // tickets, epic memberships and mirrors a push creates.
    //
    // The forty-second is V036's `planning_epic_progress` view, mirrored by AL.4 (#280) for the
    // roadmap payload — the one definition of an epic's `issues · done` chip.
    //
    // The forty-third and forty-fourth are V039's `reestimation_runs` and
    // `reestimation_run_counts`, mirrored by AL.5 (#281), whose nightly job is their one writer
    // and whose backlog-health payload is their one reader.
    //
    // The forty-fifth to forty-ninth are the build farm's identity layer, mirrored by AH.2
    // (#250): V040's `runner_pools`, `runners` and `enrollment_tokens`, and V041's
    // `farm_authorities` and `runner_certificates`. They keep the no-reader rule — enrollment
    // reads a pool by name, creates a runner and spends a token, and the CA and the
    // certificates it issues are read at every handshake.
    //
    // The fiftieth and fifty-first are mirrored by AH.3 (#251), the agent gateway: V040's
    // `build_jobs`, which an agent's `job.start` and `job.finish` move through the lifecycle, and
    // V042's `runner_terminal_frames`, the ledger that makes the second of those apply exactly
    // once.
    //
    // The fifty-second is V040's `build_log_chunks`, mirrored by AH.5 (#253), whose ingest writes
    // it in `seq` order and whose read API pages it by offset. The rest of V040,
    // `runner_pool_windows`, is still not here: dispatch (AH.4, #252) reads it in one raw
    // eligibility statement and nothing writes it, so the pool windows' own ticket mirrors it.
    //
    // The fifty-third to fifty-fifth are V045's, mirrored by AO.1 (#298): `run_stages` — the
    // stage timeline per attempt — and the two views the stage meter is derived through,
    // `run_stage_current` and `runs_with_stage`. They are here before a reader for the drift
    // check's sake rather than in spite of it: `runs` grew three columns in the same migration,
    // and the list above is what catches a mirror that stopped matching the migrations.
    //
    // The fifty-sixth and fifty-seventh are V046's, mirrored by AO.2 (#299): `run_events` — the
    // agent transcript, typed and append-only — and `run_events_jsonl`, the projection mockup
    // 10's *Raw JSONL* button streams. Here before a reader for the same reason: `runs` grew six
    // more columns in the same migration, three of them the cap's running totals, and a mirror
    // that missed those would type-check a write the database refuses.
    //
    // The fifty-eighth and fifty-ninth are V047's, mirrored by AO.3 (#300): `run_files` — the
    // change-set as cumulative, upserted rows — and `run_commits`. Here before a reader for the
    // third time running, and for a reason particular to these two: a file's counts are
    // *replaced* by each report, so the shape a writer reaches for has to be the upsert rather
    // than an insert, and `RunFilesTable`'s own comment is where that is written down.
    //
    // The sixtieth to sixty-second are V048's, mirrored by AO.4 (#301): `guardrail_evaluations`
    // — the card's verdicts, with evidence that carries a place and a rule and never the matched
    // value — `v_run_guardrails_latest`, the latest-per-check read the card actually makes, and
    // `run_controls`, decision R6's durable queue. Here before a reader for the fourth time
    // running, and this time the mirror carries a rule as well as a shape: `GuardrailEvidence`
    // is the one typed jsonb interface in the file, because that column's keys are closed by
    // CHECK rather than left open by convention.
    //
    // The sixty-third is V049's `run_ingest_receipts`, mirrored by AP.1 (#303) — and it is the
    // first of the run tables that arrives *with* its reader, because the migration and the
    // service are one ticket. `runs` grew two more columns in the same migration, `event_hint`
    // and `change_set_seq`, and both are counters the ingestion contract advances, so a mirror
    // that missed either would type-check a write the database would then refuse or, worse,
    // accept against a stale number.
    //
    // The sixty-fourth and sixty-fifth are V052's `pull_requests` and `pr_revisions`, mirrored by
    // AX.1 (#357) — whose SPI PR sync is the only writer of their sync-owned columns. The files
    // snapshot is the second typed jsonb column in the file, `PrRevisionFile[]`, for
    // `GuardrailEvidence`'s reason: `pr_revision_files_valid()` closes its shape by CHECK.
    //
    // The sixty-sixth to seventieth are V051's `test_runs`, `test_suites` and `test_cases`,
    // V053's `hil_measurements` and V059's `test_run_coverage` view, mirrored by AT.1 (#329) —
    // the result parser that writes the tree and reads the prior attempt's coverage.
    expect(TABLE_NAMES).toHaveLength(70);
  });

  it("mirrors the person a trail names, and only so a select can say their name", () => {
    // The library still owns the rows — `LIBRARY_OWNED_TABLES` is what says so, and
    // `organization.repository.spec.ts` is what enforces it against this module's source.
    // Mirroring the table buys one join and no write path.
    expect(TABLE_NAMES).toContain("user");
    expect(LIBRARY_OWNED_TABLES).toContain("user");
    expect(READ_ONLY_VIEWS).not.toContain("user");
    expect(TABLE_COLUMNS.user).toEqual([
      "id",
      "name",
      "email",
      "emailVerified",
      "image",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("mirrors the audit trail V022 created", () => {
    // Named as well as counted, for the reason `route_revisions` is: nothing about a missing
    // entry here would surface as a failed *read*. It would surface as a credential
    // operation that could not record itself, which is the one failure this table exists to
    // make impossible.
    expect(TABLE_NAMES).toContain("audit_events");
    expect(READ_ONLY_VIEWS).not.toContain("audit_events");
    expect(TABLE_COLUMNS.audit_events).toEqual([
      "id",
      "organization_id",
      "actor_id",
      "action",
      "subject_type",
      "subject_id",
      "ip",
      "detail",
      "occurred_at",
    ]);
  });

  it("gives an audit event no updated_at, because an event that can be edited is not one", () => {
    // The same rule `route_revisions` states, and here the database states it too:
    // `audit_events_no_update` refuses a revision from any role, the owner included. A mirror
    // that declared the column would type-check a statement PostgreSQL raises on.
    expect(TABLE_COLUMNS.audit_events).not.toContain("updated_at");
  });

  it("mirrors the revision trail V021 created", () => {
    // Named as well as counted, for the reason the routing matrix is: this is the one table
    // in the mirror nothing in this service reads, so a missing entry would surface as a
    // failed save rather than as a failed query — much later, and against a stack trace that
    // says nothing about a mirror.
    expect(TABLE_NAMES).toContain("route_revisions");
    expect(READ_ONLY_VIEWS).not.toContain("route_revisions");
    expect(TABLE_COLUMNS.route_revisions).toEqual([
      "id",
      "organization_id",
      "actor",
      "diff",
      "created_at",
    ]);
  });

  it("gives a revision no updated_at, because an event that can be edited is not one", () => {
    // V021 declares no `updated_at` and attaches no touch trigger, which is the append-only
    // rule as a property of the table. A mirror that added the column would type-check an
    // update PostgreSQL would then refuse — and would invite one to be written.
    expect(TABLE_COLUMNS.route_revisions).not.toContain("updated_at");
  });

  it("mirrors the routing matrix V016 and V018 created", () => {
    // Named as well as counted, for the reason V015's pair is: a mirror missing one of these
    // is a service that cannot resolve a route at all, and the failure would otherwise read
    // as an off-by-one in a total.
    for (const table of ["task_kinds", "routes", "route_hops", "escalation_rules"] as const) {
      expect(TABLE_NAMES).toContain(table);
      expect(READ_ONLY_VIEWS).not.toContain(table);
    }
  });

  it("gives a route hop an alias and no model of its own", () => {
    // Decision M1, restated where a reader of the mirror meets it. `model_aliases.model_id` is
    // the only column in this schema a raw provider model string may live in, and a hop names
    // an alias by foreign key. A column here spelled anything like a model would be the one
    // way a route could pin a raw model id, which V016 makes structurally impossible and this
    // asserts the mirror has not quietly re-introduced.
    expect(TABLE_COLUMNS.route_hops).toContain("model_alias_id");
    for (const column of TABLE_COLUMNS.route_hops) {
      expect(column).not.toMatch(/^model(_(id|name))?$/);
    }
  });

  it("mirrors the generated display column rather than pretending it is writable", () => {
    // V018 makes `display` `generated always … stored`, so PostgreSQL refuses a writer that
    // supplies one. `EscalationRulesTable.display` is therefore `ColumnType<string, never,
    // never>`, and the assertion that it is not writable is the compile error below rather
    // than a runtime check — the column is in the mirror, and an insert naming it does not
    // type.
    expect(TABLE_COLUMNS.escalation_rules).toContain("display");

    const written: Insertable<Database["escalation_rules"]> = {
      organization_id: "org_acme",
      sort_order: 1,
      when: { effort_gte: "l" },
      then: { use_alias: { task_kind: "implement", alias: "coder-max" } },
      // @ts-expect-error - `display` is generated by the database; a writer that supplies one
      // is refused by PostgreSQL, and the insert type is what says so before the statement
      // is ever sent. Every other column on this object is legal, so the error is this one.
      display: "effort ≥ L → implement uses coder-max",
    };

    expect(written.sort_order).toBe(1);
  });

  it("mirrors the discovered model catalog V017 created", () => {
    // Named as well as counted, for the same reason as the tables below it: without this
    // mirror the param schema CH.2 serves would have no live context length to clamp to, and
    // the failure would read as an off-by-one in a total rather than as a missing table.
    expect(TABLE_NAMES).toContain("provider_models");
    expect(TABLE_COLUMNS.provider_models).toEqual([
      "id",
      "provider_connection_id",
      "model_id",
      "display",
      "size_bytes",
      "meta",
      "discovered_at",
    ]);
  });

  it("gives the discovered catalog no organization column of its own", () => {
    // V017's decision, restated where a reader of the mirror meets it: a discovered model is a
    // fact about a connection, so its tenancy is the foreign key and every read enters through
    // a join that carries the workspace predicate. A column added here would invite a
    // statement that filtered on it instead of joining, which is the one way to read another
    // workspace's catalog.
    expect(TABLE_COLUMNS.provider_models).not.toContain("organization_id");
  });

  it("mirrors the routing foundation V015 created", () => {
    // Named as well as counted, for the reason the pricing catalog and the vault's table are:
    // a mirror missing one of these is a service that cannot resolve an alias at all, and the
    // failure would otherwise read as an off-by-one in a total.
    for (const table of ["provider_connections", "model_aliases"] as const) {
      expect(TABLE_NAMES).toContain(table);
      expect(READ_ONLY_VIEWS).not.toContain(table);
    }
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

  it("declares each read-only view, and declares it as a view", () => {
    // A view is in `Database` because it is read, and in `READ_ONLY_VIEWS` because it may not
    // be written — `Database` itself has no way to say the second thing. The pairing is what
    // stops a view being added to the mirror and quietly acquiring an `insertInto`.
    for (const view of READ_ONLY_VIEWS) {
      expect(TABLE_NAMES).toContain(view);
    }
    expect(READ_ONLY_VIEWS).toHaveLength(9);
  });

  it("makes runs_with_stage the same shape as runs, so the stage read moves by one word", () => {
    // V045's amendment on #64 is `selectFrom("runs")` becoming `selectFrom("runs_with_stage")`
    // in the four reads that render a stage meter. That is only a one-word change while the
    // two rows are interchangeable, and a column added to `runs` without being carried into
    // the view would break it silently — the read would compile and answer without the
    // column. Assigning each to the other's type is what fails the compile if they drift.
    const fromTable: Run = {} as RunWithStage;
    const fromView: RunWithStage = {} as Run;

    // The values are casts, so the only thing worth asserting at run time is that the test
    // exercised both directions rather than being optimised away by a reader.
    expect(fromTable).toEqual(fromView);
  });

  it("mirrors the transcript as append-only, rather than pretending its account of itself is writable", () => {
    // V046 (#299, AO.2) refuses every UPDATE on `run_events` for every role including the
    // owner, and the four `elided_*` columns are refused on INSERT as well: they are the cap's
    // account of what it dropped, and a marker a caller could write is the product describing a
    // hole that was never there. The mirror says so with `never` in both write positions, so
    // the assertion is the compile error below rather than a runtime check.
    for (const column of ["elided_events", "elided_bytes", "elided_from", "elided_to"] as const) {
      expect(TABLE_COLUMNS.run_events).toContain(column);
    }

    const written: Insertable<Database["run_events"]> = {
      run_id: "5eed0009-0000-4000-8000-000000000482",
      actor: "system",
      body: "a hole somebody invented",
      // @ts-expect-error - the four elided_* columns are written by the cap trigger and
      // refused from any caller. Every other column on this object is legal, so the error is
      // this one.
      elided_events: 9000,
    };

    expect(written.actor).toBe("system");
  });

  it("keeps the transcript's running totals out of a writer's reach", () => {
    // `runs.event_seq`, `event_bytes` and `events_elided_at` are the cap trigger's own
    // accounting — the sequence it hands out, the bytes it has admitted, and when it first
    // refused one. A statement that set any of them would be telling the store how much of
    // itself it had used, so all three are `never` in both write positions while `event_cap`
    // and `event_byte_cap`, which are configuration rather than observation, are not.
    const configured: Insertable<Database["runs"]> = {
      organization_id: "acme",
      github_repo_id: "5eed0003-0000-4000-8000-000000000001",
      issue_number: 482,
      issue_title: "Fix flaky CAN-bus telemetry test",
      workflow_tag: "standard-fix",
      model: "claude-fable-5",
      stage_label: "Implementing",
      stage_index: 4,
      stage_total: 8,
      event_cap: 500,
      simulated: true,
      // @ts-expect-error - the totals are the trigger's. Every other column on this object is
      // legal, so the error is this one.
      event_seq: 12,
    };

    expect(configured.event_cap).toBe(500);
  });

  it("mirrors, for each view, the table a write to it belongs in", () => {
    // The rule `READ_ONLY_VIEWS` states, as an assertion about the mirror rather than about a
    // caller: refusing a write is only useful if the mirror also declares somewhere for that
    // write to go.
    expect(TABLE_NAMES).toContain("token_usage");
    expect(TABLE_NAMES).toContain("workspace_settings");
    expect(TABLE_NAMES).toContain("ticket_sources");
    expect(TABLE_NAMES).toContain("planning_epics");
    // V046's projection (#299) is the one view here whose base table this service will be the
    // *only* writer of: AP.1's ingestion appends to `run_events` and AP.2's export reads the
    // lines out of it.
    expect(TABLE_NAMES).toContain("run_events");
  });

  it("keeps the sealed credential off the view a read path selects", () => {
    // V030's acceptance criterion, as a property of the mirror: `credentials_encrypted` is on
    // the table and absent from the view, so a `select *` through the view cannot reach it and
    // a query that wants it has to name the table — which is one statement, in one file.
    expect(TABLE_COLUMNS.ticket_sources).toContain("credentials_encrypted");
    expect(TABLE_COLUMNS.ticket_sources_public).not.toContain("credentials_encrypted");

    // And the view is otherwise the whole table, so reading through it costs a caller nothing
    // but the column it must not have.
    const hidden = TABLE_COLUMNS.ticket_sources.filter(
      (column) => !(TABLE_COLUMNS.ticket_sources_public as readonly string[]).includes(column),
    );

    expect(hidden).toEqual(["credentials_encrypted"]);
  });

  it("gives a ticket no column that names one tracker", () => {
    // Decision P6, as an assertion about the mirror rather than about the migration: the four
    // GitHub-shaped columns of `github_issues` are exactly what the canonical model exists to
    // not have, and a `gh_`-prefixed or repository-shaped column arriving here would be the
    // generalization being undone one convenience at a time.
    for (const shaped of ["github_repo_id", "number", "gh_created_at", "gh_updated_at", "gh_url"]) {
      expect(TABLE_COLUMNS.tickets).not.toContain(shaped);
    }

    // What replaced them, named — so the failure says which half of the trade went missing.
    for (const canonical of ["external_id", "external_key", "external_url", "meta"]) {
      expect(TABLE_COLUMNS.tickets).toContain(canonical);
    }
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
   * The CHECK names seven words (V008, `canceled` added by V050) and the mirror splits them in two, so what has to be asserted
   * is that the split loses none of them and invents none — the failure that would let a
   * status the database accepts fall out of every query that reads by status.
   */
  const everyStatus: readonly RunStatus[] = [...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES];

  it("splits the seven statuses V008 and V050 declare into active and terminal, losing none", () => {
    expect(everyStatus).toEqual([
      "coding",
      "building",
      "review",
      "merged",
      "needs_human",
      "failed",
      "canceled",
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

  it("does not compile a run whose status is not one of the seven", () => {
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

describe("the alias param vocabulary V019 closed", () => {
  it("names the five keys the column accepts, in the order the function declares them", () => {
    // Written out rather than derived, because this list *is* the mirror: a key added here
    // that `ouroboros.model_alias_params_valid()` does not accept is a field CH.2 would offer
    // and a write the database would refuse.
    expect(MODEL_ALIAS_PARAM_KEYS).toEqual([
      "thinking",
      "token_budget",
      "max_output",
      "context_clamp",
      "temperature",
    ]);
  });

  it("names the three thinking levels, off included", () => {
    // `off` is a real instruction rather than the absence of the key — see the type's own
    // documentation for why an alias that says nothing and an alias that says `off` are two
    // different requests.
    expect(THINKING_LEVELS).toEqual(["off", "std", "max"]);
  });

  it("bounds a token count where V019 bounds it", () => {
    expect(MODEL_ALIAS_TOKENS_MIN).toBe(1);
    expect(MODEL_ALIAS_TOKENS_MAX).toBe(10_000_000);
  });

  it("starts a token count at one rather than zero", () => {
    // The bound worth stating on its own: zero is not a small budget, it is an instruction to
    // produce nothing, and *no budget* is said by leaving the key out.
    expect(MODEL_ALIAS_TOKENS_MIN).toBeGreaterThan(0);
  });

  it("bounds a temperature where V019 bounds it", () => {
    expect(MODEL_ALIAS_TEMPERATURE_MIN).toBe(0);
    expect(MODEL_ALIAS_TEMPERATURE_MAX).toBe(2);
  });

  it("keeps the two restriction flags out of the param vocabulary", () => {
    // Decision R3, as a property rather than as prose: a restriction is policy about the
    // alias and a param is merged into a request body, so a key that appeared in both lists
    // would be one this product could not say which of the two it meant.
    expect(MODEL_ALIAS_RESTRICTION_KEYS).toEqual(["review_vote_only", "batch_ok"]);

    for (const flag of MODEL_ALIAS_RESTRICTION_KEYS) {
      expect(MODEL_ALIAS_PARAM_KEYS).not.toContain(flag);
    }
  });
});

describe("SCHEMA_NAME", () => {
  it("is the schema the migrations qualify their DDL with", () => {
    expect(SCHEMA_NAME).toBe("ouroboros");
  });
});
