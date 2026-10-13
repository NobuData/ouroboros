/**
 * The chat dispatcher (BZ.2, [#536](https://github.com/NobuData/ouroboros/issues/536)) — the
 * outbox's other half: what is due is sent, and every attempt ends in a recorded state.
 *
 * ```
 * tick ─▶ claim due rows (skip locked, leased)
 *      ─▶ per connection, one row at a time:
 *           where does it go?   a channel, or a DM opened now
 *           what does it say?   composed from current facts
 *           post / update       through the backend
 *           settle              sent · absorbed · skipped · retry · dead_lettered
 * ```
 *
 * **One message at a time per connection.** Slack limits posting per channel and per app; a
 * dispatcher that fans a connection's backlog out in parallel turns a busy minute into a wall of
 * `429`s. Connections are independent and run side by side ({@link CONNECTION_CONCURRENCY}); a
 * connection's own rows go in order.
 *
 * **A rate limit is an instruction.** When the platform says `Retry-After`, the row that heard
 * it waits at least that long, and so does every other row of that connection in the batch —
 * they are put back untried rather than sent into the same refusal.
 *
 * **Nothing vanishes.** A transient failure is retried with the webhook pipeline's backoff
 * (#487: 30 s doubling to an hour, jittered) up to {@link MAX_CHAT_ATTEMPTS}; then, or at once
 * for a message the platform will never take, the row is `dead_lettered` with its error — which
 * the connection's status reports, and logs say. A destination that is gone, or a decision that
 * no longer exists, is `skipped` with the reason: nothing was lost, there was nowhere to say it.
 *
 * **A duplicate is absorbed.** The message row is written before the post. If
 * `chat_messages_dedupe_key` (or the one-open-card rule) says the same thing is already in that
 * channel, the row is settled `absorbed` and nothing is posted.
 */

import { createHash } from "node:crypto";

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { describeForLog } from "../errors/failure";
import { retryDelayMs } from "../webhooks/webhook.backoff";
import { CHAT_BACKEND, type ChatBackend, type ChatSendFailure } from "./chat.backend";
import { ChatComposer, type ComposedChatMessage } from "./chat.composer";
import { ChatRepository, type ChatChannelTarget, type ClaimedChatRow } from "./chat.repository";

/** How many rows one tick claims. */
export const CHAT_DISPATCH_BATCH = 25;

/** How long a claim holds a row before it becomes due again unsettled. */
export const CHAT_DISPATCH_LEASE_MS = 120_000;

/** Attempts after which a row that keeps failing is dead-lettered. */
export const MAX_CHAT_ATTEMPTS = 8;

/** How many connections are published through at once. Each sends one message at a time. */
export const CONNECTION_CONCURRENCY = 4;

/** The injection token for the jitter's randomness, so a spec can fix it. */
export const CHAT_RANDOM = Symbol("CHAT_RANDOM");

/** How one row ended, this tick. */
export type ChatDispatchOutcome =
  "sent" | "absorbed" | "skipped" | "retried" | "dead_lettered" | "deferred";

/** What a tick did. */
export type ChatDispatchReport = Readonly<Record<ChatDispatchOutcome, number>> & {
  readonly claimed: number;
};

/** What one delivery did, and whether the platform asked the connection to wait. */
interface Delivered {
  readonly outcome: ChatDispatchOutcome;
  readonly waitSeconds?: number;
}

/**
 * The digest `chat_messages.payload_digest` stores.
 *
 * Over what the message *is* and where it goes — never its rendered text, which carries a
 * countdown and per-button nonces and so differs between two renderings of the same thing.
 *
 * @param channelId - `chat_channels.id`.
 * @param parts - What the message is.
 * @returns SHA-256, lower-case hex.
 */
export function payloadDigest(channelId: string, parts: readonly string[]): string {
  return createHash("sha256")
    .update([channelId, ...parts].join("\u001f"), "utf8")
    .digest("hex");
}

