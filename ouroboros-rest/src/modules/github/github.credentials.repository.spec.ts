import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { FIXTURE_WORKSPACE, credentialRow } from "./github.fixture";
import { GithubCredentialsRepository } from "./github.credentials.repository";

/**
 * The four statements, and the properties each has to have: every one is keyed by the
 * workspace and nothing else, the write is a **single** upsert rather than the read-then-write
 * pair the primary key exists to make unnecessary, clearing **deletes** rather than nulling,
 * and the sweep's write is conditional on the value it read.
 *
 * The `exists` statement gets a test of its own for a reason that is not obvious: it must not
 * select the ciphertext. The fewer places a sealed value is loaded, the shorter the list of
 * places it could be logged, and a `selectAll()` here would be invisible in review.
 */

const ENVELOPE = "ouro.v1.1.bm9uY2U.Y2lwaGVy";
const NEXT_ENVELOPE = "ouro.v1.2.bm9uY2Uy.Y2lwaGVyMg";

describe("the GitHub credentials repository", () => {
  let database: RecordingDatabase;
  let credentials: GithubCredentialsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    credentials = new GithubCredentialsRepository(database.service);
  });

  describe("reading", () => {
    it("finds the workspace's row, scoped to the workspace and nothing else", async () => {
      const row = credentialRow(ENVELOPE);

      database.answers({ rows: [row] });

      expect(await credentials.find(FIXTURE_WORKSPACE)).toEqual(row);
      expect(database.statements[0].sql).toContain('from "ouroboros"."github_credentials"');
      expect(database.statements[0].sql).toContain('where "organization_id" = $1');
      expect(database.statements[0].parameters).toEqual([FIXTURE_WORKSPACE]);
    });

    it("answers undefined for a workspace with no token, which is not an error", async () => {
      database.answers({ rows: [] });

      expect(await credentials.find(FIXTURE_WORKSPACE)).toBeUndefined();
    });

    it("answers whether a token is there without loading the ciphertext", async () => {
      database.answers({ rows: [{ organization_id: FIXTURE_WORKSPACE }] });

      expect(await credentials.exists(FIXTURE_WORKSPACE)).toBe(true);
      expect(database.statements[0].sql).toContain('select "organization_id"');
      expect(database.statements[0].sql).not.toContain("token_encrypted");
    });

    it("answers false when there is nothing there", async () => {
      database.answers({ rows: [] });

      expect(await credentials.exists(FIXTURE_WORKSPACE)).toBe(false);
    });

    it("lists the configured workspaces without naming a ciphertext (#102)", async () => {
      // The backlog sync's entry point: a poll runs on a timer with nobody signed in, so it
      // starts from *which workspaces are configured at all*. Unscoped by design, and the
      // statement selects the key column and nothing else — so no envelope enters the process
      // for a question that is about ids.
      database.answers({
        rows: [{ organization_id: FIXTURE_WORKSPACE }, { organization_id: "org-other" }],
      });

      expect(await credentials.configured()).toEqual([FIXTURE_WORKSPACE, "org-other"]);
      expect(database.statements[0].sql).toContain('select "organization_id"');
      expect(database.statements[0].sql).not.toContain("token_encrypted");
      expect(database.statements[0].sql).not.toContain("where");
    });

    it("answers an installation where nobody has configured a token with an empty list", async () => {
      database.answers({ rows: [] });

      expect(await credentials.configured()).toEqual([]);
    });
  });

  describe("writing", () => {
    it("stores the envelope as one upsert on the primary key", async () => {
      database.answers({ rows: [credentialRow(ENVELOPE)] });

      await credentials.upsert(FIXTURE_WORKSPACE, ENVELOPE);

      // One statement: set and rotate are the same operation, and the database arbitrates
      // two administrators pasting at once rather than this code pretending to.
      expect(database.statements).toHaveLength(1);
      expect(database.statements[0].sql).toContain('insert into "ouroboros"."github_credentials"');
      expect(database.statements[0].sql).toContain('on conflict ("organization_id") do update');
      expect(database.statements[0].parameters).toEqual([FIXTURE_WORKSPACE, ENVELOPE, ENVELOPE]);
    });

    it("names no timestamp, so the trigger stays the only writer of updated_at", async () => {
      database.answers({ rows: [credentialRow(ENVELOPE)] });

      await credentials.upsert(FIXTURE_WORKSPACE, ENVELOPE);

      expect(database.statements[0].sql).not.toContain("updated_at");
    });
  });

  describe("clearing", () => {
    it("deletes the row rather than nulling the column", async () => {
      database.answers({ numAffectedRows: 1n });

      expect(await credentials.remove(FIXTURE_WORKSPACE)).toBe(true);
      expect(database.statements[0].sql).toContain('delete from "ouroboros"."github_credentials"');
      expect(database.statements[0].sql).toContain('where "organization_id" = $1');
    });

    it("reports that nothing was there, so the trail does not claim a removal", async () => {
      database.answers({ numAffectedRows: 0n });

      expect(await credentials.remove(FIXTURE_WORKSPACE)).toBe(false);
    });
  });

  describe("re-sealing, for the vault's sweep", () => {
    it("writes only if the row still holds what the sweep read", async () => {
      database.answers({ numAffectedRows: 1n });

      await credentials.reseal(FIXTURE_WORKSPACE, ENVELOPE, NEXT_ENVELOPE);

      // Without the second predicate, a sweep running detached would overwrite a token an
      // administrator rotated mid-sweep — resurrecting a credential somebody retired.
      expect(database.statements[0].sql).toContain('where "organization_id" = $2');
      expect(database.statements[0].sql).toContain('and "token_encrypted" = $3');
      expect(database.statements[0].parameters).toEqual([
        NEXT_ENVELOPE,
        FIXTURE_WORKSPACE,
        ENVELOPE,
      ]);
    });
  });
});
