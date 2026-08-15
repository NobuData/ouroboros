/**
 * The credential vault — the one place in Ouroboros that encrypts a secret.
 *
 * AD.1 ([#222](https://github.com/NobuData/ouroboros/issues/222)) and roadmap decision
 * **P2**. Mockup 07's security strip claims credentials are *"sealed per-tenant with
 * envelope encryption (AES-256-GCM)"*; this service is what makes that sentence true rather
 * than aspirational, and it exists as one service specifically so that the three roadmaps
 * that need it — Q.1 ticket sources ([#138](https://github.com/NobuData/ouroboros/issues/138)),
 * K.3 GitHub credentials ([#101](https://github.com/NobuData/ouroboros/issues/101)) and Y.1
 * providers ([#189](https://github.com/NobuData/ouroboros/issues/189)) — share one
 * implementation instead of three ad-hoc helpers.
 *
 * ```
 * secret ──encrypt(tenant, record)──▶ envelope string, stored in the consumer's column
 *   ▲                                       │
 *   │                                       │ AES-256-GCM, 96-bit nonce
 *   │                                       │ AAD = tenant id + record id
 *   └───────────── per-tenant DEK ──────────┘
 *                        │
 *                        │ wrap / unwrap
 *                        ▼
 *                   KeyWrapper ──▶ OURO_VAULT_MASTER_KEY  (MVP)
 *                              ─ ▶ AWS/GCP KMS, Vault      (AF.3, #236)
 *                        │
 *                        ▼
 *              ouroboros.tenant_keys (sealed DEK · version · rotated_at)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Three properties, and where each one actually comes from.**
 *
 *   * **A ciphertext cannot be moved.** The AAD binds the workspace id and the record id, so
 *     a value lifted from one tenant's row and pasted into another's fails authentication
 *     rather than decrypting into somebody else's key. `envelope.ts`'s length-prefixed
 *     encoding is what makes that hold for *every* pair of identifiers rather than for the
 *     ones that happen not to contain a separator.
 *   * **Deleting a workspace destroys its secrets.** `tenant_keys` cascades from
 *     `organization`, so the DEK goes with the workspace and every ciphertext sealed by it —
 *     in live rows and in every backup — becomes unopenable. This service holds **no key
 *     cache**, which is not an oversight but the condition that claim depends on: a DEK
 *     living in a process after its row was deleted is a window in which the shred has not
 *     happened.
 *   * **Custody can be upgraded without a data migration.** {@link VaultService.rewrap} is
 *     the whole of it, and its test asserts the property directly — every data ciphertext
 *     byte-identical, every sealed key different.
 *
 * ---------------------------------------------------------------------------
 * **No DEK cache, stated as a decision because it is a visible cost.** Every encrypt and
 * every decrypt unwraps the workspace's key and zeroizes it in a `finally`. Under the
 * environment-master wrapper that is one in-memory AES operation, which is not worth
 * caching. Under an AF.3 KMS wrapper it is a network call per operation, and that is a real
 * price — one AF.3 should pay deliberately, with a bounded cache whose eviction it can
 * argue about, rather than one inherited from a decision made here for a wrapper that did
 * not need it. The property being protected in the meantime is the second bullet above.
 *
 * ---------------------------------------------------------------------------
 * **Handling discipline.** Plaintext lives in a `Buffer` for the duration of one call and is
 * zeroized in a `finally`. The `…Text` convenience methods take and return `string`s, which
 * **cannot be zeroized** — JavaScript strings are immutable and the runtime may have copied
 * one anywhere — so they document the weaker guarantee rather than implying the stronger
 * one. Nothing here logs; `no-secret-logging.mjs` is the lint rule that keeps it that way,
 * and `redaction.spec.ts` is the test that proves it.
 */

import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";

import {
  KEY_BYTES,
  canonicalAad,
  formatEnvelope,
  open,
  parseEnvelope,
  seal,
  zeroize,
} from "./envelope";
import { KEY_WRAPPER, type DekIdentity, type KeyWrapper, type SealedKey } from "./key.wrapper";
import { VaultKeyError } from "./vault.errors";
import { FIRST_VERSION, VaultRepository } from "./vault.repository";

/**
 * The domain separator in a credential ciphertext's additional authenticated data.
 *
 * Distinct from `WRAP_AAD_CONTEXT`, which binds sealed *keys* — the two describe different
 * things sealed with different keys, and sharing a prefix would let a future encoding
 * mistake produce the same bytes for both.
 */
