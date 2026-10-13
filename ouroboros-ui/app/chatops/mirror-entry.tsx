"use client";

import Image from "next/image";

import type {
  ChatMirrorEntry,
  MirrorAction,
  MirrorCard,
  MirrorCommand,
  MirrorLine,
  MirrorReply,
  MirrorSeverity,
} from "@/app/api/chatops-mirror";
import { Button } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  ACTION_TONES,
  APP_TAG,
  BOT_NAME,
  CONSOLE_SURFACE_MARK,
  ESCALATED_MARK,
  PENDING_NOTE,
  UNKNOWN_AUTHOR,
  cardSeverity,
  clockText,
  initials,
  isInApp,
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
 * who a message is from and the frame around a reply.
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

/** The app mark's drawn size, in CSS pixels — the sheet sizes it in rem. */
const MARK_SIZE = 22;

/**
 * An instant on the stream's clock.
 *
 * @param props.at The instant, ISO 8601.
 * @returns The time, or nothing for a stamp that cannot be read.
 */
function Clock({ at }: Readonly<{ at: string }>) {
  const text = clockText(at);

  return text === "" ? null : (
    <time className="chatops-mirror__ts" dateTime={at}>
      {text}
    </time>
  );
}

/**
 * A message from the app: its mark, its name with the tag that says it is an app, and the time.
 *
 * @param props.at When it was posted.
 * @param props.children What it said.
 * @returns The message.
 */
function BotMessage({ at, children }: Readonly<{ at: string; children: React.ReactNode }>) {
  return (
    <div className="chatops-mirror__msg">
      <span aria-hidden className="chatops-mirror__avatar">
        <Image
          alt=""
          className="chatops-mirror__mark chatops-mirror__mark--light"
          height={MARK_SIZE}
          src="/brand/icon-light.png"
          width={MARK_SIZE}
        />
        <Image
          alt=""
          className="chatops-mirror__mark chatops-mirror__mark--dark"
          height={MARK_SIZE}
          src="/brand/icon-dark.png"
          width={MARK_SIZE}
        />
      </span>
      <div className="chatops-mirror__body">
        <div className="chatops-mirror__meta">
          <span className="chatops-mirror__name chatops-mirror__name--bot">
            {BOT_NAME}
            <span className="chatops-mirror__app">{APP_TAG}</span>
          </span>
          <Clock at={at} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A small button that goes where a record points.
 *
 * A path of this application stays in the tab; an address with an origin of its own opens in a
 * new one.
 *
 * @param props.href Where.
 * @param props.label What the button says.
 * @param props.tone Its treatment.
 * @returns The link.
 */
function RefButton({
  href,
  label,
  tone,
}: Readonly<{ href: string; label: string; tone: "primary" | "danger" | "ghost" }>) {
  return isInApp(href) ? (
    <Button href={href} size="sm" tone={tone}>
      {label}
    </Button>
  ) : (
    <Button href={href} rel="noopener noreferrer" size="sm" target="_blank" tone={tone}>
      {label}
    </Button>
  );
}

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
  return <div className="chatops-mirror__sys">{line.text}</div>;
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
  const known = command.author !== null && command.author.name.trim() !== "";
  const waiting = command.outcome === "async_pending" && command.result === null;
  // An outcome is the command's last word: once a result has arrived it describes the result,
  // and the acknowledgement above it was only ever an acknowledgement.
  const failed = replyFailed(command.outcome);

  return (
    <>
      <div className="chatops-mirror__msg" data-surface={command.surface}>
        <span
          aria-hidden
          className={cx(
            "chatops-mirror__avatar",
            "chatops-mirror__avatar--human",
            !known && "chatops-mirror__avatar--unknown",
          )}
        >
          {initials(command.author?.name)}
        </span>
        <div className="chatops-mirror__body">
          <div className="chatops-mirror__meta">
            <span className="chatops-mirror__name">{known ? command.author?.name : UNKNOWN_AUTHOR}</span>
            {command.surface === "console" && (
              <span className="chatops-mirror__surface">{CONSOLE_SURFACE_MARK}</span>
            )}
            <Clock at={command.at} />
          </div>
          <div className="chatops-mirror__mono">
            <span className="chatops-mirror__cmd">{command.text}</span>
          </div>
        </div>
      </div>
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
