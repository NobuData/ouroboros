/**
 * The model registry — Y.1 ([#189](https://github.com/NobuData/ouroboros/issues/189)),
 * roadmap decision **M2**.
 *
 * ```
 * resolution.ts          what an alias resolves to        → the shape, and the mapper
 * registry.errors.ts     the two refusals, and the codes
 * registry.repository.ts the three statements against V015's tables
 * registry.service.ts    resolve / list / dependentAliases
 * registry.secrets.ts    the vault's re-encryption store for the credential column
 * ```
 *
 * **It declares no controller, and that is the whole of decision M2 in one line.**
 * `provider_connections` and `model_aliases` are the data mockup 07 (*Providers & keys*) and
 * mockup 21 (*Model registry*) will build their management UIs on. Routing cannot be built
 * without them, so the schema and the reads land here — and every create, update and delete
 * stays with those roadmaps, because a CRUD surface written here first is one they would
 * have to negotiate with rather than write. Z.2
 * ([#195](https://github.com/NobuData/ouroboros/issues/195)) is what puts the alias list on
 * a route, and it imports this module rather than reaching past it.
 *
 * **It exports two providers with very different audiences.** {@link RegistryService} is for
 * Y.2's routes, Z.1's resolution, Z.2's swap menu and the engine's estimator — everything
 * that has to turn a name into a model. {@link ProviderCredentialStore} is for exactly one
 * consumer, `VaultModule`, which is where `VAULT_SECRET_STORES` is bound; see
 * `registry.secrets.ts` for why the store lands with the column rather than with the first
 * thing that writes one.
 *
 * `DbModule` is imported for the reason every module with a repository imports it — the
 * import is the answer to "who can reach V015's tables", and `DbModule` is deliberately
 * non-global so the question has one.
 *
 * **`VaultModule` is deliberately *not* imported.** Nothing here decrypts anything: a
 * resolution carries an address and a model, never a credential (`resolution.ts` argues
 * why), and the sweep hands this module an already-sealed envelope rather than asking it to
 * produce one. The absent import is what keeps that true as this module grows — the day
 * something here needs a plaintext, adding the import is a visible change with a reviewer
 * attached to it.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { RegistryRepository } from "./registry.repository";
import { RegistryService } from "./registry.service";
import { ProviderCredentialStore } from "./registry.secrets";

@Module({
  imports: [DbModule],
  providers: [RegistryRepository, RegistryService, ProviderCredentialStore],
  exports: [RegistryService, ProviderCredentialStore],
})
export class RegistryModule {}
