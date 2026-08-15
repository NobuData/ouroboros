import type { AppConfigService } from "../config/config.service";
import { KEY_BYTES, isEnvelope, zeroize } from "./envelope";
import type { DekIdentity, SealedKey } from "./key.wrapper";
import { MASTER_WRAPPER_ID, MasterKeyWrapper } from "./master.key.wrapper";
import { masterKey, wrapperWith } from "./vault.fixture";
import { VaultCryptoError, VaultKeyError } from "./vault.errors";

/**
 * The MVP's key custody, on its own.
 *
 * What is being asserted here is not "AES works" — `envelope.spec.ts` covers the cipher —
 * but the three things this class is responsible for: that it **holds no key material in the
 * clear** where a caller could reach it, that a sealed key is **bound to the row it belongs
 * to** so it cannot be moved between workspaces or versions, and that it **says which backend
 * sealed a row it cannot open**, which is the diagnostic AF.3
 * ([#236](https://github.com/NobuData/ouroboros/issues/236)) will depend on.
 */

const WORKSPACE = "org-wrapper";
const IDENTITY: DekIdentity = { organizationId: WORKSPACE, version: 1 };

/** A data-encryption key, of the size the wrapper requires. */
function dek(fill = 9): Buffer {
  return Buffer.alloc(KEY_BYTES, fill);
}

describe("constructing the wrapper", () => {
  it("accepts a 32-byte key in either base64 alphabet", () => {
    expect(() => wrapperWith(masterKey())).not.toThrow();
    expect(() => wrapperWith(Buffer.alloc(KEY_BYTES, 250).toString("base64url"))).not.toThrow();
  });

  // The second of the two validations — `configuration.ts` is the first, and is where an
  // operator gets the legible message. This one holds when the class is constructed by
  // something other than the configured application: a test, or AF.3 instantiating the
  // *previous* wrapper by hand to migrate away from it.
  it.each([
    ["31 bytes", Buffer.alloc(KEY_BYTES - 1, 1).toString("base64")],
    ["33 bytes", Buffer.alloc(KEY_BYTES + 1, 1).toString("base64")],
    ["nothing at all", ""],
  ])("refuses %s rather than stretching it", (_description, key) => {
    expect(() => wrapperWith(key)).toThrow(VaultKeyError);
  });

  it("names the variable and the requirement, and never the value", () => {
    const key = Buffer.from("s3cr3t-but-only-thirty-one-byte", "utf8").toString("base64");

    try {
      new MasterKeyWrapper({ vaultMasterKey: key } as unknown as AppConfigService);
      throw new Error("expected construction to fail");
    } catch (error) {
      expect((error as Error).message).toContain("OURO_VAULT_MASTER_KEY");
      expect((error as Error).message).toContain("32 bytes");
      expect((error as Error).message).not.toContain("s3cr3t");
      expect((error as Error).message).not.toContain(key);
    }
  });

  it("stamps rows with an identifier that must never change", () => {
    // It is written into `tenant_keys.wrapper`. A release that changed it would orphan every
    // row sealed by an earlier one — unreadable not because the key was wrong but because
    // nothing would admit to being able to open them.
    expect(wrapperWith(masterKey()).id).toBe("env-master");
    expect(MASTER_WRAPPER_ID).toBe("env-master");
  });
});

describe("sealing a data-encryption key", () => {
  it("round-trips the key", async () => {
    const wrapper = wrapperWith(masterKey());
    const key = dek();

    const sealed = await wrapper.wrap(key, IDENTITY);

    expect(await wrapper.unwrap(sealed, IDENTITY)).toEqual(key);
  });

  it("stores no key material in the clear", async () => {
    const wrapper = wrapperWith(masterKey());
    const key = dek(0xab);

    const sealed = await wrapper.wrap(key, IDENTITY);

    expect(sealed.material).not.toContain(key);
    expect(sealed.material.toString("utf8")).not.toContain(key.toString("base64url"));
    expect(sealed.material.includes(key)).toBe(false);
  });

  it("stamps what sealed it, and frames it as the module's own envelope", async () => {
    const sealed = await wrapperWith(masterKey()).wrap(dek(), { ...IDENTITY, version: 4 });

    expect(sealed.wrapper).toBe(MASTER_WRAPPER_ID);
    expect(isEnvelope(sealed.material.toString("utf8"))).toBe(true);
    expect(sealed.material.toString("utf8")).toContain("ouro.v1.4.");
  });

  it("seals the same key differently every time", async () => {
    const wrapper = wrapperWith(masterKey());
    const key = dek();

    const first = await wrapper.wrap(key, IDENTITY);
    const second = await wrapper.wrap(key, IDENTITY);

    expect(first.material).not.toEqual(second.material);
  });

  it.each([31, 33, 0])("refuses to seal a %s-byte key", async (size) => {
    await expect(wrapperWith(masterKey()).wrap(Buffer.alloc(size, 1), IDENTITY)).rejects.toThrow(
      VaultKeyError,
    );
  });

  it("does not consume the key it was given", async () => {
    // The caller owns the DEK's lifetime and zeroizes it; a wrapper that cleared the buffer
    // itself would break the caller that seals one key into two rows during a re-wrap.
    const wrapper = wrapperWith(masterKey());
    const key = dek(5);

    await wrapper.wrap(key, IDENTITY);

    expect(key).toEqual(dek(5));
  });
});

