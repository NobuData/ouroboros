import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { ApiHarness, ORGS } from "./harness.fixture";
import { bodyOf, DISPOSABLE, integrationDatabaseUrl } from "./integration.fixture";
import { databaseProject, DATABASE_SCHEMA, POSTGRES_IMAGE } from "./migration.fixture";
import { SCHEMA_NAME } from "../modules/db/schema";
import { API_BASE_PATH } from "../application";

/**
 * The harness itself, asserted rather than assumed.
 *
 * > *Suite green locally and in CI without external setup.*
 *
 * [#37](https://github.com/NobuData/ouroboros/issues/37)'s first acceptance criterion is a
 * claim about this machinery, not about the API — and it is the kind of claim that fails
 * quietly. A harness that started a container and then talked to a database somebody else
 * left running would pass every suite in this module while proving none of them; a
 * `truncate` that emptied nothing would leave each suite reading the last one's rows and
 * would only be noticed as flakiness months later.
 *
 * So each of the four things the harness promises is checked here, against the database the
 * run actually got:
 *
 *   * it is the PostgreSQL the images are pinned to, and it is empty of anything a developer
 *     might have left in it;
 *   * `ouroboros-db`'s migrations have all been applied, by Flyway, with a history to show
 *     for it;
 *   * the application is listening on a port nobody chose, and answers over it;
 *   * a minted session is one the real guard honours, and `truncate` really empties.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** What this suite's own rows are named with. */
const PREFIX = "ouro-harness";

/** The major version the pinned image carries, taken from the tag rather than restated. */
const POSTGRES_MAJOR = POSTGRES_IMAGE.split(":")[1].split("-")[0];

/** One row of Flyway's history, as much of it as this suite reads. */
interface HistoryRow {
  version: string | null;
  script: string;
  success: boolean;
}

