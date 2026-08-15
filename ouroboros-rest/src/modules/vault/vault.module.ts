/**
 * The credential vault — AD.1 ([#222](https://github.com/NobuData/ouroboros/issues/222)),
 * roadmap decision **P2**.
 *
 * ```
 * envelope.ts           the cryptography, and nothing else     → pure functions, no state
 * key.wrapper.ts        the custody seam                       → KEY_WRAPPER token
 * master.key.wrapper.ts the MVP's custody: an env master key   → AF.3 swaps this line
 * vault.repository.ts   the statements against tenant_keys
 * vault.service.ts      encrypt / decrypt / reseal / rotate / rewrap
 * vault.rotation.ts     the re-encrypt sweep, and the migration
 * ```
 *
 * **Two providers here are one-line swaps, and both are the point of the module's shape.**
 *
 * `KEY_WRAPPER` is bound to `MasterKeyWrapper` today. AF.3
 * ([#236](https://github.com/NobuData/ouroboros/issues/236)) changes this one `useClass` to a
 * KMS or Vault implementation and ships no data migration, because a wrapper seals
 * data-encryption keys and never touches a credential ciphertext.
 *
 * `VAULT_SECRET_STORES` is bound to an **empty array**, and that is accurate rather than a
 * stub: no module in this service holds an encrypted secret yet. Q.1
 * ([#138](https://github.com/NobuData/ouroboros/issues/138)), K.3
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)) and Y.1
 * ([#189](https://github.com/NobuData/ouroboros/issues/189)) each add theirs, and the sweep
 * and the one-time migration start doing something the moment they do.
 *
 * It exports `VaultService` and `VaultRotation` — the credential lifecycle API (AD.2,
 * [#223](https://github.com/NobuData/ouroboros/issues/223)) and the provider adapters
 * (AC.2/AC.3/AC.5) are what import them. `KEY_WRAPPER` is exported too, so a module that
 * genuinely needs the configured custody — an operator route that re-wraps after a master
 * key change — can name it rather than construct one.
 *
 * It declares **no controller**. Nothing here is reachable over HTTP: a route that decrypted
 * a credential would be a route that returned one, and which of those exist is AD.2's
 * decision to make behind a re-authentication step, not this module's to leave lying around.
 *
 * `DbModule` is imported for the reason every module with a repository imports it — the
 * import is the answer to "who can reach `tenant_keys`", and `DbModule` is deliberately
 * non-global so the question has one.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { KEY_WRAPPER } from "./key.wrapper";
import { MasterKeyWrapper } from "./master.key.wrapper";
import { VAULT_SECRET_STORES, VaultRotation, type VaultSecretStore } from "./vault.rotation";
import { VaultRepository } from "./vault.repository";
import { VaultService } from "./vault.service";

/**
 * The stores registered today: none.
 *
 * A named constant rather than a literal in the `providers` array, so the fact has somewhere
 * to be documented and so a test can assert it is still true — which is what stops this from
 * being quietly forgotten when #138 lands and adds the first one.
 */
export const REGISTERED_SECRET_STORES: readonly VaultSecretStore[] = Object.freeze([]);

@Module({
  imports: [DbModule],
  providers: [
    VaultRepository,
    VaultService,
    VaultRotation,
    { provide: KEY_WRAPPER, useClass: MasterKeyWrapper },
    { provide: VAULT_SECRET_STORES, useValue: REGISTERED_SECRET_STORES },
  ],
  exports: [VaultService, VaultRotation, KEY_WRAPPER],
})
export class VaultModule {}