describe("the binding on a sealed key", () => {
  // The same swap-prevention credential ciphertext gets, one level up: a `sealed_dek` copied
  // from one workspace's row into another's must fail rather than hand that workspace
  // somebody else's key.
  it("refuses a sealed key moved to another workspace", async () => {
    const wrapper = wrapperWith(masterKey());
    const sealed = await wrapper.wrap(dek(), IDENTITY);

    await expect(
      wrapper.unwrap(sealed, { organizationId: "org-somebody-else", version: 1 }),
    ).rejects.toThrow(VaultCryptoError);
  });

  it("refuses a sealed key moved to another version of the same workspace", async () => {
    const wrapper = wrapperWith(masterKey());
    const sealed = await wrapper.wrap(dek(), { organizationId: WORKSPACE, version: 2 });

    // Caught by the version stamp inside the sealed material before the cipher is reached,
    // which is the more useful of the two failures: it says a writer stored a key under the
    // wrong version rather than reporting something that reads as tampering.
    await expect(wrapper.unwrap(sealed, { organizationId: WORKSPACE, version: 3 })).rejects.toThrow(
      VaultKeyError,
    );
  });

  it("refuses a sealed key from another deployment's master key", async () => {
    const sealed = await wrapperWith(masterKey(1)).wrap(dek(), IDENTITY);

    await expect(wrapperWith(masterKey(2)).unwrap(sealed, IDENTITY)).rejects.toThrow(
      VaultCryptoError,
    );
  });

  it("names the backend when a row was sealed by another one", async () => {
    // AF.3's diagnostic: a deployment reading rows sealed by a backend it is not configured
    // for should be told which backend, not handed something that reads as data corruption.
    const wrapper = wrapperWith(masterKey());
    const foreign: SealedKey = { wrapper: "aws-kms", material: Buffer.from("opaque blob") };

    await expect(wrapper.unwrap(foreign, IDENTITY)).rejects.toThrow(VaultKeyError);
    await expect(wrapper.unwrap(foreign, IDENTITY)).rejects.toThrow(/aws-kms/);
    await expect(wrapper.unwrap(foreign, IDENTITY)).rejects.toThrow(/env-master/);
  });

  it("fails authentication for a single flipped bit in the sealed material", async () => {
    const wrapper = wrapperWith(masterKey());
    const sealed = await wrapper.wrap(dek(), IDENTITY);

    // The material is the envelope as text; flipping a byte of the base64 payload is what a
    // corrupted `bytea` column looks like.
    const altered = Buffer.from(sealed.material);
    const target = altered.byteLength - 5;
    altered[target] = altered[target] === 65 ? 66 : 65;

    await expect(
      wrapper.unwrap({ wrapper: sealed.wrapper, material: altered }, IDENTITY),
    ).rejects.toThrow(VaultCryptoError);
  });
});

describe("re-wrapping under the same backend", () => {
  it("produces different material for the same key", async () => {
    const wrapper = wrapperWith(masterKey());
    const key = dek(0x3c);
    const sealed = await wrapper.wrap(key, IDENTITY);

    const resealed = await wrapper.rewrap(sealed, IDENTITY);

    expect(resealed.material).not.toEqual(sealed.material);
    expect(resealed.wrapper).toBe(MASTER_WRAPPER_ID);
    expect(await wrapper.unwrap(resealed, IDENTITY)).toEqual(key);
  });

  it("never returns the plaintext key", async () => {
    const wrapper = wrapperWith(masterKey());
    const key = dek(0x11);
    const resealed = await wrapper.rewrap(await wrapper.wrap(key, IDENTITY), IDENTITY);

    expect(resealed.material.includes(key)).toBe(false);
  });

  it("still refuses a row it cannot open", async () => {
    const wrapper = wrapperWith(masterKey(1));
    const sealed = await wrapperWith(masterKey(2)).wrap(dek(), IDENTITY);

    await expect(wrapper.rewrap(sealed, IDENTITY)).rejects.toThrow(VaultCryptoError);
  });
});

describe("what a caller gets back", () => {
  it("hands out a key the caller owns and can zeroize", async () => {
    // The contract `VaultService.withDek` depends on: the buffer is the caller's, and
    // overwriting it does not disturb the wrapper's own state.
    const wrapper = wrapperWith(masterKey());
    const sealed = await wrapper.wrap(dek(0x77), IDENTITY);

    const first = await wrapper.unwrap(sealed, IDENTITY);
    zeroize(first);

    expect(first).toEqual(Buffer.alloc(KEY_BYTES));
    expect(await wrapper.unwrap(sealed, IDENTITY)).toEqual(dek(0x77));
  });
});
