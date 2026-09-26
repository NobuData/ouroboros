/**
 * Classification & routing — AT.4 ([#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * ```
 * controller   /api/v1/test-runs/:id/{hints,classifications,cases/:caseId/classify,rerun,waivers}
 * service      the hints, the decision, and the three routes → triage.service.ts
 * rules        the heuristic hints, pure                      → triage.rules.ts
 * contract     POST /v0/triage, committed for AV.1 (#343)      → triage.contract.ts
 * repository   the statements, and nothing else               → triage.repository.ts
 * ```
 *
 * It composes over two modules rather than reaching beneath them: `ControlsModule` for the
 * correction round (its service's `correctionRound`, so AP.4's role policy and audit apply) and
 * `FarmDispatchModule` for re-runs (`FarmJobsService.submitRerun`, so AH.4's audit and dispatch
 * apply). It exports nothing.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ControlsModule } from "../controls/controls.module";
import { DbModule } from "../db/db.module";
import { FarmDispatchModule } from "../farm/dispatch/dispatch.module";
import { TriageController } from "./triage.controller";
import { TriageRepository } from "./triage.repository";
import { TriageService } from "./triage.service";

@Module({
  imports: [DbModule, AuditModule, ControlsModule, FarmDispatchModule],
  controllers: [TriageController],
  providers: [TriageRepository, TriageService],
})
export class TriageModule {}