@Injectable()
export class ChatDispatcher {
  private readonly logger = new Logger(ChatDispatcher.name);

  /**
   * @param repository - The outbox and the message records.
   * @param composer - What each row says.
   * @param backend - The platform.
   * @param random - The backoff's jitter; `Math.random` unless a spec fixes it.
   */
  constructor(
    private readonly repository: ChatRepository,
    private readonly composer: ChatComposer,
    @Inject(CHAT_BACKEND) private readonly backend: ChatBackend,
    @Optional() @Inject(CHAT_RANDOM) private readonly random: () => number = Math.random,
  ) {}

  /**
   * Send what is due.
   *
   * @param now - The instant of the tick.
   * @returns How many rows were claimed and how each ended.
   */
  async tick(now: Date): Promise<ChatDispatchReport> {
    const claimed = await this.repository.claimDue(
      now,
      new Date(now.getTime() + CHAT_DISPATCH_LEASE_MS),
      CHAT_DISPATCH_BATCH,
    );
    const report: Record<ChatDispatchOutcome, number> = {
      sent: 0,
      absorbed: 0,
      skipped: 0,
      retried: 0,
      dead_lettered: 0,
      deferred: 0,
    };
    const byConnection = new Map<string, ClaimedChatRow[]>();

    for (const row of claimed) {
      byConnection.set(row.connectionId, [...(byConnection.get(row.connectionId) ?? []), row]);
    }

    const queues = [...byConnection.values()];

    for (let start = 0; start < queues.length; start += CONNECTION_CONCURRENCY) {
      const outcomes = await Promise.all(
        queues.slice(start, start + CONNECTION_CONCURRENCY).map((rows) => this.drain(rows, now)),
      );

      for (const outcome of outcomes.flat()) {
        report[outcome] += 1;
      }
    }

    return { claimed: claimed.length, ...report };
  }

  /**
   * Send one connection's rows in order, stopping when the platform says to wait.
   *
   * @param rows - The connection's claimed rows.
   * @param now - The instant of the tick.
   * @returns How each row ended.
   */
  private async drain(rows: readonly ClaimedChatRow[], now: Date): Promise<ChatDispatchOutcome[]> {
    const outcomes: ChatDispatchOutcome[] = [];

    for (const [index, row] of rows.entries()) {
      const delivered = await this.deliver(row, now);

      outcomes.push(delivered.outcome);

      if (delivered.waitSeconds !== undefined) {
        const rest = rows.slice(index + 1);

        await this.repository.defer(
          rest.map((waiting) => waiting.id),
          new Date(now.getTime() + delivered.waitSeconds * 1000),
        );
        outcomes.push(...rest.map(() => "deferred" as const));
        break;
      }
    }

    return outcomes;
  }

  /**
   * Deliver one row and settle it. Never throws: a failure to deliver is an outcome.
   *
   * @param row - The claimed row.
   * @param now - The instant of the tick.
   * @returns How it ended.
   */
  async deliver(row: ClaimedChatRow, now: Date): Promise<Delivered> {
    try {
      return await this.attempt(row, now);
    } catch (error) {
      this.logger.error(`Chat outbox row ${row.id} failed unexpectedly.`, describeForLog(error));

      return this.failed(
        row,
        {
          ok: false,
          error: error instanceof Error ? error.message : "unexpected failure",
          reason: "retry",
        },
        now,
        { channel: undefined, messageId: row.messageId },
      );
    }
  }

  /**
   * One attempt at one row.
   *
   * @param row - The claimed row.
   * @param now - The instant of the tick.
   * @returns How it ended.
   */
  private async attempt(row: ClaimedChatRow, now: Date): Promise<Delivered> {
    if (!(await this.repository.connectionActive(row.connectionId))) {
      return this.skip(row, "the connection is not active", now);
    }

    const target = await this.target(row, now);

    if ("failure" in target) {
      return this.failed(row, target.failure, now, {
        channel: undefined,
        messageId: row.messageId,
      });
    }

    if ("skip" in target) {
      return this.skip(row, target.skip, now);
    }

    const composed = await this.composer.compose(row, now);

    if ("skip" in composed) {
      return this.skip(row, composed.skip, now);
    }

    return row.operation === "update"
      ? this.update(row, target.channel, composed, now)
      : this.post(row, target.channel, composed, now);
  }

