import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { DiscoveryRepository } from "./discovery.repository";

/**
 * The discovery statement, and the three things that have to be true of it.
 *
 * A repository is thin by design, so what is asserted is the SQL itself — the same argument
 * `tenancy/domains.repository.spec.ts` makes, and here it carries more weight than usual:
 *
 *   * **It matches on `domain` and on nothing else.** `V006__tenancy_extensions.sql` dropped
 *     `tenant_id` from this table and `src/modules/db/schema.ts` still declares it, so a
 *     statement that named any other column would compile, typecheck, and fail against a
 *     migrated database. The unique index on `domain` is the one the migration explicitly
 *     preserved for this endpoint.
 *   * **It reads one column of one row.** The caller is anonymous; a `select *` here would
 *     be a row waiting for somebody to return part of it by accident.
 *   * **It answers a boolean.** Existence is the question, and the return type is what stops
 *     the answer from carrying more than the endpoint may say.
 */

const DOMAIN = "acme.ouroboros.dev";

describe("the discovery repository", () => {
  let database: RecordingDatabase;
  let domains: DiscoveryRepository;

  beforeEach(() => {
    database = recordingDatabase();
    domains = new DiscoveryRepository(database.service);
  });

  it("looks the domain up by the column the unique index covers", async () => {
    await domains.exists(DOMAIN);

    // The second parameter is the `limit` below, which Kysely binds rather than inlines.
    expect(database.statements[0].sql).toContain('where "domain" = $1');
    expect(database.statements[0].parameters).toEqual([DOMAIN, 1]);
  });

  it("names no column V006 dropped", async () => {
    // The failure this closes is not a wrong answer, it is a 500: `tenant_id` is gone from
    // the table and still present in the schema type, so only the SQL can catch it.
    await domains.exists(DOMAIN);

    expect(database.statements[0].sql).not.toContain("tenant_id");
    expect(database.statements[0].sql).not.toContain("organization_id");
  });

  it("selects one column rather than the row", async () => {
    await domains.exists(DOMAIN);

    expect(database.statements[0].sql).toContain('select "domain"');
    expect(database.statements[0].sql).not.toContain("*");
  });

  it("stops at the first match", async () => {
    // The unique index means there cannot be a second, so reading further would be reading
    // for nobody.
    await domains.exists(DOMAIN);

    expect(database.statements[0].sql).toContain("limit");
  });

  it("issues exactly one statement, with no transaction around it", async () => {
    // One statement is the whole request. A `begin`/`commit` here would be a unit of work
    // with one member and a connection held for the length of the timing floor.
    await domains.exists(DOMAIN);

    expect(database.statements).toHaveLength(1);
  });

  it("says yes when a workspace holds the domain", async () => {
    database.answers({ rows: [{ domain: DOMAIN }] });

    expect(await domains.exists(DOMAIN)).toBe(true);
  });

  it("says no when nothing does", async () => {
    expect(await domains.exists(DOMAIN)).toBe(false);
  });

  it("says nothing else either way", async () => {
    // The row is queued with more on it than the repository may reveal; what comes back is
    // a boolean, so there is nothing to leak by forgetting to strip a field.
    database.answers({ rows: [{ domain: DOMAIN, organization_id: "org_acme", is_primary: true }] });

    expect(await domains.exists(DOMAIN)).toBe(true);
  });
});
