"use client";

import { useId } from "react";

import type { SlackChannel } from "@/app/api/chatops";
import { InfoTip } from "@/app/inbox/info-tip";
import { useSecondsNow } from "@/app/shell/clock";
import { Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  MIRROR_FRESH_TITLE,
  MIRROR_LABEL,
  MIRROR_TIP_LABEL,
  MIRROR_TOOLTIP,
  OPEN_LABEL,
  PLATFORM_SEGMENT_LABEL,
  TEAMS_LABEL,
  TEAMS_REASON,
  channelName,
  mirrorFreshness,
  mirrorMeta,
  openName,
} from "./view";

// The shared note behind an ⓘ is the inbox's (#469), and its rules live in the inbox's sheet.
import "@/app/inbox/inbox.css";

/** What the head takes. */
export interface MirrorHeadProps {
  /** The channel the mirror is of. */
  readonly channel: SlackChannel;
  /** The platform's name, as the tag and the segment write it. */
  readonly platform: string;
  /** The installed app's version, or null when the connection does not say. */
  readonly appVersion: string | null;
  /** When the mirror was last read or confirmed, epoch milliseconds, or null before the first. */
  readonly updatedAt: number | null;
  /** The server's reading of the clock at first paint, in whole seconds. */
  readonly readAtSeconds: number;
  /** Read the mirror again now. */
  readonly onRefresh: () => void;
}

/**
 * The freshness tag — the poll family's own, ticking and pressable (`app/issues/freshness-tag.tsx`).
 *
 * Its own component so the second-by-second tick re-renders one tag and not the stream.
 *
 * @param props.updatedAt When the mirror was last read or confirmed, or null.
 * @param props.readAtSeconds The first paint's clock.
 * @param props.onRefresh What a press does.
 * @returns The tag.
 */
function Freshness({
  updatedAt,
  readAtSeconds,
  onRefresh,
}: Readonly<{ updatedAt: number | null; readAtSeconds: number; onRefresh: () => void }>) {
  const now = useSecondsNow(readAtSeconds);

  return (
    <button className={cx("ou-tag", "chatops-mirror__fresh")} onClick={onRefresh} title={MIRROR_FRESH_TITLE} type="button">
      {mirrorFreshness(updatedAt, now)}
    </button>
  );
}

/**
 * The mirror's head — mockup 19's `.chan-head`, and the three things it adds so that nobody
 * takes the card for Slack (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)).
 *
 * The channel's name, the platform tag, the Slack/Teams segment and the meta line are the
 * mockup's. **Teams is there and cannot be chosen**, and says in words when it can — beside the
 * control, not only on it. The meta line is connection truth: a half that is not known is left
 * out, never filled in.
 *
 * What is added: the **mirror** chip with the note behind it, the freshness tag, and **Open ↗**
 * — the way out to the conversation this card is only a record of.
 *
 * @param props See {@link MirrorHeadProps}.
 * @returns The head.
 */
export function MirrorHead({ channel, platform, appVersion, updatedAt, readAtSeconds, onRefresh }: MirrorHeadProps) {
  const teamsNote = useId();
  const meta = mirrorMeta(channel.memberCount, appVersion);

  return (
    <header className="chatops-mirror__head">
      <h2 className="chatops-mirror__channel">{channelName(channel)}</h2>
      <Tag>{platform}</Tag>
      <span aria-label={PLATFORM_SEGMENT_LABEL} className="chatops-mirror__seg" role="group">
        <button aria-pressed="true" className="chatops-mirror__seg-item chatops-mirror__seg-item--on" type="button">
          {platform}
        </button>
        <button
          aria-describedby={teamsNote}
          aria-disabled="true"
          aria-pressed="false"
          className="chatops-mirror__seg-item chatops-mirror__seg-item--off"
          title={TEAMS_REASON}
          type="button"
        >
          {TEAMS_LABEL}
        </button>
      </span>
      <span className="chatops-mirror__seg-note" id={teamsNote}>
        {TEAMS_REASON}
      </span>

      <span className="chatops-mirror__trail">
        {meta !== null && <span className="chatops-mirror__members">{meta}</span>}
        <span className="chatops-mirror__label">
          <span className="chatops-mirror__chip" title={MIRROR_TOOLTIP}>
            {MIRROR_LABEL}
          </span>
          <InfoTip label={MIRROR_TIP_LABEL}>{MIRROR_TOOLTIP}</InfoTip>
        </span>
        <Freshness onRefresh={onRefresh} readAtSeconds={readAtSeconds} updatedAt={updatedAt} />
        {channel.url !== "" && (
          <a
            aria-label={openName(channel)}
            className="chatops-mirror__out"
            href={channel.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {OPEN_LABEL}
          </a>
        )}
      </span>
    </header>
  );
}
