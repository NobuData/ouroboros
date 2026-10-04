/**
 * `InboxChannelsModule` — the two real decision channels (BN.3,
 * [#463](https://github.com/NobuData/ouroboros/issues/463), decision **X5**).
 *
 * ```
 * mirror/          one PR comment per decision, edited on refresh and resolution (lifecycle listener)
 * tokens/          single-use action tokens: HMAC under a vault-sealed workspace key (V096, V100)
 * mail/            instant mails for err items and the daily digest, rows carrying tokens
 * answer/          GET/POST /api/v1/inbox/answer/{token} — the confirm page; merge-class needs a session
 * notifications/   per person per workspace preferences — GET/PATCH /api/v1/inbox/notifications
 * channels.*       GET /api/v1/inbox/channels — the channel truth payload; the minute tick
 * ```
 *
 * Its own module because it sits above everything it uses: it hears `DecisionsModule`'s lifecycle,
 * answers through `InboxActionsModule`'s executor, and comments through `PullRequestsModule`'s sync
 * — all of which import `DecisionsModule`, so none of them can host it without a cycle.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { DecisionsModule } from "../decisions/decisions.module";
import { InboxActionsModule } from "../inbox-actions/inbox-actions.module";
import { MailModule } from "../mail/mail.module";
import { PullRequestsModule } from "../pull-requests/pull-requests.module";
import { TicketSourcesModule } from "../ticket-sources/ticket-sources.module";
import { VaultModule } from "../vault/vault.module";
import { AnswerController } from "./answer/answer.controller";
import { AnswerService } from "./answer/answer.service";
import { ChannelsController } from "./channels.controller";
import { ChannelsScheduler } from "./channels.scheduler";
import { ChannelsService } from "./channels.service";
import { DecisionMailRepository } from "./mail/decision-mail.repository";
import { DecisionMailService } from "./mail/decision-mail.service";
import { MirrorRepository } from "./mirror/mirror.repository";
import { DecisionMirrorService } from "./mirror/mirror.service";
import { PreferencesRepository } from "./notifications/preferences.repository";
import { NotificationPreferencesService } from "./notifications/preferences.service";
import { ActionTokenRepository } from "./tokens/action-token.repository";
import { ActionTokenService } from "./tokens/action-token.service";

@Module({
  imports: [
    DbModule,
    DecisionsModule,
    InboxActionsModule,
    PullRequestsModule,
    TicketSourcesModule,
    MailModule,
    VaultModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [ChannelsController, AnswerController],
  providers: [
    ActionTokenRepository,
    ActionTokenService,
    MirrorRepository,
    DecisionMirrorService,
    PreferencesRepository,
    NotificationPreferencesService,
    DecisionMailRepository,
    DecisionMailService,
    AnswerService,
    ChannelsService,
    ChannelsScheduler,
  ],
  exports: [ActionTokenService, DecisionMirrorService, DecisionMailService],
})
export class InboxChannelsModule {}
