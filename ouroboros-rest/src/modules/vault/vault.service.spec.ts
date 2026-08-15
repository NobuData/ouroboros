import { KEY_BYTES, isEnvelope, parseEnvelope } from "./envelope";
import { MASTER_WRAPPER_ID } from "./master.key.wrapper";
import { VaultCryptoError, VaultKeyError } from "./vault.errors";
import {
  OTHER_WORKSPACE,
  WORKSPACE,
  inMemoryVault,
  masterKey,
  randomSecret,
  wrapperWith,
  type InMemoryVault,
} from "./vault.fixture";

/**
 * The vault, through the vocabulary a caller uses — a workspace, a record and a secret.
 *
 * This is where [#222](https://github.com/NobuData/ouroboros/issues/222)'s acceptance
 * criteria are asserted as the issue words them, over the real cipher and the real
 * `MasterKeyWrapper`: **round-trip**, **tamper**, **AAD binding across tenants and records**,
 * **rotation leaves old data readable**, and **a KEK re-wrap changes zero data ciphertexts**.
 * The last one is the negative criterion and is asserted byte-for-byte rather than by a
 * round-trip, because a round-trip would also pass if every ciphertext had been rewritten.
 *
 * `tenant_keys` is in memory here (`vault.fixture.ts`); `vault.repository.spec.ts` holds the
 * SQL to account and `vault.integration-spec.ts` runs the whole thing against PostgreSQL.
 */

const RECORD = "connection-anthropic";
const OTHER_RECORD = "connection-openai";

/** A credential shaped like the one mockup 07 shows being pasted in. */
const SECRET = "sk-ant-api03-0000000000000000000000000000000000";

describe("sealing and opening a credential", () => {
  let vault: InMemoryVault;

  beforeEach(() => {
    vault = inMemoryVault();
  });

  it("round-trips a secret", async () => {
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    expect(await vault.vault.decryptText(WORKSPACE, RECORD, envelope)).toBe(SECRET);
  });

  it.each([
    ["an API key", Buffer.from(SECRET, "utf8")],
    ["an empty secret", Buffer.alloc(0)],
    ["a PEM-sized credential", randomSecret(3200)],
    ["bytes that are not text", Buffer.from([0xff, 0x00, 0x80, 0xc0])],
  ])("round-trips %s", async (_description, plaintext) => {
    // Every record type a provider connection might hold: a key, an absent value, a service
    // account file, a DER blob. The last one is why the API speaks in buffers at all.
    const envelope = await vault.vault.encrypt(WORKSPACE, RECORD, plaintext);

    expect(await vault.vault.decrypt(WORKSPACE, RECORD, envelope)).toEqual(plaintext);
  });

  it("stores something that does not contain the secret", async () => {
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    expect(envelope).not.toContain(SECRET);
    expect(envelope).not.toContain(Buffer.from(SECRET, "utf8").toString("base64url"));
  });

  it("stores a self-describing envelope naming the key version", async () => {
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    expect(isEnvelope(envelope)).toBe(true);
    expect(parseEnvelope(envelope).version).toBe(1);
  });

  it("seals the same secret twice to different ciphertext", async () => {
    const first = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    const second = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    expect(first).not.toBe(second);
  });
});

describe("the per-workspace key", () => {
  it("is created lazily, on the workspace's first secret", async () => {
    const vault = inMemoryVault();

    expect(await vault.keys.activeKey(WORKSPACE)).toBeUndefined();

    await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    // A key generated for a workspace that never stores anything is key material with no
    // purpose that every backup would then carry.
    expect((await vault.keys.activeKey(WORKSPACE))?.version).toBe(1);
    expect(await vault.keys.activeKey(OTHER_WORKSPACE)).toBeUndefined();
  });

  it("is one key per workspace, not one per record", async () => {
    const vault = inMemoryVault();

    await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    await vault.vault.encryptText(WORKSPACE, OTHER_RECORD, SECRET);

    expect(vault.keys.all().filter((row) => row.organization_id === WORKSPACE)).toHaveLength(1);
  });

  it("is different for every workspace", async () => {
    const vault = inMemoryVault();

    await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    await vault.vault.encryptText(OTHER_WORKSPACE, RECORD, SECRET);

    const [first, second] = vault.keys.all();

    expect(first.sealed_dek).not.toEqual(second.sealed_dek);
  });

  it("is stored sealed, stamped with the backend that sealed it", async () => {
    const vault = inMemoryVault();
    await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    const row = await vault.keys.activeKey(WORKSPACE);

    expect(row?.wrapper).toBe(MASTER_WRAPPER_ID);
    expect(row?.sealed_dek.byteLength).toBeGreaterThan(KEY_BYTES);
    expect(row?.status).toBe("active");
    expect(row?.rotated_at).toBeNull();
  });

  it("is adopted rather than duplicated when two first writes race", async () => {
    // Two requests storing a workspace's first secret at the same moment both find no key.
    // The database arbitrates; the loser adopts the winner's key rather than failing a
    // request that did nothing wrong.
    const vault = inMemoryVault();

    const [first, second] = await Promise.all([
      vault.vault.encryptText(WORKSPACE, RECORD, SECRET),
      vault.vault.encryptText(WORKSPACE, OTHER_RECORD, SECRET),
    ]);

    expect(vault.keys.all()).toHaveLength(1);
    expect(await vault.vault.decryptText(WORKSPACE, RECORD, first)).toBe(SECRET);
    expect(await vault.vault.decryptText(WORKSPACE, OTHER_RECORD, second)).toBe(SECRET);
  });
});

