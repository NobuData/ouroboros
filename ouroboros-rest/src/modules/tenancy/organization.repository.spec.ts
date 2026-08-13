import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ORGANIZATION_ROLE_IDS } from "../../auth/organization.roles";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { LIBRARY_OWNED_TABLES } from "../db/schema";
import { FIXTURE_ORGANIZATION } from "./organization.fixture";
import { KNOWN_ROLES, OrganizationRepository, rolesFrom } from "./organization.repository";

/**
 * The two reads the tenant context makes, and the parse between a column and a role.
 *
 * The statements are asserted as SQL rather than through a mocked method, for the reason
 * `database.fixture.ts` gives: which table a query names and which columns it filters on is
 * what tenant isolation actually rests on, and `toHaveBeenCalled()` says nothing about either.
 *
 * The parse is the other half and is specific to this table. `member.role` is text with no
 * check constraint behind it — V005 declined to add one deliberately — so every assumption
 * about what it contains has to be made here, out loud, rather than inherited from a
 * migration.
 */

const USER_ID = "5eed0003-0000-4000-8000-000000000001";

describe("the tables the library owns", () => {
  /** Where this service's own source lives, from this file rather than the working directory. */
  const SOURCE_ROOT = join(__dirname, "..", "..");

  /** The Kysely verbs that write. `selectFrom` is deliberately absent. */
  const WRITES = ["insertInto", "updateTable", "deleteFrom", "replaceInto", "mergeInto"];

  /**
   * Every shipped TypeScript file under `src/`.
   *
   * Specs and fixtures are excluded: they are allowed to name whatever they need to make an
   * assertion — this file names all five verbs a line above — and including them would make
   * the check fail on its own text.
   *
   * @param directory - Where to look.
   * @returns The paths, recursively.
   */
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return sourceFiles(path);
      }

      const shipped =
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".fixture.ts");

      return shipped ? [path] : [];
    });
  }

  it("is written by BetterAuth and by no statement in this service", () => {
    // The rule `db/schema.ts` states, enforced where it can be: the library mints the ids,
    // maps the field names and converts the dates its routes expect, so a hand-written insert
    // here would be a second implementation of all three and the first to drift would drift
    // silently. Typing the columns as un-insertable does *not* enforce this — Kysely resolves
    // such a table's `Insertable` to `{}`, which accepts every object rather than none — so
    // the check reads the source instead.
    const offenders = sourceFiles(SOURCE_ROOT).filter((path) => {
      const source = readFileSync(path, "utf8");

      return LIBRARY_OWNED_TABLES.some((table) =>
        WRITES.some((verb) => source.includes(`${verb}("${table}")`)),
      );
    });

    expect(offenders).toEqual([]);
  });

  it("reads the source it claims to, so a broken walk cannot pass silently", () => {
    // An empty file list would make the assertion above vacuous — and a spec that passes by
    // finding nothing is the failure mode of every check written this way.
    expect(sourceFiles(SOURCE_ROOT)).toContain(join(__dirname, "organization.repository.ts"));
  });
});

describe("reading member.role", () => {
  it("reads one word as one role", () => {
    expect(rolesFrom("owner")).toEqual(["owner"]);
  });

  it("reads a comma-separated list as several", () => {
    // V005's column comment: the library accepts an array of roles and joins it. Read as one
    // word, `admin,member` would be a role nothing grants — an administrator locked out of
    // every mutation, with the database showing them as an admin.
    expect(rolesFrom("admin,member")).toEqual(["admin", "member"]);
  });

  it("tolerates the spacing a hand-written row may carry", () => {
    expect(rolesFrom(" admin , viewer ")).toEqual(["admin", "viewer"]);
  });

  it("drops a word it does not recognise, rather than trusting it", () => {
    // Reachable precisely because the column is not constrained. Nothing here can decide what
    // an unknown role may do, and the safe reading of one is that it grants nothing.
    expect(rolesFrom("superuser")).toEqual([]);
    expect(rolesFrom("owner,superuser")).toEqual(["owner"]);
  });

  it("does not repeat a role that was stored twice", () => {
    expect(rolesFrom("member,member")).toEqual(["member"]);
  });

  it("reads an empty column as no roles at all", () => {
    expect(rolesFrom("")).toEqual([]);
  });

  it("recognises exactly the roles the organization plugin is configured with", () => {
    // The vocabulary is configuration rather than schema, so the one thing that can go wrong
    // is these two lists drifting: a role the plugin grants and this service does not
    // recognise is a member whose permissions silently vanish at our own routes.
    expect([...KNOWN_ROLES].sort()).toEqual([...ORGANIZATION_ROLE_IDS].sort());
  });
});

