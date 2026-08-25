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
 * params.*.ts            CH.2 — the param schema, its merge, its validation, the chips
 * aliases.*.ts           CH.1 — the alias lifecycle: create, edit, rebind, duplicate, delete
 * import.*.ts            CH.4 — bulk creation from discovery: candidates, naming, one batch
 * ```
 *
 * **It declared no controller until mockup 21 was written, and that was the whole of decision
 * M2 in one line.** `provider_connections` and `model_aliases` are the data mockup 07
 * (*Providers & keys*) and mockup 21 (*Model registry*) build their management UIs on.
 * Routing could not be built without them, so the schema and the reads landed here first —
 * and every create, update and delete stayed with those roadmaps, because a CRUD surface
 * written here ahead of them is one they would have had to negotiate with rather than write.
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)) put the alias *list* on a
 * routing route by importing this module; CH.2
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)) added the first controller
 * here, a read; CH.1 ([#584](https://github.com/NobuData/ouroboros/issues/584)) is mockup
 * 21 writing its own API, which is what M2 was waiting for — `/api/v1/registry/aliases`,
 * with the guards that make the page's caption true. CH.4
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)) is the head's other button,
 * `/api/v1/registry/import`. `registry.module.spec.ts` asserts the controller list, so a
 * fourth entry has to be stated out loud rather than noticed in review.
 *
 * **It imports `PricingModule`, and only for `PricingService`.** CH.4's candidate rows carry a
 * price preview, and CH.3 ([#586](https://github.com/NobuData/ouroboros/issues/586)) is
 * emphatic that there is exactly one resolution of *what does this model cost* because the
 * thing four surfaces would disagree about is money. So the wizard consumes that service
 * rather than reaching `model_prices` through the repository beside it — which this module
 * does do, for `meta`, and `registry.repository.ts` argues why a column that is not a price is
 * a different question.
 *
 * **It imports `ProvidersModule`, and only for `ModelProviderRegistry`.** A param schema is
 * whatever the bound adapter says it is, and decision **P1** is that core code reaches an
 * adapter through the registry and never by importing one — `.dependency-cruiser.cjs` is what
 * makes that a build failure rather than a review comment. `provider-connections/` imports this
 * module for the same one binding and for the same reason.
 *
 * **It exports three providers with very different audiences.** {@link RegistryService} is for
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
 * {@link ParamSchemaService} is the third, and it is exported for CH.1's sake rather than for a
 * route's: every alias write has to be checked against the schema its inspector was rendered
 * from, and the alternative to exporting this is that ticket re-implementing a precedence rule
 * about capabilities. The export *is* the internal contract, exactly as `PricingModule`'s is.
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
import { PricingModule } from "../pricing/pricing.module";
import { ProvidersModule } from "../providers/providers.module";
import { AliasesController } from "./aliases.controller";
import { AliasesRepository } from "./aliases.repository";
import { AliasesService } from "./aliases.service";
import { ImportController } from "./import.controller";
import { ImportRepository } from "./import.repository";
import { ImportService } from "./import.service";
import { ParamSchemaController } from "./params.controller";
import { ParamSchemaService } from "./params.service";
import { RegistryRepository } from "./registry.repository";
import { RegistryService } from "./registry.service";
import { ProviderCredentialStore } from "./registry.secrets";

@Module({
  imports: [DbModule, PricingModule, ProvidersModule],
  controllers: [ParamSchemaController, AliasesController, ImportController],
  providers: [
    RegistryRepository,
    RegistryService,
    ProviderCredentialStore,
    ParamSchemaService,
    AliasesRepository,
    AliasesService,
    ImportRepository,
    ImportService,
  ],
  exports: [RegistryService, ProviderCredentialStore, ParamSchemaService],
})
export class RegistryModule {}
