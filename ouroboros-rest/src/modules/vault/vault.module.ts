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
 * `VAULT_SECRET_STORES` is the list of tables that hold a sealed value, and Y.1
 * ([#189](https://github.com/NobuData/ouroboros/issues/189)) put the first one in it:
 * `provider_connections.credentials_encrypted`, through `RegistryModule`'s
 * `ProviderCredentialStore`. Until V015 there was no encrypted column in this schema and the
 * array was empty, which was accurate rather than a stub. Q.1
 * ([#138](https://github.com/NobuData/ouroboros/issues/138)) and K.3
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)) each add theirs the same way.
 *
 * A store is registered **with the migration that creates its column**, not with the first
 * thing that writes one — see `registry/registry.secrets.ts`. A sealed column the sweep
 * cannot see is not an inert gap: it is a rotation that reports success while leaving
 * ciphertext on a key version it then retires.
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
import { ProviderCredentialStore } from "../registry/registry.secrets";
import { RegistryModule } from "../registry/registry.module";
import { KEY_WRAPPER } from "./key.wrapper";
import { MasterKeyWrapper } from "./master.key.wrapper";
import { VAULT_SECRET_STORES, VaultRotation, type VaultSecretStore } from "./vault.rotation";
import { VaultRepository } from "./vault.repository";
import { VaultService } from "./vault.service";

/**
 * The stores registered today, as the providers that implement them.
 *
 * A named constant rather than a literal in the `inject` array, so the list has somewhere to
 * be documented and so a test can assert what is in it — which is what stops a table with a
 * sealed column being quietly left out when #138 and #101 land theirs.
 *
 * Classes rather than instances: each store injects `DatabaseService`, so Nest has to
 * construct them, and naming them here is what makes "which modules hold a sealed value" one
 * readable list instead of a factory argument list nobody can grep for.
 */
export const REGISTERED_SECRET_STORES = [ProviderCredentialStore] as const;

@Module({
  imports: [DbModule, RegistryModule],
  providers: [
    VaultRepository,
    VaultService,
    VaultRotation,
    { provide: KEY_WRAPPER, useClass: MasterKeyWrapper },
    {
      provide: VAULT_SECRET_STORES,
      // Frozen for the reason the empty array was: `VaultRotation` iterates this list and
      // must not be able to grow it, and a store appended at run time would be one the
      // module's own documentation does not mention.
      useFactory: (...stores: VaultSecretStore[]): readonly VaultSecretStore[] =>
        Object.freeze(stores),
      inject: [...REGISTERED_SECRET_STORES],
    },
  ],
  exports: [VaultService, VaultRotation, KEY_WRAPPER],
})
export class VaultModule {}
