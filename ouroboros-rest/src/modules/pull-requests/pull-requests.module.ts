/**
 * `PullRequestsModule` — the PR plane's service layer (AX.1,
 * [#357](https://github.com/NobuData/ouroboros/issues/357)).
 *
 * It holds the SPI PR sync that mirrors V052's `pull_requests` and `pr_revisions` from a git host,
 * and imports the gate engine (`gates/`, #358), which every sync notifies. The criteria & evidence
 * service (`criteria/`, AX.3 #359) and its routes live here too, because a waiver's host annotation
 * goes through the sync service's `comment`. The merge executor (`merge/`, AX.4 #360) lives here
 * for the same reason — it merges, comments and mirrors through the sync service, reads the criteria
 * matrix for its evidence summary, and hears the gate engine on `GateListeners`. The page's reads and
 * head actions (`page/`, AX.5 #361) compose all of them — the criteria matrix, the merge plan, the
 * gate engine's sink, the sync's `requestReview` — plus AP.4's `ControlsService`. It
 * imports `TicketSourcesModule` for the registry and the credential opener, and reaches a host only
 * through the SPI — `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only` holds it
 * to that, and `ticket-source-core-tests-run-on-the-fake` holds its suites to the in-memory host.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ControlsModule } from "../controls/controls.module";
import { DbModule } from "../db/db.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { CriteriaController } from "./criteria/criteria.controller";
import { CriteriaRepository } from "./criteria/criteria.repository";
import { CriteriaService } from "./criteria/criteria.service";
import { GuardrailsRepository } from "../guardrails/guardrails.repository";
import { GatesModule } from "./gates/gates.module";
import { MergeController } from "./merge/merge.controller";
import { MergeExecutorService } from "./merge/merge.executor";
import { MergeRepository } from "./merge/merge.repository";
import { PageActionsService } from "./page/page.actions";
import { PageController } from "./page/page.controller";
import { PageRepository } from "./page/page.repository";
import { PageService } from "./page/page.service";
import { ThreadActionsService } from "./page/page.thread";
import { PrMirrorRepository } from "./pr-sync.repository";
import { PrSyncService } from "./pr-sync.service";

@Module({
  imports: [DbModule, AuditModule, TicketSourcesModule, GatesModule, ControlsModule],
  controllers: [CriteriaController, MergeController, PageController],
  providers: [
    PrSyncService,
    PrMirrorRepository,
    CriteriaService,
    CriteriaRepository,
    GuardrailsRepository,
    MergeRepository,
    MergeExecutorService,
    PageRepository,
    PageService,
    PageActionsService,
    ThreadActionsService,
  ],
  exports: [PrSyncService],
})
export class PullRequestsModule {}
