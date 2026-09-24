/**
 * `PullRequestsModule` — the PR plane's service layer (AX.1,
 * [#357](https://github.com/NobuData/ouroboros/issues/357)).
 *
 * Today it holds the SPI PR sync that mirrors V052's `pull_requests` and `pr_revisions` from a git
 * host. The gate engine (#358), the merge executor (#360) and their routes land beside it. It
 * imports `TicketSourcesModule` for the registry and the credential opener, and reaches a host only
 * through the SPI — `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only` holds it
 * to that, and `ticket-source-core-tests-run-on-the-fake` holds its suites to the in-memory host.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { PrMirrorRepository } from "./pr-sync.repository";
import { PrSyncService } from "./pr-sync.service";

@Module({
  imports: [DbModule, TicketSourcesModule],
  providers: [PrSyncService, PrMirrorRepository],
  exports: [PrSyncService],
})
export class PullRequestsModule {}
