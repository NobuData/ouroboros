import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ENVELOPE_FORMAT, ENVELOPE_MAGIC } from "../vault/envelope";
import {
  PROVIDER_CREDENTIAL_STORE,
  ProviderCredentialStore,
  envelopePrefix,
} from "./registry.secrets";

/**
 * The store the vault's sweep reaches `provider_connections.credentials_encrypted` through.
 *
 * Two statements, and both of them are the kind where mocking a method would prove nothing:
 * *which rows does a rotation still have to convert* is a `where` clause, and *does a write
 * that lost a race overwrite a newer credential* is another one. So these run against a real
 * Kysely over a recording driver, as the repository's suite does.
 *
 * That the sweep then actually re-seals what this reports is `vault.rotation.spec.ts`'s and
 * `registry.integration-spec.ts`'s question.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const SEALED_ON_ONE = "ouro.v1.1.AAAAAAAAAAAAAAAA.ZmFrZS1jaXBoZXJ0ZXh0";
const SEALED_ON_TWO = "ouro.v1.2.BBBBBBBBBBBBBBBB.ZmFrZS1jaXBoZXJ0ZXh0";

describe("envelopePrefix", () => {
  it("is built from the envelope module's own constants", () => {
    // A literal here would let the framing change under this file, which would make every
    // row look out of date — a sweep that re-seals the whole table on every rotation and
    // reports success.
    expect(envelopePrefix(3)).toBe(`${ENVELOPE_MAGIC}.${ENVELOPE_FORMAT}.3.`);
  });

  it("ends at the separator, so version 1 does not match version 12", () => {
    expect(envelopePrefix(1)).toBe("ouro.v1.1.");
    expect(SEALED_ON_TWO.startsWith(envelopePrefix(2))).toBe(true);
    expect("ouro.v1.12.AAAA.BBBB".startsWith(envelopePrefix(1))).toBe(false);
  });
});

describe("the provider credential store", () => {
  let database: RecordingDatabase;
  let store: ProviderCredentialStore;

  beforeEach(() => {
    database = recordingDatabase();
    store = new ProviderCredentialStore(database.service);
  });

  it("names itself after the table an operator would go and look at", () => {
    expect(store.name).toBe(PROVIDER_CREDENTIAL_STORE);
    expect(store.name).toBe("provider_connections");
  });

  describe("pending", () => {
    it("asks for this workspace's rows that are not on the target version", async () => {
      await store.pending(WORKSPACE, 2);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"ouroboros"."provider_connections"');
      expect(statement.parameters).toEqual([WORKSPACE, "ouro.v1.2.%"]);
    });

    it("filters by prefix rather than by a second column", async () => {
      // The key version is the third field of the envelope, so *which key sealed this row* is
      // a property of the value and needs no column to fall out of step with it.
      await store.pending(WORKSPACE, 2);

      expect(database.statements[0].sql).toContain("not like");
    });

    it("excludes rows with no credential at all", async () => {
      // A local provider has nothing to re-seal. `not like` against a null is null rather
      // than true, so the predicate is redundant — and saying it is what makes the fact
      // visible here instead of a consequence of three-valued logic.
      await store.pending(WORKSPACE, 2);

      expect(database.statements[0].sql).toContain('"credentials_encrypted" is not null');
    });

    it("reports each row as already sealed", async () => {
      // Never `false`. V015's provider_connections_credentials_sealed refuses any value that
      // is not an envelope, so a row holding an unsealed secret cannot exist — the sweep has
      // nothing to adopt here, only to re-seal.
      database.answers({ rows: [{ id: CONNECTION, credentials_encrypted: SEALED_ON_ONE }] });

      await expect(store.pending(WORKSPACE, 2)).resolves.toEqual([
        { recordId: CONNECTION, secret: SEALED_ON_ONE, sealed: true },
      ]);
    });

    it("uses the primary key as the record id, which the envelope is bound to", async () => {
      database.answers({ rows: [{ id: CONNECTION, credentials_encrypted: SEALED_ON_ONE }] });

      const [record] = await store.pending(WORKSPACE, 2);

      expect(record.recordId).toBe(CONNECTION);
    });

    it("reports nothing for a workspace with no sealed credentials", async () => {
      // The expected steady state, and the answer for every workspace today: nothing writes
      // a provider credential until AD.2 (#223).
      await expect(store.pending(WORKSPACE, 1)).resolves.toEqual([]);
    });
  });

  describe("store", () => {
    it("writes the new envelope onto the row it was reported for", async () => {
      await store.store(
        { recordId: CONNECTION, secret: SEALED_ON_ONE, sealed: true },
        SEALED_ON_TWO,
      );

      const [statement] = database.statements;
      expect(statement.sql).toContain('update "ouroboros"."provider_connections"');
      expect(statement.parameters).toEqual([SEALED_ON_TWO, CONNECTION, SEALED_ON_ONE]);
    });

    it("writes only while the row still holds what pending saw", async () => {
      // The sweep runs detached and AD.2's credential lifecycle can rewrite a connection's
      // key at any moment. Re-sealing the value that write replaced would resurrect a
      // superseded credential; the conditional makes that write a no-op and leaves the row
      // for the next sweep.
      await store.store(
        { recordId: CONNECTION, secret: SEALED_ON_ONE, sealed: true },
        SEALED_ON_TWO,
      );

      expect(database.statements[0].sql).toContain('"credentials_encrypted" = $3');
    });

    it("scopes the write to one row", async () => {
      await store.store(
        { recordId: CONNECTION, secret: SEALED_ON_ONE, sealed: true },
        SEALED_ON_TWO,
      );

      expect(database.statements[0].sql).toContain('"id" = $2');
      expect(database.statements).toHaveLength(1);
    });
  });
});
