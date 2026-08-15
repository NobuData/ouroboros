/**
 * The MVP's key custody: one key-encryption key, read from the environment at boot.
 *
 * The default deployment of decision **P2**, and the reason the roadmap chose option 1-A
 * over cloud KMS: a self-hosted Ouroboros needs no extra infrastructure to have real
 * envelope encryption, and the deployments that want hardware-backed custody get it in AF.3
 * ([#236](https://github.com/NobuData/ouroboros/issues/236)) by swapping one provider —
 * without a data migration, because this class seals data-encryption keys and nothing else.
 *
 * **The honest cost, stated here rather than in a footnote: key custody is the operator's
 * problem.** The KEK is an environment variable. It is as safe as the process environment,
 * the orchestrator's secret store and the deployment's logging discipline make it, and
 * anyone who can read all three can read every credential in the product. That is a
 * different claim from "KMS-backed", and `docs/SECURITY_MODEL.md` (AD.5,
 * [#226](https://github.com/NobuData/ouroboros/issues/226)) is where it is written down as
 * such rather than glossed. What this class does provide is the property that makes the
 * upgrade cheap: the day an operator moves to KMS, `VaultService.rewrap` re-seals the
 * `tenant_keys` rows and every credential ciphertext in the database stays byte-identical.
 *
 * ---------------------------------------------------------------------------
 * **The key is validated twice, and the second time is not redundant.**
 * `configuration.ts` refuses to start the process on a key that is not exactly 32 bytes of
 * base64 — that is the acceptance criterion, and it is where an operator gets a legible
 * message. The check in the constructor here is the one that holds when this class is
 * constructed by something other than the configured application: a test, an AF.3 migration
 * that instantiates the *previous* wrapper by hand, or a future caller that reads a key from
 * somewhere else. A class that assumed its input had already been checked would be a class
 * that could be given 31 bytes by the one caller that mattered.
 *
 * ---------------------------------------------------------------------------
 * **The KEK is held decoded, for the life of the process.** Zeroizing it would mean
 * decoding it per operation from a `string` that cannot itself be zeroized — the same bytes,
 * in more copies. What *is* zeroized is every DEK this class hands out or takes in, in a
 * `finally`.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import {
  KEY_BYTES,
  canonicalAad,
  formatEnvelope,
  open,
  parseEnvelope,
  seal,
  zeroize,
} from "./envelope";
import type { DekIdentity, KeyWrapper, SealedKey } from "./key.wrapper";
import { VaultKeyError } from "./vault.errors";

/**
 * What this wrapper writes into `ouroboros.tenant_keys.wrapper`.
 *
 * **Stable forever.** It is stored in rows, and a release that changed it would orphan every
 * key sealed by an earlier one — the rows would be unreadable not because the key was wrong
 * but because nothing would admit to being able to open them.
 */
export const MASTER_WRAPPER_ID = "env-master";

/**
 * The domain separator in the sealed DEK's additional authenticated data.
 *
 * Distinct from the one credential ciphertext uses, and deliberately so: the two AADs
 * describe different things sealed with different keys, and sharing a prefix would make a
 * future encoding mistake able to produce the same bytes for both.
 */
export const WRAP_AAD_CONTEXT = "ouro-vault-kek:v1";

/**
 * Run a synchronous computation and report its failure as a *rejection*.
 *
 * `KeyWrapper`'s methods return promises because AF.3's backends are network calls — see
 * `key.wrapper.ts` — and this implementation's work is all in memory. Left as it stands, a
 * bad argument would come back as a synchronous `throw` from a method whose signature says
 * `Promise`, so a caller written the way the interface asks (`await`, or `.catch()`) would
 * miss it entirely and a caller written against *this* implementation would work by
 * accident. One helper is cheaper than remembering the distinction at four call sites.
 *
 * @param work - The computation.
 * @returns Its result, or a promise rejected with whatever it threw.
 */
function settled<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error: unknown) {
    return Promise.reject(error instanceof Error ? error : new VaultKeyError(String(error)));
  }
}

/**
 * A key-encryption key held in memory, read once from `OURO_VAULT_MASTER_KEY`.
 *
 * Framing note: `material` is the same five-field envelope credential ciphertext uses, with
 * the version field carrying the DEK's version. Reusing the format rather than inventing a
 * second one means there is exactly one parser in this module to get right, and the sealed
 * key in the database is inspectable by the same eye that reads a credential column.
 */