export const DATA_AAD_CONTEXT = "ouro-vault:v1";

/**
 * A workspace's key, opened, together with the version it is.
 *
 * Returned by {@link VaultService.withDek} to its callback and **never** returned from a
 * public method: a caller that could hold one could hold it past the request that needed it,
 * which is the state the crypto-shredding guarantee is written against.
 */
interface OpenedKey {
  /** Which version this is — what goes into the envelope of anything sealed with it. */
  readonly version: number;
  /** The 32-byte key. Valid only for the duration of the callback. */
  readonly dek: Buffer;
}

@Injectable()
export class VaultService {
  /**
   * @param keys - Statements against `ouroboros.tenant_keys`.
   * @param wrapper - The configured key custody. Injected by token so AF.3 swaps a KMS
   *   implementation in by changing one `provide` — see `key.wrapper.ts`.
   */
  constructor(
    private readonly keys: VaultRepository,
    @Inject(KEY_WRAPPER) private readonly wrapper: KeyWrapper,
  ) {}

  /**
   * The binding a credential ciphertext is authenticated against.
   *
   * @param organizationId - The workspace the record belongs to.
   * @param recordId - What the secret is attached to — a provider connection id, a ticket
   *   source id. The caller decides what it is and must derive the same value on the way
   *   back out; anything less stable than a primary key makes a record undecryptable the day
   *   it changes.
   * @returns The additional authenticated data.
   */
  private aad(organizationId: string, recordId: string): Buffer {
    return canonicalAad(DATA_AAD_CONTEXT, organizationId, recordId);
  }

  /**
   * Run `work` with a workspace's key open, and overwrite it afterwards whatever happens.
   *
   * The only path by which a decrypted DEK exists in this process, so the `finally` is the
   * only zeroization that has to be right. `work` must not retain the buffer: it is
   * overwritten before this method returns, and a caller holding it would find its own key
   * full of zeros — which is the failure mode being chosen deliberately over the silent one.
   *
   * @param sealed - The stored key row's material and wrapper.
   * @param identity - The workspace and version, authenticated by the wrapper.
   * @param work - What to do while the key is open.
   * @returns Whatever `work` resolved to.
   */
  private async withDek<T>(
    sealed: SealedKey,
    identity: DekIdentity,
    work: (opened: OpenedKey) => T | Promise<T>,
  ): Promise<T> {
    let dek: Buffer | undefined;

    try {
      dek = await this.wrapper.unwrap(sealed, identity);
      return await work({ version: identity.version, dek });
    } finally {
      zeroize(dek);
    }
  }

  /**
   * Generate a workspace's first key, or adopt the one a concurrent request just created.
   *
   * Lazy by design: a workspace gets a key the first time it stores a secret, so an
   * installation's `tenant_keys` holds keys for the workspaces that have credentials and not
   * for the ones that do not. Key material with no purpose is still key material every
   * backup carries.
   *
   * @param organizationId - The workspace.
   * @returns Its active key row's sealed material and version.
   */
  private async createKey(organizationId: string): Promise<{ sealed: SealedKey; version: number }> {
    let dek: Buffer | undefined;

    try {
      // From the CSPRNG, per workspace. Never derived from the workspace id or from the KEK:
      // a derived key would make "destroy the DEK" impossible — the inputs would still exist.
      dek = randomBytes(KEY_BYTES);

      const identity: DekIdentity = { organizationId, version: FIRST_VERSION };
      const wrapped = await this.wrapper.wrap(dek, identity);

      const row = await this.keys.createFirstVersion({
        organization_id: organizationId,
        version: FIRST_VERSION,
        sealed_dek: wrapped.material,
        wrapper: wrapped.wrapper,
      });

      // The row that came back may be the one another request inserted, in which case the key
      // just generated is discarded — which is why it is read back rather than assumed.
      return {
        sealed: { wrapper: row.wrapper, material: row.sealed_dek },
        version: row.version,
      };
    } finally {
      zeroize(dek);
    }
  }

  /**
   * The workspace's active key, creating it if this is the workspace's first secret.
   *
   * @param organizationId - The workspace.
   * @returns Its sealed active key and that key's version.
   */
  private async activeKey(organizationId: string): Promise<{ sealed: SealedKey; version: number }> {
    const row = await this.keys.activeKey(organizationId);

    if (row === undefined) {
      return this.createKey(organizationId);
    }

    return { sealed: { wrapper: row.wrapper, material: row.sealed_dek }, version: row.version };
  }