describe("tampering with a stored ciphertext", () => {
  let vault: InMemoryVault;
  let envelope: string;

  beforeEach(async () => {
    vault = inMemoryVault();
    envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
  });

  // The issue's criterion in its own words: *a single bit flipped in the ciphertext produces
  // an authentication failure, not garbage plaintext*.
  it("fails authentication rather than returning garbage", async () => {
    const fields = envelope.split(".");
    const body = Buffer.from(fields[4], "base64url");
    body[0] ^= 0x01;
    fields[4] = body.toString("base64url");

    await expect(vault.vault.decryptText(WORKSPACE, RECORD, fields.join("."))).rejects.toThrow(
      VaultCryptoError,
    );
  });

  it("fails for a truncated value, which is what a shortened column looks like", async () => {
    await expect(
      vault.vault.decryptText(WORKSPACE, RECORD, envelope.slice(0, envelope.length - 8)),
    ).rejects.toThrow(VaultCryptoError);
  });

  it("fails for a value that was never an envelope", async () => {
    await expect(vault.vault.decryptText(WORKSPACE, RECORD, SECRET)).rejects.toThrow(
      VaultCryptoError,
    );
  });

  it("never names the secret or the ciphertext in the failure", async () => {
    await expect(vault.vault.decryptText(WORKSPACE, RECORD, envelope + "AA")).rejects.not.toThrow(
      new RegExp(envelope.slice(-16)),
    );
  });
});

describe("moving a ciphertext somewhere it does not belong", () => {
  // The AAD-binding criterion: *a ciphertext moved between tenants (or between records) fails
  // to decrypt*. Both directions are asserted, because binding only the tenant would leave a
  // workspace's own administrator able to read one connection's key through another's record.
  it("refuses a ciphertext pasted into another workspace's row", async () => {
    const vault = inMemoryVault();
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    // Give the other workspace a key of its own, so the failure is the binding rather than a
    // missing key — the weaker outcome that would pass a carelessly written test.
    await vault.vault.encryptText(OTHER_WORKSPACE, RECORD, "another secret entirely");

    await expect(vault.vault.decryptText(OTHER_WORKSPACE, RECORD, envelope)).rejects.toThrow(
      VaultCryptoError,
    );
  });

  it("refuses a ciphertext pasted into another record of the same workspace", async () => {
    const vault = inMemoryVault();
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    await expect(vault.vault.decryptText(WORKSPACE, OTHER_RECORD, envelope)).rejects.toThrow(
      VaultCryptoError,
    );
  });

  it("refuses a ciphertext from a deployment with a different master key", async () => {
    const theirs = inMemoryVault({ key: masterKey(1) });
    const ours = inMemoryVault({ key: masterKey(2) });
    const envelope = await theirs.vault.encryptText(WORKSPACE, RECORD, SECRET);

    // Their sealed DEK copied into our table, which is what restoring the wrong backup does.
    const row = await theirs.keys.activeKey(WORKSPACE);
    await ours.keys.createFirstVersion({
      organization_id: WORKSPACE,
      version: 1,
      sealed_dek: row?.sealed_dek ?? Buffer.alloc(0),
      wrapper: row?.wrapper ?? MASTER_WRAPPER_ID,
    });

    await expect(ours.vault.decryptText(WORKSPACE, RECORD, envelope)).rejects.toThrow(
      VaultCryptoError,
    );
  });
});

