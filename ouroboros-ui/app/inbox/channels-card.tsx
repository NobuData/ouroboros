"use client";

import { type FormEvent, useId, useState } from "react";

import type { InboxChannel, InboxChannels, NotificationPreferences } from "@/app/api/inbox";
import type { Reading } from "@/app/api/reading";
import { Button, Card, CardHead, TextField, Toggle } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { updateNotificationSettings } from "./inbox-actions";
import { NotificationsAction } from "./notifications-sheet";
import {
  DIGEST_TIME_INVALID,
  PREFERENCES_FAILED,
  PREFERENCES_UNREADABLE,
  nextDigestLine,
  utcMinute,
} from "./notifications-view";
import {
  CHANNELS_TITLE,
  CHANNEL_SETTINGS_LABEL,
  CHAT_OPS_LABEL,
  CHAT_OPS_SOON,
  DIGEST_LEAD,
  DIGEST_SAVING,
  DIGEST_TIME_FIELD,
  DIGEST_TIME_SAVE,
  SOON_MARK,
  carriesDigest,
  channelStanding,
  digestSummary,
  digestTimeBlock,
} from "./side-view";

/** What {@link ChannelsCard} takes. */
export interface ChannelsCardProps {
  /** The channels, as served; `null` while they could not be read. */
  readonly channels: InboxChannels | null;
  /** Why they could not be read, or `null`. */
  readonly failure: string | null;
  /** The reader's notification preferences — what the email row's digest controls show. */
  readonly preferences: Reading<NotificationPreferences>;
  /** Hears the preferences whenever they are learned — a save on the row, a read or save in the sheet. */
  readonly onPreferences: (saved: NotificationPreferences) => void;
}

/**
 * The daily digest, on the email row: a switch, and — while it is on — the time it is sent.
 * Both write straight to the reader's preferences (BN.3's model, the one the sheet edits), and
 * the line under them is the service's own answer to *when is the next one*.
 *
 * @param props.preferences The reader's preferences.
 * @param props.onPreferences Hears what the service answered after a save.
 * @returns The controls.
 */
