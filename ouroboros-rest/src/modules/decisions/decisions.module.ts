/**
 * `DecisionsModule` — the decision kind SPI and the Needs-You feed (BN.1,
 * [#461](https://github.com/NobuData/ouroboros/issues/461)).
 *
 * ```
 * decision-kind.registry   declarations · emit (validate → upsert → audit → lifecycle) · render · actions
 * decision.watchers        out-of-band detectors, the sweep, and its once-a-minute timer
 * decision.lifecycle       who hears that an item was filed, refreshed or resolved (#536)
 * inbox.feed / controller  GET /api/v1/inbox/feed — the sidebar badge
 * inbox.queue / controller GET /api/v1/inbox, /resolved, /stats, snooze (BN.4, #464)
 * ```
 *
 * It imports only `DbModule`, `AuditModule` and the scheduler, so every plane can import it for the registry and
 * the watcher without a cycle. **Emitter adapters live with their plane** — the gate engine's,
 * the guardrails', the facts', planning's, estimation's — and register their detectors here at
 * module init; nothing in this module names a kind.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { DecisionKindRegistry } from "./decision-kind.registry";
import { DecisionLifecycle } from "./decision.lifecycle";
import { DecisionRepository } from "./decision.repository";
import { DecisionSourceSweeper, DecisionSourceWatcher } from "./decision.watchers";
import { InboxController } from "./inbox.controller";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { InboxFeedService } from "./inbox.feed";
import { InboxQueueService } from "./inbox.queue";
import { InboxRepository } from "./inbox.repository";

@Module({
  imports: [DbModule, AuditModule, ScheduleModule.forRoot()],
  controllers: [InboxController],
  providers: [
    DecisionRepository,
    DecisionKindRegistry,
    DecisionLifecycle,
    DecisionSourceWatcher,
    DecisionSourceSweeper,
    InboxFeedService,
    InboxRepository,
    InboxQueueService,
    CapabilityRepository,
  ],
  exports: [DecisionKindRegistry, DecisionLifecycle, DecisionSourceWatcher],
})
export class DecisionsModule {}