describe("the organization repository", () => {
  let database: RecordingDatabase;
  let organizations: OrganizationRepository;

  beforeEach(() => {
    database = recordingDatabase();
    organizations = new OrganizationRepository(database.service);
  });

  describe("finding a workspace", () => {
    it("looks a uuid up by primary key", async () => {
      database.answers({ rows: [FIXTURE_ORGANIZATION] });

      const found = await organizations.find({ kind: "id", value: FIXTURE_ORGANIZATION.id });

      expect(found).toEqual(FIXTURE_ORGANIZATION);
      expect(database.statements[0].sql).toContain('from "ouroboros"."organization"');
      expect(database.statements[0].sql).toContain('where "id" = $1');
      expect(database.statements[0].parameters).toEqual([FIXTURE_ORGANIZATION.id]);
    });

    it("looks anything else up by slug", async () => {
      // One header accepts both, and which lookup it becomes is decided by the shape of the
      // value — `organization_slug_key` serves this one.
      await organizations.find({ kind: "slug", value: "acme" });

      expect(database.statements[0].sql).toContain('where "slug" = $1');
      expect(database.statements[0].parameters).toEqual(["acme"]);
    });

    it("is nothing when no row matches", async () => {
      expect(await organizations.find({ kind: "slug", value: "nobody" })).toBeUndefined();
    });
  });

  describe("finding what somebody may do", () => {
    it("reads one membership by the pair V005 made unique", async () => {
      database.answers({ rows: [{ role: "owner" }] });

      const roles = await organizations.rolesFor(FIXTURE_ORGANIZATION.id, USER_ID);

      expect(roles).toEqual(["owner"]);
      expect(database.statements[0].sql).toContain('from "ouroboros"."member"');
      expect(database.statements[0].sql).toContain('where "organizationId" = $1 and "userId" = $2');
      expect(database.statements[0].parameters).toEqual([FIXTURE_ORGANIZATION.id, USER_ID]);
    });

    it("selects the role and nothing else", async () => {
      // The membership's id, and when it was created, are somebody else's questions. A
      // `selectAll` here would be two more columns on the hottest read in the service.
      await organizations.rolesFor(FIXTURE_ORGANIZATION.id, USER_ID);

      expect(database.statements[0].sql).toContain('select "role"');
    });

    it("parses whatever the column held", async () => {
      database.answers({ rows: [{ role: "admin,member" }] });

      expect(await organizations.rolesFor(FIXTURE_ORGANIZATION.id, USER_ID)).toEqual([
        "admin",
        "member",
      ]);
    });

    it("distinguishes no membership from a membership with no usable role", async () => {
      // The difference is a 404 and a member who may only read, so the two may not be
      // collapsed: `undefined` means *not a member*, and `[]` means *a member holding nothing
      // this service recognises*.
      const absent = await organizations.rolesFor(FIXTURE_ORGANIZATION.id, USER_ID);

      database.answers({ rows: [{ role: "superuser" }] });
      const unrecognised = await organizations.rolesFor(FIXTURE_ORGANIZATION.id, USER_ID);

      expect(absent).toBeUndefined();
      expect(unrecognised).toEqual([]);
    });
  });

  describe("listing the workspaces somebody belongs to", () => {
    it("joins the membership to the workspace in one statement", async () => {
      // The reason `GET /api/v1/orgs` exists. The plugin's own `organization/list` discards
      // the role in its adapter, so `ouroboros-ui` has been issuing one extra request per
      // workspace to recover it; one join answers both.
      await organizations.listFor(USER_ID, { limit: 25, offset: 0 });

      expect(database.statements).toHaveLength(1);
      expect(database.statements[0].sql).toContain('from "ouroboros"."member"');
      expect(database.statements[0].sql).toContain('inner join "ouroboros"."organization"');
      expect(database.statements[0].sql).toContain('where "ouroboros"."member"."userId" = $1');
    });

    it("orders by creation, then by id", async () => {
      // The tiebreak is not decorative: the development seed creates its three workspaces in
      // one statement, so they share an instant to the microsecond — and without a second key
      // the order mockup 01 Step 2 is drawn in would be whatever the planner returned.
      await organizations.listFor(USER_ID, { limit: 25, offset: 0 });

      expect(database.statements[0].sql).toContain(
        'order by "ouroboros"."organization"."createdAt", "ouroboros"."organization"."id"',
      );
    });

    it("parses each membership's role the same way a single lookup does", async () => {
      database.answers({
        rows: [{ ...FIXTURE_ORGANIZATION, memberRole: "admin,superuser" }],
      });

      expect(await organizations.listFor(USER_ID, { limit: 25, offset: 0 })).toEqual([
        { organization: FIXTURE_ORGANIZATION, roles: ["admin"] },
      ]);
    });

    it("keeps the joined column out of the workspace it returns", async () => {
      // `memberRole` is an artefact of the join, not a field of `organization`. Leaving it on
      // the row would put it in the resource the moment somebody spread the object.
      database.answers({ rows: [{ ...FIXTURE_ORGANIZATION, memberRole: "owner" }] });

      const [membership] = await organizations.listFor(USER_ID, { limit: 25, offset: 0 });

      expect(membership.organization).not.toHaveProperty("memberRole");
    });

    it("counts every membership, ignoring the window", async () => {
      database.answers({ rows: [{ total: "3" }] });

      expect(await organizations.countFor(USER_ID)).toBe(3);
      expect(database.statements[0].sql).toContain('from "ouroboros"."member"');
      expect(database.statements[0].sql).toContain('where "userId" = $1');
      expect(database.statements[0].sql).not.toContain("limit");
    });
  });
});

