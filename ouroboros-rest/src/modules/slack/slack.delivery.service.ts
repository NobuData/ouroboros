/**
 * Retrying what Slack did not take (CA.5, [#545](https://github.com/NobuData/ouroboros/issues/545)).
 *
 * ```
 * a publish fails ─▶ retried with backoff ─▶ attempts run out ─▶ dead_lettered, kept with its error
 * retry (here)    ─▶ every dead letter of the last seven days ─▶ pending, due now, attempts cleared
 *                 ─▶ audit chat.delivery_retried
 * ```
 *
 * **The whole queue, not one row.** A dead letter is a symptom of something an administrator has
 * just fixed — the bot invited back, a scope granted — and the fix applies to all of them. The
 * dispatcher takes them on its next tick; one that still fails starts its retry schedule again.
 *
 * **Nothing is said twice.** A row is queued again as itself: its dedupe key and its message row
 * stand (`chat.repository.ts`).
 */

import { Injectable } from "@nestjs/common";

import { CHAT_DELIVERY_RETRIED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { slackNotConnected } from "./slack.errors";
import { SlackRepository } from "./slack.repository";

@Injectable()
export class SlackDeliveryService {
  /**
   * @param repository - The connection and its outbox.
   * @param audit - The audit plane.
   */
  constructor(
    private readonly repository: SlackRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Queue the workspace's dead-lettered messages again.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @returns How many messages were queued — zero when there was nothing to retry, which is not
   *   an error and is not audited.
   * @throws {ConflictError} `409 slack_not_connected` — no active connection to publish through.
   */
  async retry(organizationId: string, actorId: string): Promise<number> {
    const connection = await this.repository.connectionOf(organizationId);

    if (connection?.status !== "active") {
      throw slackNotConnected();
    }

    const at = new Date();
    const queued = await this.repository.requeueDeadLetters(connection.id, at);

    if (queued.length > 0) {
      await this.audit.record({
        organizationId,
        actorId,
        action: CHAT_DELIVERY_RETRIED_EVENT,
        subjectType: "chat_connection",
        subjectId: connection.id,
        at,
        detail: { messages: queued.length, routes: [...new Set(queued)].sort().join(",") },
      });
    }

    return queued.length;
  }
}