function DigestControls({
  preferences,
  onPreferences,
}: Readonly<{ preferences: NotificationPreferences; onPreferences: (saved: NotificationPreferences) => void }>) {
  const field = useId();
  const problem = useId();
  const [time, setTime] = useState(preferences.digest.time);
  const [held, setHeld] = useState(preferences.digest.time);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { enabled } = preferences.digest;

  // The saved time moved underneath the field — from here, or from the sheet. The field follows
  // it: what is saved is what it starts from. (Adjusted in render rather than by remounting, so a
  // reader who saved with Enter keeps their place in the field.)
  if (held !== preferences.digest.time) {
    setHeld(preferences.digest.time);
    setTime(preferences.digest.time);
  }

  const block = digestTimeBlock(time, preferences.digest.time);
  const invalid = block === DIGEST_TIME_INVALID;

  /**
   * Write one change, once at a time. Whatever happens — an answer, a refusal, a connection that
   * dropped under the call — the row ends up saying what is really saved, and why if it is not
   * what was asked.
   *
   * @param patch The fields to change.
   */
  function write(patch: Parameters<typeof updateNotificationSettings>[0]): void {
    if (saving) return;

    setSaving(true);
    setRefusal(null);
    void updateNotificationSettings(patch)
      .then((outcome) => {
        if (outcome.ok) onPreferences(outcome.value);
        else setRefusal(outcome.reason);
      })
      .catch(() => setRefusal(PREFERENCES_FAILED))
      .finally(() => setSaving(false));
  }

  /** Save the time the reader typed. */
  function submit(event: FormEvent): void {
    event.preventDefault();

    if (block === undefined) write({ digestTime: time });
  }

  return (
    <div className="inbox-channels__digest">
      <div className="inbox-channels__digest-row">
        <Toggle
          checked={enabled}
          label={DIGEST_LEAD}
          onClick={() => write({ digestEnabled: !enabled })}
          reason={saving ? DIGEST_SAVING : undefined}
        />
        <span aria-hidden className="inbox-channels__digest-lead">
          {DIGEST_LEAD}
        </span>
        <span className="inbox-channels__digest-state">{digestSummary(preferences)}</span>
      </div>
      {enabled && (
        <form className="inbox-channels__digest-time" onSubmit={submit}>
          <TextField
            // The refusal is printed under the whole editor, not inside the field, so the button
            // beside the box does not jump when it appears.
            aria-describedby={invalid ? problem : undefined}
            aria-invalid={invalid || undefined}
            className="inbox-channels__time-field"
            id={field}
            inputMode="numeric"
            label={DIGEST_TIME_FIELD}
            mono
            onChange={(event) => setTime(event.target.value.trim())}
            value={time}
          />
          <Button reason={saving ? DIGEST_SAVING : block} size="sm" type="submit">
            {DIGEST_TIME_SAVE}
          </Button>
        </form>
      )}
      {enabled && invalid && (
        <p className="inbox-channels__refusal" id={problem} role="alert">
          {block}
        </p>
      )}
      <p className="inbox-channels__next">{nextDigestLine(preferences, utcMinute)}</p>
      {refusal !== null && (
        <p className="inbox-channels__refusal" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * One channel: what it is, what it does, how it stands — all from the truth payload — and the
 * digest's controls when the row carries them.
 *
 * @param props.channel The channel, as served.
 * @param props.preferences The reader's preferences.
 * @param props.onPreferences Hears a save.
 * @returns The row.
 */
function ChannelRow({
  channel,
  preferences,
  onPreferences,
}: Readonly<{
  channel: InboxChannel;
  preferences: Reading<NotificationPreferences>;
  onPreferences: (saved: NotificationPreferences) => void;
}>) {
  const standing = channelStanding(channel);

  return (
    <li className="inbox-channels__row">
      {/* The mark shares the name's line only, so what the channel does keeps the card's width. */}
      <div className="inbox-channels__head">
        <p className="inbox-channels__name">{channel.label}</p>
        <span className={cx("inbox-channels__mark", standing.connected && "inbox-channels__mark--ok")}>
          {standing.mark}
        </span>
      </div>
      <p className="inbox-channels__sub">{channel.summary}</p>
      {standing.reason !== null && <p className="inbox-channels__reason">{standing.reason}</p>}
      {carriesDigest(channel) &&
        (preferences.ok ? (
          <DigestControls onPreferences={onPreferences} preferences={preferences.value} />
        ) : (
          <p className="inbox-channels__reason">{PREFERENCES_UNREADABLE}</p>
        ))}
    </li>
  );
}

/**
 * **Answer From Anywhere** (BO.4, [#469](https://github.com/NobuData/ouroboros/issues/469),
 * mockup 16) — where a decision can be answered from, as it really is.
 *
 * **The card decides nothing.** Each row is BN.3's truth payload (#463) verbatim: the channel's
 * name, what it does, and its state. A ✓ is drawn for `connected` and for nothing else — Slack
 * reads *Arrives with Chat Ops.* and push *Arrives later.* until those capabilities exist, and
 * both flip the day the payload says so, with no change here. A ✓ beside a channel that cannot
 * deliver is how a loop sits blocked for an afternoon waiting on a message that never comes.
 *
 * **Controls only where they do something.** The daily digest's switch and time live on the email
 * row, and only while email is connected; push has no switch at all until it can deliver. *Chat
 * Ops* is an honest *soon* rather than a link to a page that is not there, and the card's own
 * *All notification settings* opens the same sheet the page head does.
 *
 * @param props See {@link ChannelsCardProps}.
 * @returns The card.
 */
export function ChannelsCard({ channels, failure, preferences, onPreferences }: ChannelsCardProps) {
  const title = useId();

  return (
    <Card aria-labelledby={title} as="section">
      <CardHead
        className="inbox-side__head"
        title={CHANNELS_TITLE}
        titleId={title}
        trailing={
          <Button reason={CHAT_OPS_SOON} size="sm" tone="ghost">
            {/* The space keeps the accessible name's words apart — "Chat Ops soon". */}
            {CHAT_OPS_LABEL} <span className="inbox-channels__soon">{SOON_MARK}</span>
          </Button>
        }
      />
      {channels === null ? (
        failure !== null && <p className="inbox-channels__quiet">{failure}</p>
      ) : (
        <ul className="inbox-channels">
          {channels.channels.map((channel) => (
            <ChannelRow channel={channel} key={channel.id} onPreferences={onPreferences} preferences={preferences} />
          ))}
        </ul>
      )}
      <div className="inbox-channels__foot">
        <NotificationsAction label={CHANNEL_SETTINGS_LABEL} onPreferences={onPreferences} size="sm" />
      </div>
    </Card>
  );
}