  /**
   * Where a row goes.
   *
   * @param row - The row.
   * @param now - When a DM's channel row is stamped.
   * @returns The channel; why there is nowhere to send it; or the platform's refusal to open a DM.
   */
  private async target(
    row: ClaimedChatRow,
    now: Date,
  ): Promise<{ channel: ChatChannelTarget } | { skip: string } | { failure: ChatSendFailure }> {
    if (row.channelId !== null) {
      const channel = await this.repository.channel(row.channelId);

      if (channel === undefined) {
        return { skip: "the channel no longer exists" };
      }

      return channel.archived ? { skip: "the channel is archived" } : { channel };
    }

    if (row.dmPlatformUserId === null) {
      return { skip: "the row names no target" };
    }

    const opened = await this.backend.openDm({
      connectionId: row.connectionId,
      platformUserId: row.dmPlatformUserId,
    });

    if (!opened.ok) {
      return { failure: opened };
    }

    return {
      channel: await this.repository.ensureDmChannel(
        row,
        row.dmPlatformUserId,
        opened.channelId,
        now,
      ),
    };
  }

  /**
   * Post a new message.
   *
   * @param row - The row.
   * @param channel - Where.
   * @param composed - What.
   * @param now - The instant of the tick.
   * @returns How it ended.
   */
  private async post(
    row: ClaimedChatRow,
    channel: ChatChannelTarget,
    composed: ComposedChatMessage,
    now: Date,
  ): Promise<Delivered> {
    let messageId = row.messageId;

    if (messageId !== null) {
      // An earlier attempt wrote the row. If that attempt's post did land, there is nothing to do.
      const earlier = await this.repository.message(messageId);

      if (earlier === undefined) {
        messageId = null;
      } else if (earlier.platformTs !== null) {
        return this.settled(row, "sent", { messageId }, now);
      }
    }

    if (messageId === null) {
      const written = await this.repository.insertMessage({
        organizationId: row.organizationId,
        channelId: channel.id,
        kind: row.messageKind,
        cardKind: row.cardKind,
        decisionItemId: row.decisionItemId,
        refs: composed.refs,
        facts: composed.facts,
        state: composed.state,
        resolution: composed.resolution,
        payloadDigest: payloadDigest(channel.id, composed.digestParts),
        at: now,
      });

      if (written.created) {
        messageId = written.id;
      } else if (written.existing === undefined) {
        return this.failed(
          row,
          { ok: false, error: "the message record could not be written", reason: "retry" },
          now,
          { channel, messageId: null },
        );
      } else if (written.existing.platformTs !== null) {
        // The same thing is already in the channel: nothing is posted.
        return this.settled(row, "absorbed", { messageId: written.existing.id }, now);
      } else {
        // Recorded by an attempt that never reached the platform; this one takes it over.
        messageId = written.existing.id;
      }
    }

    const sent = await this.backend.post({
      connectionId: row.connectionId,
      channelId: channel.platformChannelId,
      rendered: this.backend.render(composed.model),
    });

    if (!sent.ok) {
      return this.failed(row, sent, now, { channel, messageId });
    }

    await this.repository.stampPosted(messageId, sent.ts);

    return this.settled(row, "sent", { messageId, attempts: row.attempts + 1 }, now);
  }

