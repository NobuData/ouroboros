/**
 * The chat publisher (BZ.2, [#536](https://github.com/NobuData/ouroboros/issues/536)): one
 * renderer for everything Ouroboros says in a channel, published through an outbox and edited in
 * place when what it described changes.
 *
 * ```
 * chat.card.ts               the card model — no platform in it
 * chat.cards.decision.ts     decision cards, from the kind registry's own words (#457)
 * chat.cards.events.ts       loop finished · build green · build failed · digest
 * chat.backend.ts            the port a platform implements        ◀── slack/slack.chat-backend.ts
 * chat.outbox.ts             route evaluation + the intent, in the caller's transaction
 * chat.publisher.ts          decision lifecycle and due digests ─▶ intents
 * chat.dispatcher.ts         intents ─▶ the platform, with retry, dedupe and dead letters
 * chat.composer.ts           what an intent says, from current facts
 * chat.escalation.ts         due timers ─▶ item escalated, cards annotated, on-call DMed (#538)
 * chat.answers.ts            a button press ─▶ the inbox's action executor, as its presser (#538)
 * ```
 *
 * The backend is bound to Slack's here and nowhere else: a second platform (#547) is a second
 * implementation of `ChatBackend` and a choice at this line.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { DecisionsModule } from "../decisions/decisions.module";
import { InboxActionsModule } from "../inbox-actions/inbox-actions.module";
import { InboxChannelsModule } from "../inbox-channels/inbox-channels.module";
import { InsightsModule } from "../insights/insights.module";
import { SlackChatBackend } from "../slack/slack.chat-backend";
import { SlackModule } from "../slack/slack.module";
import { SlackPressHandler } from "../slack/slack.press-handler";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { OrganizationRepository } from "../tenancy/organization.repository";
import { ChatAnswers } from "./chat.answers";
import { CHAT_BACKEND } from "./chat.backend";
import { ChatComposer } from "./chat.composer";
import { ChatDispatcher } from "./chat.dispatcher";
import { ChatEscalation } from "./chat.escalation";
import { ChatEscalationRepository } from "./chat.escalation.repository";
import { ChatPublisher } from "./chat.publisher";
import { ChatRepository } from "./chat.repository";
import { ChatScheduler } from "./chat.scheduler";

@Module({
  imports: [
    DbModule,
    AuditModule,
    DecisionsModule,
    InboxActionsModule,
    InboxChannelsModule,
    InsightsModule,
    SlackModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    ChatRepository,
    ChatEscalationRepository,
    ChatEscalation,
    ChatComposer,
    ChatDispatcher,
    ChatPublisher,
    ChatScheduler,
    ChatAnswers,
    OrganizationRepository,
    CapabilityRepository,
    SlackChatBackend,
    // Slack's button presses reach `ChatAnswers` through this, registered with the inbound
    // service at start — the same one-line binding as the backend above.
    SlackPressHandler,
    { provide: CHAT_BACKEND, useExisting: SlackChatBackend },
  ],
  exports: [ChatComposer, ChatPublisher],
})
export class ChatModule {}