describe("a key this deployment does not hold", () => {
  it("is reported as a key problem, not as tampering", async () => {
    // The distinction matters to whoever reads the log: a ciphertext that fails to
    // authenticate sends somebody looking for an attacker, and a missing key version is a
    // database restored without `tenant_keys`.
    const vault = inMemoryVault();
    const envelope = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    const forVersionNine = envelope.replace("ouro.v1.1.", "ouro.v1.9.");

    await expect(vault.vault.decryptText(WORKSPACE, RECORD, forVersionNine)).rejects.toThrow(
      VaultKeyError,
    );
  });
});

describe("rotating a workspace's key", () => {
  let vault: InMemoryVault;
  let before: string;

  beforeEach(async () => {
    vault = inMemoryVault();
    before = await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
  });

  it("makes a new version active and retires its predecessor", async () => {
    expect(await vault.vault.rotate(WORKSPACE)).toBe(2);

    const rows = await vault.keys.allKeys(WORKSPACE);

    expect(rows.map((row) => [row.version, row.status])).toEqual([
      [1, "retired"],
      [2, "active"],
    ]);
    expect(rows[0].rotated_at).not.toBeNull();
    expect(rows[1].rotated_at).toBeNull();
  });

  // The criterion: *DEK rotation leaves existing data readable while new writes use the new
  // version*. Both halves, in one test, because either alone would pass a broken
  // implementation.
  it("leaves existing data readable and puts new writes on the new version", async () => {
    await vault.vault.rotate(WORKSPACE);

    expect(await vault.vault.decryptText(WORKSPACE, RECORD, before)).toBe(SECRET);
    expect(parseEnvelope(before).version).toBe(1);

    const after = await vault.vault.encryptText(WORKSPACE, OTHER_RECORD, "written after");

    expect(parseEnvelope(after).version).toBe(2);
    expect(await vault.vault.decryptText(WORKSPACE, OTHER_RECORD, after)).toBe("written after");
  });

  it("uses a genuinely new key, not the old one re-sealed", async () => {
    const first = await vault.keys.activeKey(WORKSPACE);
    await vault.vault.rotate(WORKSPACE);
    const second = await vault.keys.activeKey(WORKSPACE);

    expect(second?.sealed_dek).not.toEqual(first?.sealed_dek);

    // And the ciphertexts really are under different keys: re-sealing the old value produces
    // a value the *old* key cannot be used to read.
    const resealed = await vault.vault.reseal(WORKSPACE, RECORD, before);
    expect(parseEnvelope(resealed).version).toBe(2);
    expect(await vault.vault.decryptText(WORKSPACE, RECORD, resealed)).toBe(SECRET);
  });

  it("survives several rotations, with every generation still readable", async () => {
    const sealed = [before];

    for (let round = 0; round < 3; round += 1) {
      await vault.vault.rotate(WORKSPACE);
      sealed.push(await vault.vault.encryptText(WORKSPACE, RECORD, SECRET));
    }

    expect(await vault.vault.activeVersion(WORKSPACE)).toBe(4);

    for (const envelope of sealed) {
      expect(await vault.vault.decryptText(WORKSPACE, RECORD, envelope)).toBe(SECRET);
    }
  });

  it("refuses to rotate a workspace that has never stored a secret", async () => {
    // There is nothing to re-encrypt, and creating a key here would leave a version 1 that
    // had never sealed anything — which the sweep would then dutifully find nothing for.
    await expect(vault.vault.rotate(OTHER_WORKSPACE)).rejects.toThrow(/never stored a secret/);
  });

  it("re-seals a value that is already current, harmlessly", async () => {
    const resealed = await vault.vault.reseal(WORKSPACE, RECORD, before);

    expect(resealed).not.toBe(before);
    expect(parseEnvelope(resealed).version).toBe(1);
    expect(await vault.vault.decryptText(WORKSPACE, RECORD, resealed)).toBe(SECRET);
  });
});

