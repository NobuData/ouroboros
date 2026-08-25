/**
 * The registry's composed read model — CH.5
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)), decision **R8**.
 *
 * ```
 * alias.health.ts              the derivation — six states, no probe   → a pure function
 * registry-read.rows.ts        the shapes the three statements select
 * registry-read.repository.ts  connections, discovery membership, envelopes
 * registry-read.resources.ts   composition → the contract, and the monograms
 * registry-read.service.ts     the composition itself
 * registry-read.controller.ts  GET /api/v1/registry
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why this is its own module rather than a fourth controller in `RegistryModule`.**
 *
 * `registry.module.ts` states, at length, that `VaultModule` is *deliberately not imported*:
 * nothing there decrypts anything, and the absent import is what keeps that true as the module
 * grows. That sentence is still true, and this module is what makes it stay true — because
 * mockup 21's inspector draws *Anthropic — key sk-ant-…Xq4A* on its provider line, the composed
 * read **does** need a plaintext for the length of one mask, and there is no stored suffix
 * column to read instead.
 *
 * It could not have been done in place in any case. `VaultModule` imports `RegistryModule` — it
 * is where `ProviderCredentialStore` is bound into `VAULT_SECRET_STORES` — so a `RegistryModule`
 * that imported the vault back would be a cycle, and `.dependency-cruiser.cjs`'s `no-circular`
 * rule is an error rather than a warning. Splitting the read into a module that imports both is
 * the shape that has no cycle in it, and the seam it draws is a real one: **writes and the
 * alias's own resource live in `RegistryModule`; the page's composed payload lives here.**
 *
 * ---------------------------------------------------------------------------
 * **It imports `RegistryModule` for `AliasesService`, and only for that.**
 *
 * The rows and their references come from CH.1's list — the same read
 * `GET /api/v1/registry/aliases` serves — rather than from a second query written here. Two
 * readings of *what is an alias* would be two answers, and the `Used by` column disagreeing
 * with the chips on the same page is precisely the failure decision **R5** exists to prevent.
 * That export is the internal contract, exactly as `PricingModule`'s is.
 *
 * **It imports `PricingModule` for `PricingService`, and only for that.** CH.3
 * ([#586](https://github.com/NobuData/ouroboros/issues/586)) is emphatic that there is exactly
 * one resolution of *what does this model cost*, because the thing four surfaces would disagree
 * about is money. The registry column is one of the four the ticket names.
 *
 * **It imports `VaultModule` for `VaultService`, and only for the mask.** See above, and see
 * `registry-read.service.ts` for the buffer's lifetime — opened, masked, erased in a `finally`,
 * never returned, never attached to a resource, never logged.
 *
 * **`DbModule` is imported for the reason every module with a repository imports it** — the
 * import is the answer to "who can reach these tables", and `DbModule` is deliberately
 * non-global so the question has one.
 *
 * ---------------------------------------------------------------------------
 * **`ProvidersModule` is deliberately *not* imported, and that is decision R8 made structural.**
 *
 * `ModelProviderRegistry` is the only door to an adapter (decision **P1**), and it is not
 * injectable here — so this read cannot make a provider call even by mistake, and the import
 * that would change that is a visible edit with a reviewer attached to it.
 * `registry-read.module.spec.ts` asserts the absent import, and
 * `registry-read.integration-spec.ts` counts adapter lookups across a real request and expects
 * zero. Note that CH.2's `ParamSchemaService` *does* reach an adapter and is *not* used here:
 * the chips come from `paramChips`, the pure derivation over the two stored documents.
 *
 * **It exports nothing.** Its one consumer is a browser, over the route below. A service that
 * wanted an alias's binding reads `RegistryService`; one that wanted the alias itself reads
 * `AliasesService`. Composing them for a page is not an internal contract anybody else needs.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { PricingModule } from "../pricing/pricing.module";
import { RegistryModule } from "../registry/registry.module";
import { VaultModule } from "../vault/vault.module";
import { RegistryReadController } from "./registry-read.controller";
import { RegistryReadRepository } from "./registry-read.repository";
import { RegistryReadService } from "./registry-read.service";

@Module({
  imports: [DbModule, RegistryModule, PricingModule, VaultModule],
  controllers: [RegistryReadController],
  providers: [RegistryReadRepository, RegistryReadService],
})
export class RegistryReadModule {}
