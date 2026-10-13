/**
 * The channel mirror (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)) — a
 * channel's stream, redrawn from **our own records** of it.
 *
 * The Chat Ops page shows what Ouroboros said in a channel and what people typed at it. Nothing
 * is fetched from Slack and nothing is a sample: every entry is a `chat_messages` or
 * `chat_commands` row, and every card is composed by the functions the publisher posts with
 * (`chat.cards.events.ts`, `chat.cards.decision.ts`), so the mirror cannot say a loop finished
 * in words Slack was not sent.
 *
 * ```
 * chat_messages   event_card     facts + refs ─▶ chat.record.ts ─▶ loopFinishedCard / build… / digest
 *                 decision_card  item + pinned kind (#457) ─▶ decisionCard | resolvedDecisionCard
 *                 system_line    facts {action, answered_by} + the kind ─▶ decisionSystemLine
 *                 command_reply  not an entry — the command carries its reply
 * chat_commands   the text as typed, who typed it, `reply`, and `settled_reply` as the result
 * ```
 *
 * **What comes from the row, and what is looked up.** A card's figures are the row's `facts`,
 * its state, outcome and answerer the row's own columns. Looked up are only the things a row
 * names by id: the run's loop number and the pull request (for the headline and the links), the
 * decision item and its pinned kind (for the question and its actions — the inbox owns those
 * words), the answerer's name, and a waiting card's escalation timer, which its footnote counts
 * down from at the moment of reading, as the Slack card does when it is rendered.
 *
 * **A row that cannot be drawn does not fail the page.** Each is skipped, or drawn with less,
 * on purpose:
 *
 * | Row | What the mirror does |
 * |---|---|
 * | an event card of a family this service has no card for | skipped |
 * | an event card whose refs name no run, or whose facts hold no counts | skipped |
 * | a digest | drawn from its record: headline, window and link — no KPI lines, no cost |
 * | a decision card whose item no longer exists | skipped — its question is the item's |
 * | a system line whose item no longer exists | drawn: the action reads as its id in words |
 * | a row whose composition throws (a kind version that is gone) | skipped, and logged |
 *
 * A skipped row still counts towards its page, so a page can hold fewer entries than `limit`;
 * `olderCursor` is what says whether there is more.
 */

import { Injectable, Logger } from "@nestjs/common";

import { decodeCursor, encodeCursor } from "../audit-plane/audit-plane.cursor";
import { chatChannelNotFound, chatCursorInvalid } from "../chatops/chatops.errors";
import { AppConfigService } from "../config/config.service";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import type { DecisionRef } from "../decisions/decision.types";
import { outcomeWords, refsOf } from "../decisions/inbox.compose";
import { InboxRepository } from "../decisions/inbox.repository";
import { inboxItemUrl } from "../inbox-channels/channel.links";
import { SlackRepository } from "../slack/slack.repository";
import { channelResource } from "../slack/slack.resources";
import type { ChatCard } from "../chat/chat.card";
import {
  answeredWords,
  answers,
  decisionCard,
  decisionSystemLine,
  resolvedDecisionCard,
} from "../chat/chat.cards.decision";
import {
  buildFailedCard,
  buildGreenCard,
  digestRecordCard,
  loopFinishedCard,
} from "../chat/chat.cards.events";
import { decisionSubject } from "../chat/chat.composer";
import { ChatEscalationRepository } from "../chat/chat.escalation.repository";
import {
  ChatMirrorRepository,
  type MirrorCommandRow,
  type MirrorMessageRow,
  type MirrorPullRequest,
} from "./chat.mirror.repository";
import {
  inAppHref,
  toMirrorCard,
  toMirrorCommand,
  toMirrorLine,
  type ChatMirrorResource,
  type MirrorEntry,
} from "./chat.mirror.resources";
import { DM_PURPOSE_TAG } from "../chat/chat.outbox";
import {
  recordedBuild,
  recordedDigest,
  recordedLoopFinished,
  type RecordSubject,
} from "../chat/chat.record";
import { ChatRepository } from "../chat/chat.repository";

/** A page's size when the caller names none, and the most it may ask for. */
export const MIRROR_PAGE_DEFAULT = 50;
export const MIRROR_PAGE_MAX = 100;

/** A row id, as the database stores one — anything else names nothing and is never queried. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The number a ref's label carries — `1846` of `loop #1846`, `514` of `PR #514`. */
const LABEL_NUMBER = /#(\d+)\b/;

/** A row of either table, at its place in the stream. */
type StreamRow =
  | { readonly from: "message"; readonly row: MirrorMessageRow }
  | { readonly from: "command"; readonly row: MirrorCommandRow };

