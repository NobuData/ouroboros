/**
 * The channel mirror's route (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)):
 *
 * ```
 * GET /api/v1/chat/channels/{id}/mirror?before=…&limit=…   any member   a channel's stream
 * ```
 *
 * **Every member reads**, as every member reads the channel list (`slack.channels.controller.ts`):
 * what Ouroboros said in a channel of the workspace is the workspace's to see. Nothing is written
 * here — a command typed under a mirror goes to `POST /api/v1/chat/commands` with the channel's
 * id — and nothing is answered here: an open question's buttons lead to the Needs-you inbox.
 */

import { Controller, Get, Param, Query } from "@nestjs/common";

import { CHAT_ROUTE } from "../chatops/chatops.controller";
import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ChatMirrorQuery } from "./chat.mirror.dto";
import type { ChatMirrorResource } from "./chat.mirror.resources";
import { ChatMirrorService } from "./chat.mirror.service";

@Controller(`${CHAT_ROUTE}/channels`)
export class ChatMirrorController {
  /** @param mirror - Composes the stream. */
  constructor(private readonly mirror: ChatMirrorService) {}

  /**
   * `GET /chat/channels/{id}/mirror` — one page of the channel's stream, oldest first.
   *
   * @param tenant - The workspace.
   * @param id - The channel row's id.
   * @param query - `before` and `limit`.
   * @returns The channel, its entries, and the cursor for the page before.
   * @throws {NotFoundError} `404 chat_channel_not_found` for an id that is not a UUID, another
   *   workspace's channel, or a DM conversation.
   * @throws {InvalidRequestError} `422 chat_cursor_invalid` for a `before` this service did not
   *   issue; `422 validation_failed` for a `limit` outside 1–100.
   */
  @Get(":id/mirror")
  read(
    @CurrentTenant() tenant: Organization,
    @Param("id") id: string,
    @Query() query: ChatMirrorQuery,
  ): Promise<ChatMirrorResource> {
    return this.mirror.read(tenant.id, id, query);
  }
}
