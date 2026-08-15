/**
 * What the vault throws, and the one rule every message here obeys.
 *
 * **No message in this file ever carries a value.** Not the plaintext, not the ciphertext,
 * not the key, not the master key, and not the base64 of any of them. That is not a
 * stylistic preference: an error message is the single most likely thing in a service to
 * be logged, wrapped, serialized into a response body and pasted into an issue, and a
 * secret that reaches one has reached all four. So the messages say *what kind of thing
 * went wrong* and name the workspace, the record and the key version — the three
 * identifiers that make a failure diagnosable and that are already in the URL, the row and
 * the audit trail respectively.
 *
 * The classes are separate because the callers need to tell them apart, and because they
 * mean genuinely different things about the state of the system:
 *
 *   * {@link VaultCryptoError} — a ciphertext did not authenticate. Something is wrong with
 *     the *data*: it was truncated, altered, or moved from another workspace or record.
 *     AD.2 answers this as a failure of the record, not of the service.
 *   * {@link VaultKeyError} — a key is missing, is at an unknown version, or is sealed by a
 *     backend this deployment cannot open. Something is wrong with the *deployment*: the
 *     record is probably fine and unreadable anyway, and the fix is an operator's.
 *
 * Both extend {@link VaultError}, so a caller that only wants "the vault refused" can catch
 * one thing.
 *
 * Filed under [#222](https://github.com/NobuData/ouroboros/issues/222) (AD.1).
 */

/**
 * Base class for every failure the vault reports.
 *
 * Carries no value by construction — see this file's header — and exists so a caller can
 * catch the whole family without enumerating it.
 */
export class VaultError extends Error {
  /**
   * @param message - What went wrong. Must name no secret, no ciphertext and no key
   *   material; identifiers only.
   */
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A ciphertext did not authenticate, or was not a well-formed envelope.
 *
 * AES-GCM does not distinguish *altered* from *decrypted with the wrong key* from *carrying
 * the wrong additional data* — all three are one authentication failure, and that is the
 * property the tamper and AAD-binding criteria rest on. So this one class covers a flipped
 * bit, a truncated column, a ciphertext lifted from another workspace, and a value that was
 * never an envelope at all.
 *
 * **It is never accompanied by a partial plaintext.** GCM's tag is checked before
 * `final()` returns anything, so a caller receiving this error has received no bytes.
 */
export class VaultCryptoError extends VaultError {}

/**
 * A key could not be found, could not be opened, or was sealed by another backend.
 *
 * Distinct from {@link VaultCryptoError} because the operator's response is different: a
 * record whose ciphertext fails to authenticate is a broken record, and a workspace whose
 * key version 3 is missing is a broken *deployment* — most likely a database restored
 * without `tenant_keys`, or a `OURO_VAULT_MASTER_KEY` that is not the one this data was
 * sealed with.
 */
export class VaultKeyError extends VaultError {}