  /**
   * Edit a stored card into its resolved form.
   *
   * @param row - The row.
   * @param channel - Where the card is.
   * @param composed - What it now says.
   * @param now - The instant of the tick.
   * @returns How it ended.
   */
  private async update(
    row: ClaimedChatRow,
    channel: ChatChannelTarget,
    composed: ComposedChatMessage,
    now: Date,
  ): Promise<Delivered> {
    const message =
      row.messageId === null ? undefined : await this.repository.message(row.messageId);

    if (message === undefined || message.platformTs === null) {
      return this.skip(row, "the card to edit was never posted", now);
    }

    if (message.state === "resolved") {
      return this.settled(row, "absorbed", { messageId: message.id }, now);
    }

    if (composed.resolution === null) {
      return this.skip(row, "the decision is not resolved", now);
    }

    const sent = await this.backend.update({
      connectionId: row.connectionId,
      channelId: channel.platformChannelId,
      ts: message.platformTs,
      rendered: this.backend.render(composed.model),
    });

    if (!sent.ok) {
      return this.failed(row, sent, now, { channel, messageId: message.id });
    }

    await this.repository.recordResolved(
      message.id,
      composed.resolution,
      payloadDigest(channel.id, composed.digestParts),
      now,
    );

    return this.settled(row, "sent", { messageId: message.id, attempts: row.attempts + 1 }, now);
  }

  /**
   * Settle a row as delivered or absorbed.
   *
   * @param row - The row.
   * @param status - `sent` or `absorbed`.
   * @param detail - The message and the attempts counted.
   * @param now - When.
   * @returns The outcome.
   */
  private async settled(
    row: ClaimedChatRow,
    status: "sent" | "absorbed",
    detail: { messageId: string; attempts?: number },
    now: Date,
  ): Promise<Delivered> {
    await this.repository.settle(row.id, status, detail, now);

    return { outcome: status };
  }

  /**
   * Settle a row as having nowhere to go or nothing to say.
   *
   * @param row - The row.
   * @param reason - Why.
   * @param now - When.
   * @returns The outcome.
   */
  private async skip(row: ClaimedChatRow, reason: string, now: Date): Promise<Delivered> {
    await this.repository.settle(row.id, "skipped", { error: reason }, now);

    return { outcome: "skipped" };
  }

  /**
   * Act on a refusal: skip, retry or dead-letter.
   *
   * @param row - The row.
   * @param failure - The backend's classified failure.
   * @param now - The instant of the tick.
   * @param context.channel - The channel, when the failure is about one.
   * @param context.messageId - The message row this attempt holds, kept for the next.
   * @returns The outcome, with the wait the platform asked for, if it asked.
   */
  private async failed(
    row: ClaimedChatRow,
    failure: ChatSendFailure,
    now: Date,
    context: { channel: ChatChannelTarget | undefined; messageId: string | null },
  ): Promise<Delivered> {
    const attempts = row.attempts + 1;

    if (failure.reason === "revoked") {
      return this.skip(row, `the connection was revoked: ${failure.error}`, now);
    }

    if (failure.reason === "gone") {
      if (context.channel !== undefined) {
        await this.repository.markChannelGone(context.channel.id, failure.error);
      }

      return this.skip(row, `the destination takes no messages: ${failure.error}`, now);
    }

    if (failure.reason === "rejected" || attempts >= MAX_CHAT_ATTEMPTS) {
      await this.repository.settle(
        row.id,
        "dead_lettered",
        { error: failure.error, messageId: context.messageId, attempts },
        now,
      );
      this.logger.error(
        `Chat outbox row ${row.id} (${row.cardKind}, route ${row.routeKind}) is dead-lettered ` +
          `after ${String(attempts)} attempt(s): ${failure.error}`,
      );

      return { outcome: "dead_lettered" };
    }

    const waitMs = Math.max(
      retryDelayMs(attempts, this.random),
      (failure.retryAfterSeconds ?? 0) * 1000,
    );

    await this.repository.retry(row.id, {
      attempts,
      nextAttemptAt: new Date(now.getTime() + waitMs),
      error: failure.error,
      messageId: context.messageId,
    });

    return failure.retryAfterSeconds === undefined
      ? { outcome: "retried" }
      : { outcome: "retried", waitSeconds: failure.retryAfterSeconds };
  }
}