describe("re-wrapping the key-encryption key", () => {
  /**
   * A workspace with several records and two key generations — the state a real re-wrap
   * finds, rather than the one-row case that would pass whatever the implementation did.
   *
   * @param vault - The vault to seed.
   * @returns Every stored envelope, by record id.
   */
  async function seed(vault: InMemoryVault): Promise<Map<string, string>> {
    const stored = new Map<string, string>();

    stored.set(RECORD, await vault.vault.encryptText(WORKSPACE, RECORD, SECRET));
    await vault.vault.rotate(WORKSPACE);
    stored.set(OTHER_RECORD, await vault.vault.encryptText(WORKSPACE, OTHER_RECORD, "second"));
    stored.set("elsewhere", await vault.vault.encryptText(OTHER_WORKSPACE, RECORD, "third"));

    return stored;
  }

  // **The acceptance criterion this whole design exists for**, and it is a negative one:
  // *KEK re-wrap changes zero data ciphertexts — verified byte-for-byte*. Asserted as byte
  // equality rather than by decrypting and comparing, because a re-wrap that had quietly
  // re-encrypted everything would pass the second test and fail this one.
  it("changes every sealed key and not one data ciphertext", async () => {
    // The custody the rows were sealed under, and the custody they are moving to. Two
    // different master keys is what makes this the AF.3 shape rather than a no-op: the
    // vault's configured wrapper holds the *new* key, and the *old* one is handed to
    // `rewrap` so the rows can be opened one last time.
    const departing = wrapperWith(masterKey(1));
    const original = inMemoryVault({ key: masterKey(1) });
    const stored = await seed(original);

    // The same database, read by a deployment configured with the new master key — which is
    // exactly what an operator has on the morning of a custody migration.
    const arriving = inMemoryVault({ key: masterKey(2) });
    for (const row of original.keys.all()) {
      arriving.keys.seed(row);
    }

    const before = new Map(stored);
    const sealedBefore = new Map(
      arriving.keys
        .all()
        .map((row) => [`${row.organization_id} ${row.version.toString()}`, row.sealed_dek]),
    );

    expect(await arriving.vault.rewrap(WORKSPACE, departing)).toBe(2);

    // Every sealed key for the converted workspace is different…
    for (const row of await arriving.keys.allKeys(WORKSPACE)) {
      expect(row.sealed_dek).not.toEqual(
        sealedBefore.get(`${row.organization_id} ${row.version.toString()}`),
      );
      expect(row.wrapper).toBe(MASTER_WRAPPER_ID);
    }

    // …and not one stored envelope moved. Byte equality, not a round-trip: a re-wrap that
    // had quietly re-encrypted the data would pass a round-trip and fail exactly here.
    for (const [recordId, envelope] of stored) {
      expect(envelope).toBe(before.get(recordId));
    }

    // The data really is still openable under the new custody, which is the other half of
    // "no migration was needed".
    expect(await arriving.vault.decryptText(WORKSPACE, RECORD, stored.get(RECORD) ?? "")).toBe(
      SECRET,
    );
  });

  it("leaves every generation of ciphertext readable afterwards", async () => {
    const vault = inMemoryVault({ key: masterKey(1) });
    const stored = await seed(vault);

    await vault.vault.rewrap(WORKSPACE, wrapperWith(masterKey(1)));

    expect(await vault.vault.decryptText(WORKSPACE, RECORD, stored.get(RECORD) ?? "")).toBe(SECRET);
    expect(
      await vault.vault.decryptText(WORKSPACE, OTHER_RECORD, stored.get(OTHER_RECORD) ?? ""),
    ).toBe("second");
  });

  it("converts every version, not only the active one", async () => {
    // A half-converted workspace is one whose older ciphertext is readable only through the
    // backend the operator believes has been decommissioned.
    const vault = inMemoryVault();
    await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);
    await vault.vault.rotate(WORKSPACE);
    await vault.vault.rotate(WORKSPACE);

    const before = vault.keys.all().map((row) => Buffer.from(row.sealed_dek));

    expect(await vault.vault.rewrap(WORKSPACE)).toBe(3);

    for (const [index, row] of (await vault.keys.allKeys(WORKSPACE)).entries()) {
      expect(row.sealed_dek).not.toEqual(before[index]);
    }
  });

  it("does nothing, and does not fail, for a workspace with no keys", async () => {
    // Most workspaces in an installation have never stored a secret, and a custody migration
    // that threw on the first one of them would stop at the first row of `organization`.
    expect(await inMemoryVault().vault.rewrap(OTHER_WORKSPACE)).toBe(0);
  });

  it("refuses rather than half-converting when it cannot open a row", async () => {
    const vault = inMemoryVault({ key: masterKey(1) });
    await vault.vault.encryptText(WORKSPACE, RECORD, SECRET);

    await expect(vault.vault.rewrap(WORKSPACE, wrapperWith(masterKey(9)))).rejects.toThrow(
      VaultCryptoError,
    );
  });
});
