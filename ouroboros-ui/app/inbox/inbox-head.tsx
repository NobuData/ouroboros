"use client";

import type { InboxQueue, InboxSnoozeResult, NotificationPreferences } from "@/app/api/inbox";
import { Eyebrow } from "@/app/ui";

import { NotificationsAction } from "./notifications-sheet";
import { SnoozeAll } from "./snooze-all";
import { HEAD_UNREAD, INBOX_EYEBROW, INBOX_SUBLINE, maySnoozeAll } from "./view";

/**
 * The page head (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)): the eyebrow,
 * the headline the service composed, the verbatim subline, and *Snooze all 1h* and *Notification
 * settings*.
 *
 * @param props.queue The latest queue, or `null` when none was read.
 * @param props.clock How an instant is printed.
 * @param props.onSnoozed Hears a snooze, so the page can re-read.
 * @param props.onPreferences Hears the preferences the sheet read or saved, so the channels card
 *   (BO.4, [#469](https://github.com/NobuData/ouroboros/issues/469)) shows the same ones.
 * @returns The head.
 */
export function InboxHead({
  queue,
  clock,
  onSnoozed,
  onPreferences,
}: Readonly<{
  queue: InboxQueue | null;
  clock: (atMs: number) => string;
  onSnoozed: (result: InboxSnoozeResult) => void;
  onPreferences?: (preferences: NotificationPreferences) => void;
}>) {
  return (
    <div className="inbox__head">
      <div className="inbox__headings">
        <Eyebrow>{INBOX_EYEBROW}</Eyebrow>
        <h1 className="inbox__title">{queue?.head.sentence ?? HEAD_UNREAD}</h1>
        <p className="inbox__sub">{INBOX_SUBLINE}</p>
      </div>
      <div className="inbox__actions">
        <SnoozeAll
          clock={clock}
          count={queue?.head.count ?? 0}
          maySnooze={maySnoozeAll(queue?.items ?? [])}
          onSnoozed={onSnoozed}
        />
        <NotificationsAction onPreferences={onPreferences} />
      </div>
    </div>
  );
}
