/**
 * Provider health — the passive-first answer to *is this provider usable*, over V015's
 * `provider_connections` ([#196](https://github.com/NobuData/ouroboros/issues/196)).
 *
 * ```
 * checks.ts                     which question each kind gets, and the two that get none
 * cadence.ts                    the jitter, the caps, the deadline
 * probe.client.ts               the only outbound call — GET, body-less, no completions
 * snapshot.ts                   the health jsonb, and the shape AB.2 extends without a migration
 * provider-health.repository.ts the four statements
 * provider-health.service.ts    the sweep, the strip, the snapshots
 * provider-health.scheduler.ts  what makes it periodic
 * resources.ts                  snapshot → chip
 * provider-health.controller.ts GET /api/v1/routing/providers
 * ```
 *
 * **It exports its service, and the export is the point of half the ticket.** Z.1
 * ([#194](https://github.com/NobuData/ouroboros/issues/194)) resolves a fallback chain against
 * provider health and was told to consume *snapshots as pure inputs* rather than to check
 * anything itself; AA.1 ([#200](https://github.com/NobuData/ouroboros/issues/200)) draws the
 * chips. Both go through {@link ProviderHealthService}, which is what stops a resolver
 * growing a second, network-touching, opinion about whether a provider is up.
 *
 * **`ScheduleModule.forRoot()` is imported here, and this is the first module in the service
 * to need it.** It contributes `SchedulerRegistry` and nothing else that this module uses; see
 * `provider-health.scheduler.ts` for why the sweep is a self-rescheduling timeout rather than
 * an `@Interval`, and `vault.rotation.ts`'s header for the state of the world before it.
 *
 * **`VaultModule` is imported, and unlike `RegistryModule` it has to be.** That module's
 * header makes a point of *not* importing the vault — a resolution carries an address and
 * never a credential, and the absent import is what keeps it true. This module is the
 * different case: validating a key means presenting it, so the import is a visible statement
 * that a plaintext exists somewhere in here. `provider-health.service.ts` says exactly where,
 * and how briefly.
 *
 * `DbModule` is imported for the reason every module with a repository imports it — the import
 * is the answer to "who can reach V015's tables", and `DbModule` is deliberately non-global so
 * the question has one.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { VaultModule } from "../vault/vault.module";
import { ProviderProbe } from "./probe.client";
import { ProviderHealthController } from "./provider-health.controller";
import { ProviderHealthRepository } from "./provider-health.repository";
import { ProviderHealthScheduler } from "./provider-health.scheduler";
import { ProviderHealthService } from "./provider-health.service";

@Module({
  imports: [DbModule, VaultModule, ScheduleModule.forRoot()],
  controllers: [ProviderHealthController],
  providers: [
    ProviderHealthService,
    ProviderHealthRepository,
    ProviderProbe,
    ProviderHealthScheduler,
  ],
  // The one export, and the internal contract Z.1 and AA.1 were told to consume. The
  // repository, the probe and the scheduler stay private: a consumer reaching past the service
  // would be a consumer that had skipped the *no check on demand* rule the controller states.
  exports: [ProviderHealthService],
})
export class ProviderHealthModule {}
