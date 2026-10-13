/**
 * The card model as Slack's Block Kit (BZ.2,
 * [#536](https://github.com/NobuData/ouroboros/issues/536)) — pure.
 *
 * The one place a card meets Slack's vocabulary. Everything above it — what a card says, which
 * buttons it has — is `chat/chat.card.ts`, which knows no platform; this file only decides how
 * Slack draws it.
 *
 * ```
 * card   attachments: [{ color, blocks: [ section *mark headline*, section lines,
 *                                         context `stats`, actions, context footnote ] }]
 * line   blocks: [ context text ]
 * ```
 *
 * A card is an attachment because that is what gives it the mockup's coloured border; a system
 * line is a bare context block, which Slack draws small and dim.
 *
 * **Every string is escaped.** A card's text comes from issue titles, file paths and people's
 * names. Slack's control characters are `&`, `<` and `>` — `<` is how a mention, a channel
 * broadcast and a link are written — so escaping those three means no fact can ping a channel or
 * disguise a link. Lengths are clipped to Slack's limits rather than refused by them.
 */

import type { ChatCard, ChatCardAction, ChatMessageModel, ChatSeverity } from "../chat/chat.card";
import { fallbackText } from "../chat/chat.card";
import type { ChatRendered } from "../chat/chat.backend";

/** The border colour of each severity — the mockup's ok, warn, accent, err and dim. */
export const SEVERITY_COLORS: Readonly<Record<ChatSeverity, string>> = {
  ok: "#2f9e6b",
  warn: "#d9a13a",
  accent: "#3a8fd9",
  err: "#d9534f",
  info: "#8a94a3",
};

/** The `action_id` prefix of a button that answers a decision — what #538's handler matches. */
export const ANSWER_ACTION_PREFIX = "ouro_answer:";

/** The `action_id` prefix of a link button. Slack still sends a press; it is acknowledged. */
export const LINK_ACTION_PREFIX = "ouro_link:";

/** Slack's limits for the fields this file fills. */
const SECTION_LIMIT = 3000;
const CONTEXT_LIMIT = 3000;
const BUTTON_TEXT_LIMIT = 75;
const NOTIFICATION_LIMIT = 300;

/** Slack draws at most 25 elements in an actions block; a card that had more keeps the first. */
const ACTIONS_LIMIT = 25;

/**
 * Escape text for Slack's `mrkdwn`.
 *
 * @param value - Plain text.
 * @returns It, with `&`, `<` and `>` as entities.
 */
export function escapeMrkdwn(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Clip text to a limit, marking the cut.
 *
 * @param value - The text.
 * @param limit - The most characters allowed.
 * @returns The text, or its start and an ellipsis.
 */
function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/**
 * One action as a button element.
 *
 * @param action - The action.
 * @returns The element.
 */
function button(action: ChatCardAction): Record<string, unknown> {
  const text = { type: "plain_text", text: clip(action.label, BUTTON_TEXT_LIMIT), emoji: true };

  if (action.type === "link") {
    return {
      type: "button",
      action_id: `${LINK_ACTION_PREFIX}${action.id}`,
      text,
      url: action.url,
    };
  }

  return {
    type: "button",
    action_id: `${ANSWER_ACTION_PREFIX}${action.id}`,
    text,
    value: action.value,
    // Slack has `primary` and `danger`; a default button carries no style at all.
    ...(action.style === "default" ? {} : { style: action.style }),
  };
}

/**
 * A card's blocks, top to bottom.
 *
 * @param card - The card.
 * @returns The blocks — only those the card has content for.
 */
export function cardBlocks(card: ChatCard): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: clip(`*${escapeMrkdwn(`${card.mark} ${card.headline}`)}*`, SECTION_LIMIT),
      },
    },
  ];

  if (card.lines.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clip(card.lines.map(escapeMrkdwn).join("\n"), SECTION_LIMIT) },
    });
  }

  if (card.stats !== null) {
    blocks.push({
      type: "context",
      // Backticks draw the line mono; one inside the figures would end it early.
      elements: [
        {
          type: "mrkdwn",
          text: clip(`\`${escapeMrkdwn(card.stats.replace(/`/g, "'"))}\``, CONTEXT_LIMIT),
        },
      ],
    });
  }

  if (card.actions.length > 0) {
    blocks.push({ type: "actions", elements: card.actions.slice(0, ACTIONS_LIMIT).map(button) });
  }

  if (card.footnote !== null) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: clip(escapeMrkdwn(card.footnote), CONTEXT_LIMIT) }],
    });
  }

  return blocks;
}

/**
 * Render a card or a system line for Slack.
 *
 * @param message - The model.
 * @returns The notification text and the `chat.postMessage` payload (`blocks`, `attachments`).
 */
export function renderBlockKit(message: ChatMessageModel): ChatRendered {
  // Slack parses the notification text and an attachment's fallback as `mrkdwn` too, so they
  // are escaped exactly as the blocks are: a fact must not ping a channel from there either.
  const text = clip(escapeMrkdwn(fallbackText(message)), NOTIFICATION_LIMIT);

  if (message.kind === "line") {
    return {
      text,
      payload: {
        blocks: [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: clip(escapeMrkdwn(message.text), CONTEXT_LIMIT) }],
          },
        ],
        attachments: [],
      },
    };
  }

  return {
    text,
    payload: {
      blocks: [],
      attachments: [
        { color: SEVERITY_COLORS[message.severity], fallback: text, blocks: cardBlocks(message) },
      ],
    },
  };
}