describe("the tables V006 dropped", () => {
  /**
   * The acceptance criterion, as an assertion.
   *
   * > *No endpoint in `modules/tenancy` still reads `tenant_members` or `users`.*
   *
   * Read off the source rather than inferred from the type system, for the same reason the
   * library-owned rule above is: `db/schema.ts` no longer declares these tables, so a query
   * naming one would not compile *today* — but a raw `sql` fragment would, and so would a
   * table name that came back into the mirror by mistake. This is the check that survives
   * both.
   */
  const SOURCE_ROOT = __dirname;

  /** What V006 dropped, and what nothing under this module may name again. */
  const DROPPED = ["tenants", "tenant_members", "users", "user_identities"];

  it.each(DROPPED)("is not named by any statement in this module: %s", (table) => {
    const offenders = readdirSync(SOURCE_ROOT)
      // Shipped source only. Specs and fixtures are excluded for the reason the walk above
      // excludes them: they are allowed to name whatever an assertion needs, and this file
      // names all four of these a few lines up.
      .filter(
        (name) =>
          name.endsWith(".ts") &&
          !name.endsWith(".spec.ts") &&
          !name.endsWith("-spec.ts") &&
          !name.endsWith(".fixture.ts"),
      )
      .filter((name) => {
        const source = readFileSync(join(SOURCE_ROOT, name), "utf8");

        // The Kysely verbs, plus a raw fragment. `tenant_domains` survives V006 and starts
        // with `tenant`, so the names are matched with their quotes rather than as substrings.
        return [
          `From("${table}")`,
          `Into("${table}")`,
          `Table("${table}")`,
          `ouroboros.${table} `,
        ].some((usage) => source.includes(usage));
      });

    expect(offenders).toEqual([]);
  });

  it("reads the module it claims to, so a broken walk cannot pass silently", () => {
    expect(readdirSync(SOURCE_ROOT)).toContain("enablement.repository.ts");
  });
});