  /**
   * Which key version this workspace's new writes are sealed under.
   *
   * Exposed for the rotation sweep, which needs to know what "already current" means before
   * it re-encrypts anything, and for tests. Creates the workspace's key if it has none, so
   * the answer is always a version that exists.
   *
   * @param organizationId - The workspace.
   * @returns The active version number.
   */
  async activeVersion(organizationId: string): Promise<number> {
    return (await this.activeKey(organizationId)).version;
  }

  /**
   * Seal a secret for one record of one workspace.
   *
   * @param organizationId - The workspace. Bound into the ciphertext.
   * @param recordId - The record the secret belongs to. Bound into the ciphertext, so the
   *   value cannot be moved to another record even inside the same workspace.
   * @param plaintext - The secret. Zeroized here if it is a `Buffer`; see this file's header
   *   on why a `string` cannot be.
   * @returns The envelope string to store — `ouro.v1.<version>.<nonce>.<ciphertext>`.
   */
  async encrypt(organizationId: string, recordId: string, plaintext: Buffer): Promise<string> {
    const { sealed, version } = await this.activeKey(organizationId);

    return this.withDek(sealed, { organizationId, version }, (opened) => {
      const bytes = seal(opened.dek, this.aad(organizationId, recordId), plaintext);
      return formatEnvelope(opened.version, bytes.nonce, bytes.ciphertext);
    });
  }

  /**
   * Seal a secret given as a string.
   *
   * A convenience for the common case — an API key arrives as JSON and is a `string` before
   * this service ever sees it. **The weaker guarantee**: the caller's string cannot be
   * zeroized, so the plaintext's lifetime is the garbage collector's business. The `Buffer`
   * this creates is zeroized.
   *
   * @param organizationId - The workspace.
   * @param recordId - The record.
   * @param plaintext - The secret, UTF-8.
   * @returns The envelope string to store.
   */
  async encryptText(organizationId: string, recordId: string, plaintext: string): Promise<string> {
    const bytes = Buffer.from(plaintext, "utf8");

    try {
      return await this.encrypt(organizationId, recordId, bytes);
    } finally {
      zeroize(bytes);
    }
  }

  /**
   * Open a sealed secret.
   *
   * The version comes from the envelope rather than from the workspace's current key, which
   * is what lets a rotation be additive: a value sealed under version 3 is still opened with
   * version 3 after version 4 became active.
   *
   * @param organizationId - The workspace. Must be the one the value was sealed for — this
   *   is the swap-prevention, and a mismatch is an authentication failure rather than a
   *   lookup miss.
   * @param recordId - The record the value was sealed for.
   * @param envelope - The stored envelope string.
   * @returns The plaintext. **The caller owns it** and should `zeroize` it when finished.
   * @throws {VaultCryptoError} If the value is not a well-formed envelope, or fails
   *   authentication — a flipped bit, a truncation, or a ciphertext moved between workspaces
   *   or records.
   * @throws {VaultKeyError} If this deployment does not hold the key version the envelope
   *   names.
   */
  async decrypt(organizationId: string, recordId: string, envelope: string): Promise<Buffer> {
    const parsed = parseEnvelope(envelope);
    const row = await this.keys.keyAt(organizationId, parsed.version);

    if (row === undefined) {
      // Deliberately not a crypto error: nothing is wrong with the data. This is a
      // deployment missing a key — a database restored without `tenant_keys`, or a workspace
      // whose rows outlived its key — and an operator should not go looking for tampering.
      throw new VaultKeyError(
        `vault: workspace ${organizationId} has no key at version ${parsed.version.toString()}`,
      );
    }

    return this.withDek(
      { wrapper: row.wrapper, material: row.sealed_dek },
      { organizationId, version: parsed.version },
      (opened) => open(opened.dek, this.aad(organizationId, recordId), parsed),
    );
  }

  /**
   * Open a sealed secret that was stored as text.
   *
   * The counterpart of {@link encryptText}, with the same weaker guarantee: the returned
   * `string` cannot be zeroized.
   *
   * @param organizationId - The workspace.
   * @param recordId - The record.
   * @param envelope - The stored envelope string.
   * @returns The plaintext, UTF-8.
   */
  async decryptText(organizationId: string, recordId: string, envelope: string): Promise<string> {
    const bytes = await this.decrypt(organizationId, recordId, envelope);

    try {
      return bytes.toString("utf8");
    } finally {
      zeroize(bytes);
    }
  }