/** What event cards name by id, read once for a page. */
interface Lookups {
  readonly loopSeqs: ReadonlyMap<string, number>;
  readonly pullRequests: readonly MirrorPullRequest[];
  readonly people: ReadonlyMap<string, string>;
}

/**
 * The number in a ref's label.
 *
 * @param label - `loop #1846`.
 * @returns `1846`, or null for a label with none.
 */
function labelNumber(label: string): number | null {
  const match = LABEL_NUMBER.exec(label);

  return match === null ? null : Number(match[1]);
}

/**
 * A non-negative whole number of a row's facts.
 *
 * @param value - The stored value.
 * @returns The number, or null.
 */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Whether a stream row sorts before another, newest first — by instant, then by id, the order
 * both queries return.
 *
 * @param a - A row.
 * @param b - Another.
 * @returns Negative when `a` is the newer.
 */
function newestFirst(a: StreamRow, b: StreamRow): number {
  // Fixed-width UTC text sorts as the instants do; uuids compare as their lower-case text.
  if (a.row.cursor_at !== b.row.cursor_at) {
    return a.row.cursor_at < b.row.cursor_at ? 1 : -1;
  }

  const [left, right] = [a.row.id.toLowerCase(), b.row.id.toLowerCase()];

  return left === right ? 0 : left < right ? 1 : -1;
}

@Injectable()
export class ChatMirrorService {
  private readonly logger = new Logger(ChatMirrorService.name);

  /**
   * @param mirror - The stream's rows, and what they name by id.
   * @param chat - How a decision ended.
   * @param escalations - A waiting decision's escalation timer.
   * @param slack - The channel and its connection.
   * @param inbox - Decision items.
   * @param registry - The kinds, pinned, and their rendering.
   * @param config - `OURO_UI_URL`, which card links are built on and taken off again.
   */
  constructor(
    private readonly mirror: ChatMirrorRepository,
    private readonly chat: ChatRepository,
    private readonly escalations: ChatEscalationRepository,
    private readonly slack: SlackRepository,
    private readonly inbox: InboxRepository,
    private readonly registry: DecisionKindRegistry,
    private readonly config: AppConfigService,
  ) {}

  /**
   * One page of a channel's stream.
   *
   * @param organizationId - The workspace.
   * @param channelId - The channel row's id, as the path carried it.
   * @param query - `before`, a previous page's `olderCursor`; and `limit`, 1–100.
   * @param now - The instant of reading, which a waiting card's footnote counts from.
   * @returns The channel, and its entries oldest first. An unbound channel is readable: its
   *   stream is whatever was said there.
   * @throws {NotFoundError} `404 chat_channel_not_found` for an id that is not a UUID, another
   *   workspace's channel, or a DM conversation the publisher opened.
   * @throws {InvalidRequestError} `422 chat_cursor_invalid` for a `before` this service did not
   *   issue.
   */
  async read(
    organizationId: string,
    channelId: string,
    query: { readonly before?: string; readonly limit?: number },
    now: Date = new Date(),
  ): Promise<ChatMirrorResource> {
    const channel = UUID.test(channelId)
      ? await this.slack.channel(organizationId, channelId)
      : undefined;

    if (channel === undefined || channel.purpose_tag === DM_PURPOSE_TAG) {
      throw chatChannelNotFound();
    }

    const before = query.before === undefined ? undefined : decodeCursor(query.before);

    if (query.before !== undefined && before === undefined) {
      throw chatCursorInvalid();
    }

    const limit = Math.min(Math.max(query.limit ?? MIRROR_PAGE_DEFAULT, 1), MIRROR_PAGE_MAX);

    // One more than a page from each table: together they say whether an older page exists.
    const [connection, routes, messages, commands] = await Promise.all([
      this.slack.connection(channel.connection_id),
      this.slack.channelRoutes(organizationId),
      this.mirror.messages(organizationId, channel.id, before, limit + 1),
      this.mirror.commands(organizationId, channel.id, before, limit + 1),
    ]);

    if (connection === undefined) {
      throw chatChannelNotFound();
    }

    const stream: StreamRow[] = [
      ...messages.map((row): StreamRow => ({ from: "message", row })),
      ...commands.map((row): StreamRow => ({ from: "command", row })),
    ].sort(newestFirst);
    const page = stream.slice(0, limit);
    const oldest = page.at(-1);
    const lookups = await this.lookups(
      organizationId,
      page.flatMap((entry) => (entry.from === "message" ? [entry.row] : [])),
    );
    const uiUrl = this.config.uiUrl;
    const entries = await Promise.all(
      page.map(async (entry): Promise<MirrorEntry | null> =>
        entry.from === "command"
          ? toMirrorCommand(entry.row, uiUrl)
          : this.message(organizationId, entry.row, lookups, now),
      ),
    );

    return {
      channel: channelResource(connection, channel, routes),
      platform: "slack",
      appVersion: connection.install_meta.app_version ?? null,
      entries: entries.filter((entry): entry is MirrorEntry => entry !== null).reverse(),
      olderCursor:
        stream.length > limit && oldest !== undefined
          ? encodeCursor({ at: oldest.row.cursor_at, id: oldest.row.id })
          : null,
    };
  }

