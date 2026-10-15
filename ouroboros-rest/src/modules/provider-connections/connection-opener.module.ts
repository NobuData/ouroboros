/**
 * {@link ConnectionOpener} on its own — for the chain executor (AF.2, #235).
 *
 * Not `ProviderConnectionsModule`, which exports nothing on purpose (its routes are its
 * surface) and brings the step-up and the person's session with it — neither of which the
 * engine-facing surface has or needs. This module registers only what opening a connection
 * takes: the repository (stateless, so a second registration can disagree with nothing — the
 * `RoutingStatsRepository` precedent), the vault and the adapter registry.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { ProvidersModule } from "../providers/providers.module";
import { VaultModule } from "../vault/vault.module";
import { ConnectionOpener } from "./connection.opener";
import { ProviderConnectionsRepository } from "./provider-connections.repository";

@Module({
  imports: [DbModule, VaultModule, ProvidersModule],
  providers: [ConnectionOpener, ProviderConnectionsRepository],
  exports: [ConnectionOpener],
})
export class ConnectionOpenerModule {}
