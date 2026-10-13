"use client";

import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";

import type { SlackChannel, SlackChannels } from "@/app/api/chatops";
import { runningLabel } from "@/app/shell/console";
import { Button, EmptyState, RETRY_LABEL, RetryBanner } from "@/app/ui";

import { RemovedBanner, UnlinkedBanner } from "./mirror-banners";
import { MirrorComposer } from "./mirror-composer";
import { MirrorEntry } from "./mirror-entry";
import { MirrorHead } from "./mirror-head";
import type { MirrorPollOptions } from "./mirror-poll";
import { useMirror } from "./use-mirror";
import { useMirrorComposer } from "./use-mirror-composer";
import {
  HISTORY_NOTE,
  LOADING_EARLIER_LABEL,
  LOAD_EARLIER_LABEL,
  MIRROR_EMPTY_TITLE,
  MIRROR_READING,
  MIRROR_STALE_HEADLINE,
  MIRROR_UNREAD,
  PLATFORM_LABELS,
  STREAM_LABEL,
  botRemoved,
  entryKey,
  mirrorDays,
  mirrorEmptyNote,
  mirrorName,
  standingNote,
} from "./view";

import "./chatops-mirror.css";

/** What the card takes. */
export interface MirrorCardProps {
  /** The bound channel, as the page's channel list serves it. */
  readonly channel: SlackChannel;
  /** The connection's app version, shown until the mirror's own first answer says it. */
  readonly appVersion: string | null;
  /** When the server read the page, ISO 8601. */
  readonly readAt: string;
  /** Test seams for the mirror's poll and its earlier read. */
  readonly poll?: MirrorPollOptions;
  /** Where the card puts its composer's handle, for the commands card's **Try it** (CA.3, #543). */
  readonly composerRef?: React.Ref<MirrorComposerHandle>;
  /** Whether this reader may refresh the channels and unbind — an owner or an admin (CA.5, #545). */
  readonly mayAdminister?: boolean;
  /** Whether to say the reader's Slack identity is not linked. */
  readonly unlinked?: boolean;
  /**
   * Whether the card shows history only: no composer, and no way to mend the channel from here —
   * the page's revoked or failing connection is what needs mending.
   */
  readonly readOnly?: boolean;
  /**
   * Called with the channels as a refresh or an unbind made from the card left them.
   *
   * @param channels The channels.
   */
  readonly onChannels?: (channels: SlackChannels) => void;
}

/** How many placeholder messages stand in for the stream while its first read is in flight. */
const SKELETON_MESSAGES = 3;

/** What the page may ask of the mirror's composer. */
export interface MirrorComposerHandle {
  /**
   * Put a line in the box and the focus on it, without sending it.
   *
   * @param line The line, prefix included.
   */
  readonly prefill: (line: string) => void;
}

/** How near the end of the stream counts as *at* it, in CSS pixels. */
const AT_BOTTOM_SLACK = 24;

/**
 * The channel mirror (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)) — mockup
 * 19's `.chat-card`, drawn from **our own records** of what was published to a channel and what
 * was invoked there, and labelled as exactly that.
 *
 * It is not Slack and does not pretend to be: the head says *mirror* and what that means, the
 * stream holds nothing a record did not put there, and the composer sends commands — which are
 * ours — and says in words that messages are not.
 *
 * **It stays current on the page's own poll family.** The latest page is re-read every cadence
 * and folded into what is held (`app/chatops/use-mirror.ts`), so a card published a moment ago
 * appears in place, and the earlier pages a reader loaded stay where they are. A re-read that
 * fails raises the retry banner over the stream **as last read**.
 *
 * **The stream scrolls inside its own wrapper**, never the pane. It follows the newest entry
 * only while the reader is already at the end; a reader who has scrolled up to read is left
 * where they are, and a page loaded above them is prepended without moving what they see.
 *
 * **It says when the picture is not the happy one** (CA.5,
 * [#545](https://github.com/NobuData/ouroboros/issues/545)): a reader with no linked Slack
 * identity, a channel the bot was removed from — with the way back — and a connection that is
 * gone, under which the card is history: the stream as it stood, and no composer.
 *
 * Mounted with the channel's id as its `key`, so nothing held here outlives the channel.
 *
 * @param props See {@link MirrorCardProps}.
 * @returns The card.
 */
