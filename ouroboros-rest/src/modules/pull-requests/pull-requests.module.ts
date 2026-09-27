/**
 * `PullRequestsModule` — the PR plane's service layer (AX.1,
 * [#357](https://github.com/NobuData/ouroboros/issues/357)).
 *
 * It holds the SPI PR sync that mirrors V052's `pull_requests` and `pr_revisions` from a git host,
 * and imports the gate engine (`gates/`, #358), which every sync notifies. The criteria & evidence
 * service (`criteria/`, AX.3 #359) and its routes live here too, because a waiver's host annotation
 * goes through the sync service's `comment`. The merge executor (#360) lands beside them. It
 * imports `TicketSourcesModule` for the registry and the credential opener, and reaches a host only
 * through the SPI — `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only` holds it
 * to that, and `ticket-source-core-tests-run-on-the-fake` holds its suites to the in-memory host.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { CriteriaController } from "./criteria/criteria.controller";
import { CriteriaRepository } from "./criteria/criteria.repository";
import { CriteriaService } from "./criteria/criteria.service";
import { GatesModule } from "./gates/gates.module";
import { PrMirrorRepository } from "./pr-sync.repository";
import { PrSyncService } from "./pr-sync.service";

@Module({
  imports: [DbModule, AuditModule, TicketSourcesModule, GatesModule],
  controllers: [CriteriaController],
  providers: [PrSyncService, PrMirrorRepository, CriteriaService, CriteriaRepository],
  exports: [PrSyncService],
})
export class PullRequestsModule {}
