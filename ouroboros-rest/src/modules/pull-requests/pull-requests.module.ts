/**
 * `PullRequestsModule` — the PR plane's service layer (AX.1,
 * [#357](https://github.com/NobuData/ouroboros/issues/357)).
 *
 * It holds the SPI PR sync that mirrors V052's `pull_requests` and `pr_revisions` from a git host,
 * and imports the gate engine (`gates/`, #358), which every sync notifies. The merge executor (#360)
 * and the routes land beside them. It
 * imports `TicketSourcesModule` for the registry and the credential opener, and reaches a host only
 * through the SPI — `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only` holds it
 * to that, and `ticket-source-core-tests-run-on-the-fake` holds its suites to the in-memory host.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { GatesModule } from "./gates/gates.module";
import { PrMirrorRepository } from "./pr-sync.repository";
import { PrSyncService } from "./pr-sync.service";

@Module({
  imports: [DbModule, TicketSourcesModule, GatesModule],
  providers: [PrSyncService, PrMirrorRepository],
  exports: [PrSyncService],
})
export class PullRequestsModule {}