@Injectable()
export class MasterKeyWrapper implements KeyWrapper {
  /** @see KeyWrapper.id */
  readonly id = MASTER_WRAPPER_ID;

  /** The decoded KEK. Never logged, never returned, never compared to anything. */
  private readonly kek: Buffer;

  /**
   * @param config - The typed configuration, for `OURO_VAULT_MASTER_KEY`. Injected rather
   *   than read, because nothing outside `src/modules/config/` names an environment variable
   *   ([#28](https://github.com/NobuData/ouroboros/issues/28)).
   * @throws {VaultKeyError} If the key does not decode to {@link KEY_BYTES} bytes — see this
   *   class's header on why that is checked again here.
   */
  constructor(@Inject(AppConfigService) config: AppConfigService) {
    this.kek = Buffer.from(config.vaultMasterKey, "base64");

    if (this.kek.byteLength !== KEY_BYTES) {
      // Names the variable and the requirement, and nothing about the value — the same rule
      // `configuration.ts` follows, for the same reason.
      throw new VaultKeyError(
        `vault: OURO_VAULT_MASTER_KEY must decode to exactly ${KEY_BYTES.toString()} bytes`,
      );
    }
  }

  /**
   * Build the binding a sealed DEK is authenticated against.
   *
   * Length-prefixed by `canonicalAad`, so no workspace id and version can produce the bytes
   * another pair would. This is what makes a `sealed_dek` copied between rows fail to open.
   *
   * @param identity - The workspace and version the row claims.
   * @returns The additional authenticated data.
   */
  private aad(identity: DekIdentity): Buffer {
    return canonicalAad(WRAP_AAD_CONTEXT, identity.organizationId, identity.version.toString());
  }

  /** @see KeyWrapper.wrap */
  wrap(dek: Buffer, identity: DekIdentity): Promise<SealedKey> {
    return settled(() => {
      if (dek.byteLength !== KEY_BYTES) {
        throw new VaultKeyError(
          `vault: a data-encryption key must be ${KEY_BYTES.toString()} bytes before it is sealed`,
        );
      }

      const { nonce, ciphertext } = seal(this.kek, this.aad(identity), dek);

      return {
        wrapper: this.id,
        material: Buffer.from(formatEnvelope(identity.version, nonce, ciphertext), "utf8"),
      };
    });
  }

  /** @see KeyWrapper.unwrap */
  unwrap(sealed: SealedKey, identity: DekIdentity): Promise<Buffer> {
    return settled(() => {
      if (sealed.wrapper !== this.id) {
        // The AF.3 diagnostic, and the reason `wrapper` is a column rather than an assumption:
        // a deployment reading rows sealed by a backend it is not configured for should be told
        // which backend, not handed an authentication failure that reads as data corruption.
        throw new VaultKeyError(
          `vault: this key was sealed by "${sealed.wrapper}" and this deployment is configured ` +
            `for "${this.id}"`,
        );
      }

      const envelope = parseEnvelope(sealed.material.toString("utf8"));

      // The version inside the sealed material and the version the row claims must agree.
      // They are both authenticated — the AAD covers the row's — so a disagreement is not an
      // attack that got through, it is a writer that stored a key under the wrong version, and
      // saying so is better than an authentication failure nobody can act on.
      if (envelope.version !== identity.version) {
        throw new VaultKeyError(
          `vault: the sealed key for workspace ${identity.organizationId} is stamped version ` +
            `${envelope.version.toString()} but is stored as version ${identity.version.toString()}`,
        );
      }

      return open(this.kek, this.aad(identity), envelope);
    });
  }

  /**
   * @see KeyWrapper.rewrap
   *
   * Open and seal again, with the DEK zeroized in a `finally` — the plaintext key exists for
   * the duration of one `wrap` call and is overwritten whether that call succeeds or throws.
   */
  async rewrap(sealed: SealedKey, identity: DekIdentity): Promise<SealedKey> {
    let dek: Buffer | undefined;

    try {
      dek = await this.unwrap(sealed, identity);
      return await this.wrap(dek, identity);
    } finally {
      zeroize(dek);
    }
  }
}