  /**
   * Re-seal an existing value under the workspace's *current* key version.
   *
   * The operation both halves of rotation are made of: the lazy re-encrypt a consumer
   * performs when it happens to be writing a record anyway, and the sweep that finishes the
   * job for records nobody touched. Idempotent in effect — a value already on the active
   * version comes back re-sealed under the same version with a fresh nonce, which is
   * harmless and one round trip.
   *
   * @param organizationId - The workspace.
   * @param recordId - The record, which must be the one the value was sealed for.
   * @param envelope - The stored envelope string.
   * @returns A new envelope on the active version.
   */
  async reseal(organizationId: string, recordId: string, envelope: string): Promise<string> {
    const plaintext = await this.decrypt(organizationId, recordId, envelope);

    try {
      return await this.encrypt(organizationId, recordId, plaintext);
    } finally {
      zeroize(plaintext);
    }
  }

  /**
   * Begin a DEK rotation: make a new version active, leaving the old one readable.
   *
   * Returns as soon as the new version exists. Nothing is re-encrypted here, and that is the
   * design rather than a shortcut — re-encrypting inside the rotation would hold every
   * secret in the workspace in memory in one transaction, and would make a rotation's
   * duration a function of how many credentials the workspace has. What finishes the job is
   * `VaultRotation`: lazy re-encryption on write, and a sweep for everything else.
   *
   * @param organizationId - The workspace.
   * @returns The new active version number.
   * @throws If the workspace has no key to rotate, or if a concurrent rotation won the race
   *   — see `vault.repository.ts` on why the loser is told rather than quietly satisfied.
   */
  async rotate(organizationId: string): Promise<number> {
    const row = await this.keys.rotate(organizationId, async (version) => {
      let dek: Buffer | undefined;

      try {
        dek = randomBytes(KEY_BYTES);
        const wrapped = await this.wrapper.wrap(dek, { organizationId, version });
        return { sealed_dek: wrapped.material, wrapper: wrapped.wrapper };
      } finally {
        zeroize(dek);
      }
    });

    return row.version;
  }

  /**
   * Move a workspace's keys to the configured custody backend, touching no data ciphertext.
   *
   * **The acceptance criterion this method exists for is a negative one**: after it runs,
   * every credential ciphertext in the database is byte-identical. It rewrites `sealed_dek`
   * and `wrapper` on the `tenant_keys` rows and nothing else, which is why AF.3's KMS and
   * Vault backends arrive with no data migration at all.
   *
   * Every version is converted, not only the active one: a half-converted workspace is one
   * whose older ciphertext is readable only through the backend being decommissioned.
   *
   * @param organizationId - The workspace.
   * @param previous - The wrapper the rows are currently sealed by, when that is *not* the
   *   configured one — which is exactly the cross-backend case: an operator moving from the
   *   environment master key to KMS constructs the old `MasterKeyWrapper`, passes it here,
   *   and the configured KMS wrapper is what seals the result. Omit it for the same-backend
   *   case, which is rotating `OURO_VAULT_MASTER_KEY` itself.
   * @returns How many key versions were re-sealed. Zero for a workspace with no keys, which
   *   is not an error — most workspaces in an installation have never stored a secret.
   * @throws {VaultKeyError} If a row cannot be opened by `previous`, which stops the
   *   workspace mid-conversion rather than leaving rows sealed by a backend the operator
   *   believes is gone.
   */
  async rewrap(organizationId: string, previous?: KeyWrapper): Promise<number> {
    const source = previous ?? this.wrapper;
    const rows = await this.keys.allKeys(organizationId);
    let converted = 0;

    for (const row of rows) {
      const identity: DekIdentity = { organizationId, version: row.version };
      const stored: SealedKey = { wrapper: row.wrapper, material: row.sealed_dek };

      // Same wrapper on both sides: `rewrap` is the implementation's own business, and a KMS
      // backend can do it without the key leaving the service. Only the cross-backend case
      // has to open the key in this process.
      let sealed: SealedKey;

      if (source === this.wrapper) {
        sealed = await source.rewrap(stored, identity);
      } else {
        let dek: Buffer | undefined;

        try {
          dek = await source.unwrap(stored, identity);
          sealed = await this.wrapper.wrap(dek, identity);
        } finally {
          zeroize(dek);
        }
      }

      await this.keys.replaceSeal(organizationId, row.version, {
        sealed_dek: sealed.material,
        wrapper: sealed.wrapper,
      });

      converted += 1;
    }

    return converted;
  }
}
