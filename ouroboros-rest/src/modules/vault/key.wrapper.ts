/**
 * The seam custody plugs into — the interface that makes AF.3 a re-wrap instead of a
 * migration.
 *
 * A `KeyWrapper` seals and opens **data-encryption keys** and nothing else. It never sees a
 * credential, never sees a plaintext, and never sees a ciphertext from
 * `provider_connections` or anywhere else. That single restriction is what the whole
 * envelope-encryption decision (**P2**) buys: moving from the environment master key to AWS
 * KMS or Vault/OpenBao ([#236](https://github.com/NobuData/ouroboros/issues/236)) rewrites
 * the `sealed_dek` column of `ouroboros.tenant_keys` and leaves every credential ciphertext
 * in the database byte-identical. Without it, "add KMS support" would mean decrypting and
 * re-encrypting every secret in the system — an operation that has to hold every plaintext
 * in memory, and that leaves the database in two states if it fails halfway.
 *
 * ---------------------------------------------------------------------------
 * **Why `rewrap` is here from day one, rather than being added with the second backend.**
 *
 * It is the method that has no caller today and the one that is expensive to retrofit. A
 * wrapper written without it tends to be written as a pair of functions over a key held in
 * a field, and the operation AF.3 actually needs — *open with the backend we are leaving,
 * seal with the one we are arriving at* — has nowhere to live: the old backend's
 * credentials are gone by the time the new wrapper exists. Declaring it now forces every
 * implementation to be constructible for a backend that is not the configured one, which is
 * the property the migration needs and the one that cannot be added afterwards without
 * changing every implementation.
 *
 * `VaultService.rewrap` is what calls it, and takes the *previous* wrapper as an argument
 * for exactly that reason.
 *
 * ---------------------------------------------------------------------------
 * **Async, though the MVP implementation is not.** `MasterKeyWrapper` does an AES operation
 * in memory and could be synchronous. KMS and Vault are network calls, and an interface that
 * was synchronous today would have to change — along with every caller — the day the second
 * implementation arrived. The cost is a promise per unwrap; the alternative is a signature
 * change reaching through the service, the repository and the rotation job.
 *
 * Filed under [#222](https://github.com/NobuData/ouroboros/issues/222) (AD.1).
 */

/**
 * The Nest token the configured wrapper is provided under.
 *
 * An interface cannot be an injection token, so this is the indirection that lets
 * `VaultModule` swap `MasterKeyWrapper` for a KMS one in AF.3 by changing a single
 * `provide`. A string rather than a symbol, because it is what Nest prints when a provider
 * is missing and "VAULT_KEY_WRAPPER" is a better thing to read at 3am than "Symbol()".
 */
export const KEY_WRAPPER = "VAULT_KEY_WRAPPER";

/**
 * Which key is being sealed — the binding a wrapper authenticates its ciphertext against.
 *
 * Passed to every method so a sealed DEK is bound to the workspace and version it belongs
 * to, exactly as a credential ciphertext is bound to its tenant and record. It closes the
 * same hole one level up: a `sealed_dek` copied from one workspace's row into another's
 * fails to unwrap rather than handing that workspace somebody else's key.
 */
export interface DekIdentity {
  /** The workspace whose key this is — `ouroboros.tenant_keys.organization_id`. */
  readonly organizationId: string;
  /** Which generation of that workspace's key — `ouroboros.tenant_keys.version`, from 1. */
  readonly version: number;
}

/**
 * A data-encryption key as it is stored: sealed, and stamped with what sealed it.
 *
 * The two fields are the two `tenant_keys` columns, and they travel together because
 * neither means anything alone. `material`'s framing is the wrapper's own business — the
 * env-master wrapper produces nonce‖ciphertext‖tag, a KMS wrapper produces whatever blob
 * that service returns — so `wrapper` is what says which reader can make sense of it.
 */
export interface SealedKey {
  /** Which {@link KeyWrapper} produced `material` — its {@link KeyWrapper.id}. */
  readonly wrapper: string;
  /** The sealed key. Never key material in the clear, whatever the backend. */
  readonly material: Buffer;
}

/**
 * Somewhere a key-encryption key lives, and the three things it can do with one.
 *
 * Implementations must be safe to call concurrently and must hold no per-operation state:
 * the vault unwraps a DEK for every single encrypt and decrypt, deliberately — see
 * `vault.service.ts` on why there is no cache.
 */
export interface KeyWrapper {
  /**
   * How this wrapper is recorded in `ouroboros.tenant_keys.wrapper`.
   *
   * Stable across releases: it is written into rows, and changing it would orphan every row
   * already sealed. `env-master` today; AF.3 adds its own.
   */
  readonly id: string;

  /**
   * Seal a data-encryption key.
   *
   * @param dek - The 32-byte key. Not consumed — the caller owns it and zeroizes it.
   * @param identity - The workspace and version this key belongs to, bound into the
   *   ciphertext so it cannot be moved to another row.
   * @returns The sealed key, stamped with {@link id}.
   */
  wrap(dek: Buffer, identity: DekIdentity): Promise<SealedKey>;

  /**
   * Open a sealed data-encryption key.
   *
   * @param sealed - The stored key, as `tenant_keys` holds it.
   * @param identity - The workspace and version the row claims. Authenticated, not trusted:
   *   a row moved between workspaces fails here rather than yielding the wrong key.
   * @returns The 32-byte key. **The caller owns it and must zeroize it.**
   * @throws {VaultKeyError} If `sealed.wrapper` is not this wrapper's, or the backend cannot
   *   open it.
   * @throws {VaultCryptoError} If the sealed material fails authentication.
   */
  unwrap(sealed: SealedKey, identity: DekIdentity): Promise<Buffer>;

  /**
   * Re-seal a key this wrapper can already open, under this wrapper's *current* key.
   *
   * The same-backend half of custody rotation: an operator who has generated a new
   * `OURO_VAULT_MASTER_KEY` runs this over every row, and no credential ciphertext is
   * touched. The cross-backend half — open with the wrapper being retired, seal with the new
   * one — is `VaultService.rewrap`, which composes {@link unwrap} and {@link wrap} across two
   * instances; see this file's header for why the interface has to allow that.
   *
   * @param sealed - The stored key.
   * @param identity - The workspace and version, as for {@link unwrap}.
   * @returns The same key, sealed again. The plaintext DEK is never returned and is
   *   zeroized by the implementation.
   */
  rewrap(sealed: SealedKey, identity: DekIdentity): Promise<SealedKey>;
}
