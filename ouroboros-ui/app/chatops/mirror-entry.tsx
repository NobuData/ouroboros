"use client";

import type {
  ChatMirrorEntry,
  MirrorAction,
  MirrorCard,
  MirrorCommand,
  MirrorLine,
  MirrorReply,
  MirrorSeverity,
} from "@/app/api/chatops-mirror";
import { cx } from "@/app/ui/class-names";

import { BotMessage, Clock, PersonMessage, RefButton, SystemLine } from "./message";
import {
  ACTION_TONES,
  ESCALATED_MARK,
  PENDING_NOTE,
  cardSeverity,
  replyFailed,
  resolutionText,
} from "./view";

/**
 * One entry of a channel's mirror (CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)), in mockup 19's treatments.
 *
 * **There is one renderer per entry `type`, and nothing here knows an archetype.** A completion
 * card, a blocking question, a green build and a failed one are the same component handed
 * different records: the hue is the record's `severity`, the glyph its `mark`, and every word —
 * headline, lines, figures, button labels, footnote — is the service's, recomposed from the
 * stored row by the card model the Slack publisher renders. What is written in this file is only
 * the frame around a reply; who a message is from is drawn by `message.tsx`, which the
 * AI-presence card shares.
 *
 * **A resolved question has no buttons**, whatever the record's `actions` hold: it reads its
 * outcome and its actor where they were, as the channel does after the edit.
 */

/** The card's class for each severity — literal, so a search of the source finds every one. */
const RICH_CLASSES: Readonly<Record<MirrorSeverity, string>> = {
  ok: "chatops-mirror__rich--ok",
  warn: "chatops-mirror__rich--warn",
  accent: "chatops-mirror__rich--accent",
  err: "chatops-mirror__rich--err",
  info: "chatops-mirror__rich--info",
};

/** The headline's class for each severity. */
const HEADLINE_CLASSES: Readonly<Record<MirrorSeverity, string>> = {
  ok: "chatops-mirror__headline--ok",
  warn: "chatops-mirror__headline--warn",
  accent: "chatops-mirror__headline--accent",
  err: "chatops-mirror__headline--err",
  info: "chatops-mirror__headline--info",
};

/**
 * A card's buttons.
 *
 * @param props.actions The record's actions.
 * @returns The row.
 */
function Actions({ actions }: Readonly<{ actions: readonly MirrorAction[] }>) {
  return (
    <div className="chatops-mirror__actions">
      {actions.map((action) => (
        <RefButton href={action.href} key={action.id} label={action.label} tone={ACTION_TONES[action.style] ?? "ghost"} />
      ))}
    </div>
  );
}

/**
 * A card Ouroboros published.
 *
 * @param props.card The record.
 * @returns The message.
 */
function CardEntry({ card }: Readonly<{ card: MirrorCard }>) {
  const severity = cardSeverity(card.severity);
  const resolved = card.state === "resolved";
  // How a resolved card came out, when its record says.
  const answered = resolved ? card.resolution : null;

  return (
    <BotMessage at={card.at}>
      <div
        className={cx("chatops-mirror__rich", RICH_CLASSES[severity])}
        data-family={card.family}
        data-severity={card.severity}
        data-state={card.state ?? undefined}
      >
        <span className={cx("chatops-mirror__headline", HEADLINE_CLASSES[severity])}>
          {card.mark !== "" && <>{card.mark} </>}
          {card.headline}
        </span>
        {card.lines.map((line, index) => (
          // A card's lines are a fixed list with no identity of their own.
          <span className="chatops-mirror__line" key={`${String(index)}:${line}`}>
            {line}
          </span>
        ))}
        {card.stats !== null && card.stats !== "" && <span className="chatops-mirror__mono">{card.stats}</span>}
        {!resolved && card.actions.length > 0 && <Actions actions={card.actions} />}
        {answered !== null && <span className="chatops-mirror__resolution">{resolutionText(answered)}</span>}
        {card.escalatedAt !== null && (
          <span className="chatops-mirror__escalated">
            {ESCALATED_MARK} <Clock at={card.escalatedAt} />
          </span>
        )}
        {/* A resolved card's footnote says who answered — which the resolution line above already does. */}
        {answered === null && card.footnote !== null && card.footnote !== "" && (
          <span className="chatops-mirror__footnote">{card.footnote}</span>
        )}
      </div>
    </BotMessage>
  );
}

/**
 * A system line, between two rules.
 *
 * @param props.line The record.
 * @returns The line.
 */
function LineEntry({ line }: Readonly<{ line: MirrorLine }>) {
  return <SystemLine>{line.text}</SystemLine>;
}

/**
 * What a command said — at once, or when it finished — as a message from the app.
 *
 * @param props.reply The words and the link.
 * @param props.at When, for a reply that does not say.
 * @param props.failed Whether the command was refused or went wrong.
 * @param props.pending Whether its result is still on its way.
 * @returns The message.
 */
function ReplyMessage({
  reply,
  at,
  failed,
  pending,
}: Readonly<{ reply: MirrorReply; at: string; failed: boolean; pending: boolean }>) {
  return (
    <BotMessage at={reply.at ?? at}>
      <div className="chatops-mirror__answer">
        <div className={cx("chatops-mirror__reply", failed && "chatops-mirror__reply--err")}>{reply.text}</div>
        {reply.link !== null && <RefButton href={reply.link.href} label={reply.link.label} tone="ghost" />}
        {pending && <span className="chatops-mirror__pending">{PENDING_NOTE}</span>}
      </div>
    </BotMessage>
  );
}

/**
 * A command somebody ran, and what it answered.
 *
 * @param props.command The record.
 * @returns The person's line, the reply, and the result once there is one.
 */
function CommandEntry({ command }: Readonly<{ command: MirrorCommand }>) {
  const waiting = command.outcome === "async_pending" && command.result === null;
  // An outcome is the command's last word: once a result has arrived it describes the result,
  // and the acknowledgement above it was only ever an acknowledgement.
  const failed = replyFailed(command.outcome);

  return (
    <>
      <PersonMessage at={command.at} name={command.author?.name} surface={command.surface}>
        <div className="chatops-mirror__mono">
          <span className="chatops-mirror__cmd">{command.text}</span>
        </div>
      </PersonMessage>
      {command.reply !== null && (
        <ReplyMessage
          at={command.at}
          failed={failed && command.result === null}
          pending={waiting}
          reply={command.reply}
        />
      )}
      {command.reply === null && waiting && (
        <BotMessage at={command.at}>
          <span className="chatops-mirror__pending">{PENDING_NOTE}</span>
        </BotMessage>
      )}
      {command.result !== null && (
        <ReplyMessage at={command.at} failed={failed} pending={false} reply={command.result} />
      )}
    </>
  );
}

/**
 * One entry, by its type.
 *
 * @param props.entry The record.
 * @returns Its treatment — or nothing for a type this build does not know, rather than a guess.
 */
export function MirrorEntry({ entry }: Readonly<{ entry: ChatMirrorEntry }>) {
  switch (entry.type) {
    case "card":
      return <CardEntry card={entry} />;
    case "line":
      return <LineEntry line={entry} />;
    case "command":
      return <CommandEntry command={entry} />;
    default:
      return null;
  }
}
