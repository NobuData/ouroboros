/**
 * The Workflow Copilot — CD.1 ([#559](https://github.com/NobuData/ouroboros/issues/559)).
 *
 * copilot.controller.ts   the routes under /workflows/{id}/copilot
 * copilot.service.ts      sessions, exchanges, answers, continuity, the etag-guarded apply
 * copilot.exchange.ts     the loop: turns, tools, bounces, conflicts, W7
 * copilot.operations.ts   the typed operation vocabulary, validated against the DSL
 * copilot.references.ts   W7 — what does not resolve, named
 * copilot.context.ts      the grounding: catalog, skills, task routes, guards
 * copilot.guards.ts       the guard vocabulary (the org policy's core rules)
 * copilot.repository.ts   the statements, including apply_draft_batch()
 * copilot.stream.ts       the server-sent events
 * copilot.resources.ts    the API shapes
 * copilot.dto.ts          the bodies and params
 * copilot.errors.ts       the codes
 *
 * Imports `WorkflowsModule` for the catalog and P7's catalogue, `RoutingModule` for Z.1's
 * resolution of the `copilot-workflow` kind, and `EngineModule` for the turn. It exports nothing:
 * the conversation is reached through its routes.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { RoutingModule } from "../routing/routing.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { CopilotContextService } from "./copilot.context";
import { CopilotController } from "./copilot.controller";
import { CopilotRepository } from "./copilot.repository";
import { CopilotService } from "./copilot.service";

@Module({
  imports: [DbModule, EngineModule, RoutingModule, WorkflowsModule],
  controllers: [CopilotController],
  providers: [CopilotService, CopilotRepository, CopilotContextService],
})
export class CopilotModule {}
