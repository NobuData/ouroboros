import { readFileSync } from "node:fs";
import { join } from "node:path";

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { SourcesRepository } from "./sources.repository";

/**
 * The request's statements, asserted as SQL
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)) — for the reason every
 * repository spec in this service gives: this layer holds statements rather than rules, so
 * what can be wrong is the SQL.
 *
 * Three properties are load-bearing. **Every read goes through the view**, so no statement
 * here can carry a credential in a row. **The one statement that names the table for a read
 * asks a boolean of the sealed column and never selects it.** And **every write is scoped by
 * workspace in its `where`**, so an id guessed from another workspace matches nothing.
 */

/** The repository's code, comments stripped: its header names the statement it must not gain. */
const SOURCE = readFileSync(join(__dirname, "sources.repository.ts"), "utf8").replaceAll(
  /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
  "",
);

const WORKSPACE = "org-sources";
const SOURCE_ID = "5eed001a-0000-4000-8000-000000000001";

describe("SourcesRepository", () => {
  let database: RecordingDatabase;
  let repository: SourcesRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new SourcesRepository(database.service);
  });

  describe("the reads", () => {
    it("lists through the view, scoped and ordered by name, with a count beside it", async () => {
      database.answers({ rows: [] }, { rows: [{ total: "0" }] });

      const page = await repository.list(WORKSPACE, { limit: 25, offset: 0 });

      expect(page).toStrictEqual({ items: [], total: 0, limit: 25, offset: 0 });

      const [listing, counting] = database.statements;

      expect(listing?.sql).toContain('from "ouroboros"."ticket_sources_public"');
      expect(listing?.sql).toContain('"organization_id" = $1');
      expect(listing?.sql).toContain('order by "display_name" asc, "id" asc');
      expect(listing?.parameters).toStrictEqual([WORKSPACE, 25, 0]);
      expect(counting?.sql).toContain("count(*)");
      expect(counting?.sql).toContain('from "ouroboros"."ticket_sources_public"');
    });

    it("finds one source by workspace and id, through the view", async () => {
      await repository.find(WORKSPACE, SOURCE_ID);

      const [statement] = database.statements;

      expect(statement?.sql).toContain('from "ouroboros"."ticket_sources_public"');
      expect(statement?.sql).toContain('"organization_id" = $1');
      expect(statement?.sql).toContain('"id" = $2');
      expect(statement?.parameters).toStrictEqual([WORKSPACE, SOURCE_ID]);
    });

    it("answers undefined for a source that is not this workspace's", async () => {
      expect(await repository.find(WORKSPACE, SOURCE_ID)).toBeUndefined();
    });
  });

  describe("the credential's presence", () => {
    it("asks the table whether the column is null, and selects nothing else of it", async () => {
      database.answers({ rows: [{ id: SOURCE_ID, has_credential: true }] });

      const presence = await repository.credentialPresence(WORKSPACE, [SOURCE_ID]);

      expect(presence.get(SOURCE_ID)).toBe(true);

      const [statement] = database.statements;

      expect(statement?.sql).toContain('from "ouroboros"."ticket_sources"');
      expect(statement?.sql).toContain("credentials_encrypted is not null");
      expect(statement?.sql).not.toMatch(/select[^f]*"credentials_encrypted"/);
      expect(statement?.sql).toContain('"organization_id" = $1');
    });

    it("issues no statement for no sources", async () => {
      expect(await repository.credentialPresence(WORKSPACE, [])).toStrictEqual(new Map());
      expect(database.statements).toStrictEqual([]);
    });

    it("is the one statement in this file that names the table for a read", () => {
      // `ticket-sources.repository.ts` holds the statement that reads the column's *value*;
      // this file adds one that reads a boolean about it, and must not acquire a second.
      const reads = SOURCE.match(/selectFrom\("ticket_sources"\)/g) ?? [];

      expect(reads).toHaveLength(1);
      expect(SOURCE).not.toContain('select("credentials_encrypted")');
    });
  });

  describe("the writes", () => {
    it("inserts with the caller's id and the config as JSON", async () => {
      await repository.insert({
        id: SOURCE_ID,
        organizationId: WORKSPACE,
        kind: "github",
        displayName: "GitHub · acme-robotics",
        config: { login: "acme-robotics", repos: ["helios-firmware"] },
        credentialsEncrypted: "ouro.v1.1.abc.def",
      });

      const [statement] = database.statements;

      expect(statement?.sql).toContain('insert into "ouroboros"."ticket_sources"');
      expect(statement?.parameters).toStrictEqual([
        SOURCE_ID,
        WORKSPACE,
        "github",
        "GitHub · acme-robotics",
        '{"login":"acme-robotics","repos":["helios-firmware"]}',
        "ouro.v1.1.abc.def",
      ]);
    });

    it("updates only what the patch carries, scoped by workspace and id", async () => {
      database.answers({ numAffectedRows: 1n });

      expect(await repository.update(WORKSPACE, SOURCE_ID, { status: "paused" })).toBe(true);

      const [statement] = database.statements;

      expect(statement?.sql).toContain('update "ouroboros"."ticket_sources" set "status" = $1');
      expect(statement?.sql).not.toContain('"display_name"');
      expect(statement?.sql).not.toContain('"config"');
      expect(statement?.sql).toContain('"organization_id" = $2');
      expect(statement?.sql).toContain('"id" = $3');
      expect(statement?.parameters).toStrictEqual(["paused", WORKSPACE, SOURCE_ID]);
    });

    it("writes a cleared reason as null, because absence must not be a write", async () => {
      database.answers({ numAffectedRows: 1n });

      await repository.update(WORKSPACE, SOURCE_ID, { status: "active", statusReason: null });

      expect(database.statements[0]?.parameters).toStrictEqual([
        "active",
        null,
        WORKSPACE,
        SOURCE_ID,
      ]);
    });

    it("issues nothing for an empty patch, and does not read that as a 404", async () => {
      expect(await repository.update(WORKSPACE, SOURCE_ID, {})).toBe(true);
      expect(database.statements).toStrictEqual([]);
    });

    it("answers false when no row of this workspace matched", async () => {
      database.answers({ numAffectedRows: 0n });

      expect(await repository.update(WORKSPACE, SOURCE_ID, { displayName: "x" })).toBe(false);
    });

    it("replaces the sealed credential, scoped by workspace and id", async () => {
      database.answers({ numAffectedRows: 1n });

      expect(await repository.setCredential(WORKSPACE, SOURCE_ID, "ouro.v1.1.abc.def")).toBe(true);

      const [statement] = database.statements;

      expect(statement?.sql).toContain('set "credentials_encrypted" = $1');
      expect(statement?.parameters).toStrictEqual(["ouro.v1.1.abc.def", WORKSPACE, SOURCE_ID]);
    });
  });
});
