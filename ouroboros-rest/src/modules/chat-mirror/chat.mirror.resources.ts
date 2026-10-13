/**
 * What the channel mirror answers with (CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)) — pure.
 *
 * `GET /api/v1/chat/channels/{id}/mirror` is a channel's stream as the Chat Ops page draws it:
 * cards, system lines and commands, oldest first. Nothing here writes a word about a loop, a
 * build or a decision — a card arrives as the {@link ChatCard} the Slack publisher renders
 * (`chat.card.ts`) and leaves as the same headline, lines, stats, actions and footnote, with two
 * things changed for a page inside the app:
 *
 * - **Links are in-app paths.** A card's links are absolute URLs on the UI origin, because
 *   Slack needs them so; here the origin is taken off ({@link inAppHref}).
 * - **Nothing is answered from the mirror.** An open decision's answer buttons keep their
 *   labels and styles and lead to the item in the Needs-you inbox instead of carrying a signed
 *   value.
 */

import type { ChatCommandOutcome, ChatCommandSurface, ChatSettledReply } from "../db/schema";
import type { SlackChannelResource } from "../slack/slack.resources";
import type { ChatCard, ChatSeverity } from "../chat/chat.card";
import type { MirrorCommandRow, MirrorMessageRow } from "./chat.mirror.repository";

/** A button under a mirrored card — always a link. */
export interface MirrorAction {
  readonly id: string;
  readonly label: string;
  /** An in-app path: a PR page, a run console, the inbox item. Never an absolute URL. */
  readonly href: string;
  readonly style: "primary" | "danger" | "default";
}

/** A card of the stream. */
export interface MirrorCard {
  readonly type: "card";
  /** `chat_messages.id`. */
  readonly id: string;
  /** When it was posted. */
  readonly at: string;
  /** `loop_finished`, `build_green`, `build_failed`, `digest`, or a decision kind's id. */
  readonly family: string;
  readonly severity: ChatSeverity;
  readonly mark: string;
  readonly headline: string;
  readonly lines: readonly string[];
  readonly stats: string | null;
  /** Empty for a resolved decision card. */
  readonly actions: readonly MirrorAction[];
  readonly footnote: string | null;
  /** A decision card's state; null for an event card. */
  readonly state: "open" | "resolved" | null;
  /** How a resolved decision card ended; null for everything else. */
  readonly resolution: MirrorResolution | null;
  /** When the decision's escalation was noted on the card; null when it never was. */
  readonly escalatedAt: string | null;
}

/** How a decision card ended. */
export interface MirrorResolution {
  /** The answer in words — `allow once`. */
  readonly outcome: string;
  /** The person who answered; null for a policy, or a person since removed. */
  readonly actor: string | null;
  readonly at: string;
}

/** A system line of the stream. */
export interface MirrorLine {
  readonly type: "line";
  readonly id: string;
  readonly at: string;
  readonly text: string;
}

/** What a command said. */
export interface MirrorReply {
  readonly text: string;
  /** `href` is an in-app path when the stored URL is on the UI origin, else the absolute URL. */
  readonly link: { readonly label: string; readonly href: string } | null;
  readonly at: string | null;
}

/** A command of the stream, with what it said. */
export interface MirrorCommand {
  readonly type: "command";
  /** `chat_commands.id`. */
  readonly id: string;
  /** When it was typed. */
  readonly at: string;
  readonly surface: ChatCommandSurface;
  /** As typed, with its prefix — `/ouro status`. */
  readonly text: string;
  /** Who it acted as; null for an unlinked attempt or a person since deleted. */
  readonly author: { readonly name: string } | null;
  readonly outcome: ChatCommandOutcome;
  /** What it said at once; null for a row recorded before replies were kept. */
  readonly reply: MirrorReply | null;
  /** What an async command said when it finished; null until then, and for any other command. */
  readonly result: MirrorReply | null;
}

/** One entry of the stream. */
export type MirrorEntry = MirrorCard | MirrorLine | MirrorCommand;

/** `GET /api/v1/chat/channels/{id}/mirror`. */
export interface ChatMirrorResource {
  readonly channel: SlackChannelResource;
  readonly platform: "slack";
  /** The Slack app's manifest version the connection was installed at. */
  readonly appVersion: string | null;
  /** One page, oldest first. */
  readonly entries: readonly MirrorEntry[];
  /** `?before=` for the page before this one; null at the start of the channel's history. */
  readonly olderCursor: string | null;
}

/**
 * A stored or composed URL as a page inside the app addresses it.
 *
 * @param url - An absolute URL, or a path.
 * @param uiUrl - `OURO_UI_URL`.
 * @returns The path when `url` is on the UI origin or already a path (`/prs/…`); otherwise
 *   `url` unchanged — somewhere else, which a caller may keep or refuse.
 */
export function inAppHref(url: string, uiUrl: string): string {
  const origin = uiUrl.replace(/\/+$/, "");

  if (url === origin) {
    return "/";
  }

  return url.startsWith(`${origin}/`) ? url.slice(origin.length) : url;
}

