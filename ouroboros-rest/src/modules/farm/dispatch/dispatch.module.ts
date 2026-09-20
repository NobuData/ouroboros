/**
 * Build dispatch — submission, eligibility, offers, retries and cancellation, as a module.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)) under epic
 * [#240](https://github.com/NobuData/ouroboros/issues/240). The layers, with the files that carry
 * the issue's criteria named beside them:
 *
 * ```
 * the route      jobs.controller.ts     POST /farm/jobs · POST /farm/jobs/:id/cancel (member+)
 * the surface    jobs.service.ts        submit · submitForRun (AJ.3's, defined, not wired) · cancel
 * the loop       dispatcher.ts          kick/drain · tick · the agents' answers · stale-work cancels
 * the rows       dispatch.repository.ts eligibility · placement under the runner's lock · q:N
 *                job.lifecycle.ts       numbering · attempts · the retry — shared with the gateway
 * the rules      job.states.ts          the state machine; an illegal move throws
 *                dispatch.policy.ts     every number, once
 *                command.ts · offer.ts  argv ⇄ stored text · a row as its job.offer
 * the seams      dispatch.gate.ts       #489's pause (open until then)
 *                job.completions.ts     #510's build counter (non-blocking)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **It imports the gateway and the gateway does not import it.** Dispatch reaches runners through
 * `AgentSessions` and hears their answers through its listeners — the seam AH.3 built for exactly
 * this — so the gateway never needs to know dispatch exists. The one thing the two share below the
 * module line is `job.lifecycle.ts`, a function over a transaction, because an `errored` finish has
 * to create its retry inside the gateway's ledger transaction.
 *
 * **It exports three things, each for a named ticket:** `FarmJobsService` for AJ.3
 * ([#265](https://github.com/NobuData/ouroboros/issues/265)), whose workflow build stage calls
 * `submitForRun`, and for AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)), whose
 * runners table reads `queueDepth`; `JobCompletions` for BV.1
 * ([#510](https://github.com/NobuData/ouroboros/issues/510)); and the `FARM_DISPATCH_GATE` token
 * for BR.5 ([#489](https://github.com/NobuData/ouroboros/issues/489)) to bind its own gate to.
 *
 * **`FarmAudit` is provided here, not imported with `FarmModule`** — `fleet.module.ts`'s
 * arrangement. It is a thin writer over `AuditService` with no state of its own, so a second
 * instance is the same trail, and taking it this way keeps dispatch from depending on the
 * enrollment module for one class (#260's `runner.job_submitted`).
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../../audit/audit.module";
import { DbModule } from "../../db/db.module";
import { FarmAudit } from "../farm.audit";
import { FarmGatewayModule } from "../gateway/gateway.module";
import { FARM_DISPATCH_GATE, OPEN_GATE } from "./dispatch.gate";
import { DispatchRepository } from "./dispatch.repository";
import { DispatchService } from "./dispatcher";
import { JobCompletions } from "./job.completions";
import { FarmJobsController } from "./jobs.controller";
import { FarmJobsService } from "./jobs.service";

@Module({
  imports: [DbModule, AuditModule, FarmGatewayModule],
  controllers: [FarmJobsController],
  providers: [
    DispatchRepository,
    DispatchService,
    FarmJobsService,
    JobCompletions,
    FarmAudit,
    // Open until BR.5 (#489) makes a workspace's pause an organization state.
    { provide: FARM_DISPATCH_GATE, useValue: OPEN_GATE },
  ],
  exports: [FarmJobsService, JobCompletions, FARM_DISPATCH_GATE],
})
export class FarmDispatchModule {}
