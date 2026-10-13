"use client";

import { useId } from "react";

import { Button, Card, CardHead } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { BotMessage, PersonMessage, RefButton, SystemLine } from "./message";
import {
  APPLY_REASON,
  COMMANDS_ANCHOR,
  ILLUSTRATED_LINE_PREFIX,
  LIVE_CAPTION,
  LIVE_THREAD_LABEL,
  PRESENCE_ARRIVES,
  PRESENCE_TITLE,
  PREVIEW_CAPTION,
  PREVIEW_CHIP,
  PREVIEW_SOURCE,
  PREVIEW_THREAD_LABEL,
  type PresenceEntry,
  type PresenceMessage,
  type PresenceSource,
  TODAY_POINTER,
} from "./presence-view";

import "./chatops-presence.css";

/** What the card takes. */
export interface AiPresenceCardProps {
  /** The id the card's title takes, so the card is named by it. */
  readonly titleId: string;
  /**
   * What to draw: the designed preview, or a live thread. The preview when omitted — which is
   * what the page passes until #546 supplies a live one. See `presence-view.ts`.
   */
  readonly source?: PresenceSource;
}

/**
 * The AI-presence card (CA.4, [#544](https://github.com/NobuData/ouroboros/issues/544)) — mockup
 * 19's **AI PRESENCE**, as a preview nobody can take for a control.
 *
 * **Today it is an illustration, and says so three ways.** The head carries a `preview` chip and
 * *arrives with AI presence (#546)*; the thread sits in a dashed frame and is named a preview to
 * a screen reader; and its closing system line is drawn faint between dashed rules, not in the
 * mirror's green between solid ones — the mirror's lines are things that happened, this one is
 * not.
 *
 * **Nothing in it acts, and one thing in it is real.** **Apply** is inert, with its reason as its
 * tooltip, as its description and in words under it — a reader on a keyboard or a touch screen
 * has no hover. **Open Analyzer →** is a link to the Build Analyzer, which exists.
 *
 * **It points at what works.** The caption is the commitment — *when it lands* — and under it a
 * link goes to the commands card, where the `/ouro` commands do this today.
 *
 * **It flips, it is not rebuilt.** Handed a live {@link PresenceSource}, the same layout and the
 * same message components draw a real thread: the chip, the arrival label, the frame and the
 * pointer go, **Apply** calls `onConfirm`, a system line is the mirror's own, and the composer
 * is drawn under the thread. The contract is written out in `presence-view.ts`.
 *
 * @param props See {@link AiPresenceCardProps}.
 * @returns The card.
 */
export function AiPresenceCard({ titleId, source = PREVIEW_SOURCE }: AiPresenceCardProps) {
  const arrives = useId();
  const preview = source.mode === "preview";

  return (
    <Card aria-labelledby={titleId} as="section" className="chatops-presence">
      <CardHead
        beside={
          preview && (
            <span className="chatops-presence__mark">
              <span className="chatops-presence__chip">{PREVIEW_CHIP}</span>
              <span className="chatops-presence__arrives" id={arrives}>
                {PRESENCE_ARRIVES}
              </span>
            </span>
          )
        }
        title={PRESENCE_TITLE}
        titleId={titleId}
      />

      <div
        aria-describedby={preview ? arrives : undefined}
        aria-label={preview ? PREVIEW_THREAD_LABEL : LIVE_THREAD_LABEL}
        className={cx("chatops-presence__thread", preview && "chatops-presence__thread--preview")}
        role="group"
      >
        {source.thread.entries.map((entry) => (
          <Entry entry={entry} key={entry.id} source={source} />
        ))}
      </div>

      {source.mode === "live" && source.composer}

      <p className="chatops-presence__caption">{preview ? PREVIEW_CAPTION : LIVE_CAPTION}</p>
      {preview && (
        <p className="chatops-presence__today">
          <a className="chatops-presence__today-link" href={`#${COMMANDS_ANCHOR}`}>
            {TODAY_POINTER.before}
            <code className="chatops-presence__code">{TODAY_POINTER.code}</code>
            {TODAY_POINTER.after}
          </a>
        </p>
      )}
    </Card>
  );
}

/**
 * One entry of the thread, by its type.
 *
 * @param props.entry The entry.
 * @param props.source The source it came from — what decides whether it can act.
 * @returns A message, or a system line.
 */
function Entry({ entry, source }: Readonly<{ entry: PresenceEntry; source: PresenceSource }>) {
  if (entry.type === "message") return <Message message={entry} source={source} />;

  // Something that happened is the mirror's line; something illustrated must not look like one.
  return source.mode === "live" ? (
    <SystemLine>{entry.text}</SystemLine>
  ) : (
    <div className="chatops-presence__sys">
      <span className="sr-only">{ILLUSTRATED_LINE_PREFIX} </span>
      {entry.text}
    </div>
  );
}

/**
 * A message, and the suggestion it ends with.
 *
 * @param props.message The message.
 * @param props.source The source it came from.
 * @returns The message, from its person or from the app.
 */
function Message({ message, source }: Readonly<{ message: PresenceMessage; source: PresenceSource }>) {
  const reason = useId();
  const { suggestion } = message;
  const body = (
    <div className="chatops-presence__said">
      <span className="chatops-presence__text">{message.text}</span>
      {suggestion !== null && (
        <>
          <div className="chatops-mirror__actions">
            {source.mode === "live" ? (
              <Button onClick={() => source.onConfirm(message.id)} size="sm" tone="primary">
                {suggestion.confirmLabel}
              </Button>
            ) : (
              <Button aria-describedby={reason} reason={APPLY_REASON} size="sm" tone="primary">
                {suggestion.confirmLabel}
              </Button>
            )}
            {suggestion.link !== null && (
              <RefButton href={suggestion.link.href} label={suggestion.link.label} tone="ghost" />
            )}
          </div>
          {source.mode === "preview" && (
            <span className="chatops-presence__why" id={reason}>
              {APPLY_REASON}
            </span>
          )}
        </>
      )}
    </div>
  );

  return message.from === "app" ? (
    <BotMessage at={message.at} clock={message.clock}>
      {body}
    </BotMessage>
  ) : (
    <PersonMessage at={message.at} clock={message.clock} name={message.name}>
      {body}
    </PersonMessage>
  );
}
