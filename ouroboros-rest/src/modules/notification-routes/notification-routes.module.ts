/**
 * Org-level notification routes (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488)):
 * the Settings notifications card, layered above BN.3's per-person preferences.
 *
 * ```
 * catalog      kinds · channels · the locked-row rule · the config check     → routes.catalog.ts
 * management   /settings/notifications — list, read, save (audited)          → routes.controller.ts / .service.ts
 * schedule     when a daily or weekly route is due                           → routes.schedule.ts
 * sender       claim · send · settle, per address                            → routes.sender.ts
 * scheduler    when the sender runs                                          → routes.scheduler.ts
 * ```
 *
 * The content is the senders' own: the daily digest is composed by BN.3's `DecisionMailService`
 * (read-only, no tokens) and the weekly report by #440's `DigestRouteComposer`. This module decides
 * only *when* and *to whom*, and keeps its own send log, so neither sender's per-person behaviour
 * changes.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { InboxChannelsModule } from "../inbox-channels/inbox-channels.module";
import { DecisionMailService } from "../inbox-channels/mail/decision-mail.service";
import { DigestRouteComposer } from "../insights/digest/digest.route";
import { InsightsModule } from "../insights/insights.module";
import { MailModule } from "../mail/mail.module";
import { NotificationRoutesController } from "./routes.controller";
import { NotificationRoutesRepository } from "./routes.repository";
import { NotificationRoutesScheduler } from "./routes.scheduler";
import { OrgRouteSender, ROUTE_COMPOSERS, type RouteComposers } from "./routes.sender";
import { NotificationRoutesService } from "./routes.service";

@Module({
  imports: [
    DbModule,
    AuditModule,
    MailModule,
    InboxChannelsModule,
    InsightsModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [NotificationRoutesController],
  providers: [
    NotificationRoutesRepository,
    NotificationRoutesService,
    OrgRouteSender,
    NotificationRoutesScheduler,
    {
      provide: ROUTE_COMPOSERS,
      inject: [DecisionMailService, DigestRouteComposer],
      useFactory: (daily: DecisionMailService, weekly: DigestRouteComposer): RouteComposers => ({
        daily_digest: {
          compose: (organizationId: string, _workspaceName: string, slot: Date) =>
            daily.orgDigestMail(organizationId, slot),
        },
        weekly_insights: weekly,
      }),
    },
  ],
})
export class NotificationRoutesModule {}