export function MirrorCard({
  channel: listed,
  appVersion,
  readAt,
  poll,
  composerRef,
  mayAdminister = false,
  unlinked = false,
  readOnly = false,
  onChannels,
}: MirrorCardProps) {
  const mirror = useMirror(listed.id, poll);
  const { refresh } = mirror;

  const stream = useRef<HTMLDivElement>(null);
  /** Whether the reader is at the end of the stream — where new entries should keep them. */
  const following = useRef(true);
  /** Where the scroller stood just before an earlier page landed, to be put back after it. */
  const anchor = useRef<{ readonly height: number; readonly top: number } | null>(null);

  const onSent = useCallback(() => {
    // What was just sent is the newest entry, and the reader asked for it: go to it.
    following.current = true;
    refresh();
  }, [refresh]);

  const box = useRef<HTMLInputElement>(null);
  const composer = useMirrorComposer(listed.id, box, onSent);
  const sending = composer.cli.pending;
  const { prefill } = composer;

  useImperativeHandle(composerRef, () => ({ prefill }));

  // The mirror's own reading of the channel is the fresher one — whether the bot is still in it.
  const channel = mirror.page?.channel ?? listed;
  const now = useMemo(() => new Date(mirror.updatedAt ?? readAt), [mirror.updatedAt, readAt]);
  const days = useMemo(() => mirrorDays(mirror.entries, now), [mirror.entries, now]);

  useLayoutEffect(() => {
    const pane = stream.current;
    if (pane === null) return;

    if (anchor.current !== null) {
      // An earlier page landed above: keep what was on screen where it was.
      pane.scrollTop = pane.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
      return;
    }

    if (following.current) pane.scrollTop = pane.scrollHeight;
  }, [mirror.entries, sending]);

  /** Note whether the reader is at the end, each time they scroll. */
  function onScroll(event: React.UIEvent<HTMLDivElement>): void {
    const pane = event.currentTarget;

    following.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight <= AT_BOTTOM_SLACK;
  }

  /** Page backwards, holding the reader's place. */
  function loadEarlier(): void {
    mirror.loadEarlier(() => {
      const pane = stream.current;
      if (pane !== null) anchor.current = { height: pane.scrollHeight, top: pane.scrollTop };
    });
  }

  const warning = standingNote(channel);
  const unread = mirror.page === null && mirror.error !== null;
  const reading = mirror.page === null && mirror.error === null;
  const empty = mirror.page !== null && mirror.entries.length === 0;

  return (
    <section aria-label={mirrorName(channel)} className="chatops-mirror">
      <MirrorHead
        appVersion={mirror.page?.appVersion ?? appVersion}
        channel={channel}
        onRefresh={refresh}
        platform={PLATFORM_LABELS[mirror.page?.platform ?? "slack"] ?? PLATFORM_LABELS.slack}
        readAtSeconds={Math.floor(Date.parse(readAt) / 1000)}
        updatedAt={mirror.updatedAt}
      />

      {unlinked && !readOnly && <UnlinkedBanner channel={channel} />}

      {warning !== null &&
        (botRemoved(channel) && !readOnly ? (
          <RemovedBanner
            channel={channel}
            mayAdminister={mayAdminister}
            onChanged={(channels) => {
              onChannels?.(channels);
              refresh();
            }}
          />
        ) : (
          <div className="chatops-mirror__warning" role="note">
            <p className="chatops-mirror__warning-text">{warning}</p>
          </div>
        ))}

      {mirror.page !== null && mirror.error !== null && (
        <RetryBanner
          className="chatops-mirror__stale"
          headline={MIRROR_STALE_HEADLINE}
          onRetry={refresh}
          reason={mirror.error}
        />
      )}

      {/* The scroller is a region a keyboard can reach and move: it is the one thing here that scrolls. */}
      <div aria-label={STREAM_LABEL} className="chatops-mirror__stream" onScroll={onScroll} ref={stream} role="log" tabIndex={0}>
        {unread && (
          <EmptyState note={mirror.error} title={MIRROR_UNREAD} variant="flush">
            <Button onClick={refresh} size="sm" tone="ghost">
              {RETRY_LABEL}
            </Button>
          </EmptyState>
        )}
        {reading && (
          <div className="chatops-mirror__sk" role="status">
            <p className="chatops-mirror__reading">{MIRROR_READING}</p>
            {Array.from({ length: SKELETON_MESSAGES }, (_, index) => (
              <span aria-hidden="true" className="chatops-mirror__sk-row" key={index}>
                <span className="chatops-mirror__sk-avatar" />
                <span className="chatops-mirror__sk-lines">
                  <span className="chatops-mirror__sk-bar chatops-mirror__sk-bar--name" />
                  <span className="chatops-mirror__sk-bar" />
                </span>
              </span>
            ))}
          </div>
        )}
        {empty && sending === null && (
          <EmptyState note={mirrorEmptyNote(channel)} title={MIRROR_EMPTY_TITLE} variant="flush" />
        )}

        {mirror.hasEarlier && (
          <div className="chatops-mirror__earlier">
            <Button
              aria-busy={mirror.loadingEarlier || undefined}
              onClick={loadEarlier}
              reason={mirror.loadingEarlier ? LOADING_EARLIER_LABEL : undefined}
              size="sm"
              tone="ghost"
            >
              {mirror.loadingEarlier ? LOADING_EARLIER_LABEL : LOAD_EARLIER_LABEL}
            </Button>
            {mirror.earlierError !== null && (
              <p className="chatops-mirror__alert" role="alert">
                {mirror.earlierError}
              </p>
            )}
          </div>
        )}

        {days.map((day) => (
          <div className="chatops-mirror__day" key={day.key}>
            {day.label !== "" && (
              <div className="chatops-mirror__day-rule" role="separator">
                {day.label}
              </div>
            )}
            {day.entries.map((entry) => (
              <MirrorEntry entry={entry} key={entryKey(entry)} />
            ))}
          </div>
        ))}

        {/* Not a record yet, and marked as such: it is gone the moment the dispatcher answers. */}
        {sending !== null && (
          <p className="chatops-mirror__sending" role="status">
            {runningLabel(sending)}
          </p>
        )}
      </div>

      {readOnly ? (
        <p className="chatops-mirror__history" role="note">
          {HISTORY_NOTE}
        </p>
      ) : (
        <MirrorComposer channel={channel} composer={composer} inputRef={box} />
      )}
    </section>
  );
}