  /**
   * Read, once for a page, what its rows name by id.
   *
   * @param organizationId - The workspace.
   * @param rows - The page's message rows.
   * @returns Loop numbers by run, the pull requests named, and answerers' names.
   */
  private async lookups(
    organizationId: string,
    rows: readonly MirrorMessageRow[],
  ): Promise<Lookups> {
    const runIds = new Set<string>();
    const prIds = new Set<string>();
    const userIds = new Set<string>();

    for (const row of rows) {
      if (row.resolved_by !== null) {
        userIds.add(row.resolved_by);
      }

      if (row.kind !== "event_card") {
        continue;
      }

      for (const ref of refsOf(row.refs)) {
        // A ref's id is whatever was stored; only a UUID can name a row, so only one is asked for.
        if (typeof ref.id === "string" && UUID.test(ref.id)) {
          if (ref.type === "run") {
            runIds.add(ref.id);
          } else if (ref.type === "pr") {
            prIds.add(ref.id);
          }
        }
      }
    }

    const [runs, pullRequests, people] = await Promise.all([
      this.mirror.runs(organizationId, [...runIds]),
      this.mirror.pullRequests(organizationId, [...prIds], [...runIds]),
      this.mirror.people([...userIds]),
    ]);

    return { loopSeqs: new Map(runs.map((run) => [run.id, run.loopSeq])), pullRequests, people };
  }

  /**
   * One message row as an entry — or nothing, for a row that cannot be drawn.
   *
   * @param organizationId - The workspace.
   * @param row - The row.
   * @param lookups - What the page's rows name.
   * @param now - The instant of reading.
   * @returns The entry, or null. Never rejects: a row whose composition fails is skipped and
   *   logged, so one bad record cannot take the page down.
   */
  private async message(
    organizationId: string,
    row: MirrorMessageRow,
    lookups: Lookups,
    now: Date,
  ): Promise<MirrorEntry | null> {
    try {
      switch (row.kind) {
        case "event_card":
          return this.eventCard(row, lookups);
        case "decision_card":
          return await this.decisionCard(organizationId, row, lookups, now);
        case "system_line":
          return await this.systemLine(organizationId, row);
        default:
          return null;
      }
    } catch (error) {
      this.logger.warn(`Chat message ${row.id} could not be mirrored: ${String(error)}`);

      return null;
    }
  }

  /**
   * An event card, from the row's facts and what its refs name.
   *
   * @param row - The row.
   * @param lookups - What the page's rows name.
   * @returns The card, or null for a family with no card or a row with too little to draw.
   */
  private eventCard(row: MirrorMessageRow, lookups: Lookups): MirrorEntry | null {
    const uiUrl = this.config.uiUrl;
    let card: ChatCard | undefined;

    if (row.card_kind === "digest") {
      const week = recordedDigest(row.facts);

      card = week === undefined ? undefined : digestRecordCard(week, uiUrl);
    } else {
      const subject = this.subject(row, lookups);

      if (subject === undefined) {
        return null;
      }

      switch (row.card_kind) {
        case "loop_finished":
          card = loopFinishedCard(recordedLoopFinished(row.facts, subject), uiUrl);
          break;
        case "build_green":
        case "build_failed": {
          const build = recordedBuild(row.facts, subject);

          if (build !== undefined) {
            card =
              row.card_kind === "build_green"
                ? buildGreenCard(build, uiUrl)
                : buildFailedCard(build, uiUrl);
          }

          break;
        }
        default:
          return null;
      }
    }

    return card === undefined ? null : toMirrorCard(row, card, { uiUrl });
  }

