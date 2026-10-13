"use client";

import { useState, useTransition } from "react";

import type { SlackChannel, SlackChannels } from "@/app/api/chatops";
import { Button, Card, CardHead, Tag } from "@/app/ui";

import { unbindChannel } from "./chatops-actions";
import {
  BOUND_TITLE,
  OPEN_LABEL,
  PRIVATE_MARK,
  SHOWING_MIRROR_LABEL,
  SHOW_MIRROR_LABEL,
  UNBINDING_LABEL,
  UNBIND_FAILED,
  UNBIND_LABEL,
  boundChannels,
  channelName,
  membersText,
  openName,
  purposeLabel,
  refusalText,
  refused,
  routesText,
  showMirrorName,
  unbindName,
} from "./view";

/** What the list takes. */
export interface BoundChannelsProps {
  /** The workspace's channels, as served. */
  readonly channels: readonly SlackChannel[];
  /** Whether this reader may unbind — an owner or an admin. */
  readonly mayAdminister: boolean;
  /** The id the card's title takes, so the card is named by it. */
  readonly titleId: string;
  /** Called with the channels as they stand after an unbind. */
  readonly onChanged: (channels: SlackChannels) => void;
  /** The channel whose mirror is showing, or null when none is (CA.2, #542). */
  readonly shown?: string | null;
  /**
   * Show a channel's mirror. A row offers it only when this is given.
   *
   * @param id The channel.
   */
  readonly onShow?: (id: string) => void;
}

/**
 * The bound channels (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)) — every
 * channel with a purpose: its name, what it is for, who is in it, the route kinds pointed at it,
 * and the way out to the real conversation in Slack.
 *
 * A plain list on purpose: the channel *mirror* — our own record of what was published there —
 * is CA.2's card ([#542](https://github.com/NobuData/ouroboros/issues/542)), beside this one.
 * Each row's **Show mirror** is how that card is pointed at the row's channel; the row whose
 * mirror is showing says so, and is pressed.
 *
 * *Open ↗* is the service's own deep link. *Unbind* is an owner's or an admin's; while one is
 * in flight only the pressed row says so, and a refusal is printed under the list in the
 * service's words.
 *
 * @param props See {@link BoundChannelsProps}.
 * @returns The list's card.
 */
export function BoundChannels({
  channels,
  mayAdminister,
  titleId,
  onChanged,
  shown = null,
  onShow,
}: BoundChannelsProps) {
  const [unbinding, setUnbinding] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bound = boundChannels(channels);

  /**
   * Take a channel's purpose away.
   *
   * @param channel The channel.
   */
  function unbind(channel: SlackChannel): void {
    if (pending) return;

    setFailure(null);
    setUnbinding(channel.id);

    startTransition(async () => {
      try {
        const outcome = await unbindChannel(channel.id);

        if (refused(outcome)) setFailure(refusalText(outcome.error, UNBIND_FAILED));
        else onChanged(outcome);
      } catch {
        setFailure(UNBIND_FAILED);
      } finally {
        setUnbinding(null);
      }
    });
  }

  return (
    <Card aria-labelledby={titleId} as="section" className="chatops__bound">
      <CardHead title={BOUND_TITLE} titleId={titleId} />
      <ul className="chatops__channels">
        {bound.map((channel) => {
          const members = membersText(channel.memberCount);
          const busy = pending && unbinding === channel.id;

          return (
            <li className="chatops__channel" key={channel.id}>
              <div className="chatops__channel-text">
                <span className="chatops__channel-head">
                  <span className="chatops__channel-name">{channelName(channel)}</span>
                  {channel.purpose !== null && <Tag>{purposeLabel(channel.purpose)}</Tag>}
                  {channel.isPrivate && <span className="chatops__channel-mark">{PRIVATE_MARK}</span>}
                </span>
                <span className="chatops__channel-meta">
                  {members !== null && <>{members} · </>}
                  {routesText(channel.routes)}
                </span>
              </div>
              <div className="chatops__channel-actions">
                {onShow !== undefined && (
                  <Button
                    aria-label={showMirrorName(channel)}
                    aria-pressed={shown === channel.id}
                    onClick={() => onShow(channel.id)}
                    size="sm"
                    tone="ghost"
                  >
                    {shown === channel.id ? SHOWING_MIRROR_LABEL : SHOW_MIRROR_LABEL}
                  </Button>
                )}
                {channel.url !== "" && (
                  <a
                    aria-label={openName(channel)}
                    className="chatops__link"
                    href={channel.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {OPEN_LABEL}
                  </a>
                )}
                {mayAdminister && (
                  <Button
                    aria-label={unbindName(channel)}
                    onClick={() => unbind(channel)}
                    reason={busy ? UNBINDING_LABEL : undefined}
                    size="sm"
                    tone="ghost"
                  >
                    {busy ? UNBINDING_LABEL : UNBIND_LABEL}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {failure !== null && (
        <p className="chatops__refusal" role="alert">
          {failure}
        </p>
      )}
    </Card>
  );
}
