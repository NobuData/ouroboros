import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ENVELOPE_FORMAT, ENVELOPE_MAGIC } from "../vault/envelope";
import { FIXTURE_WORKSPACE } from "./github.fixture";
import { GITHUB_CREDENTIAL_STORE, GithubCredentialStore, envelopePrefix } from "./github.secrets";

/**
 * What the vault's sweep is promised about this table.
 *
 * The claim that matters is the **version filter**: `pending` must report the rows that are
 * *not* on the current key version, and only those. Report too few and `VaultRotation.rotate`
 * retires a key that still has ciphertext under it; report too many and every rotation
 * re-seals rows that were already current, which is a sweep that never reports zero and a
 * rotation that never finishes.
 */

const CURRENT_VERSION = 3;
const OLD_ENVELOPE = "ouro.v1.2.bm9uY2U.Y2lwaGVy";

describe("the GitHub credential store", () => {
  let database: RecordingDatabase;
  let store: GithubCredentialStore;

  beforeEach(() => {
    database = recordingDatabase();
    store = new GithubCredentialStore(database.service);
  });

  it("names itself for the table, which is where an operator would go and look", () => {
    expect(store.name).toBe(GITHUB_CREDENTIAL_STORE);
    expect(store.name).toBe("github_credentials");
  });

  it("builds its prefix out of the envelope's own constants", () => {
    // A literal here would make a change to the framing look like every row being out of
    // date — a sweep that re-seals the whole table on every rotation and reports success.
    expect(envelopePrefix(CURRENT_VERSION)).toBe(
      `${ENVELOPE_MAGIC}.${ENVELOPE_FORMAT}.${String(CURRENT_VERSION)}.`,
    );
  });

  it("asks for this workspace's row only when it is not on the current version", async () => {
    database.answers({
      rows: [{ organization_id: FIXTURE_WORKSPACE, token_encrypted: OLD_ENVELOPE }],
    });

    const pending = await store.pending(FIXTURE_WORKSPACE, CURRENT_VERSION);

    expect(database.statements[0].sql).toContain('where "organization_id" = $1');
    expect(database.statements[0].sql).toContain('and "token_encrypted" not like $2');
    expect(database.statements[0].parameters).toEqual([
      FIXTURE_WORKSPACE,
      `${envelopePrefix(CURRENT_VERSION)}%`,
    ]);
    expect(pending).toEqual([{ recordId: FIXTURE_WORKSPACE, secret: OLD_ENVELOPE, sealed: true }]);
  });

  it("reports the workspace id as the record id, which is what the envelope is bound to", async () => {
    database.answers({
      rows: [{ organization_id: FIXTURE_WORKSPACE, token_encrypted: OLD_ENVELOPE }],
    });

    // A record id that changed would make the row permanently unreadable; V027's primary key
    // is a workspace id, which does not.
    expect((await store.pending(FIXTURE_WORKSPACE, CURRENT_VERSION))[0].recordId).toBe(
      FIXTURE_WORKSPACE,
    );
  });

  it("never asks the sweep to adopt, because the column cannot hold a plaintext", async () => {
    database.answers({
      rows: [{ organization_id: FIXTURE_WORKSPACE, token_encrypted: OLD_ENVELOPE }],
    });

    // `github_credentials_token_sealed` is what guarantees it — stated here because "always
    // true" in a security path deserves to name who is guaranteeing it.
    expect((await store.pending(FIXTURE_WORKSPACE, CURRENT_VERSION))[0].sealed).toBe(true);
  });

  it("reports nothing for a workspace whose token is already current", async () => {
    database.answers({ rows: [] });

    expect(await store.pending(FIXTURE_WORKSPACE, CURRENT_VERSION)).toEqual([]);
  });

  it("stores the re-sealed envelope only if the row still holds what it read", async () => {
    database.answers({ numAffectedRows: 1n });

    await store.store(
      { recordId: FIXTURE_WORKSPACE, secret: OLD_ENVELOPE, sealed: true },
      "ouro.v1.3.bmV3.Y2lwaGVy",
    );

    expect(database.statements[0].sql).toContain('update "ouroboros"."github_credentials"');
    expect(database.statements[0].sql).toContain('and "token_encrypted" = $3');
    expect(database.statements[0].parameters).toEqual([
      "ouro.v1.3.bmV3.Y2lwaGVy",
      FIXTURE_WORKSPACE,
      OLD_ENVELOPE,
    ]);
  });
});