  /**
   * The run and pull request an event card is about.
   *
   * The run is the row's `run` ref; its loop number is the run's own, or the number in the
   * ref's label once the run is gone. The pull request is the row's `pr` ref when it has one;
   * otherwise the pull request of that run with the number the facts name (`pr_number`) — a row
   * that names neither has none.
   *
   * @param row - The row.
   * @param lookups - What the page's rows name.
   * @returns The subject, or undefined when the row names no run or its loop number is unknown.
   */
  private subject(row: MirrorMessageRow, lookups: Lookups): RecordSubject | undefined {
    const refs: readonly DecisionRef[] = refsOf(row.refs);
    const run = refs.find((ref) => ref.type === "run");

    if (run === undefined || typeof run.id !== "string") {
      return undefined;
    }

    const loopSeq = lookups.loopSeqs.get(run.id) ?? labelNumber(String(run.label));

    if (loopSeq === null) {
      return undefined;
    }

    const named = refs.find((ref) => ref.type === "pr");

    if (named !== undefined) {
      return {
        runId: run.id,
        loopSeq,
        prId: named.id,
        prNumber:
          lookups.pullRequests.find((pr) => pr.id === named.id)?.number ??
          labelNumber(String(named.label)),
      };
    }

    const prNumber = count(row.facts.pr_number);
    const opened =
      prNumber === null
        ? undefined
        : lookups.pullRequests.find((pr) => pr.runId === run.id && pr.number === prNumber);

    return { runId: run.id, loopSeq, prId: opened?.id ?? null, prNumber };
  }

  /**
   * A decision card, open or resolved **as the row says** — the mirror shows the card the
   * channel holds, which trails the decision by however long the edit takes to go out.
   *
   * @param organizationId - The workspace.
   * @param row - The row.
   * @param lookups - Answerers' names.
   * @param now - The instant of reading.
   * @returns The card, or null when the row names no decision or the decision is gone.
   */
  private async decisionCard(
    organizationId: string,
    row: MirrorMessageRow,
    lookups: Lookups,
    now: Date,
  ): Promise<MirrorEntry | null> {
    if (row.decision_item_id === null) {
      return null;
    }

    const item = await this.inbox.item(organizationId, row.decision_item_id);

    if (item === undefined) {
      return null;
    }

    const uiUrl = this.config.uiUrl;
    const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);
    const subject = decisionSubject(item, kind, this.registry.render(kind, item.payload));

    if (row.state !== "resolved") {
      const card = decisionCard(subject, {
        uiUrl,
        // No button here answers anything, so nothing is signed: each answering action only
        // needs to be present for its button to be drawn, and its target is the inbox item.
        values: new Map(
          kind.actions.filter((action) => answers(kind, action)).map((action) => [action.id, ""]),
        ),
        now,
        timer: await this.escalations.timer(item.id),
      });

      return toMirrorCard(row, card, {
        uiUrl,
        answerHref: inAppHref(inboxItemUrl(uiUrl, item.id), uiUrl),
      });
    }

    // The outcome, the answerer and the instant are the row's; the decision's own resolution
    // adds what the row does not keep — whether a policy answered, and through which channel.
    const settled = await this.chat.resolution(item.id);
    const actionId = row.outcome ?? settled?.actionId;

    if (actionId === undefined) {
      return null;
    }

    const actor = row.resolved_by === null ? null : (lookups.people.get(row.resolved_by) ?? null);
    const resolution = {
      resolver: settled?.resolver ?? "human",
      policy: settled?.policy ?? null,
      actionId,
      actorName: actor,
      channel: settled?.channel ?? "slack",
    } as const;

    return toMirrorCard(row, resolvedDecisionCard(subject, resolution), {
      uiUrl,
      resolution: {
        outcome:
          resolution.resolver === "policy"
            ? outcomeWords(resolution)
            : answeredWords(kind, actionId),
        actor,
        at: (row.resolved_at ?? row.posted_at).toISOString(),
      },
    });
  }

  /**
   * The line an answer left under its card, from the row's facts.
   *
   * @param organizationId - The workspace.
   * @param row - The row; its facts hold the `action` and who it was `answered_by`.
   * @returns The line, or null when the row records no action. A decision that no longer exists
   *   still has its line: the action is then said as its id in words, not by the kind's label.
   */
  private async systemLine(
    organizationId: string,
    row: MirrorMessageRow,
  ): Promise<MirrorEntry | null> {
    const actionId = row.facts.action;

    if (typeof actionId !== "string" || actionId === "") {
      return null;
    }

    const item =
      row.decision_item_id === null
        ? undefined
        : await this.inbox.item(organizationId, row.decision_item_id);
    const [kind, settled] =
      item === undefined
        ? [{ actions: [] }, undefined]
        : await Promise.all([
            this.registry.pinnedKind(item.kindId, item.kindVersion),
            this.chat.resolution(item.id),
          ]);
    const answeredBy = row.facts.answered_by;

    return toMirrorLine(
      row,
      decisionSystemLine(
        { kind, refs: refsOf(row.refs) },
        {
          resolver: settled?.resolver ?? "human",
          policy: settled?.policy ?? null,
          actionId,
          actorName: typeof answeredBy === "string" && answeredBy !== "" ? answeredBy : null,
          channel: settled?.channel ?? "slack",
        },
      ).text,
    );
  }
}