/**
 * Whether an href is a path inside the app.
 *
 * @param href - What {@link inAppHref} answered.
 * @returns True for `/…` — and not for `//host`, which a browser reads as another origin.
 */
function isPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/**
 * A card's actions as the mirror offers them.
 *
 * @param card - The card.
 * @param input.uiUrl - `OURO_UI_URL`.
 * @param input.answerHref - Where an answer button leads — the decision's inbox item; null for
 *   a card that has no decision, whose answer actions (it has none) are dropped.
 * @returns Links only. A link action that leads off the UI origin is dropped: a mirrored card
 *   never sends the reader somewhere the card model did not build.
 */
export function mirrorActions(
  card: ChatCard,
  input: { readonly uiUrl: string; readonly answerHref: string | null },
): MirrorAction[] {
  const actions: MirrorAction[] = [];

  for (const action of card.actions) {
    if (action.type === "answer") {
      if (input.answerHref !== null) {
        actions.push({
          id: action.id,
          label: action.label,
          href: input.answerHref,
          style: action.style,
        });
      }

      continue;
    }

    const href = inAppHref(action.url, input.uiUrl);

    if (isPath(href)) {
      actions.push({ id: action.id, label: action.label, href, style: "default" });
    }
  }

  return actions;
}

/**
 * A card of the stream.
 *
 * @param row - Its message row.
 * @param card - The card model composed from the row.
 * @param input.uiUrl - `OURO_UI_URL`.
 * @param input.answerHref - Where an open decision's answer buttons lead.
 * @param input.resolution - How a resolved decision card ended.
 * @returns The entry.
 */
export function toMirrorCard(
  row: MirrorMessageRow,
  card: ChatCard,
  input: {
    readonly uiUrl: string;
    readonly answerHref?: string | null;
    readonly resolution?: MirrorResolution | null;
  },
): MirrorCard {
  const decision = row.kind === "decision_card";

  return {
    type: "card",
    id: row.id,
    at: row.posted_at.toISOString(),
    family: row.card_kind ?? "",
    severity: card.severity,
    mark: card.mark,
    headline: card.headline,
    lines: [...card.lines],
    stats: card.stats,
    actions: mirrorActions(card, { uiUrl: input.uiUrl, answerHref: input.answerHref ?? null }),
    footnote: card.footnote,
    state: decision ? (row.state ?? "open") : null,
    resolution: input.resolution ?? null,
    escalatedAt: row.escalated_at === null ? null : row.escalated_at.toISOString(),
  };
}

/**
 * A system line of the stream.
 *
 * @param row - Its message row.
 * @param text - The line.
 * @returns The entry.
 */
export function toMirrorLine(row: MirrorMessageRow, text: string): MirrorLine {
  return { type: "line", id: row.id, at: row.posted_at.toISOString(), text };
}

/**
 * A stored reply as the mirror answers it.
 *
 * @param reply - `chat_commands.reply` or `settled_reply`.
 * @param at - When it was said.
 * @param uiUrl - `OURO_UI_URL`.
 * @returns The reply, or null when nothing is stored.
 */
function toReply(
  reply: ChatSettledReply | null,
  at: Date | null,
  uiUrl: string,
): MirrorReply | null {
  if (reply === null) {
    return null;
  }

  return {
    text: reply.text,
    link:
      reply.link === undefined
        ? null
        : { label: reply.link.label, href: inAppHref(reply.link.url, uiUrl) },
    at: at === null ? null : at.toISOString(),
  };
}

/**
 * Whether a command answers in two parts — an acknowledgement, then a result.
 *
 * @param row - The command.
 * @returns True while it is pending, and afterwards when it left a result behind: its
 *   `settled_reply`, or the `result_message` a Slack command's settlement names.
 */
function asynchronous(row: MirrorCommandRow): boolean {
  return (
    row.outcome === "async_pending" ||
    row.settled_reply !== null ||
    (row.result_ref !== null && "result_message" in row.result_ref)
  );
}

/**
 * A command of the stream.
 *
 * @param row - The command row, with its author's name.
 * @param uiUrl - `OURO_UI_URL`.
 * @returns The entry. `reply.at` is when the command finished for one that answered at once,
 *   and when it was typed for an async command — whose `completed_at` is its result's instant,
 *   and is `result.at`.
 */
export function toMirrorCommand(row: MirrorCommandRow, uiUrl: string): MirrorCommand {
  return {
    type: "command",
    id: row.id,
    at: row.invoked_at.toISOString(),
    surface: row.surface,
    text: row.raw_text,
    author: row.author_name === null ? null : { name: row.author_name },
    outcome: row.outcome,
    reply: toReply(
      row.reply,
      asynchronous(row) ? row.invoked_at : (row.completed_at ?? row.invoked_at),
      uiUrl,
    ),
    result: toReply(row.settled_reply, row.completed_at, uiUrl),
  };
}
