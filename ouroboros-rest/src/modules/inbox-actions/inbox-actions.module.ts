/**
 * `InboxActionsModule` — the Needs-You action executor (BN.2,
 * [#462](https://github.com/NobuData/ouroboros/issues/462), decision **X3**).
 *
 * ```
 * inbox-actions.controller   POST /api/v1/inbox/items/:id/actions/:actionId
 * inbox-actions.service      validate · role check · claim (first answer wins) · handler · resolve
 * inbox-actions.handlers     one adapter per handler_binding, onto the plane that owns it
 * inbox-actions.repository   attempts (V099), the resolution (V095), the grant (V096), plane reads
 * ```
 *
 * A module of its own because it composes the planes — PR verification, controls, guardrails,
 * planning, facts — and every one of those imports `DecisionsModule` for its emitter. Living in
 * `DecisionsModule` would be a cycle; living here, nothing imports it.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ControlsModule } from "../controls/controls.module";
import { DbModule } from "../db/db.module";
import { DecisionsModule } from "../decisions/decisions.module";
import { FactsModule } from "../facts/facts.module";
import { GuardrailsModule } from "../guardrails/guardrails.module";
import { PlanningModule } from "../planning/planning.module";
import { PullRequestsModule } from "../pull-requests/pull-requests.module";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { InboxActionsController } from "./inbox-actions.controller";
import { InboxActionHandlers } from "./inbox-actions.handlers";
import { InboxActionsRepository } from "./inbox-actions.repository";
import { InboxActionsService } from "./inbox-actions.service";

@Module({
  imports: [
    DbModule,
    AuditModule,
    DecisionsModule,
    PullRequestsModule,
    ControlsModule,
    GuardrailsModule,
    PlanningModule,
    FactsModule,
  ],
  controllers: [InboxActionsController],
  providers: [
    InboxActionsRepository,
    InboxActionHandlers,
    InboxActionsService,
    CapabilityRepository,
  ],
  exports: [InboxActionsService],
})
export class InboxActionsModule {}
