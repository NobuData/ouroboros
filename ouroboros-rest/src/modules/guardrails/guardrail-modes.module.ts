/**
 * The guardrail-mode settings (AR.1, [#315](https://github.com/NobuData/ouroboros/issues/315)):
 * `GET`/`PATCH /api/v1/settings/guardrails`.
 *
 * A module of its own rather than a controller on `GuardrailsModule`, because that module imports
 * no `DbModule` on purpose — every evaluator statement goes through the change-set report's own
 * transaction. The settings route has no report to ride on, so it takes the database and the
 * audit trail here, and shares only the stateless `GuardrailsRepository` (whose `modes` read the
 * evaluator calls with the report's writer).
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { GuardrailModesController } from "./guardrail-modes.controller";
import { GuardrailModesService } from "./guardrail-modes.service";
import { GuardrailsRepository } from "./guardrails.repository";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [GuardrailModesController],
  providers: [GuardrailsRepository, GuardrailModesService],
})
export class GuardrailModesModule {}
