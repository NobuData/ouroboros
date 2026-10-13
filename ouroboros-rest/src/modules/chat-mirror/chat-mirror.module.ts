/**
 * The channel mirror (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)): a Slack
 * channel's stream on the Chat Ops page, redrawn from this service's own records.
 *
 * ```
 * chat.mirror.controller.ts   GET /api/v1/chat/channels/{id}/mirror
 * chat.mirror.service.ts      rows ─▶ the publisher's own cards ─▶ entries, one page
 * chat.mirror.repository.ts   chat_messages · chat_commands · what they name by id
 * chat.mirror.resources.ts    the wire shape — links as in-app paths, answers as inbox links
 * ```
 *
 * **Why a module of its own.** The mirror is where three things meet that are kept apart
 * everywhere else: the platform-neutral card model (`chat/`, which imports nothing of Slack's —
 * `chat.card.spec.ts` holds it to that), the Slack channel it is a mirror of (`slack/`), and the
 * command trail (`chatops/`, whose core may reach no plane). It imports each and none of them
 * imports it, so no boundary moves: a second platform's mirror (#547) is a second reader of the
 * same cards.
 *
 * **`ChatRepository` and `ChatEscalationRepository` are provided here**, as `chat.module.ts`
 * provides `OrganizationRepository`: they are stateless reads over the database, and importing
 * `ChatModule` for them would pull in its dispatcher and scheduler.
 */

import { Module } from "@nestjs/common";

import { ChatEscalationRepository } from "../chat/chat.escalation.repository";
import { ChatRepository } from "../chat/chat.repository";
import { DbModule } from "../db/db.module";
import { DecisionsModule } from "../decisions/decisions.module";
import { SlackStoreModule } from "../slack/slack.store.module";
import { ChatMirrorController } from "./chat.mirror.controller";
import { ChatMirrorRepository } from "./chat.mirror.repository";
import { ChatMirrorService } from "./chat.mirror.service";

@Module({
  imports: [DbModule, DecisionsModule, SlackStoreModule],
  controllers: [ChatMirrorController],
  providers: [ChatMirrorRepository, ChatMirrorService, ChatRepository, ChatEscalationRepository],
})
export class ChatMirrorModule {}