describe("the integration harness", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
    await api.truncate();
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  describe("the database it was given", () => {
    it("is the PostgreSQL the harness pins", async () => {
      // `postgres:17-alpine` is a claim about the image; this is the claim about the server
      // that came out of it, which is what the migrations and the SQL below actually meet.
      const { rows } = await api.sql.query<{ version: string }>(
        "select current_setting('server_version') as version",
      );

      expect(rows[0].version.startsWith(`${POSTGRES_MAJOR}.`)).toBe(true);
    });

    it("carries the schema the migrations create, and the tables the mirror declares", async () => {
      const { rows } = await api.sql.query<{ count: string }>(
        "select count(*) as count from pg_catalog.pg_tables where schemaname = $1",
        [SCHEMA_NAME],
      );

      // The application's tables plus BetterAuth's plus Flyway's own history. The exact set
      // is `db.integration-spec.ts`'s to check against `TABLE_COLUMNS`; here it is only that
      // the schema is populated at all, which is what distinguishes "migrated" from
      // "created".
      expect(Number(rows[0].count)).toBeGreaterThan(1);
      expect(DATABASE_SCHEMA).toBe(SCHEMA_NAME);
    });

    it("has had every versioned migration applied, successfully, by Flyway", async () => {
      const { rows } = await api.sql.query<HistoryRow>(
        `select version, script, success from ${SCHEMA_NAME}.flyway_schema_history
          order by installed_rank`,
      );
      const onDisk = readdirSync(resolve(databaseProject(), "migrations"))
        .filter((file) => file.startsWith("V"))
        .sort();

      expect(rows.map((row) => row.script)).toEqual(expect.arrayContaining(onDisk));
      expect(rows.every((row) => row.success)).toBe(true);
    });

    it("ran the repeatable seed as the no-op it is without the overlay", async () => {
      // Recorded, so `placeholderReplacement` resolved `${ouro_dev_seed}` — a missing value
      // fails the whole run — and empty, because `flyway.seed.toml` is deliberately not
      // layered on. A suite that began with rows it did not create is a suite whose counts
      // mean nothing.
      const { rows } = await api.sql.query<HistoryRow>(
        `select version, script, success from ${SCHEMA_NAME}.flyway_schema_history
          where script like 'R__%'`,
      );

      expect(rows.map((row) => row.script)).toContain("R__dev_seed.sql");
      expect(rows.every((row) => row.version === null && row.success)).toBe(true);
    });

    it("is the one the application was configured with", async () => {
      // The harness publishes the url through the environment and reads it back through the
      // configuration module; this is the round trip, and it is what would fail if a suite
      // were talking to one database while the application talked to another.
      expect(api.configuration.databaseUrl).toBe(integrationDatabaseUrl());

      const { rows } = await api.sql.query<{ name: string }>("select current_database() as name");
      expect(api.configuration.databaseUrl).toContain(rows[0].name);
    });
  });

  describe("the application it starts", () => {
    it("listens on a port nobody chose, which is not the one the process would take", async () => {
      expect(api.port).toBeGreaterThan(0);
      expect(api.port).not.toBe(api.configuration.port);
      expect(api.baseUrl).toBe(`http://127.0.0.1:${api.port}`);

      // Over the socket, not through an in-memory adapter: the heartbeat is public, so this
      // is the whole stack answering with nothing arranged.
      const heartbeat = bodyOf<{ status: string }>(
        await api.anonymous("get", API_BASE_PATH).expect(200),
      );
      expect(heartbeat.status).toBe("ok");
    });

    it("lets a second one run beside it on a port of its own", async () => {
      // Which is the property that makes port 0 the right choice rather than a detail: two
      // suites, or a suite and a developer's `yarn dev`, must not have to agree on a number.
      const second = await ApiHarness.start();

      try {
        expect(second.port).not.toBe(api.port);
        await second.anonymous("get", API_BASE_PATH).expect(200);
      } finally {
        await second.close();
      }
    });

    it("is the application the process builds, guards included", async () => {
      // No cookie, so the global session guard answers before any handler is reached. A
      // harness that had switched authentication off to make its own life easier would fail
      // here, which is the point of asserting it.
      await api.anonymous("get", ORGS).expect(401);
    });
  });

  describe("the sessions it mints", () => {
    it("are honoured by the real guard", async () => {
      const person = await api.signIn();

      const page = bodyOf<{ total: number }>(await api.as(person)("get", ORGS).expect(200));

      // Zero, because a person the harness invented belongs to nothing until a fixture says
      // so — which is the `no-workspace` state Step 2 draws, and a 200 rather than a refusal.
      expect(page.total).toBe(0);
    });

    it("name a person the database really holds", async () => {
      const person = await api.signIn({ displayName: "Ada Lovelace" });

      const { rows } = await api.sql.query<{ email: string; name: string }>(
        `select "email", "name" from ${SCHEMA_NAME}."user" where "id" = $1`,
        [person.id],
      );

      expect(rows).toEqual([{ email: person.email, name: "Ada Lovelace" }]);
    });

    it("fold an address the way the API folds one", async () => {
      const person = await api.signIn({ email: `${PREFIX}-MIXED@Example.Test` });

      expect(person.email).toBe(`${PREFIX}-mixed@example.test`);
    });

    it("carry a role when the harness grants one", async () => {
      const owner = await api.signIn();
      const viewer = await api.signIn();
      const workspace = await api.workspace(owner);

      await api.join(workspace.id, viewer, "viewer");

      // A viewer may look and may not touch, which is the guard reading a membership this
      // fixture wrote — the arrangement half of every test in `roles.integration-spec.ts`.
      await api.as(viewer)("get", `${ORGS}/${workspace.id}/github-orgs`).expect(200);
      await api
        .as(viewer)("post", `${ORGS}/${workspace.id}/github-orgs`)
        .send({ login: "mine-now" })
        .expect(403);
    });
  });

  describe("the truncation between tests", () => {
    it("empties what a test created, tables the test never named included", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      await api
        .as(owner)("post", `${ORGS}/${workspace.id}/domains`)
        .send({ domain: `${PREFIX}.example` })
        .expect(201);

      await api.truncate();

      // `member`, `"user"` and `session` are the ones a prefix-scoped cleanup misses: none of
      // the three was named by this test, and all three were written by the harness on its
      // way to having somebody signed in.
      const { rows } = await api.sql.query<{ table: string; count: string }>(
        `select 'organization' as table, count(*)::text as count
           from ${SCHEMA_NAME}.organization
         union all select 'tenant_domains', count(*)::text from ${SCHEMA_NAME}.tenant_domains
         union all select 'member', count(*)::text from ${SCHEMA_NAME}.member
         union all select 'user', count(*)::text from ${SCHEMA_NAME}."user"
         union all select 'session', count(*)::text from ${SCHEMA_NAME}.session`,
      );

      expect(rows.map((row) => row.count)).toEqual(["0", "0", "0", "0", "0"]);
    });

    it("refuses a database the run did not start", async () => {
      // The safeguard, exercised rather than trusted: truncation is the one thing here a
      // developer can lose work to, and before #37 the documented way to run these suites
      // pointed at the development stack. Withdrawing the declaration is what a run against
      // somebody's own database looks like from inside the harness.
      const declared = process.env[DISPOSABLE];
      delete process.env[DISPOSABLE];

      try {
        await expect(api.truncate()).rejects.toThrow(/Refusing to empty a database/);
      } finally {
        process.env[DISPOSABLE] = declared;
      }

      // …and the tables are still there, which is the property the message is about.
      const { rows } = await api.sql.query<{ count: string }>(
        "select count(*) as count from pg_catalog.pg_tables where schemaname = $1",
        [SCHEMA_NAME],
      );
      expect(Number(rows[0].count)).toBeGreaterThan(1);
    });

    it("leaves Flyway's history alone", async () => {
      // Truncating it would leave a database that is migrated and says it is not — which the
      // next `flyway migrate` would try to fix by applying V000 to a schema that has it.
      const before = await api.sql.query(`select 1 from ${SCHEMA_NAME}.flyway_schema_history`);

      await api.truncate();

      const after = await api.sql.query(`select 1 from ${SCHEMA_NAME}.flyway_schema_history`);
      expect(after.rowCount).toBe(before.rowCount);
      expect(after.rowCount).toBeGreaterThan(0);
    });
  });
});
