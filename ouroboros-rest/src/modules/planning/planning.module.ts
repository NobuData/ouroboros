/**
 * `PlanningModule` — mockup 09's server side, starting with the push.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)) brings the module in with
 * `PushService`, which writes a batch's drafts into a tracker through the ticket-source SPI and
 * nothing else: it reaches a provider through `TicketSourceRegistry` and opens a credential through
 * `TicketSourcesService`, both exported by `TicketSourcesModule`, and imports no provider —
 * `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only` fails the build if it
 * does, and `ticket-sources/boundary.spec.ts` watches that rule fail on this very path.
 *
 * It declares no route yet. `POST /api/v1/planning/batches/:batch/push` and its siblings are AL.4's
 * ([#280](https://github.com/NobuData/ouroboros/issues/280)), which is why {@link PushService} is
 * exported.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { PushRepository } from "./push.repository";
import { PushService } from "./push.service";

@Module({
  imports: [DbModule, TicketSourcesModule],
  providers: [PushService, PushRepository],
  exports: [PushService],
})
export class PlanningModule {}
